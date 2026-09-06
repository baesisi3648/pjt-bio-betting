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
 * 1b. **판 만들기도 그 비밀번호를 요구한다** (2026-09-05 사용자 결정). 예전에는 인증이
 *    없어서 주소만 아는 학생이 빈 판을 만들어 '최근 판' 목록을 어지럽힐 수 있었다.
 *    입력란은 둘이지만 값은 하나다 — '새 판'의 `cadmin` 과 '이어하기'의 `radmin` 이
 *    서로를 따라가고, 저장소는 `/admin` 과 같다 (`shared/pw.ts`).
 *
 * 2. **'🔧 진단' 버튼이 없다.** 그 버튼이 보여주던 것은 전부 스프레드시트 상태였다
 *    (getActive · openById · listUnits …). 문제은행이 D1 으로 옮겨져 해당하는 것이 없다.
 *
 * 3. **소켓이 죽어도 진행 버튼은 눌린다.** 원본에 없던 것이다 — 교실에서 와이파이가
 *    잠깐 끊긴 사이에도 선생님은 라운드를 넘겨야 한다. shared/gateway.ts 의 hostOp 이
 *    소켓 전송이 실패하면 같은 op 을 HTTP 라우트로 다시 보낸다.
 *
 * 4. **'지금 넘어가기'에는 확인 대화상자가 없다** (MIGRATION §8-3, 사용자 결정).
 *    정답 공개·정산과 달리 되돌릴 게 없다 — 잘못 눌러도 다음 단계로 갈 뿐이다. 반대로
 *    수업 중에 한 번 더 묻게 하면, 아끼려던 그 몇 초를 대화상자가 도로 먹는다.
 *    막는 것은 **두 번 눌리는 것**뿐이다 — 응답 전에 또 누르면 단계가 두 개 지나간다.
 *
 * ⚠️ 교사 열쇠는 **매 메시지에 싣는다.** 소켓이 붙어 있다는 사실로 권한을 가정하지 않는다.
 *
 * ── 4b 연출 (MIGRATION §11) ──
 *
 * 5. **경주 무대**는 `./stage.ts` (PixiJS) 다. `import()` 로 늦게 부른다 — 정적으로 부르면
 *    PixiJS 가 학생 폰 번들에도 실린다. 무대가 켜지면 4a 의 CSS 트랙(`#track`)을 숨기고,
 *    `prefers-reduced-motion` 이거나 WebGL 이 없으면 무대를 아예 안 만들고 CSS 트랙으로 간다.
 *    **어느 쪽이든 게임은 그대로 돈다** (§11-1).
 *
 * 6. **배당판**은 다시 그리지 않고 **고쳐 쓴다.** 트랙 레인과 같은 이유다 —
 *    매번 innerHTML 로 갈면 굴러가던 숫자와 날아오던 칩이 매 푸시마다 처음으로 돌아간다.
 */

import type { AnimalCode } from '../../game/config.ts';
import type { TeacherView } from '../../game/views.ts';
import { ServerClock } from '../shared/clock.ts';
import { FATAL, HEADER_UNSAFE_MSG, api, handle, headerSafe, hostOp, isOk } from '../shared/gateway.ts';
import { pwStore } from '../shared/pw.ts';
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
// 관리자 비밀번호 — 판 만들기 · 열쇠 되찾기가 **같은 값**을 쓴다
// ────────────────────────────────────────────────────────────

/**
 * 판 만들기(`POST /api/game`)도 관리자 비밀번호를 요구한다 (2026-09-05 사용자 결정 —
 * router.ts `createRoute` 주석). 그래서 이 화면에는 비밀번호 입력란이 둘이다:
 * '새 판 만들기'의 `cadmin` 과 '이어하기'의 `radmin`.
 *
 * ⚠️ 둘은 **같은 값**을 가리킨다. 탭마다 따로 넣게 두면, 판을 만들고 나서 열쇠를
 *    되찾을 때 같은 비밀번호를 또 넣어야 한다. 저장소도 `/admin` 과 같은 것을 쓰므로
 *    (`shared/pw.ts`) 수업 준비 중에 한 번만 넣으면 세 자리가 다 열린다.
 */
