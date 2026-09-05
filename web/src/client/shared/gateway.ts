/**
 * gateway.ts — 봉투를 다루는 한 곳. HTTP 라우트와 소켓이 같은 봉투를 쓴다 (MIGRATION §8-1b).
 *
 * ⚠️ **화면은 HTTP 상태 코드로 분기하지 않는다.** `error` 코드로 분기하고 `message` 는
 *    그대로 학생에게 보여준다. 상태 코드는 로그를 읽는 사람과 프록시를 위한 것이다
 *    (router.ts STATUS 주석). 문장으로 분기하면 말투를 다듬는 순간 화면이 깨진다.
 */

import type { Envelope } from '../../do/room.ts';
import { lockButton, toast } from './ui.ts';
import type { GameSocket } from './socket.ts';

/**
 * 다시 눌러도 소용없는 실패들. 원본 Shared.html 의 FATAL 그대로다.
 * 이런 코드를 받으면 조용히 재시도하지 않고 배너에 이유를 적는다 —
 * 재시도만 하면 왜 안 되는지 영영 모른다.
 */
export const FATAL: Record<string, true> = {
  NOT_HOST: true, WRONG_PIN: true, GAME_NOT_FOUND: true, GAME_ENDED: true
};

/** 서버가 잠근 시간(초). src/do/ops.ts THROTTLE.lockMs 와 같아야 한다 */
export const LOCK_SECONDS = 30;

/**
 * HTTP 헤더 값은 Latin-1 바이트만 실을 수 있다. 한글·이모지가 든 값을 헤더에 넣으면
 * **브라우저가 요청을 만들다가 던진다** — 서버까지 가지도 못한다.
 *
 * ⚠️ 그냥 두면 화면에는 "서버에 닿지 못했어요" 만 떠서, 선생님은 배포가 고장 난 줄 안다.
 *    관리자 비밀번호를 헤더로 보내는 두 화면(관리 화면 · 교사 '이어하기')이 보내기 전에
 *    이 함수로 걸러 이유를 말한다. 배포 절차에도 "영문·숫자·기호만" 이라고 적혀 있다.
 */
export function headerSafe(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0xFF) return false;
  return true;
}

export const HEADER_UNSAFE_MSG =
  '이 비밀번호는 브라우저가 보낼 수 없어요 — 한글이나 이모지가 들어 있습니다.\n' +
  '관리자 비밀번호를 영문·숫자·기호로 바꿔주세요 (npx wrangler secret put ADMIN_PASSWORD)';

export function isOk<T>(env: Envelope<T>): env is { ok: true; data: T } {
  return env.ok === true;
}

/**
 * 원본 handle() 이식.
 * 거절이면 문장을 띄우고 null 을 준다. `TOO_MANY_TRIES` 면 누른 버튼을 30초 잠근다.
 */
export function handle(env: Envelope<unknown>, from?: HTMLButtonElement | null): unknown | null {
  if (isOk(env)) return env.data;
  if (env.message) toast(env.message);
  if (env.error === 'TOO_MANY_TRIES') lockButton(from ?? null, LOCK_SECONDS);
  return null;
}

// ────────────────────────────────────────────────────────────
// HTTP
// ────────────────────────────────────────────────────────────

export interface ApiOptions {
  method?: string;
  body?: unknown;
  /** ⚠️ 인증은 헤더가 정본이다. 물음표 뒤(query)로 보내지 않는다 — 주소는 기록에 남는다 */
  headers?: Record<string, string>;
}

/**
 * HTTP 라우트 하나를 부른다.
 *
 * ⚠️ 4xx·5xx 에도 던지지 않는다. 서버는 언제나 봉투를 돌려주고, 화면은 그 `error` 로
 *    분기해야 하기 때문이다. 던지는 것은 **응답 자체가 오지 못했을 때**뿐이다.
 */
export async function api(path: string, opts: ApiOptions = {}): Promise<Envelope<unknown>> {
  const init: RequestInit = {
    method: opts.method || 'GET',
    headers: { ...(opts.headers || {}) },
    cache: 'no-store'
  };
  if (opts.body !== undefined) {
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }

  const res = await fetch(path, init);
  const env = await res.json().catch(() => null) as Envelope<unknown> | null;
  if (!env || typeof env.ok !== 'boolean') throw new Error('서버 응답을 읽지 못했어요');
  return env;
}

// ────────────────────────────────────────────────────────────
// 교사 op — 소켓이 죽어도 눌리게
// ────────────────────────────────────────────────────────────

/**
 * 소켓 op 이름 → 같은 일을 하는 HTTP 라우트.
 *
 * ⚠️ 원본에는 없던 것이다. 넣은 이유: 교실에서 와이파이가 잠깐 끊긴 사이에도
 *    선생님은 라운드를 넘겨야 한다. 소켓이 다시 붙기를 기다리는 동안 수업이 선다.
 *
 * ⚠️ **교사 op 만** 여기 있다. 학생 행동(답 제출·베팅)까지 HTTP 로 되살리면,
 *    끊긴 폰이 뒤늦게 보낸 요청이 마감 뒤에 도착하는 경로가 하나 더 생긴다.
 *    학생은 다시 누르면 되고, 그때는 서버가 단계로 판단한다.
 */
export const TEACHER_HTTP: Record<string, string> = {
  advanceRound: 'advance',
  togglePause: 'pause',
  skipPhase: 'skip',
  finalize: 'finalize',
  reveal: 'reveal',
  handout: 'handout'
};

/**
 * 교사 op 하나. 소켓으로 보내고, **전송이 실패하면** 같은 op 을 HTTP 로 다시 보낸다.
 *
 * ⚠️ 거절(`{ok:false}`)은 재시도하지 않는다. 열쇠가 틀렸다면 HTTP 로도 틀리다.
 *    재시도하는 것은 전송 실패(끊김·응답 없음)뿐이다 — socket.send 가 reject 하는 경우다.
 */
export async function hostOp(
  sock: GameSocket | null, code: string, hostKey: string, op: string, args: unknown[] = []
): Promise<Envelope<unknown>> {
  if (sock) {
    try { return await sock.send(op, [hostKey, ...args]); }
    catch { /* 아래로 내려가 HTTP 로 다시 시도한다 */ }
  }
  const seg = TEACHER_HTTP[op];
  if (!seg) throw new Error('연결이 끊겼어요');
  return api(`/api/game/${encodeURIComponent(code)}/${seg}`, {
    method: 'POST',
    headers: { 'X-Host-Key': hostKey }
  });
}
