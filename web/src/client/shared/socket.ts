/**
 * socket.ts — 판 하나에 붙는 WebSocket. **폴링하지 않는다.**
 *
 * 상태의 정본은 서버가 미는 `{type:'state', data}` 다. 화면은 그걸 받아 그릴 뿐이고,
 * 주기적으로 상태를 물어보는 코드는 여기에도 화면에도 없다 (MIGRATION §7 4단계).
 *
 * ── 되돌리면 안 되는 것 ──
 *
 * 1. **암호·열쇠를 매 메시지에 싣는다.** 이 클래스는 자격 증명을 기억하지 않는다.
 *    소켓이 붙어 있다는 사실로 권한을 가정하면, 소켓 하나만 뚫려도 그 뒤가 전부 열린다
 *    (§4-4, GameRoom.ts SocketTag 주석). 그래서 send(op, args) 의 args 에 매번 넣는다.
 *
 * 2. **교실 와이파이는 끊긴다.** 끊기면 지수 백오프로 다시 붙고, 붙자마자 `resync()`
 *    (= getState) 를 불러 상태를 통째로 다시 받는다. 끊긴 동안 놓친 푸시를 따라잡는
 *    방법은 그것뿐이다 — 서버는 놓친 메시지를 다시 보내주지 않는다.
 *
 * 3. **재연결 대기에 지터를 넣는다.** 6모둠이 같은 순간(교실 AP 재부팅)에 끊기면
 *    지터가 없을 때 여섯이 정확히 같은 시각에 동시에 재접속한다.
 */

import type { Envelope } from '../../do/room.ts';

/** 지수 백오프 1 → 2 → 4 → 8 → 15초(상한). 15초를 넘기면 수업이 못 기다린다 */
const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];

/** 이 안에 답이 없으면 전송 실패로 본다. 교사 버튼은 그때 HTTP 로 넘어간다 (gateway.ts) */
const REPLY_TIMEOUT_MS = 8000;

/**
 * 끊긴 걸 알리기 전에 이만큼 기다린다.
 * ⚠️ 0 으로 두면 0.3초짜리 재연결에도 빨간 띠가 번쩍여서, 진짜 끊겼을 때와 구분이 안 된다.
 */
const BANNER_DELAY_MS = 1500;

export interface SocketDeps {
  /** 서버가 민 상태 */
  onState(data: unknown): void;
  /** 붙었다/끊겼다. 화면은 이걸로 배너를 켠다 */
  onStatus(up: boolean): void;
  /** 붙을 때마다 불린다. 여기서 getState 를 보내 상태를 다시 받는다 */
  resync(): void;
}

interface Pending {
  resolve(env: Envelope<unknown>): void;
  reject(e: Error): void;
  timer: number;
}

export class GameSocket {
  private code: string;
  private deps: SocketDeps;
  private ws: WebSocket | null = null;
  private tries = 0;
  private seq = 0;
  private pending = new Map<string, Pending>();
  private reconnectTimer = 0;
  private bannerTimer = 0;
  private closedByUs = false;

  constructor(code: string, deps: SocketDeps) {
    this.code = code;
    this.deps = deps;
  }

  get up(): boolean { return !!this.ws && this.ws.readyState === WebSocket.OPEN; }

  connect(): void {
    this.closedByUs = false;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${scheme}//${location.host}/ws/${encodeURIComponent(this.code)}`);
    this.ws = ws;

    ws.onopen = () => {
      this.tries = 0;
      clearTimeout(this.bannerTimer);
      this.deps.onStatus(true);
      // 끊긴 동안 놓친 것을 따라잡는 유일한 방법
      this.deps.resync();
    };

    ws.onmessage = (ev: MessageEvent) => this.onMessage(String(ev.data));

    ws.onclose = () => {
      this.ws = null;
      this.failAllPending('소켓이 끊겼어요');
      if (this.closedByUs) return;
      // 잠깐 끊긴 것과 진짜 끊긴 것을 구분한다
      clearTimeout(this.bannerTimer);
      this.bannerTimer = window.setTimeout(() => this.deps.onStatus(false), BANNER_DELAY_MS);
      this.scheduleReconnect();
    };

    // onerror 뒤에는 언제나 onclose 가 온다. 여기서 또 재연결을 걸면 두 벌이 돈다
    ws.onerror = () => { /* onclose 가 처리한다 */ };
  }

  close(): void {
    this.closedByUs = true;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.bannerTimer);
    if (this.ws) { try { this.ws.close(1000, '닫음'); } catch { /* 이미 끊김 */ } }
    this.ws = null;
  }

  /**
   * op 하나를 보내고 봉투를 기다린다.
   *
   * ⚠️ **거절(`{ok:false}`)은 resolve 로, 전송 실패는 reject 로 온다.**
   *    둘을 섞으면 "암호가 틀렸다" 와 "인터넷이 끊겼다" 를 화면이 구분하지 못한다.
   *    전자는 사람이 고칠 일이고, 후자는 다시 시도하거나 HTTP 로 넘어갈 일이다.
   */
  send(op: string, args: unknown[]): Promise<Envelope<unknown>> {
    return new Promise((resolve, reject) => {
      if (!this.up) { reject(new Error('연결이 끊겨 있어요')); return; }
      const id = String(++this.seq);
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('서버 응답이 없어요'));
      }, REPLY_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });
      try {
        this.ws!.send(JSON.stringify({ id, op, args }));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e as Error);
      }
    });
  }

  private onMessage(raw: string): void {
    let msg: { type?: string; id?: string; data?: unknown } | null = null;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg) return;

    if (msg.type === 'state') { this.deps.onState(msg.data); return; }

    if (msg.type === 'result') {
      const id = msg.id ? String(msg.id) : '';
      const p = this.pending.get(id);
      if (!p) return;                       // 시간이 지나 버린 답
      this.pending.delete(id);
      clearTimeout(p.timer);
      p.resolve(msg as unknown as Envelope<unknown>);
    }
  }

  private failAllPending(why: string): void {
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error(why)); }
    this.pending.clear();
  }

  private scheduleReconnect(): void {
    const base = BACKOFF_MS[Math.min(this.tries, BACKOFF_MS.length - 1)]!;
    this.tries++;
    // ±25% 지터 — 한 교실의 폰들이 같은 순간에 몰려 들어가지 않게
    const wait = Math.round(base * (0.75 + Math.random() * 0.5));
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => this.connect(), wait);
  }
}
