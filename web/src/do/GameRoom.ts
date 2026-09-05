/**
 * GameRoom.ts — Durable Object 어댑터. **판 코드 하나 = 인스턴스 하나** (idFromName(code)).
 *
 * 게임 규칙도 단계 기계도 여기 없다. 전부 Room 에 있고, 이 파일은 런타임을 꽂는 일만 한다:
 *   진짜 시계 · storage · alarm · WebSocket 푸시.
 * 이 경계를 흐리면 통합 게이트(test/room.ts)를 돌리는 데 workerd 가 필요해진다.
 *
 * ⚠️ 응답에 Date 객체를 넣지 않는다. 숫자(ms)만 (MIGRATION §5).
 * ⚠️ Room 메서드는 전부 동기다. 읽고→고치고→쓰기 사이에 await 를 넣으면 그 틈으로
 *    다른 요청이 끼어들어 코인이 증발한다 (§4-7). storage.put 은 **await 하지 않는다** —
 *    DO 의 output gate 가 "저장이 끝나기 전에는 응답이 나가지 않는다"를 보장한다.
 */

import { DurableObject } from 'cloudflare:workers';
import type { Level, Settings } from '../game/config.ts';
import type { Bets, GameState, Question } from '../game/types.ts';
import { Room, err } from './room.ts';
import type { AnimalTable, CreateConfig, Envelope, GameEvent } from './room.ts';
import { teacherView, teamView } from '../game/views.ts';

export interface Env {
  GAME_ROOM: DurableObjectNamespace<GameRoom>;
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

    // 깨어날 때 상태를 메모리에 올린다. 이게 끝나기 전에는 어떤 요청도 처리되지 않는다
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<GameState>('state');
      this.room.hydrate(saved ?? null);
    });
  }

  // ── HTTP ─────────────────────────────────────────────

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

    if (request.method === 'POST' && url.pathname.endsWith('/op')) {
      // ⚠️ await 는 여기까지만. dispatch 안에서는 상태를 만지는 동안 await 가 없다
      const body = await request.json<{ op?: string; args?: unknown[] }>().catch(() => null);
      if (!body || typeof body.op !== 'string') {
        return this.json(err('SHEET_INVALID', '요청 형식이 올바르지 않아요'), 400);
      }
      const result = this.dispatch(body.op, body.args || []);
      return this.json(result, result.ok ? 200 : 200);
    }

    return new Response('없는 경로예요', { status: 404 });
  }

  private json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status, headers: { 'content-type': 'application/json; charset=utf-8' }
    });
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
      ws.send(JSON.stringify({ type: 'result', ...err('SHEET_INVALID', '요청 형식이 올바르지 않아요') }));
      return;
    }
    // ⚠️ 판 만들기는 Worker 만 한다 (문제은행·D1 목록·코드 중복 확인이 거기 있다).
    //    소켓으로 열어두면 학생이 아무 코드의 방을 먼저 만들어 열쇠를 갖는다.
    if (msg.op === 'create') {
      ws.send(JSON.stringify({ type: 'result', id: msg.id, op: msg.op, ...err('NOT_HOST') }));
      return;
    }

    const result = this.dispatch(msg.op, msg.args || []);
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

  // ── 디스패치 ──────────────────────────────────────────

  /**
   * Worker 와 WebSocket 이 함께 쓰는 하나의 입구.
   * ⚠️ 여기부터 Room 메서드가 끝날 때까지 await 가 없다 (§4-7).
   */
  private dispatch(op: string, a: unknown[]): Envelope<unknown> {
    switch (op) {
      case 'create':
        return this.room.create(
          a[0] as CreateConfig, a[1] as Question[], a[2] as AnimalTable, a[3] as Partial<Settings>
        );
      case 'join':       return this.room.join(Number(a[0]), String(a[1]));
      case 'lobby':      return this.room.lobby();
      case 'getState':   return this.room.getState(
        a[0] as string | null, a[1] as string | null, a[2] as string | null
      );
      case 'chooseLevel':  return this.room.chooseLevel(Number(a[0]), a[1] as Level, String(a[2]));
      case 'submitAnswer': return this.room.submitAnswer(Number(a[0]), a[1] as Level, Number(a[2]), String(a[3]));
      case 'placeBet':     return this.room.placeBet(Number(a[0]), a[1] as Bets, String(a[2]));
      case 'advanceRound': return this.room.advanceRound(String(a[0]));
      case 'togglePause':  return this.room.togglePause(String(a[0]));
      case 'finalize':     return this.room.finalize(String(a[0]));
      case 'reveal':       return this.room.reveal(String(a[0]));
      case 'handout':      return this.room.handout(String(a[0]));
      default:             return err('SHEET_INVALID', `모르는 요청이에요: ${op}`);
    }
  }

  /** 감사·복구용. 스냅샷 뒤 이벤트를 읽어 온다 (게이트 D6b 의 restore 에 먹인다) */
  async events(): Promise<GameEvent[]> {
    const map = await this.ctx.storage.list<GameEvent>({ prefix: 'ev:' });
    return [...map.values()];
  }
}