function setAdminPw(v: string): void {
  ($('cadmin') as HTMLInputElement).value = v;
  ($('radmin') as HTMLInputElement).value = v;
}

function adminPw(): string {
  return (($('cadmin') as HTMLInputElement).value || '').trim();
}

/**
 * '새 판' 폼의 거절 사유 상자.
 *
 * ⚠️ 토스트가 아니다. 비밀번호가 틀렸다는 문장은 **고칠 때까지 남아 있어야** 한다 —
 *    사라지고 나면 선생님은 "판 만들기 버튼이 안 먹는다" 로만 기억한다.
 */
function createMsg(text: string): void {
  const box = $('create-msg');
  box.textContent = text;
  box.classList.toggle('hidden', !text);
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

// 서버의 최근 판 목록은 열쇠 이름이 아직 className·unit 이다 (ports.ts RecentGame 주석).
// 화면에서는 '방 제목'·'문제 세트'로 읽는다
interface RecentRow { code: string; className: string; unit: string; createdAt: number; isOver: boolean }
interface SetInfo { name: string; total: number; byLevel: Record<string, number> }

/** 사기 라운드 스위치 값. 배포 안내 화면의 안내 상자가 이걸 본다 */
let fraudOn = true;

function loadUnits(): void {
  Promise.all([api('/api/units'), api('/api/sets')]).then(([envU, envS]) => {
    const d = handle(envU) as { units: string[]; recent: RecentRow[]; recentError: string | null } | null;
    if (!d) return;
    const sets = (isOk(envS) ? (envS.data as { sets: SetInfo[] }).sets : []) || [];

    const sel = $('unit') as HTMLSelectElement;
    const setupBox = $('no-questions');
    if (!sets.length) {
      sel.innerHTML = '<option value="">— 문제가 없습니다 —</option>';
      sel.disabled = true;
      setupBox.classList.remove('hidden');
    } else {
      sel.disabled = false;
      setupBox.classList.add('hidden');
      // 빈 값 = 전체 은행 (RENEWAL §3-4). 세트 옆에 난이도별 개수를 붙여 10문항 미달을 고르기 전에 보게 한다
      sel.innerHTML = '<option value="">— 전체 (모든 세트) —</option>' + sets.map((st) => {
        const b = st.byLevel || {};
        return `<option value="${esc(st.name)}">${esc(st.name)} (쉬움 ${b['쉬움'] ?? 0} · 보통 ${b['보통'] ?? 0} · 어려움 ${b['어려움'] ?? 0})</option>`;
      }).join('');
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
          `<td>${esc(g.className)}</td><td>${esc(g.unit || '(전체)')}</td>` +
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
  // 빈 값은 전체 은행 — 그것도 미리 본다 (문항 수 경고가 거기서도 나온다)
  api(`/api/prepare?set=${encodeURIComponent(u)}`).then((env) => {
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

  const setName = ($('unit') as HTMLSelectElement).value;   // '' = 전체 은행
  fraudOn = ($('fraud') as HTMLInputElement).checked;

  const pw = adminPw();
  if (!pw) {
    createMsg('관리자 비밀번호를 넣어주세요. 판을 만들 때만 확인합니다.');
    ($('cadmin') as HTMLInputElement).focus();
    return;
  }
  // 한글·이모지 비밀번호는 헤더에 실리지 못해 **브라우저가 요청을 만들다가 던진다**.
  // 그냥 두면 "서버에 닿지 못했어요" 만 떠서 배포가 고장 난 줄 안다 (shared/gateway.ts)
  if (!headerSafe(pw)) {
    createMsg(HEADER_UNSAFE_MSG);
    ($('cadmin') as HTMLInputElement).focus();
    return;
  }
  createMsg('');

  api('/api/game', {
    method: 'POST',
    // ⚠️ 매 호출 싣는다. 서버는 세션도 쿠키도 만들지 않는다 (MIGRATION §10)
    headers: { 'X-Admin-Password': pw },
    body: {
      roomTitle: ($('cls') as HTMLInputElement).value || '우리 방',
      setName, teamCount: n, teamNames: names, fraudEnabled: fraudOn
    }
  }).then((env) => {
    if (!isOk(env)) {
      if (env.error === 'ADMIN_DENIED') {
        // 서버 문장을 그대로 남긴다 — 화면이 말을 지어내면 서버 쪽을 고친 날 갈라진다
        createMsg(env.message || '관리자 비밀번호가 달라요');
        pwStore(null);                       // 틀린 값을 다음번에 미리 채워 주면 안 된다
        const box = $('cadmin') as HTMLInputElement;
        box.focus();
        box.select();
        return;
      }
      if (env.error === 'ADMIN_DISABLED') {
        // 선생님이 고칠 수 있는 문제가 아니다 — 배포 설정을 짚어 준다
        createMsg('관리자 기능이 꺼져 있어요 — 배포 설정(ADMIN_PASSWORD)을 확인해주세요');
        return;
      }
      handle(env, $('btn-create') as HTMLButtonElement);
      return;
    }
    const d = env.data as CreateResult;
    // 서버가 통과시켰으니 맞는 값이다. 여기서만 저장한다 — '이어하기'와 /admin 이 같이 쓴다
    pwStore(pw);
    setAdminPw(pw);
    createMsg('');
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
  code: string; roomTitle?: string; pins: Record<number, string>;
  teams: { no: number; name: string }[]; studentUrl?: string;
}

function drawHandout(d: HandoutData): void {
  studentUrl = d.studentUrl || studentUrl;
  $('out-title').textContent = d.roomTitle || ($('cls') as HTMLInputElement).value || '';
  // 선생님이 학생들에게 미리 말할 수 있게 — 폰에도 같은 공지가 뜬다 (team/main.ts fraudNote)
  $('fraud-note').classList.toggle('hidden', !fraudOn);
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
  const pw = (($('radmin') as HTMLInputElement).value || '').trim();
  // ⚠️ 실패하면 고칠 자리가 보여야 한다 — 성공하기 전에는 계속 열어 둔다
  row.classList.remove('hidden');
  if (!pw) {
    ($('radmin') as HTMLInputElement).focus();
    toast('이 기기에 교사 열쇠가 없어요. 관리자 비밀번호를 넣어주세요');
    return;
  }

  // 한글·이모지 비밀번호는 헤더에 실리지 못해 브라우저가 던진다 — 보내기 전에 이유를 말한다
  if (!headerSafe(pw)) { toast(HEADER_UNSAFE_MSG); ($('radmin') as HTMLInputElement).focus(); return; }

  api('/api/admin/host-key', {
    method: 'POST', headers: { 'X-Admin-Password': pw }, body: { code: c }
  }).then((env) => {
    if (!isOk(env)) {
      // ADMIN_DISABLED 는 사용자가 고칠 수 있는 문제가 아니다 — 배포 설정을 알려준다
      if (env.error === 'ADMIN_DISABLED') {
        toast('관리자 기능이 꺼져 있어요 — 배포 설정(ADMIN_PASSWORD)을 확인해주세요');
      } else {
        toast(env.message);
        // 틀린 값을 저장해 두면 '새 판' 입력란에까지 미리 채워진다
        if (env.error === 'ADMIN_DENIED') pwStore(null);
      }
      ($('radmin') as HTMLInputElement).focus();
      return;
    }
    const d = env.data as { code: string; hostKey: string };
    // 서버가 통과시킨 값이다. '새 판' 입력란·/admin 과 같이 쓴다 (한 번만 넣게)
    pwStore(pw);
    setAdminPw(pw);
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
  // 1단계 리뉴얼에서 뷰 이름만 바뀌었다 (className→roomTitle, unit→setName).
  // 화면 문구·배치는 3·4단계에서 손댄다 (RENEWAL §5)
  fraudOn = !!d.fraudEnabled;
  $('p-cls').textContent = `애니멀 더비 · ${d.roomTitle}`;
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

  // 조기 종료 버튼 (MIGRATION §8-3).
  // ⚠️ 단계 이름으로 여기서 다시 판단하지 않는다 — 서버가 계산한 canSkip 하나만 본다
  //    (views.canSkipNow). 조건을 화면에 한 벌 더 쓰면, 눌리는데 서버가 NOT_SKIPPABLE 로
  //    거절하는 버튼(또는 눌러야 하는데 죽어 있는 버튼)이 언젠가 생긴다.
  // ⚠️ 비활성(disabled)이 아니라 **감춘다.** 대기 중에는 그 자리가 '라운드 시작'의 것이고,
  //    경주 20초는 학생이 결과를 보는 시간이라 애초에 넘길 것이 아니다.
  $('btn-skip').classList.toggle('hidden', !d.canSkip);

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

/** 타이머가 튄 것을 알아보기 위해 지난 초를 기억한다 (아래 tick 주석) */
let prevLeft: number | null = null;
let prevPhase = '';

/** 1초마다. 서버 시각으로 다시 센다 (폴링이 아니다) */
function tick(): void {
  const d = LAST;
  if (!d || d.isOver) return;
  const left = clock.secondsLeft(d);
  const t = $('p-timer');
  t.textContent = (PHASE_KO[d.phase] || '') + (left != null ? `  ⏱ ${left}` : '');
  // ⚠️ className 을 통째로 다시 쓰지 않는다 — 아래에서 붙인 pop 이 다음 상태 푸시에
  //    지워져서 애니메이션이 중간에 끊긴다
  t.classList.toggle('urgent', left != null && left <= 10);

  /* 자동 단축이 걸리면 서버는 phaseEndsAt 만 당긴다(phaseSeconds 는 그대로) — 그래서
     숫자가 61 → 5 로 한 번 튄다. **정상이다.** 다만 8m 밖에서는 숫자가 작아진 것을
     못 보고 지나치므로, 튀는 그 순간 타이머를 한 번 튕겨 준다.
     10초 이하의 붉은색(urgent)은 기존 로직이 알아서 붙인다.

     ⚠️ 같은 단계 안에서 줄었을 때만이다. 단계가 바뀌면 남은 초는 늘어나지(90 → 180)
        줄지 않으므로, 이 조건은 사실상 자동 단축 하나만 잡는다.
     ⚠️ 문턱이 2 가 아니라 3 인 이유: 탭이 뒤에 있으면 브라우저가 1초 interval 을 밀어
        2초가 한꺼번에 줄어드는 일이 흔하다. 그때마다 튕기면 신호가 아니라 잡음이 된다. */
  if (d.phase === prevPhase && left != null && prevLeft != null && prevLeft - left >= 3) pop(t);
  prevPhase = d.phase;
  prevLeft = left;

  skipNote(d, left);
}

/**
 * "값이 바뀌었다"를 한 번 튕겨 보인다. 배당 숫자와 **같은 keyframe(oddsPop)** 을 쓴다 —
 * 같은 뜻에 화면마다 다른 동작을 붙이면 보는 사람이 매번 새로 배워야 한다.
 * (reduced-motion 은 base.css 가 0.01ms 로 눌러 준다)
 */
function pop(el: HTMLElement): void {
  el.classList.remove('pop');
  void el.offsetWidth;                                // 애니메이션을 다시 트는 표준 수법
  el.classList.add('pop');
}

/**
 * '✅ 모둠이 다 끝났어요 · N초 뒤 넘어갑니다'.
 *
 * ⚠️ 서버가 준 `allDone` 만 본다 (views.allTeamsDone). 모둠 표를 세어 직접 판단하면
 *    자동 단축이 도는 조건과 문구가 갈라져서, "다 끝났어요"라고 써 놓고 시계는 안 줄어드는
 *    상태가 생긴다 (MIGRATION §5 — 사본을 만들지 말 것).
 * ⚠️ 토론에서는 `allDone` 이 언제나 false 다. 토론 180초는 줄이지 않기 때문이고,
 *    그래서 토론 중에 이 문구가 안 뜨는 것이 정상이다 (§8-3).
 * ⚠️ 멈춰 있는 동안에는 초를 적지 않는다 — 시간이 안 흐르므로 'N초 뒤'가 거짓말이 된다.
 *    (임의 결정) ✅ 와 글자가 뜻을 다 말한다. 초록색은 거들 뿐이다 (§11-1).
 */
function skipNote(d: TeacherView, left: number | null): void {
  const el = $('skip-note');
  el.classList.toggle('hidden', !d.allDone);
  if (!d.allDone) return;
  el.textContent =
    d.phase === 'paused' ? '✅ 모둠이 다 끝났어요 · 일시정지 중'
    : left != null ? `✅ 모둠이 다 끝났어요 · ${left}초 뒤 넘어갑니다`
    : '✅ 모둠이 다 끝났어요';
}

/* ── 트랙 그리기 ──
   ⚠️ 되돌리면 안 되는 곳: 레인 DOM은 판이 바뀔 때만 짓고, 그 뒤엔 right 값만 만진다.
      매번 innerHTML로 갈아끼우면 요소가 새로 생겨서 말이 순간이동한다.

   ⚠️ **진행 방향은 오른쪽 → 왼쪽이다** (출발선 오른쪽 · 결승선 왼쪽). 동물 이모지가
      대부분 왼쪽을 보고 있어서, 반대로 두면 말이 뒷걸음질치는 그림이 된다 (사용자 결정).
      그래서 말은 `left` 가 아니라 **`right` 퍼센트**로 민다 — pctOf() 는 그대로
      "출발선에서 얼마나 갔나"를 돌려주고, 그 값을 어느 쪽 끝에서 재느냐만 다르다.
      되돌리려면 teacher.css · stage.ts · team/mini.ts 를 **동시에** 되돌릴 것.

   레인 안의 순서도 뒤집혔다: 칸수(n/10) → 트랙 → 이름 → 배지.
   뒤집기 전과 **같은 짝**을 지킨 것이다 (이름은 출발선 옆, 칸수는 결승선 옆). */
const SILK = 8;
let trackKey: string | null = null;
let wasFinished: Record<string, boolean> = {};

interface Runner extends HTMLElement { _pct?: number; _t?: number }

function drawTrack(d: TeacherView, codes: AnimalCode[]): void {
  const key = codes.join(',');
  if (trackKey !== key) {
    $('track').innerHTML = codes.map((c, i) => {
      const pct = pctOf(d.positions[c], d.trackCells);
      // 레인의 flex 자식 순서 = 화면 순서 (칸수 → 트랙 → 이름 → 배지).
      // row-reverse 로 뒤집지 않은 이유는, 이 HTML 을 읽는 사람이 "보이는 순서"를
      // 그대로 볼 수 있게 하기 위해서다.
      // ⚠️ 반대로 `.course` **안쪽** 순서는 건드리지 않는다 — 셋 다 absolute 라
      //    DOM 순서가 곧 겹치는 순서다. finish 를 앞으로 옮기면 골인한 말이 체크무늬
      //    **위**로 올라와, 뒤집기 전과 다른 그림이 된다 (이번 변경은 방향만 바꾼다)
      return `<div class="lane" id="ln-${c}">` +
        `<div class="lane-pos num" id="lp-${c}"></div>` +
        '<div class="course">' +
          `<div class="covered" id="cv-${c}" style="width:${coveredW(pct)}"></div>` +
          `<div class="runway"><div class="runner" id="rn-${c}" style="right:${pct}%">` +
            `<div class="trail"></div><div class="horse">${d.emojis[c] || '🐎'}</div>` +
          '</div></div>' +
          '<div class="finish"></div>' +
        '</div>' +
        `<div class="lane-tag"><span class="lane-name">${esc(d.animals[c])}</span>` +
          `<span class="silk s${i % SILK}">${i + 1}</span></div></div>`;
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
    // 출발선(오른쪽)에서 잰다 — pct 가 커질수록 말이 왼쪽 결승선에 가까워진다
    runner.style.right = pct + '%';
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
   말은 runway(결승선 쪽 24px · 출발선 쪽 32px 들여쓴 칸) 기준이고 막대는 course 전체
   기준이라, 그 차이(합 56px)를 여기서 맞춘다. 막대는 출발선(오른쪽)에 붙어 왼쪽으로 자란다 */
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

/** 응답을 기다리는 동안 또 눌리는 것만 막는다 (파일 머리 4번 — 확인 대화상자는 없다) */
let skipping = false;

/**
 * '지금 넘어가기' (MIGRATION §8-3).
 *
 * ⚠️ 응답의 `data` 는 **이미 다음 단계의 teacherView** 다 — 서버가 알람을 기다리지 않고
 *    동기로 넘긴 뒤 그 결과를 돌려주기 때문이다 (room.ts skipPhase). 그대로 그리면 된다.
 *    소켓 푸시를 기다렸다가 그리면, 그 몇백 ms 동안 화면이 안 바뀌어 선생님이 다시 누른다.
 * ⚠️ 실패는 handle() 이 서버 문장 그대로 토스트로 띄운다 (NOT_SKIPPABLE·PAUSED·NOT_HOST).
 *    여기서 코드별로 문장을 다시 쓰지 않는다 — 말투가 두 벌이 된다 (gateway.ts 머리 주석).
 */
async function skipPhase(): Promise<void> {
  if (skipping) return;
  skipping = true;
  try {
    const d = await host('skipPhase', $('btn-skip') as HTMLButtonElement);
    if (d) applyState(d as TeacherView);
  } finally {
    skipping = false;
  }
}

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
  ($('fraud') as HTMLInputElement).addEventListener('change', () => {
    const on = ($('fraud') as HTMLInputElement).checked;
    $('fraud-desc').textContent = on
      ? '2~4라운드 중 한 라운드는 힌트가 거짓입니다 — 학생에게 공지됩니다'
      : '모든 힌트가 참입니다';
  });
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
  $('btn-skip').addEventListener('click', () => { void skipPhase(); });
  $('btn-handout').addEventListener('click', showHandout);
  $('btn-reveal').addEventListener('click', askReveal);
  $('btn-finalize').addEventListener('click', askFinalize);
  $('r-next').addEventListener('click', nextStep);

  ($('rcode') as HTMLInputElement).addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') resume();
  });

  // 관리자 비밀번호 입력란 둘을 붙여 둔다 — 어느 쪽에 넣어도 다른 쪽이 따라간다.
  // ⚠️ 저장은 여기서 하지 않는다. 맞는 값인지는 서버만 알기 때문이다 (setAdminPw 주석).
  //    타이핑할 때마다 저장하면 틀린 값이 /admin 에까지 미리 채워진다
  for (const [from, to] of [['cadmin', 'radmin'], ['radmin', 'cadmin']] as const) {
    ($(from) as HTMLInputElement).addEventListener('input', () => {
      ($(to) as HTMLInputElement).value = ($(from) as HTMLInputElement).value;
      if (from === 'cadmin') createMsg('');
    });
  }
  ($('cadmin') as HTMLInputElement).addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') create();
  });
}

function start(): void {
  wire();
  // 같은 탭에서 이미 넣은 관리자 비밀번호가 있으면 두 입력란에 미리 채운다.
  // /admin 과 같은 저장소를 쓰므로 (shared/pw.ts) 거기서 로그인했으면 여기도 채워진다
  setAdminPw(pwStore());
  api('/api/version').then((env) => {
    if (isOk(env)) $('ver-badge').textContent = '배포 ' + (env.data as { v: string }).v;
  }).catch(() => { $('ver-badge').textContent = ''; });
  loadUnits();
}

start();
