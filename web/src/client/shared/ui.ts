/**
 * ui.ts — 두 화면이 함께 쓰는 표시 부품. apps-script/Shared.html 의 <script> 이식.
 *
 * ⚠️ alert() · confirm() 을 쓰지 않는다. 원본 주석: "alert/confirm은 폴링을 막으므로".
 *    소켓으로 바뀐 지금이 오히려 더 나쁘다 — 브라우저의 기본 대화상자는 그 탭의
 *    자바스크립트를 통째로 세우므로, 선생님이 확인을 누를 때까지 상태 푸시도 타이머도
 *    멈춘다. 그래서 확인 대화는 직접 만든다.
 *
 * ⚠️ 연결 배너(#conn)와 확인 대화(#modal)의 마크업은 여기서 한 벌만 만들어 넣는다.
 *    두 HTML 에 각각 복사해 두면 한쪽만 고쳐지는 날이 온다 (MIGRATION §5 '사본' 함정).
 */

let chromeReady = false;

/** 두 화면 공통 마크업을 문서에 한 번 심는다 */
function ensureChrome(): void {
  if (chromeReady) return;
  chromeReady = true;

  const conn = document.createElement('div');
  conn.id = 'conn';
  conn.className = 'hidden';
  conn.textContent = '연결이 불안정해요. 인터넷을 확인해주세요';

  const modal = document.createElement('div');
  modal.id = 'modal';
  modal.className = 'hidden';
  modal.innerHTML =
    '<div class="box"><p id="modal-msg"></p>' +
    '<div class="btns"><button class="no" id="modal-no">취소</button>' +
    '<button class="yes" id="modal-yes">확인</button></div></div>';

  document.body.appendChild(conn);
  document.body.appendChild(modal);

  let onYes: (() => void) | null = null;
  const close = () => { modal.classList.add('hidden'); onYes = null; };

  (modal.querySelector('#modal-yes') as HTMLButtonElement).onclick = () => {
    modal.classList.add('hidden');
    if (onYes) { const f = onYes; onYes = null; f(); }
  };
  (modal.querySelector('#modal-no') as HTMLButtonElement).onclick = close;

  confirmImpl = (msg, yes) => {
    (modal.querySelector('#modal-msg') as HTMLElement).textContent = msg;
    modal.classList.remove('hidden');
    onYes = yes;
  };
}

let confirmImpl: (msg: string, yes: () => void) => void = () => {};

/** 확인 대화. 원본 confirmBox 와 같은 모양(콜백)이다 */
export function confirmBox(msg: string, onYes: () => void): void {
  ensureChrome();
  confirmImpl(msg, onYes);
}

export function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error('없는 요소: ' + id);
  return el;
}

/** 있으면 주고 없으면 null. 화면 하나에만 있는 요소를 만질 때 쓴다 */
export function maybe(id: string): HTMLElement | null {
  return document.getElementById(id);
}

export function show(id: string, on: boolean): void {
  $(id).classList.toggle('hidden', !on);
}

export function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

interface ToastEl extends HTMLElement { _t?: number }

export function toast(msg: string): void {
  const el = document.getElementById('toast') as ToastEl | null;
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = window.setTimeout(() => el.classList.add('hidden'), 3500);
}

/** 진동 — 안드로이드 크롬만 듣는다. iOS는 조용히 무시되므로 분기하지 않는다 */
export function buzz(pattern: number | number[]): void {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* 지원 안 함 */ }
}

// ────────────────────────────────────────────────────────────
// 연결 배너
// ────────────────────────────────────────────────────────────

/**
 * 원본 onFail 의 배너. 세 가지 상태가 있다:
 *   숨김        — 정상
 *   흔들림 경고 — 소켓이 끊겨 재연결 중 (기본 문구)
 *   치명적      — 다시 시도해도 소용없는 이유 (NOT_HOST · WRONG_PIN …). 그 이유를 적는다
 */
export function showConn(text?: string): void {
  ensureChrome();
  const c = $('conn');
  c.textContent = text || '연결이 불안정해요. 인터넷을 확인해주세요';
  c.classList.remove('hidden');
}

export function hideConn(): void {
  ensureChrome();
  $('conn').classList.add('hidden');
}

// ────────────────────────────────────────────────────────────
// 버튼 잠금 (TOO_MANY_TRIES)
// ────────────────────────────────────────────────────────────

interface LockableButton extends HTMLButtonElement { _lockText?: string; _lockTimer?: number }

/**
 * 암호를 연속으로 틀리면 서버가 30초간 막는다 (src/do/ops.ts).
 *
 * ⚠️ 그동안 버튼을 그냥 두면 학생은 계속 누르고, 화면에는 같은 토스트만 반복된다 —
 *    "기다리면 풀린다"는 걸 알 방법이 없다. 그래서 남은 초를 버튼에 적어 보여준다.
 */
export function lockButton(btn: HTMLButtonElement | null, seconds: number): void {
  if (!btn) return;
  const b = btn as LockableButton;
  if (b._lockTimer) clearInterval(b._lockTimer);
  if (b._lockText === undefined) b._lockText = b.textContent || '';

  let left = seconds;
  b.disabled = true;
  const paint = () => { b.textContent = `${left}초 뒤에 다시 눌러주세요`; };
  paint();

  b._lockTimer = window.setInterval(() => {
    left--;
    if (left > 0) { paint(); return; }
    clearInterval(b._lockTimer);
    b._lockTimer = undefined;
    b.disabled = false;
    b.textContent = b._lockText || '';
    b._lockText = undefined;
  }, 1000);
}
