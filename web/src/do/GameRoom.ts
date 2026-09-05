/**
 * GameRoom.ts — Durable Object 어댑터. **판 코드 하나 = 인스턴스 하나** (idFromName(code)).
 *
 * 게임 규칙도 단계 기계도 여기 없다. 전부 Room 에 있고, 이름표(dispatch)와 암호 잠금은
 * ops.ts 에 있다. 이 파일은 런타임을 꽂는 일만 한다:
 *   진짜 시계 · storage · alarm · WebSocket 푸시.
 * 이 경계를 흐리면 통합 게이트(test/room.ts, test/gateway.ts)를 돌리는 데 workerd 가 필요해진다.
 *
 * ⚠️ 응답에 Date 객체를 넣지 않는다. 숫자(ms)만 (MIGRATION §5).
 * ⚠️ Room 메서드는 전부 동기다. 읽고→고치고→쓰기 사이에 await 를 넣으면 그 틈으로
 *    다른 요청이 끼어들어 코인이 증발한다 (§4-7). storage.put 은 **await 하지 않는다** —
 *    DO 의 output gate 가 "저장이 끝나기 전에는 응답이 나가지 않는다"를 보장한다.
 *
 * ── 3단계에서 달라진 것 ──
 *
 * `POST /op` HTTP 경로를 **없앴다.** 2단계에는 그게 있었고 스텁 Worker 가
 * `/room/:code/op` 를 그대로 넘겨서, 주소만 알면 누구나 `create` 를 부를 수 있었다
 * (MIGRATION §7 3단계 ⚠️). 지금 Worker 는 RPC 메서드 `op()` 로만 방을 부른다 —
 * RPC 는 바인딩을 가진 Worker 만 부를 수 있어서, **인터넷에서 닿을 수 있는 문 자체가 없다.**
 * fetch() 에 남은 것은 WebSocket 업그레이드 하나뿐이다.
 */

import { DurableObject } from 'cloudflare:workers';
import type { GameState } from '../game/types.ts';
import { Room, err } from './room.ts';
import type { Envelope, GameEvent } from './room.ts';
import { RoomOps } from './ops.ts';
import type { ThrottleState } from './ops.ts';
import { teacherView, teamView } from '../game/views.ts';

export interface Env {
  GAME_ROOM: DurableObjectNamespace<GameRoom>;
  DB: D1Database;
  /** wrangler secret. 없으면 관리자 경로는 전부 닫힌다 (src/server/router.ts) */
  ADMIN_PASSWORD?: string;
}

/**
 * 소켓에 붙여 두는 꼬리표. hibernation 으로 잠들었다 깨어나도 누구의 소켓인지 알기 위함이다.
 *
 * ⚠️ 이건 **누구에게 어떤 뷰를 밀어줄지** 정하는 데만 쓴다.
 *    들어오는 요청의 권한 확인에는 절대 쓰지 않는다 — 암호와 열쇠는 매 메시지에 실려 와야 하고,
 *    Room 이 매번 다시 본다. 꼬리표를 믿으면 소켓 하나만 뚫려도 그 뒤가 전부 열린다.
 */
interface SocketTag { role: 'teacher' | 'team' | 'none'; teamNo: number | null }

const NO_TAG: SocketTag = { role: 'none', teamNo: null };

/** 이벤트 열쇠. 문자열 정렬이 번호 순서와 같도록 0 을 채운다 */
const evKey = (seq: number) => 'ev:' + String(seq).padStart(9, '0');

export class GameRoom extends DurableObject<Env> {
  private room: Room;
  private ops: RoomOps;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    this.room = new Room({
      now: () => Date.now(),
      setAlarm: (at) => {
        // await 하지 않는다 — output gate 가 순서를 지킨다
        if (at === null) void this.ctx.storage.deleteAlarm();
        else void this.ctx.storage.setAlarm(at);
      },
      persist: (state) => { void this.ctx.storage.put('state', state); },
      appendEvent: (ev) => { void this.ctx.storage.put(evKey(ev.seq), ev); },
      changed: () => { this.broadcast(); }
    });

    // ⚠️ 실패 카운터를 저장소에 둔다. 메모리에만 두면 DO 가 잠들었다 깨어날 때마다 0 이 되고,
    //    브루트포스는 소켓을 끊었다 다시 붙이는 것만으로 잠금을 지운다
    this.ops = new RoomOps(this.room, {
      now: () => Date.now(),
      persistThrottle: (t) => { void this.ctx.storage.put('throttle', t); }
    });

