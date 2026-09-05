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
 */

import type { AnimalCode } from '../../game/config.ts';
import type { TeacherView } from '../../game/views.ts';
import { ServerClock } from '../shared/clock.ts';
import { FATAL, api, handle, hostOp, isOk } from '../shared/gateway.ts';
import { qrSvg } from '../shared/qr.ts';
import { GameSocket } from '../shared/socket.ts';
import { $, confirmBox, esc, hideConn, maybe, showConn, toast } from '../shared/ui.ts';

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

  // 경주 20초 — 4a 에서는 문구만. 4b 가 이 자리(#race-stage)에 PixiJS 무대를 넣는다
  const note = $('phase-note');
  if (d.phase === 'moving') {
    note.textContent = '🏇 경주 중';
    note.classList.remove('hidden');
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

/* ── 배당판 ──
   판돈 막대로 "어디에 돈이 몰렸는지"를 보이고, 배당이 움직이면 숫자가 튀며 ▲▼를 단다.
   화살표를 같이 쓰는 건 색만으로 뜻을 전하지 않기 위해서다 (05-design-system §2)

   ⚠️ 인기순으로 정렬하지 않는다. 줄이 바뀌면 눈이 못 따라간다 (05 §4-2) */
function drawTote(d: TeacherView, codes: AnimalCode[]): void {
  let total = 0;
  const bets: Partial<Record<AnimalCode, number>> = {};
  codes.forEach((c) => { bets[c] = Math.max(0, d.pool[c] - d.seedCoins); total += bets[c]!; });

  $('odds').innerHTML = codes.map((c, i) => {
    const now = d.odds[c], prev = prevOdds[c];
    const moved = prev !== undefined && Math.abs(prev - now) > 0.005;
    const up = moved && now > prev!;
    const share = total ? (bets[c]! / total * 100) : 0;
    return '<tr>' +
      `<td class="t-silk"><span class="silk s${i % SILK}">${i + 1}</span></td>` +
      `<td class="t-name">${d.emojis[c] || ''} ${esc(d.animals[c])}</td>` +
      '<td><div class="pool-wrap">' +
        `<div class="pool-fill" id="pf-${c}" data-w="${share.toFixed(1)}"></div></div></td>` +
      `<td class="t-coins num">${bets[c]}<span class="u">코인</span></td>` +
      `<td class="t-odds"><span class="odds num${moved ? ' pop' : ''}">${now.toFixed(2)}배</span>` +
        `<span class="delta ${moved ? (up ? 'up' : 'down') : ''}">${moved ? (up ? '▲' : '▼') : ''}</span></td></tr>`;
  }).join('');

  // 0에서 한 프레임 뒤에 늘려야 막대가 자라는 게 보인다
  requestAnimationFrame(() => {
    codes.forEach((c) => {
      const el = maybe('pf-' + c);
      if (el) el.style.width = el.getAttribute('data-w') + '%';
    });
  });
  prevOdds = {};
  codes.forEach((c) => { prevOdds[c] = d.odds[c]; });
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
// S3 정산 — 한 단계씩 넘긴다 (한 번에 다 보여주면 김빠진다)
// ⚠️ 4b 가 여기에 드럼롤·스포트라이트·컨페티를 붙인다 (MIGRATION §11-4).
//    그때도 이 단계 구분(3등→2등→1등 → 계산 → 우승)은 그대로 쓴다
// ────────────────────────────────────────────────────────────

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
    $('r-step').innerHTML = '<div class="podium">' +
      truth.slice(0, step).map((c, i) => `${medal[i]} ${i + 1}등 ${d.emojis[c] || ''} ${esc(d.animals[c])}`).join('<br>') +
      '</div>';
    $('r-next').textContent = step < 3 ? '다음 순위 공개' : '모둠별 계산 보기';
  } else if (step === 4) {
    body.innerHTML = '<div class="card"><h2>모둠별 계산</h2>' + (d.settlement || []).map((s) =>
      `<details><summary>${s.teamNo}모둠 ${esc(s.teamName)} — ${s.finalCoins}코인</summary>` +
      s.lines.map((l) =>
        `<div class="line">${esc(d.animals[l.animalCode])} (${l.finalRank}등) ${l.coins}코인 × ` +
        `${l.odds.toFixed(2)}배 × ${Math.round(l.payoutRate * 100)}% = <b>${l.gained}</b></div>`).join('') +
      `<div class="line">획득 합계 ${s.gained}코인</div></details>`).join('') + '</div>';
    $('r-next').textContent = '우승 발표';
  } else {
    const list = d.settlement || [];
    const w = list[0];
    if (!w) return;
    body.innerHTML = `<div class="card"><div class="podium">🏆 ${w.teamNo}모둠 ${esc(w.teamName)}<br>` +
      `<span style="color:var(--gold)">${w.finalCoins}코인</span></div><table><tbody>` +
      list.slice(1).map((s) =>
        `<tr><td>${s.rank}위</td><td>${esc(s.teamName)}</td><td class="num">${s.finalCoins}코인</td></tr>`).join('') +
      '</tbody></table></div>';
    $('r-next').classList.add('hidden');
  }
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
