/**
 * teacher/main.ts — 교사 화면 (S1 시작 · 배포 안내 · S2 진행 · S3 정산).
 *
 * apps-script/Teacher.html 의 <script> 를 옮긴 것이다. 트랙·배당판·암호 blur·인쇄는
 * 그대로고, 서버를 부르는 방식과 '열쇠를 되찾는 길'만 바뀌었다.
 *
 * ── 옮기면서 일부러 다르게 한 것 ──
 *
 * 1. **교사 열쇠 회수** — 원본은 "스프레드시트 메뉴 → 교사 열쇠 확인"이었다. 시트가 없는
 *    지금은 **관리자 비밀번호**로 되찾는다 (MIGRATION §10 — 사용자 결정).
 *    `POST /api/admin/host-key`. `ADMIN_PASSWORD` 를 안 넣고 배포하면 이 경로는 통째로
 *    닫히고(`ADMIN_DISABLED`), 그때는 판을 만든 브라우저 말고는 이어갈 방법이 없다.
 *
 * 2. **'🔧 진단' 버튼이 없다.** 그 버튼이 보여주던 것은 전부 스프레드시트 상태였다
 *    (getActive · openById · listUnits …). 문제은행이 D1 으로 옮겨져 해당하는 것이 없다.
 *
 * 3. **소켓이 죽어도 진행 버튼은 눌린다.** 원본에 없던 것이다 — 교실에서 와이파이가
 *    잠깐 끊긴 사이에도 선생님은 라운드를 넘겨야 한다. shared/gateway.ts 의 hostOp 이
 *    소켓 전송이 실패하면 같은 op 을 HTTP 라우트로 다시 보낸다.
 *
 * ⚠️ 교사 열쇠는 **매 메시지에 싣는다.** 소켓이 붙어 있다는 사실로 권한을 가정하지 않는다.
 *
 * ── 4b 연출 (MIGRATION §11) ──
 *
 * 4. **경주 무대**는 `./stage.ts` (PixiJS) 다. `import()` 로 늦게 부른다 — 정적으로 부르면
 *    PixiJS 가 학생 폰 번들에도 실린다. 무대가 켜지면 4a 의 CSS 트랙(`#track`)을 숨기고,
 *    `prefers-reduced-motion` 이거나 WebGL 이 없으면 무대를 아예 안 만들고 CSS 트랙으로 간다.
 *    **어느 쪽이든 게임은 그대로 돈다** (§11-1).
 *
 * 5. **배당판**은 다시 그리지 않고 **고쳐 쓴다.** 트랙 레인과 같은 이유다 —
 *    매번 innerHTML 로 갈면 굴러가던 숫자와 날아오던 칩이 매 푸시마다 처음으로 돌아간다.
 */

import type { AnimalCode } from '../../game/config.ts';
import type { TeacherView } from '../../game/views.ts';
import { ServerClock } from '../shared/clock.ts';
import { FATAL, api, handle, hostOp, isOk } from '../shared/gateway.ts';
import { qrSvg } from '../shared/qr.ts';
import { GameSocket } from '../shared/socket.ts';
import { $, confirmBox, esc, hideConn, maybe, reducedMotion, showConn, toast } from '../shared/ui.ts';
import type { RaceStage } from './stage.ts';

// ────────────────────────────────────────────────────────────
// 이 화면이 기억하는 것
// ────────────────────────────────────────────────────────────

let CODE = '';
let HOSTKEY = '';
let LAST: TeacherView | null = null;
let prevOdds: Partial<Record<AnimalCode, number>> = {};
let lastVersion = -1;

const clock = new ServerClock();
let sock: GameSocket | null = null;
let playing = false;

/** PixiJS 경주 무대. null 이면 4a 의 CSS 트랙으로 돈다 (reduced-motion · WebGL 없음) */
let stage: RaceStage | null = null;
let stageLoading = false;
let stageRaf = 0;
let stageLastAt = 0;
/** 정지 화면을 매 프레임 다시 그리지 않기 위한 표식 */
let stillKey = '';

/** 배포 안내에 쓰는 학생 주소. 판을 만들 때 / 다시 보기 할 때 서버가 준다 */
let studentUrl = '';

// ────────────────────────────────────────────────────────────
// 교사 열쇠
// ────────────────────────────────────────────────────────────

/**
 * 판 코드는 칠판에 적혀 있어서 비밀이 아니다. 교사 화면임을 증명하는 건 이 열쇠뿐이다 (§4-4).
 * 판을 만든 기기에 저장해두고, 없으면 관리자 비밀번호로 되찾는다.
 * (localStorage 가 막힌 브라우저에서도 판 만들기 → 진행은 그대로 된다 — 그 세션 동안은 변수에 있으니까)
 */
function keyStore(code: string, val?: string): string | null {
  try {
    if (val === undefined) return localStorage.getItem('wd_host_' + code);
    localStorage.setItem('wd_host_' + code, val);
  } catch { /* 막힌 브라우저 */ }
  return val ?? null;
}

// ────────────────────────────────────────────────────────────
// S1 — 새 판
// ────────────────────────────────────────────────────────────

function pane(k: 'new' | 'resume'): void {
  $('tab-new').className = k === 'new' ? 'on' : '';
  $('tab-resume').className = k === 'resume' ? 'on' : '';
  $('pane-new').classList.toggle('hidden', k !== 'new');
  $('pane-resume').classList.toggle('hidden', k !== 'resume');
}

function drawNames(): void {
  const n = Number(($('cnt') as HTMLSelectElement).value);
  let h = '';
  for (let i = 1; i <= n; i++) h += `<input id="tn${i}" placeholder="${i}모둠">`;
  $('names').innerHTML = h;
}