    // 깨어날 때 상태를 메모리에 올린다. 이게 끝나기 전에는 어떤 요청도 처리되지 않는다
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<GameState>('state');
      this.room.hydrate(saved ?? null);
      this.ops.hydrateThrottle(await ctx.storage.get<ThrottleState>('throttle'));
    });
  }

  // ── RPC — Worker 만 부를 수 있는 입구 ──────────────────

  /**
   * Worker 라우트가 방을 부르는 유일한 통로.
   * 바인딩(GAME_ROOM)을 가진 코드만 부를 수 있으므로 공개 경로가 아니다.
   */
  async op(name: string, args: unknown[]): Promise<Envelope<unknown>> {
    return this.ops.op(name, args);
  }

  /**
   * ⚠️ 관리자 전용. 교사 열쇠를 되찾는 경로다 (MIGRATION §10).
   *    관리자 비밀번호 확인은 Worker 가 하고(상수 시간 비교), 여기는 값을 꺼내 줄 뿐이다.
   *    **이 값은 어떤 뷰에도 섞이지 않는다.** 그래서 op() 표에 넣지 않고 따로 뒀다 —
   *    표에 있으면 언젠가 소켓으로도 부를 수 있게 된다.
   */
  async adminHostKey(): Promise<string | null> {
    const state = this.room.raw();
    return state ? state.hostKey : null;
  }

  // ── HTTP — WebSocket 업그레이드만 ────────────────────

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith('/ws')) {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('WebSocket 업그레이드가 필요합니다', { status: 426 });
      }
      const pair = new WebSocketPair();
      const client = pair[0], server = pair[1];
      // hibernation API — 소켓이 조용한 동안 DO 가 잠들 수 있다. 6모둠이 40분간 붙어 있는
      // 수업에서 이게 없으면 그동안 내내 깨어 있게 된다
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment(NO_TAG);
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('없는 경로예요', { status: 404 });
  }

  // ── WebSocket ────────────────────────────────────────

  /**
   * ⚠️ 인증은 **매 메시지** Room 이 한다. 소켓에 붙은 꼬리표를 믿지 않는다.
   *    꼬리표는 인증이 성공한 뒤에만 갱신되고, 어디에 무엇을 밀어줄지 고르는 데만 쓴다.
   */
  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    let msg: { id?: string; op?: string; args?: unknown[] } | null = null;
    try { msg = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message)); }
    catch { msg = null; }

    if (!msg || typeof msg.op !== 'string') {
      ws.send(JSON.stringify({ type: 'result', ...err('BAD_REQUEST') }));
      return;
    }
    // ⚠️ 판 만들기는 Worker 만 한다 (문제은행·D1 목록·코드 중복 확인이 거기 있다).
    //    소켓으로 열어두면 학생이 아무 코드의 방을 먼저 만들어 열쇠를 갖는다.
    if (msg.op === 'create') {
      ws.send(JSON.stringify({ type: 'result', id: msg.id, op: msg.op, ...err('NOT_HOST') }));
      return;
    }

    const result = this.ops.op(msg.op, msg.args || []);
    if (result.ok) this.tagSocket(ws, msg.op, msg.args || []);
    ws.send(JSON.stringify({ type: 'result', id: msg.id, op: msg.op, ...result }));
  }

  override webSocketClose(ws: WebSocket, code: number, _reason: string, _wasClean: boolean): void {
    // 1005 = 코드 없음. 그대로 되돌려주면 닫기가 실패한다
    ws.close(code === 1005 || code === 1006 ? 1000 : code, '닫음');
  }

  /** 인증에 성공한 호출에서만 누구의 소켓인지 기억한다 */
  private tagSocket(ws: WebSocket, op: string, args: unknown[]): void {
    if (op !== 'getState' && op !== 'join') return;
    if (op === 'join') {
      ws.serializeAttachment({ role: 'team', teamNo: Number(args[0]) } satisfies SocketTag);
      return;
    }
    const viewer = String(args[0] || '');
    if (viewer.indexOf('team:') === 0) {
      ws.serializeAttachment({ role: 'team', teamNo: Number(viewer.split(':')[1]) } satisfies SocketTag);
    } else {
      ws.serializeAttachment({ role: 'teacher', teamNo: null } satisfies SocketTag);
    }
  }

  /**
   * 상태가 바뀔 때마다 연결된 소켓에 **각자의 뷰**를 민다.
   * 교사 소켓엔 teacherView, 모둠 소켓엔 그 모둠의 teamView 다.
   * ⚠️ 한 벌을 만들어 모두에게 보내면 안 된다 — 모둠끼리 힌트와 코인 내역이 새고,
   *    교사 뷰에는 학생이 알면 안 되는 lastRound 가 들어 있다 (§8-2).
   */
  private broadcast(): void {
    const state = this.room.raw();
    if (!state) return;
    const now = Date.now();

    for (const ws of this.ctx.getWebSockets()) {
      let tag: SocketTag = NO_TAG;
      try { tag = (ws.deserializeAttachment() as SocketTag) || NO_TAG; } catch { tag = NO_TAG; }
      if (tag.role === 'none') continue;         // 아직 자기가 누구인지 밝히지 않은 소켓

      const data = tag.role === 'teacher'
        ? teacherView(state, now)
        : teamView(state, Number(tag.teamNo), now);
      try { ws.send(JSON.stringify({ type: 'state', data })); } catch { /* 끊긴 소켓 */ }
    }
  }

  // ── 알람 — 단계 전환이 일어나는 유일한 사건 ─────────────

  override async alarm(): Promise<void> {
    this.room.onAlarm();
  }

  /** 감사·복구용. 스냅샷 뒤 이벤트를 읽어 온다 (게이트 D6b 의 restore 에 먹인다) */
  async events(): Promise<GameEvent[]> {
    const map = await this.ctx.storage.list<GameEvent>({ prefix: 'ev:' });
    return [...map.values()];
  }
}