interface RecentRow { code: string; className: string; unit: string; createdAt: number; isOver: boolean }

function loadUnits(): void {
  api('/api/units').then((env) => {
    const d = handle(env) as { units: string[]; recent: RecentRow[]; recentError: string | null } | null;
    if (!d) return;

    const sel = $('unit') as HTMLSelectElement;
    const setupBox = $('no-questions');
    if (!d.units.length) {
      sel.innerHTML = '<option value="">— 문제가 없습니다 —</option>';
      sel.disabled = true;
      setupBox.classList.remove('hidden');
    } else {
      sel.disabled = false;
      setupBox.classList.add('hidden');
      sel.innerHTML = d.units.map((u) => `<option>${esc(u)}</option>`).join('');
    }

    let c = '';
    for (let i = 2; i <= 8; i++) c += `<option${i === 6 ? ' selected' : ''}>${i}</option>`;
    ($('cnt') as HTMLSelectElement).innerHTML = c;
    drawNames();

    // ⚠️ 최근 판 목록은 라운드 진행 상황을 담지 않는다 — 인증 없이 나가는 목록이기 때문이다
    //    (ports.ts RecentGame 주석). 그래서 원본의 '몇 라운드' 칸이 '만든 날짜'로 바뀌었다
    $('recent').innerHTML = d.recent.length
      ? d.recent.map((g) =>
          `<tr data-code="${esc(g.code)}" style="cursor:pointer"><td><b>${esc(g.code)}</b></td>` +
          `<td>${esc(g.className)}</td><td>${esc(g.unit)}</td>` +
          `<td>${esc(dateText(g.createdAt))}</td><td>${g.isOver ? '끝남' : '진행중'}</td></tr>`).join('')
      : '<tr><td colspan="5" style="color:var(--muted)">아직 만든 판이 없어요. 새 판을 만들어 보세요.</td></tr>';

    if (d.recentError) toast('최근 판 목록을 읽지 못했어요: ' + d.recentError);
    checkSheets();
  }).catch(() => {
    $('check').innerHTML = '<div class="stop">⛔ 서버에 닿지 못했어요\n' +
      '잠시 뒤 새로고침해주세요.</div>';
  });
}

function dateText(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 판을 만들기 전 문제은행 미리보기 (원본 gwPrepare) */
function checkSheets(): void {
  const u = ($('unit') as HTMLSelectElement).value;
  if (!u) return;
  api(`/api/prepare?unit=${encodeURIComponent(u)}`).then((env) => {
    const d = handle(env) as { blocking: string[]; warnings: string[] } | null;
    if (!d) return;
    let h = '';
    if (d.blocking.length) h += `<div class="stop">⛔ 시작할 수 없어요\n${esc(d.blocking.join('\n'))}</div>`;
    if (d.warnings.length) h += `<div class="warn">⚠️ ${esc(d.warnings.join('\n'))}</div>`;
    $('check').innerHTML = h;
  }).catch(() => { /* 미리보기가 없어도 판 만들기는 서버가 다시 검사한다 */ });
}

interface CreateResult {
  code: string; hostKey: string; pins: Record<number, string>;
  teams: { no: number; name: string }[]; warnings: string[]; studentUrl: string;
}

function create(): void {
  const n = Number(($('cnt') as HTMLSelectElement).value);
  const names: string[] = [];
  for (let i = 1; i <= n; i++) names.push((($(`tn${i}`) as HTMLInputElement).value || '').trim());

  const unit = ($('unit') as HTMLSelectElement).value;
  if (!unit) { toast('단원을 골라주세요'); return; }

  api('/api/game', {
    method: 'POST',
    body: {
      className: ($('cls') as HTMLInputElement).value || '우리 반',
      unit, teamCount: n, teamNames: names
    }
  }).then((env) => {
    const d = handle(env, $('btn-create') as HTMLButtonElement) as CreateResult | null;
    if (!d) return;
    CODE = d.code;
    HOSTKEY = d.hostKey;
    keyStore(CODE, HOSTKEY);
    if (d.warnings && d.warnings.length) toast('⚠️ ' + d.warnings.join(' / '));
    drawHandout(d);
    $('s1').classList.add('hidden');
    $('handout').classList.remove('hidden');
  }).catch(() => toast('서버 응답이 없어요'));
}

// ────────────────────────────────────────────────────────────
// 배포 안내 — 판 코드 · QR · 가려진 암호
// ────────────────────────────────────────────────────────────

interface HandoutData {
  code: string; pins: Record<number, string>;
  teams: { no: number; name: string }[]; studentUrl?: string;
}

function drawHandout(d: HandoutData): void {
  studentUrl = d.studentUrl || studentUrl;
  $('out-code').textContent = d.code;
  $('qr-code-echo').textContent = d.code;
  $('out-url').textContent = studentUrl;

  // 학생 폰이 못 여는 주소면 미리 알린다 (원본은 앱스 스크립트의 /dev 주소를 걸렀다)
  const badUrl = !/^https?:\/\//.test(studentUrl);
  $('url-warn').classList.toggle('hidden', !badUrl);

  // QR 은 화면이 그린다 — 서버는 주소만 준다 (router.ts studentUrlOf 주석).
  // 라이브러리를 받아오지 않고 번들 안의 구현을 쓴다 (shared/qr.ts)
  $('out-qr').innerHTML = studentUrl ? qrSvg(studentUrl, 6) : '';

  $('out-pins').innerHTML = d.teams.map((t) =>
    `<tr><td>${t.no}모둠</td><td>${esc(t.name)}</td>` +
    `<td><span class="pin">${esc(d.pins[t.no])}</span></td></tr>`).join('');
}

function revealAllPins(): void {
  const all = document.querySelectorAll<HTMLElement>('.pin');
  let anyHidden = false;
  all.forEach((el) => { if (!el.classList.contains('show')) anyHidden = true; });
  all.forEach((el) => el.classList.toggle('show', anyHidden));
}

/**
 * 2차시에 학생들이 다시 접속할 때.
 * ⚠️ 여기만 소켓이 아니라 HTTP 로 부른다 — 학생 주소(studentUrl)는 전송 계층의 것이라
 *    HTTP 라우트만 붙여 준다 (router.ts handout). 소켓 응답에는 그게 없다.
 */
function showHandout(): void {
  api(`/api/game/${encodeURIComponent(CODE)}/handout`, {
    method: 'POST', headers: { 'X-Host-Key': HOSTKEY }
  }).then((env) => {
    const d = handle(env) as HandoutData | null;
    if (!d) return;
    drawHandout(d);
    $('s2').classList.add('hidden');
    $('handout').classList.remove('hidden');
  }).catch(() => toast('서버 응답이 없어요'));
}

// ────────────────────────────────────────────────────────────
// S1 — 이어하기
// ────────────────────────────────────────────────────────────

function resume(): void {
  const c = (($('rcode') as HTMLInputElement).value || '').toUpperCase().trim();
  if (c.length !== 4) { toast('판 코드 4자리를 입력해주세요'); return; }

  const stored = keyStore(c);
  if (stored) { verifyAndPlay(c, stored); return; }

  // 이 기기에 열쇠가 없다 — 관리자 비밀번호로 되찾는다 (MIGRATION §10)
  const row = $('key-row');
  const pw = ($('radmin') as HTMLInputElement).value || '';
  if (row.classList.contains('hidden') || !pw) {
    row.classList.remove('hidden');
    ($('radmin') as HTMLInputElement).focus();
    toast('이 기기에 교사 열쇠가 없어요. 관리자 비밀번호를 넣어주세요');
    return;
  }

  api('/api/admin/host-key', {
    method: 'POST', headers: { 'X-Admin-Password': pw }, body: { code: c }
  }).then((env) => {
    if (!isOk(env)) {
      // ADMIN_DISABLED 는 사용자가 고칠 수 있는 문제가 아니다 — 배포 설정을 알려준다
      if (env.error === 'ADMIN_DISABLED') {
        toast('관리자 기능이 꺼져 있어요 — 배포 설정(ADMIN_PASSWORD)을 확인해주세요');
      } else toast(env.message);
      ($('radmin') as HTMLInputElement).value = '';
      return;
    }
    const d = env.data as { code: string; hostKey: string };
    ($('radmin') as HTMLInputElement).value = '';
    verifyAndPlay(c, d.hostKey);
  }).catch(() => toast('서버 응답이 없어요'));
}

/**
 * 진행 화면으로 넘어가기 전에 열쇠부터 확인한다.
 * ⚠️ 넘어간 뒤에 막히면 다시 입력할 자리가 없어서 새로고침밖에 방법이 없다 (원본 주석).
 */
function verifyAndPlay(code: string, key: string): void {
  api(`/api/game/${encodeURIComponent(code)}/state?viewer=teacher`, {
    headers: { 'X-Host-Key': key }
  }).then((env) => {
    if (!isOk(env)) {
      toast(env.message);
      $('key-row').classList.remove('hidden');
      ($('radmin') as HTMLInputElement).focus();
      return;
    }
    CODE = code; HOSTKEY = key;
    keyStore(code, key);
    // 학생 주소는 이 브라우저의 출처와 같다. 배포 안내를 다시 열면 서버 값으로 덮인다
    studentUrl = studentUrl || location.origin + '/';
    goPlay();
    applyState(env.data as TeacherView);
  }).catch(() => toast('서버 응답이 없어요'));
}

// ────────────────────────────────────────────────────────────
// S2 진행
// ────────────────────────────────────────────────────────────

function goPlay(): void {
  $('s1').classList.add('hidden');
  $('handout').classList.add('hidden');   // 암호표를 TV에 남기지 않는다
  $('s2').classList.remove('hidden');
  if (playing) return;                    // '다시 보기'에서 돌아온 경우 — 소켓을 두 벌 열지 않는다
  playing = true;

  sock = new GameSocket(CODE, {
    onState: (data) => applyState(data as TeacherView),
    onStatus: (up) => { if (up) hideConn(); else showConn(); },
    resync: () => { void resync(); }
  });
  sock.connect();
  window.setInterval(tick, 1000);
  void ensureStage();
}

// ────────────────────────────────────────────────────────────
// 경주 무대 (MIGRATION §11-2)
// ────────────────────────────────────────────────────────────

/**
 * PixiJS 무대를 붙인다. **실패해도 조용히 CSS 트랙으로 돌아간다.**
 *
 * ⚠️ 여기서 예외를 밖으로 던지면 진행 화면이 통째로 멈춘다. 연출 때문에 수업이 멎는
 *    것이 이 프로젝트에서 제일 나쁜 결과다 (§11-1 "연출은 거들 뿐").
 * ⚠️ `import()` 여야 한다 — 정적 import 로 바꾸면 PixiJS 가 학생 폰 번들에도 실린다.
 */
async function ensureStage(): Promise<void> {
  if (stage || stageLoading) return;
  // 캔버스 안은 CSS 미디어쿼리가 못 막는다. 여기서 물어보고 아예 만들지 않는다
  if (reducedMotion()) return;
  stageLoading = true;
  try {
    const mod = await import('./stage.ts');
    const s = await mod.createStage($('race-stage'));
    if (!s) return;                                  // WebGL 없음 — CSS 트랙 그대로
    stage = s;
    $('race-stage').classList.remove('hidden');
    $('track').classList.add('hidden');
    if (LAST) s.still(LAST);
    if (typeof ResizeObserver !== 'undefined') {
      // 카드 폭이 바뀌면 칸 눈금·결승선 위치가 전부 틀어진다 — 다시 짓게 한다
      new ResizeObserver(() => { s.resize(); stillKey = ''; }).observe($('race-stage'));
    }
    startStageLoop();
  } catch {
    /* 무대가 없어도 게임은 돈다 */
  } finally {
    stageLoading = false;
  }
}

/**
 * 무대의 유일한 시간축. **서버 시각으로 계산한 진행률**을 넣는다 (§11-2) —
 * 늦게 들어온 폰·TV 가 같은 지점에서 같은 경주를 본다.
 *
 * ⚠️ 정지 화면은 상태가 바뀔 때만 다시 그린다. 매 프레임 다 그리면 교실 TV(대개 낡은
 *    노트북)가 아무 일도 없는 3분 토론 동안 팬을 돌린다.
 */
function startStageLoop(): void {
  if (stageRaf) return;
  const tick = (now: number): void => {
    stageRaf = requestAnimationFrame(tick);
    const s = stage, d = LAST;
    if (!s || !d || d.isOver) return;
    const dt = stageLastAt ? Math.min(80, now - stageLastAt) : 16;
    stageLastAt = now;

    // ⚠️ 'moving' 이 아니라 raceMoves 로 판단한다 — 경주 중에 일시정지하면 phase 는
    //    'paused' 가 되지만 경주는 그 자리에 서 있어야 한다 (elapsed 가 멈춰 준다)
    const t = d.raceMoves ? clock.elapsed(d) : null;
    if (t != null) { s.frame(d, t, dt); stillKey = ''; return; }
    const key = d.stateVersion + '|' + d.phase;
    if (key !== stillKey) { stillKey = key; s.still(d); }
  };
  stageRaf = requestAnimationFrame(tick);
}

async function resync(): Promise<void> {
  if (!sock) return;
  try {
    const env = await sock.send('getState', ['teacher', HOSTKEY, null]);
    if (isOk(env)) { hideConn(); applyState(env.data as TeacherView); return; }
    if (FATAL[env.error]) { sock.close(); showConn(env.message || '이 판을 볼 수 없어요'); }
    else toast(env.message);
  } catch { /* 소켓이 곧 다시 붙는다 */ }
}

function applyState(d: TeacherView): void {
  clock.sync(d);
  LAST = d;
  if (d.stateVersion !== lastVersion) { lastVersion = d.stateVersion; render(d); }
  tick();
}

const PHASE_KO: Record<string, string> = {
  waiting: '준비', moving: '이동 중', quiz: '문제 푸는 중',
  discuss: '모둠 토론 중', betting: '베팅 중', paused: '일시정지', done: '종료'
};

function render(d: TeacherView): void {
  if (d.isOver) { showResult(d); return; }
  $('p-cls').textContent = `${d.className} · ${d.unit}`;
  $('p-round').textContent = `${d.round}라운드`;
  $('ver').textContent = '배포 ' + d.deployVersion;

  const codes = Object.keys(d.animals) as AnimalCode[];
  drawTrack(d, codes);
  drawTote(d, codes);

  $('prog').innerHTML = d.teams.map((t) =>
    `<tr><td>${esc(teamLabel(t.no, t.name))}</td>` +
    `<td class="${t.answered ? 'ok' : 'wait'}">${t.answered ? '✅ 제출' : '⏳ 푸는중'}</td>` +
    `<td class="${t.betLocked ? 'ok' : 'wait'}">${t.betLocked ? '💰 확정' : '⏳'}</td></tr>`).join('');

  const waiting = d.phase === 'waiting';
  const next = nextRoundNo(d);
  $('btn-round').classList.toggle('hidden', !waiting);
  $('btn-round').textContent = `🎲 ${next}라운드 시작`;
  $('btn-pause').textContent = d.phase === 'paused' ? '▶ 이어하기' : '⏸ 일시정지';
  $('btn-pause').classList.toggle('hidden', waiting);

  // 경주 20초. 무대가 켜져 있으면 라운드 번호·카운트다운을 무대가 크게 보여주므로
  // 이 문구는 감춘다 — 겹쳐 놓으면 8m 밖에서 두 글자가 서로를 가린다 (§11-1)
  const note = $('phase-note');
  if (d.phase === 'moving') {
    if (stage) { note.classList.add('hidden'); } else {
      note.textContent = '🏇 경주 중';
      note.classList.remove('hidden');
    }
  } else if (waiting) {
    note.textContent = `${next}라운드 준비`;
    note.classList.remove('hidden');
  } else {
    note.classList.add('hidden');
  }
}

/**
 * 이 버튼을 누르면 **몇 라운드가 시작되는가**. 서버가 준 `roundStarted` 를 본다.
 *
 * ⚠️ 이건 **표시용 숫자**일 뿐이다. 라운드를 넘길지 말지는 언제나 서버가 정한다 —
 *    화면이 "1라운드인가?"로 판단하면 라운드가 무한 반복된다 (MIGRATION §8-3, 게이트 BUG1).
 *    이 함수가 틀려도 버튼에 적힌 숫자만 틀리고 게임은 그대로 돈다.
 */
function nextRoundNo(d: TeacherView): number {
  return d.roundStarted ? d.round + 1 : d.round;
}

/** 1초마다. 서버 시각으로 다시 센다 (폴링이 아니다) */
function tick(): void {
  const d = LAST;
  if (!d || d.isOver) return;
  const left = clock.secondsLeft(d);
  const t = $('p-timer');
  t.textContent = (PHASE_KO[d.phase] || '') + (left != null ? `  ⏱ ${left}` : '');
  t.className = 'timer num' + (left != null && left <= 10 ? ' urgent' : '');
}

/* ── 트랙 그리기 ──
   ⚠️ 되돌리면 안 되는 곳: 레인 DOM은 판이 바뀔 때만 짓고, 그 뒤엔 left 값만 만진다.
      매번 innerHTML로 갈아끼우면 요소가 새로 생겨서 말이 순간이동한다. */
const SILK = 8;
let trackKey: string | null = null;
let wasFinished: Record<string, boolean> = {};

interface Runner extends HTMLElement { _pct?: number; _t?: number }

function drawTrack(d: TeacherView, codes: AnimalCode[]): void {
  const key = codes.join(',');
  if (trackKey !== key) {
    $('track').innerHTML = codes.map((c, i) => {
      const pct = pctOf(d.positions[c], d.trackCells);
      return `<div class="lane" id="ln-${c}">` +
        `<div class="lane-tag"><span class="silk s${i % SILK}">${i + 1}</span>` +
          `<span class="lane-name">${esc(d.animals[c])}</span></div>` +
        '<div class="course">' +
          `<div class="covered" id="cv-${c}" style="width:${coveredW(pct)}"></div>` +
          `<div class="runway"><div class="runner" id="rn-${c}" style="left:${pct}%">` +
            `<div class="trail"></div><div class="horse">${d.emojis[c] || '🐎'}</div>` +
          '</div></div>' +
          '<div class="finish"></div>' +
        '</div>' +
        `<div class="lane-pos num" id="lp-${c}"></div></div>`;
    }).join('');
    trackKey = key; wasFinished = {};   // 이어하기로 들어온 판은 처음 위치에서 시작 — 질주 연출 없음
  }

  // ⚠️ 트랙 칸 수는 서버가 준 값이다. 10 으로 박아 두면 '설정' 탭의 트랙칸수를 12 로 바꿔도
  //    화면은 10칸에서 골인시킨다 — 앱스 스크립트판이 정확히 그랬다 (MIGRATION §5 trackCells)
  const cells = d.trackCells || 10;
  codes.forEach((c) => {
    const raw = d.positions[c];
    const fin = raw >= cells;
    const pct = pctOf(raw, cells);
    const runner = maybe('rn-' + c) as Runner | null;
    const lane = maybe('ln-' + c);
    if (!runner || !lane) return;

    const moved = runner._pct !== undefined && pct > runner._pct;
    runner.style.left = pct + '%';
    const cv = maybe('cv-' + c);
    if (cv) cv.style.width = coveredW(pct);
    const lp = maybe('lp-' + c);
    if (lp) lp.textContent = fin ? '골인' : `${Math.max(0, raw)}/${cells}`;
    lane.classList.toggle('finished', fin);

    if (moved) {                       // 달리는 동안만 다리를 움직인다
      runner.classList.add('galloping');
      clearTimeout(runner._t);
      runner._t = window.setTimeout(() => runner.classList.remove('galloping'), 1200);
    }
    if (fin && !wasFinished[c]) {       // 골인은 딱 한 번만 번쩍인다
      wasFinished[c] = true;
      lane.classList.add('justFinished');
      window.setTimeout(() => lane.classList.remove('justFinished'), 2100);
    }
    runner._pct = pct;
  });
}

function pctOf(pos: number, cells: number): number {
  const n = Math.max(1, cells || 10);
  return Math.max(0, Math.min(n, pos || 0)) / n * 100;
}

/* 지나온 거리 막대는 말과 끝이 맞아야 한다.
   말은 runway(양옆 32px·24px 들여쓴 칸) 기준이고 막대는 course 전체 기준이라, 그 차이를 여기서 맞춘다 */
function coveredW(pct: number): string { return `calc((100% - 56px) * ${pct / 100})`; }

/* 이름을 비우면 서버가 '1모둠'으로 채운다(room.ts). 거기에 번호를 또 붙이면 '1모둠 1모둠'이 된다 */
function teamLabel(no: number, name: string): string {
  const n = String(name || '');
  return n === no + '모둠' ? n : `${no}모둠 ${n}`;
}

/* ── 라이브 배당판 (MIGRATION §11-3) ──
   이 이전의 눈에 보이는 성과다. 폴링 2초가 아니라 **베팅이 확정되는 순간** 움직인다.

   판돈 막대로 "어디에 돈이 몰렸는지"를 보이고, 늘어난 줄에는 칩이 날아와 쌓이고,
   배당은 롤링 숫자로 굴러가며 ▲▼를 단다.
   화살표를 같이 쓰는 건 색만으로 뜻을 전하지 않기 위해서다 (05-design-system §2)

   ⚠️ **인기순으로 정렬하지 않는다.** 줄이 바뀌면 눈이 못 따라간다 (05 §4-2)
   ⚠️ **어느 모둠이 걸었는지는 표시하지 않는다** (05 §4-3, §11-6). 그걸 보이면 토론이 망가진다.
      늘어난 개수는 `pool` 차이로만 안다
   ⚠️ **줄을 매번 다시 짓지 않는다.** 트랙 레인과 같은 이유다 — innerHTML 로 갈아끼우면
      굴러가던 숫자와 날아오던 칩이 매 상태 푸시마다 처음으로 돌아간다 */

/** 손으로 맞춘 값들. 8m 가독성을 해치지 않는 선에서 조절하는 자리 */
const TOTE = {
  /** 배당 숫자가 굴러가는 시간(ms). 05 §5 "애니메이션은 0.6초를 넘지 않는다" */
  rollMs: 500,
  /** 한 줄에 쌓아 보여주는 칩의 최대 개수. 넘으면 +n 으로 적는다 */
  maxChips: 24
};

let toteKey: string | null = null;
let prevBets: Partial<Record<AnimalCode, number>> = {};
let prevTotal: number | null = null;

interface Roll { from: number; to: number; at: number; digits: number; suffix: string }
const rolls = new Map<string, Roll>();
let rollRaf = 0;

/** 숫자를 이전 값에서 새 값으로 굴린다 (odometer). reduced-motion 이면 즉시 바꾼다 */
function roll(id: string, from: number, to: number, digits: number, suffix: string): void {
  const el = maybe(id);
  if (!el) return;
  if (reducedMotion() || from === to) {
    rolls.delete(id);
    el.textContent = to.toFixed(digits) + suffix;
    return;
  }
  rolls.set(id, { from, to, at: performance.now(), digits, suffix });
  if (!rollRaf) rollRaf = requestAnimationFrame(rollTick);
}

function rollTick(now: number): void {
  rollRaf = 0;
  for (const [id, r] of [...rolls]) {
    const u = Math.min(1, (now - r.at) / TOTE.rollMs);
    const e = 1 - Math.pow(1 - u, 3);                  // 끝에서 부드럽게 멎는다
    const el = maybe(id);
    if (el) el.textContent = (r.from + (r.to - r.from) * e).toFixed(r.digits) + r.suffix;
    if (u >= 1) rolls.delete(id);
  }
  if (rolls.size) rollRaf = requestAnimationFrame(rollTick);
}

function drawTote(d: TeacherView, codes: AnimalCode[]): void {
  let total = 0;
  const bets: Partial<Record<AnimalCode, number>> = {};
  codes.forEach((c) => { bets[c] = Math.max(0, d.pool[c] - d.seedCoins); total += bets[c] as number; });

  const key = codes.join(',');
  const fresh = toteKey !== key;
  if (fresh) {
    $('odds').innerHTML = codes.map((c, i) =>
      `<tr id="tr-${c}">` +
      `<td class="t-silk"><span class="silk s${i % SILK}">${i + 1}</span></td>` +
      `<td class="t-name">${d.emojis[c] || ''} ${esc(d.animals[c])}</td>` +
      '<td><div class="pool-wrap">' +
        `<div class="pool-fill" id="pf-${c}"></div></div>` +
        `<div class="tchips" id="ch-${c}"></div></td>` +
      `<td class="t-coins num"><span id="tc-${c}">0</span><span class="u">코인</span></td>` +
      '<td class="t-odds">' +
        `<span class="odds num" id="to-${c}">${d.odds[c].toFixed(2)}배</span>` +
        `<span class="delta" id="td-${c}"></span></td></tr>`).join('');
    toteKey = key;
    prevBets = {};
    prevTotal = null;
    rolls.clear();
  }

  codes.forEach((c) => {
    const now = d.odds[c];
    const prev = prevOdds[c];
    const moved = prev !== undefined && Math.abs(prev - now) > 0.005;
    const up = moved && now > (prev as number);

    roll('to-' + c, prev === undefined ? now : prev, now, 2, '배');
    const oddsEl = maybe('to-' + c);
    if (oddsEl && moved && !reducedMotion()) {
      oddsEl.classList.remove('pop');
      void oddsEl.offsetWidth;                        // 애니메이션을 다시 트는 표준 수법
      oddsEl.classList.add('pop');
    }
    const dl = maybe('td-' + c);
    if (dl) {
      dl.textContent = moved ? (up ? '▲' : '▼') : '';
      dl.className = 'delta ' + (moved ? (up ? 'up' : 'down') : '');
    }

    const mine = bets[c] as number;
    const was = prevBets[c];
    const coins = maybe('tc-' + c);
    if (coins) coins.textContent = String(mine);
    const bar = maybe('pf-' + c);
    if (bar) bar.style.width = (total ? mine / total * 100 : 0).toFixed(1) + '%';
    if (was === undefined || mine !== was) addChips(c, mine, was === undefined ? mine : mine - was);
    prevBets[c] = mine;
  });

  // 카드 위의 "지금 걸린 코인 총합" — 베팅 단계에만 강조한다
  const box = $('tote-total');
  box.classList.toggle('live', d.phase === 'betting');
  roll('tote-total-n', prevTotal == null ? total : prevTotal, total, 0, '');
  prevTotal = total;

  prevOdds = {};
  codes.forEach((c) => { prevOdds[c] = d.odds[c]; });
}

/**
 * 그 줄의 칩 더미를 `count` 개로 맞춘다. 새로 늘어난 만큼만 날아 들어온다.
 * ⚠️ 이미 쌓여 있는 칩을 다시 만들지 않는다 — 매번 새로 지으면 상태 푸시마다
 *    판 전체의 칩이 다시 날아와서 어디가 늘었는지 알 수 없게 된다
 */
function addChips(c: AnimalCode, count: number, added: number): void {
  const box = maybe('ch-' + c);
  if (!box) return;
  const want = Math.min(count, TOTE.maxChips);
  const have = box.querySelectorAll('.tchip').length;
  const over = box.querySelector('.tmore') as HTMLElement | null;

  if (want < have) { box.innerHTML = ''; }            // 줄었다(다음 판) — 다시 쌓는다
  const from = want < have ? 0 : have;
  const flying = !reducedMotion() && added > 0;
  for (let i = from; i < want; i++) {
    const s = document.createElement('span');
    // 날아온 칩만 애니메이션. 처음 그릴 때(added 가 없을 때)는 그냥 놓는다
    s.className = 'tchip' + (flying && i >= want - added ? ' fly' : '');
    if (s.classList.contains('fly')) s.style.animationDelay = ((i - (want - added)) * 45) + 'ms';
    box.appendChild(s);
  }
  const extra = count - TOTE.maxChips;
  if (extra > 0) {
    const el = over || document.createElement('span');
    el.className = 'tmore num';
    el.textContent = '+' + extra;
    if (!over) box.appendChild(el);
  } else if (over) over.remove();
}

// ────────────────────────────────────────────────────────────
// 진행 조작 — 소켓이 죽어도 눌린다 (gateway.ts hostOp)
// ────────────────────────────────────────────────────────────

async function host(op: string, btn?: HTMLButtonElement): Promise<unknown | null> {
  try {
    const env = await hostOp(sock, CODE, HOSTKEY, op);
    return handle(env, btn ?? null);
  } catch (e) {
    toast((e as Error).message || '서버 응답이 없어요');
    return null;
  }
}

function nextRound(): void { void host('advanceRound', $('btn-round') as HTMLButtonElement); }
function togglePause(): void { void host('togglePause', $('btn-pause') as HTMLButtonElement); }

/**
 * 정답은 상시 응답에 담기지 않는다. 누른 그 순간에만 따로 받아온다 (§4-1, room.ts reveal).
 * ⚠️ 이 화면은 TV 에 연결돼 있을 수 있어서, 띄우기 전에 한 번 묻고 12초 뒤 스스로 감춘다.
 */
function askReveal(): void {
  confirmBox('정답 순위를 화면에 띄웁니다.\nTV에 보여도 괜찮나요?', () => {
    void host('reveal').then((d) => {
      if (!d) return;
      const r = d as { truth: AnimalCode[]; animals: Record<AnimalCode, string> };
      const el = $('reveal');
      el.innerHTML = '<b>정답 순위</b><br>' +
        r.truth.map((c, i) => `${i + 1}등 ${esc(r.animals[c])}`).join(' · ');
      el.classList.remove('hidden');
      window.setTimeout(() => el.classList.add('hidden'), 12000);
    });
  });
}

function askFinalize(): void {
  const msg = (LAST && LAST.round < LAST.lastRound)
    ? '아직 3등이 안 들어왔어요.\n그래도 정산할까요?'
    : '정산을 시작할까요?\n모둠 화면도 결과로 바뀝니다.';
  confirmBox(msg, () => { void host('finalize'); });
}

// ────────────────────────────────────────────────────────────
// S3 정산 드럼롤 (MIGRATION §11-4)
//
// 한 번에 표를 다 띄우면 김빠진다. 교사가 '다음'을 눌러 한 단계씩 넘기고,
// 각 단계에 연출이 붙는다: 스포트라이트 3등 → 2등 → 1등 → 코인 카운트업 → 컨페티.
//
// ⚠️ **공개 순서는 3등 → 2등 → 1등이다** (§11-4). 4a 는 1등부터 보여줬는데,
//    그러면 제일 궁금한 것을 맨 처음에 말해 버려서 나머지 두 단계가 소화 절차가 된다.
// ⚠️ 마지막에는 **지금까지의 결과표가 그대로 남는다** — 인쇄·기록용이다.
// ⚠️ 서버는 연출을 모른다. `reveal`·`finalize` 응답 한 벌로 화면이 전부 만든다.
// ────────────────────────────────────────────────────────────

/** 컨페티 조각 수. 오래된 TV 에서 버벅이면 제일 먼저 줄일 값이다 */
const CONFETTI = 90;

let step = 0;
let RES: TeacherView | null = null;

function showResult(d: TeacherView): void {
  RES = d;
  $('s2').classList.add('hidden');
  $('s3').classList.remove('hidden');
  if (step === 0) nextStep();
}

function nextStep(): void {
  step++;
  const d = RES;
  if (!d || !d.truth) return;
  const truth = d.truth;
  const medal = ['🥇', '🥈', '🥉'];
  const body = $('r-body');

  if (step <= 3) {
    // step 1 → 3등, 2 → 2등, 3 → 1등
    const rank = 4 - step;                       // 3, 2, 1
    const c = truth[rank - 1];
    if (!c) return;
    // 스포트라이트 한 마리. 이미 밝혀진 등수는 아래에 남겨 둔다 — 8m 밖에서
    // "지금까지 뭐가 나왔더라"를 다시 물을 수 없기 때문이다
    const sofar = truth.slice(0, 3).map((x, i) => ({ x, i }))
      .filter(({ i }) => i + 1 > rank)          // 이미 밝힌 등수만. 지금 것은 스포트라이트에 있다
      .sort((a, b) => b.i - a.i)
      .map(({ x, i }) => `<div class="past">${medal[i]} ${i + 1}등 ${d.emojis[x] || ''} ${esc(d.animals[x])}</div>`)
      .join('');

    $('r-step').innerHTML =
      '<div class="spot">' +
        '<div class="beam"></div>' +
        `<div class="star"><div class="medal">${medal[rank - 1]}</div>` +
          `<div class="face">${d.emojis[c] || ''}</div>` +
          `<div class="nm">${rank}등 · ${esc(d.animals[c])}</div></div>` +
      '</div>' +
      `<div class="sofar">${sofar}</div>`;
    $('r-next').textContent = step < 3 ? '다음 순위 공개' : '모둠별 계산 보기';
    return;
  }

  if (step === 4) {
    const list = d.settlement || [];
    body.innerHTML = '<div class="card"><h2>모둠별 계산</h2>' + list.map((s) =>
      `<details><summary>${s.teamNo}모둠 ${esc(s.teamName)} — ` +
      `<span class="tally num" id="sc-${s.teamNo}">${s.finalCoins - s.gained}</span>코인</summary>` +
      s.lines.map((l) =>
        `<div class="line">${esc(d.animals[l.animalCode])} (${l.finalRank}등) ${l.coins}코인 × ` +
        `${l.odds.toFixed(2)}배 × ${Math.round(l.payoutRate * 100)}% = <b>${l.gained}</b></div>`).join('') +
      `<div class="line">획득 합계 ${s.gained}코인</div></details>`).join('') + '</div>';
    // 폰의 coinPop 감각을 TV 로 (§11-4). 딴 건지 잃은 건지가 숫자가 움직이는 방향으로 보인다
    list.forEach((s, i) => {
      const el = maybe('sc-' + s.teamNo);
      if (el && s.gained !== 0) el.classList.add(s.gained > 0 ? 'up' : 'down');
      window.setTimeout(() => roll('sc-' + s.teamNo, s.finalCoins - s.gained, s.finalCoins, 0, ''), 120 * i);
    });
    $('r-next').textContent = '우승 발표';
    return;
  }

  const list = d.settlement || [];
  const w = list[0];
  if (!w) return;
  body.innerHTML = `<div class="card"><div class="podium">🏆 ${w.teamNo}모둠 ${esc(w.teamName)}<br>` +
    `<span style="color:var(--gold)">${w.finalCoins}코인</span></div><table><tbody>` +
    list.slice(1).map((s) =>
      `<tr><td>${s.rank}위</td><td>${esc(s.teamName)}</td><td class="num">${s.finalCoins}코인</td></tr>`).join('') +
    '</tbody></table></div>';
  $('r-next').classList.add('hidden');
  confetti();
}

/**
 * 우승 모둠 컨페티. DOM 조각으로 만든다 — 여기서 PixiJS 를 또 띄울 이유가 없다
 * (무대는 S2 에 있고, S3 에서는 이미 숨겨져 있다).
 * ⚠️ 글자 위를 덮지 않게 `pointer-events:none` 이고, 다 떨어지면 스스로 지운다.
 */
function confetti(): void {
  if (reducedMotion()) return;
  const box = document.createElement('div');
  box.className = 'confetti';
  const colors = ['#F2B441', '#4FC3F7', '#8BC34A', '#EF5350', '#BA68C8', '#FF8A65'];
  let html = '';
  for (let i = 0; i < CONFETTI; i++) {
    const left = Math.random() * 100;
    const delay = Math.random() * 900;
    const dur = 2200 + Math.random() * 1600;
    const col = colors[i % colors.length];
    const w = 6 + Math.random() * 7;
    html += `<i style="left:${left.toFixed(1)}%;background:${col};width:${w.toFixed(0)}px;` +
      `height:${(w * 1.6).toFixed(0)}px;animation-delay:${delay.toFixed(0)}ms;` +
      `animation-duration:${dur.toFixed(0)}ms"></i>`;
  }
  box.innerHTML = html;
  document.body.appendChild(box);
  window.setTimeout(() => box.remove(), 5200);
}

// ────────────────────────────────────────────────────────────
// 배선
// ────────────────────────────────────────────────────────────

function wire(): void {
  $('tab-new').addEventListener('click', () => pane('new'));
  $('tab-resume').addEventListener('click', () => pane('resume'));
  ($('cnt') as HTMLSelectElement).addEventListener('change', drawNames);
  ($('unit') as HTMLSelectElement).addEventListener('change', checkSheets);
  $('btn-reload').addEventListener('click', loadUnits);
  $('btn-create').addEventListener('click', create);
  $('btn-resume').addEventListener('click', resume);

  // 최근 판을 누르면 코드가 채워진다 (원본에는 없던 편의. 칠판 코드를 다시 타이핑할 일을 줄인다)
  $('recent').addEventListener('click', (e) => {
    const tr = (e.target as HTMLElement).closest('tr') as HTMLElement | null;
    if (!tr || !tr.dataset.code) return;
    ($('rcode') as HTMLInputElement).value = tr.dataset.code;
  });

  $('btn-reveal-pins').addEventListener('click', revealAllPins);
  $('btn-print').addEventListener('click', () => window.print());
  $('btn-go-play').addEventListener('click', goPlay);
  // 암호는 눌러야 보인다 — 이 화면이 TV에 연결돼 있을 수 있다
  $('out-pins').addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    if (el.classList.contains('pin')) el.classList.toggle('show');
  });

  $('btn-round').addEventListener('click', nextRound);
  $('btn-pause').addEventListener('click', togglePause);
  $('btn-handout').addEventListener('click', showHandout);
  $('btn-reveal').addEventListener('click', askReveal);
  $('btn-finalize').addEventListener('click', askFinalize);
  $('r-next').addEventListener('click', nextStep);

  ($('rcode') as HTMLInputElement).addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') resume();
  });
}

function start(): void {
  wire();
  api('/api/version').then((env) => {
    if (isOk(env)) $('ver-badge').textContent = '배포 ' + (env.data as { v: string }).v;
  }).catch(() => { $('ver-badge').textContent = ''; });
  loadUnits();
}

start();
