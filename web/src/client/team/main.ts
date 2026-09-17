/**
 * team/main.ts — 학생 화면 (S4 접속 · S5 게임 · S6 결과).
 *
 * apps-script/Team.html 의 <script> 를 옮긴 것이다. 게임 흐름과 문구는 그대로고,
 * 서버를 부르는 방식만 바뀌었다:
 *
 *   google.script.run + 2초 폴링   →   HTTP 라우트(접속) + WebSocket 푸시(상태·행동)
 *
 * ── 옮기면서 일부러 다르게 한 것 ──
 *
 * 1. **`totalFor(p)` 를 지웠다.** 원본은 90/180/60 을 화면에 하드코딩해서, '설정'의
 *    시간을 바꾸면 타이머 막대가 거짓말을 했다. 이제 서버가 준 `phaseSeconds` 를 쓴다
 *    (MIGRATION §5 — 설정값을 화면이 다시 정하지 말 것).
 *
 * 2. **폴링이 없다.** 상태의 정본은 소켓 푸시다. 1초마다 도는 것은 타이머 숫자 계산뿐이고,
 *    그것도 서버 시각 기준이다 (shared/clock.ts).
 *
 * 3. **오답 해설이 남는다.** 원본은 제출 직후 해설을 그려 놓고 `forceRefresh()` 했는데,
 *    푸시는 폴링보다 훨씬 빨리 오므로 해설이 눈 깜짝할 새 사라진다. 그래서 제출 결과를
 *    라운드와 함께 기억해 두고 그 라운드 동안 계속 보여준다.
 *
 * 4. **라운드가 바뀌면 화면에 남은 것을 지운다.** 원본은 `window._q` 를 제출할 때만
 *    비워서, 시간이 지나 못 낸 모둠은 다음 라운드에 **지난 라운드 문제**를 보고 있었다.
 *    (apps-script 쪽 버그다 — MIGRATION §9-1 에 따라 거기는 고치지 않고 보고한다)
 *
 * ⚠️ 모둠 암호(PIN)는 **매 메시지에 실어 보낸다.** 소켓이 붙어 있다는 사실로 권한을
 *    가정하지 않는다 (§4-4). 그리고 **localStorage 에 저장하지 않는다** — 원본과 같다.
 *    폰이 남의 손에 들어가도 암호는 남지 않는다.
 */

import { isNoBetPosition, type AnimalCode, type Level } from '../../game/config.ts';
import { summarizeInvestments } from '../../game/investments.ts';
import type { Settlement } from '../../game/types.ts';
import type { TeamView } from '../../game/views.ts';
import { ServerClock } from '../shared/clock.ts';
import { FATAL, api, handle, isOk } from '../shared/gateway.ts';
import { GameSocket } from '../shared/socket.ts';
import { $, buzz, confirmBox, esc, hideConn, maybe, reducedMotion, showConn, toast } from '../shared/ui.ts';
import { startMini, stopMini } from './mini.ts';

// ────────────────────────────────────────────────────────────
// 이 화면이 기억하는 것
// ────────────────────────────────────────────────────────────

let CODE = '';
let TEAM = 0;
let PIN = '';                       // ⚠️ 저장하지 않는다. 새로고침하면 다시 넣는다
let D: TeamView | null = null;
let TAB = 0;
let sel: number | null = null;      // 고른 보기 번호(1~4)
let draft: Partial<Record<AnimalCode, number>> = {};
let seenHints = 0;
let lastBumped: AnimalCode | null = null;
let lastVersion = -1;
let lastRoundSeen = -1;
let lastPhaseSeen = '';

/** 지금 화면에 열려 있는 문제 (chooseLevel 응답). 라운드가 바뀌면 버린다 */
let openQuestion: { text: string; choices: string[] } | null = null;
let openLevel: Level | null = null;

/** 제출 결과 — 오답 해설을 그 라운드 내내 보여주기 위해 라운드와 함께 기억한다 */
let answered: { round: number; correct: boolean; answer: number; explanation: string } | null = null;

const clock = new ServerClock();
let sock: GameSocket | null = null;

/** 같은 op 을 두 번 누르는 것을 막는다 (원본 Shared.html 의 busy 맵) */
const busy = new Set<string>();

// ────────────────────────────────────────────────────────────
// 서버 부르기
// ────────────────────────────────────────────────────────────

/**
 * 모둠 행동 하나. **암호를 매번 싣는다.**
 * 전송 실패(끊김)와 거절(`{ok:false}`)은 다른 길로 온다 — 전자는 토스트, 후자는 handle().
 */
async function act(op: string, args: unknown[], btn?: HTMLButtonElement | null): Promise<unknown | null> {
  if (busy.has(op)) return null;
  busy.add(op);
  try {
    if (!sock) return null;
    const env = await sock.send(op, args);
    return handle(env, btn);
  } catch (e) {
    toast((e as Error).message || '서버 응답이 없어요');
    return null;
  } finally {
    busy.delete(op);
  }
}

// ────────────────────────────────────────────────────────────
// S4 접속
// ────────────────────────────────────────────────────────────

function step1(): void {
  const c = (($('jcode') as HTMLInputElement).value || '').toUpperCase().trim();
  if (c.length !== 4) { toast('판 코드 4자리를 넣어주세요'); return; }

  api(`/api/game/${encodeURIComponent(c)}/lobby`).then((env) => {
    const d = handle(env) as { roomTitle: string; teams: { no: number; name: string }[] } | null;
    if (!d) return;
    CODE = c;
    $('j-room').textContent = d.roomTitle || '';
    // ⚠️ 원본은 모둠 이름을 onclick 문자열에 끼워 넣느라 작은따옴표를 지웠다.
    //    여기서는 data 속성으로 넘겨서 이름을 있는 그대로 쓴다
    $('jteams').innerHTML = d.teams.map((t) =>
      `<button data-no="${t.no}" data-name="${esc(t.name)}">${t.no}모둠<br>${esc(t.name)}</button>`
    ).join('');
    $('j1').classList.add('hidden');
    $('j2').classList.remove('hidden');
  }).catch(() => toast('서버 응답이 없어요'));
}

function step2(no: number, name: string): void {
  TEAM = no;
  $('j3sub').textContent = `${no}모둠 ${name} — 암호 4자리`;
  $('j2').classList.add('hidden');
  $('j3').classList.remove('hidden');
  ($('jpin') as HTMLInputElement).focus();
}

function step3(): void {
  const btn = $('j3-go') as HTMLButtonElement;
  const p = (($('jpin') as HTMLInputElement).value || '').trim();

  api(`/api/game/${encodeURIComponent(CODE)}/join`, {
    method: 'POST',
    // ⚠️ 인증은 헤더가 정본. 본문에도 넣는 것은 라우터가 둘 다 받기 때문이다 (§8-1b)
    headers: { 'X-Team-Pin': p },
    body: { teamNo: TEAM, pin: p }
  }).then((env) => {
    if (!handle(env, btn)) return;
    PIN = p;
    // 암호는 담지 않는다 — 원본과 같다
    try { localStorage.setItem('wd', JSON.stringify({ code: CODE, team: TEAM })); } catch { /* 막힌 브라우저 */ }
    $('join').classList.add('hidden');
    $('game').classList.remove('hidden');
    openSocket();
  }).catch(() => toast('서버 응답이 없어요'));
}

// ────────────────────────────────────────────────────────────
// 소켓
// ────────────────────────────────────────────────────────────

function openSocket(): void {
  sock = new GameSocket(CODE, {
    onState: (data) => applyState(data as TeamView),
    onStatus: (up) => { if (up) hideConn(); else showConn(); },
    // 붙을 때마다(처음 · 재연결) 상태를 통째로 다시 받는다. 끊긴 동안 놓친 푸시는
    // 서버가 다시 보내주지 않는다
    resync: () => { void resync(); }
  });
  sock.connect();
  window.setInterval(tick, 1000);
}

async function resync(): Promise<void> {
  if (!sock) return;
  try {
    const env = await sock.send('getState', [`team:${TEAM}`, null, PIN]);
    if (isOk(env)) { hideConn(); applyState(env.data as TeamView); return; }
    // 다시 눌러도 소용없는 실패는 배너에 이유를 적고 멈춘다 (원본 onFail)
    if (FATAL[env.error]) { sock.close(); showConn(env.message || '이 판을 볼 수 없어요'); }
    else toast(env.message);
  } catch { /* 소켓이 곧 다시 붙는다 */ }
}

function applyState(d: TeamView): void {
  clock.sync(d);
  D = d;
  if (d.stateVersion !== lastVersion) { lastVersion = d.stateVersion; render(d); }
  tick();
}

// ────────────────────────────────────────────────────────────
// S5 게임
// ────────────────────────────────────────────────────────────

const PHASE_KO: Record<string, string> = {
  waiting: '다음 라운드를 기다려요', moving: '동물들이 달리는 중',
  quiz: '문제 풀 때예요', bonus: '추가 단서 구입!', discuss: '힌트 보고 이야기할 때예요', betting: '베팅할 때예요',
  paused: '선생님이 잠시 멈췄어요', done: '게임 끝!'
};

function render(d: TeamView): void {
  if (d.isOver) { showResult(d); return; }
  $('ver').textContent = '배포 ' + d.deployVersion;

  // ⚠️ 라운드가 바뀌면 지난 라운드의 화면 잔재를 버린다.
  //    원본은 이걸 안 해서, 시간이 지나 답을 못 낸 모둠이 다음 라운드에 지난 문제를 봤다
  if (d.round !== lastRoundSeen) {
    lastRoundSeen = d.round;
    openQuestion = null; openLevel = null; sel = null;
    draft = {}; lastBumped = null;
  }
  // 경주 20초 동안은 문제 탭 자리에서 경주를 알린다 — 이때 폰에는 조작할 것이 없다
  if (d.phase === 'moving' && lastPhaseSeen !== 'moving') TAB = 0;
  if (d.phase === 'bonus' && lastPhaseSeen !== 'bonus') TAB = 1;
  lastPhaseSeen = d.phase;

  const me = d.me;
  if (me) {
    // 이름을 비우면 서버가 '2모둠'으로 채운다(room.ts). 번호를 또 붙이면 '2모둠 2모둠'이 된다
    $('mname').textContent = String(me.name) === me.no + '모둠' ? me.name : `${me.no}모둠 ${me.name}`;

    // 코인이 늘거나 줄면 눈에 띄게. 정산 순간에 아무 반응이 없으면 딴 건지 잃은 건지 모른다
    const coinEl = $('mcoins');
    const coinTxt = `💰 ${me.coins}코인`;
    if (coinEl.textContent && coinEl.textContent !== coinTxt) {
      coinEl.classList.remove('changed');
      void coinEl.offsetWidth;                 // 애니메이션을 다시 트는 표준 수법
      coinEl.classList.add('changed');
    }
    coinEl.textContent = coinTxt;

    // 새 힌트가 오면 힌트 탭으로. 토론 단계에도 힌트 탭을 연다
    if (me.hints.length > seenHints) {
      const isNew = seenHints > 0;
      seenHints = me.hints.length;
      if (isNew) TAB = 1;
    }
    const b = $('hb');
    b.textContent = String(me.hints.length);
    b.classList.toggle('hidden', !me.hints.length);
  }
  if (d.phase === 'discuss' && TAB === 0) TAB = 1;
  $('g-room').textContent = d.roomTitle || '';

  const n = $('now');
  n.textContent = '지금은 ▸ ' + (PHASE_KO[d.phase] || '');
  n.className = 'now' + (d.phase === 'paused' ? ' paused' : '');

  drawTab();
}

/** 1초마다. 서버 시각으로 남은 초를 다시 센다 (폴링이 아니다) */
function tick(): void {
  const d = D;
  if (!d || d.isOver) return;
  const left = clock.secondsLeft(d);
  const bar = $('tbar');
  bar.style.width = (clock.progress(d) * 100) + '%';

  // 마감 10초 전엔 막대가 빨개지고 뛴다 — 폰을 안 보고 있어도 곁눈에 걸리게
  const urgent = left != null && left <= 10 && (d.phase === 'betting' || d.phase === 'quiz' || d.phase === 'bonus');
  bar.parentElement!.classList.toggle('urgent', urgent);

  const n = $('now');
  n.textContent = '지금은 ▸ ' + (PHASE_KO[d.phase] || '') + (left != null ? `  ·  ${left}초` : '');
}

function tab(i: number): void { TAB = i; drawTab(); }

function drawTab(): void {
  (['t0', 't1', 't2'] as const).forEach((id, i) => { $(id).className = i === TAB ? 'on' : ''; });
  const p = $('pane');
  if (!D) { p.innerHTML = ''; stopRace(); return; }
  // 경주가 시작되면 문제 탭은 TV를 보게 한다. 베팅 탭은 누적 투자 현황을 직접 확인할 수 있다.
  if (D.phase === 'moving' && TAB === 0) {
    // ⚠️ 이미 그려져 있으면 다시 짓지 않는다 — innerHTML 로 갈아끼우면 캔버스가 새로
    //    생겨서 20초 경주가 상태 푸시마다 처음부터 다시 시작한다
    if (!maybe('mini-track')) p.innerHTML = racingHtml();
    startRace();
    return;
  }
  stopRace();
  p.innerHTML = TAB === 0 ? quizHtml() : TAB === 1 ? hintHtml() : betHtml();
}

/**
 * 경주(moving) 20초.
 * ⚠️ **여기에 버튼을 넣지 마세요.** 이 20초는 고개를 들어 TV 를 보라는 시간입니다 (§11-2).
 *    #mini-track 에는 team/mini.ts 가 TV 와 **같은 경주**를 작게 그린다.
 *    캔버스가 안 그려져도(구형 브라우저·reduced-motion) 문구는 남고 게임은 그대로 돈다.
 */
function racingHtml(): string {
  return '<div class="racing"><div class="head">🏇 동물들이 달리는 중</div>' +
    '<div class="sub2">앞의 큰 화면을 보세요</div>' +
    '<div id="mini-track"></div></div>';
}

let racing = false;

/**
 * 미니 트랙을 돌린다. 시간축은 **서버 시각**이다 (§11-2) —
 * 늦게 들어온 폰도 TV 와 같은 지점부터 본다.
 *
 * ⚠️ 'moving' 이 아니라 raceMoves 로 판단한다: 경주 중 일시정지하면 phase 는 'paused' 가
 *    되지만 말은 그 자리에 서 있어야 한다 (clock.elapsed 가 멈춰 준다)
 */
function startRace(): void {
  const host = maybe('mini-track');
  if (!host) return;
  if (racing && host.querySelector('canvas')) return;
  racing = true;
  startMini(host, () => D, () => (D && D.raceMoves ? clock.elapsed(D) : null));
}

function stopRace(): void {
  if (!racing) return;
  racing = false;
  stopMini();
}

/* 탭 1 — 문제 */
function quizHtml(): string {
  const d = D!, me = d.me;
  if (d.phase === 'paused') return '<div class="empty">선생님이 잠시 멈췄어요</div>';
  if (!me) return '<div class="empty">모둠 정보를 불러오는 중…</div>';
  if (d.predictionOpen) {
    const chosen = me.predictedWinner;
    if (chosen) return `<section class="prediction"><h2>🏆 우승 예측 완료</h2><p>${esc(d.emojis[chosen])} ${esc(d.animals[chosen])}을 선택했어요. 1등을 맞히면 최종 코인에 ${d.predictionBonus}코인이 추가됩니다.</p></section>`;
    if (!me.canPredictWinner) return '<div class="empty">우승 예측이 마감됐어요</div>';
    return `<section class="prediction"><h2>🏆 1등 동물 미리 예측하기</h2><p>무료로 한 마리를 선택하세요. 한 번 확정하면 바꿀 수 없고, 맞히면 최종 코인 +${d.predictionBonus}!</p>` +
      `<div class="prediction-grid">${Object.keys(d.animals).map((id) => `<button type="button" data-act="predict" data-code="${id}">${esc(d.emojis[id as AnimalCode])}<br>${esc(d.animals[id as AnimalCode])}</button>`).join('')}</div></section>`;
  }

  // 이번 라운드에 낸 답이 있으면 결과를 계속 보여준다 (오답 해설 포함)
  const mine = answered && answered.round === d.round ? answered : null;
  if (mine) {
    return mine.correct
      ? '<div class="result o">⭕ 정답! 힌트 탭을 보세요</div>'
      : `<div class="result x">❌ 오답 — 정답은 ${mine.answer}번<br>` +
        `<span style="font-weight:400;font-size:15px">${esc(mine.explanation)}</span></div>`;
  }

  if (d.phase !== 'quiz') {
    if (me.answerResult) return `<div class="result ${me.answerResult.correct ? 'o' : 'x'}">` +
      (me.answerResult.correct ? '⭕ 정답! 힌트를 받았어요' : '❌ 오답이었어요') + '</div>';
    return `<div class="empty">지금은 ${PHASE_KO[d.phase] || ''}</div>`;
  }
  if (!me.canAnswer) {
    if (me.answerResult) return `<div class="result ${me.answerResult.correct ? 'o' : 'x'}">` +
      (me.answerResult.correct ? '⭕ 정답! 힌트 탭을 보세요' : '❌ 오답 — 다음 라운드를 기다려요') + '</div>';
    return '<div class="empty">시간이 지났어요</div>';
  }
  if (!me.chosenLevel && !openQuestion) {
    return '<p class="sub">어려울수록 좋은 힌트를 받아요</p><div class="levels">' +
      '<button class="lv-easy" data-act="level" data-level="쉬움">쉬움 · 힌트 약</button>' +
            // ⚠️ 난이도 값은 서버의 LEVELS 와 **글자 하나까지 같아야** 문제가 배정된다.
      //    '중간' → '보통' (RENEWAL §1). 화면 문구 자체는 3단계에서 손댄다
      '<button class="lv-normal" data-act="level" data-level="보통">보통 · 힌트 중</button>' +
      '<button class="lv-hard" data-act="level" data-level="어려움">어려움 · 힌트 강</button></div>';
  }
  // 답을 낸 뒤에도 문제 본문은 서버가 보내준다 (views.ts teamView — 정답은 안 담긴다)
  const q = openQuestion || d.question;
  if (!q) return '<div class="empty">문제를 불러오는 중…</div>';
  return `<div class="q">${esc(q.text)}</div>` + q.choices.map((c, i) =>
    `<button class="choice${sel === i + 1 ? ' sel' : ''}" data-act="pick" data-choice="${i + 1}">${i + 1}. ${esc(c)}</button>`
  ).join('') + `<button class="big" data-act="submit"${sel ? '' : ' disabled'}>제출하기</button>`;
}

function chooseLevel(lv: Level, btn: HTMLButtonElement): void {
  confirmBox(`${lv}로 정할까요?\n이번 라운드에는 못 바꿔요.`, () => {
    void act('chooseLevel', [TEAM, lv, PIN], btn).then((d) => {
      if (!d) return;
      const r = d as { level: Level; question: { text: string; choices: string[] } };
      openQuestion = r.question;
      openLevel = lv;
      drawTab();
    });
  });
}

function submit(btn: HTMLButtonElement): void {
  if (!sel || !openLevel) return;
  const round = D ? D.round : -1;
  void act('submitAnswer', [TEAM, openLevel, sel, PIN], btn).then((d) => {
    if (!d) return;
    const r = d as { correct: boolean; answer: number; explanation: string };
    answered = { round, correct: r.correct, answer: r.answer, explanation: r.explanation || '' };
    openQuestion = null; openLevel = null; sel = null;
    drawTab();
  });
}

/* 탭 2 — 힌트 (게임의 심장) */
/**
 * 사기 라운드 공지. 서버는 **켜져 있는지만** 준다(fraudNotice) — 어느 라운드인지는 정산 때까지 비밀이다.
 * ⚠️ 접히지 않게 맨 위에 둔다. 이 한 줄이 없으면 학생은 거짓 힌트를 참으로 믿고 억울해진다
 */
function fraudNote(): string {
  return D && D.fraudNotice
    ? '<div class="fraudnote">🎭 2~4라운드 중 한 라운드의 힌트는 <b>거짓</b>입니다.<br>어느 라운드인지는 여러분이 추리하세요. 서로 어긋나는 힌트를 찾아보세요.</div>'
    : '';
}

function hintHtml(): string {
  const h = D && D.me ? D.me.hints : [];
  const shop = D && D.phase === 'bonus' ? bonusHtml(D) : '';
  const prediction = D?.me?.predictedWinner && !D.predictionOpen
    ? `<div class="prediction-recap">🏆 사전 우승 예측: ${esc(D.emojis[D.me.predictedWinner])} ${esc(D.animals[D.me.predictedWinner])} · 적중 시 +${D.predictionBonus}코인</div>`
    : '';
  if (!h.length) return shop + prediction + fraudNote() + '<div class="empty">문제를 맞히면 힌트를 받아요</div>';
  return shop + prediction + fraudNote() + h.slice().reverse().map((x) => {
    const icons = x.animalIds?.length
      ? `<div class="meta">${x.animalIds.map((id) => `${esc(D!.emojis[id])} ${esc(D!.animals[id])}`).join(' · ')}</div>`
      : '';
    return `<div class="hint"><div class="meta">${x.round}라운드 · ${esc(x.level)}</div>` +
      icons + `<div class="txt">${esc(x.text)}</div></div>`;
  }).join('');
}

function predictWinner(animalId: AnimalCode, btn: HTMLButtonElement): void {
  if (!D?.me?.canPredictWinner) return;
  confirmBox(`${D.animals[animalId]}을 1등으로 예측할까요?\n확정하면 바꿀 수 없어요.`, () => {
    void act('predictWinner', [TEAM, animalId, PIN], btn);
  });
}

function bonusHtml(d: TeamView): string {
  const me = d.me;
  if (!me) return '';
  if (me.bonusBox) return `<section class="bonus-shop"><h2>🎁 추가 단서 구입 완료</h2><p>${me.bonusBox}번 상자를 열었습니다. 받은 단서는 아래에서 확인하세요.</p></section>`;
  if (!me.canBuyBonus) return `<section class="bonus-shop"><h2>🎁 추가 단서 구입!</h2><p>구입에는 ${d.bonusCost}코인이 필요합니다. 현재 ${me.coins}코인이라 구입할 수 없어요.</p></section>`;
  return `<section class="bonus-shop"><h2>🎁 추가 단서 구입!</h2><p>${d.bonusCost}코인을 내고 비밀 상자 하나를 고르세요. 세 상자에는 서로 다른 참 단서가 숨어 있습니다.</p>` +
    `<div class="bonus-boxes">${[1, 2, 3].map((box) => `<button type="button" data-act="bonus" data-box="${box}" aria-label="${box}번 비밀 상자 선택"><span>🎁</span><b>${box}번 상자</b></button>`).join('')}</div></section>`;
}

function buyBonus(box: number, btn: HTMLButtonElement): void {
  if (!D?.me?.canBuyBonus) return;
  confirmBox(`${box}번 비밀 상자를 열까요?\n${D.bonusCost}코인이 차감되며 다시 고를 수 없어요.`, () => {
    void act('buyBonusHint', [TEAM, box, PIN], btn);
  });
}

/* 탭 3 — 베팅 */
function investmentHtml(d: TeamView): string {
  const me = d.me!;
  const summary = summarizeInvestments(me.myBets, d.odds);
  const coin = (n: number): string => n.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  const rows = summary.lines.length
    ? summary.lines.map(({ animalId, coins, odds, reference }) =>
      `<div class="investment-row"><span>${esc(d.emojis[animalId])} ${esc(d.animals[animalId])}</span>` +
      `<span>${coins}코인 × ${odds.toFixed(2)}배 = <b>${coin(reference)}</b></span></div>`
    ).join('')
    : '<p class="investment-empty">아직 확정한 베팅이 없어요.</p>';
  return '<section class="investment-summary" aria-label="우리 모둠 누적 투자 현황">' +
    '<h2>📊 우리 모둠 누적 투자</h2>' +
    `<div class="investment-totals"><span>보유 <b>${coin(me.coins)}코인</b></span>` +
    `<span>투자 <b>${coin(summary.invested)}코인</b></span></div>` +
    rows +
    `<div class="investment-reference">현재 배당 기준 단순 합계 <b>${coin(summary.referenceTotal)}코인</b></div>` +
    '<p class="investment-caution">확정 수익이 아닌 참고값이에요. 최종 수령액은 마지막 배당률과 1·2·3등 순위별 정산률에 따라 달라집니다.</p>' +
    '</section>';
}

function betHtml(): string {
  const d = D!, me = d.me;
  if (!me) return '<div class="empty">모둠 정보를 불러오는 중…</div>';
  const investment = investmentHtml(d);
  if (d.phase === 'paused') return investment + '<div class="empty">선생님이 잠시 멈췄어요</div>';
  if (!me.canBet) {
    // ⚠️ 확정 뒤에 이 화면이 시선을 **TV 로 올려 보낸다** (§11-5, 05 §1 "고개 들어 TV를 본다").
    //    여기에 다시 만질 것을 넣으면 학생은 계속 폰을 본다
    if (me.myBets[d.round]) return investment + '<div class="empty locked">✅ 이번 라운드 베팅을 확정했어요' +
      '<div class="watch">📺 TV 를 보세요</div></div>';
    if (d.phase !== 'betting') return investment + `<div class="empty">지금은 ${PHASE_KO[d.phase] || ''}</div>`;
    return investment + '<div class="empty">베팅 시간이 지났어요</div>';
  }

  let used = 0;
  for (const k of Object.keys(draft) as AnimalCode[]) used += draft[k] || 0;
  const cap = Math.min(d.maxBet, me.coins);

  const rows = (Object.keys(d.animals) as AnimalCode[]).map((c) => {
    const v = draft[c] || 0;
    let chips = '';
    // 건 코인만큼 칩이 쌓인다 — 이게 무게감의 핵심. 방금 얹은 하나만 튀어오른다
    for (let i = 0; i < v; i++) chips += `<span class="chip${c === lastBumped && i === v - 1 ? ' new' : ''}"></span>`;
    // 결승선 3칸 전에 도달한 동물은 잠긴다. 서버와 같은 공통 함수를 쓴다.
    const noBet = isNoBetPosition(d.positions[c] ?? 0, d.trackCells);
    const controls = noBet
      ? '<span class="fin-tag">🚫 베팅 금지</span>'
      : `<button class="step" data-act="bet" data-code="${c}" data-delta="-1"${v ? '' : ' disabled'}>−</button>` +
        `<span class="cnt num">${v}</span>` +
        `<button class="step plus" data-act="bet" data-code="${c}" data-delta="1"${used >= cap ? ' disabled' : ''}>+</button>`;
    return `<div class="brow${v ? ' has' : ''}${noBet ? ' fin' : ''}">` +
      `<span class="b-emoji">${d.emojis[c] || ''}</span>` +
      `<span class="b-main"><span class="bname">${esc(d.animals[c])}</span>` +
        `<span class="b-sub"><span class="bodds num">${d.odds[c].toFixed(2)}배</span>` +
        `<span class="chips">${chips}</span></span></span>` + controls + '</div>';
  }).join('');

  return investment + '<div class="bet-head"><span>이번 라운드에 걸 코인</span>' +
    `<span><b class="num">${used}</b> / ${cap}</span></div>` +
    rows + `<div class="used">보유 ${me.coins}코인</div>` +
    `<button class="big commit" data-act="commit"${used ? '' : ' disabled'}>` +
    (used ? `💰 ${used}코인 걸기` : '코인을 골라주세요') + '</button>';
}

function bet(c: AnimalCode, delta: number): void {
  draft[c] = Math.max(0, (draft[c] || 0) + delta);
  if (!draft[c]) delete draft[c];
  lastBumped = delta > 0 ? c : null;   // 방금 얹은 칩 하나만 튀어오르게
  buzz(delta > 0 ? 12 : 8);
  drawTab();
}

function confirmBet(btn: HTMLButtonElement): void {
  let used = 0;
  for (const k of Object.keys(draft) as AnimalCode[]) used += draft[k] || 0;
  confirmBox(`코인 ${used}개를 겁니다.\n확정하면 되돌릴 수 없어요.`, () => {
    // ⚠️ 칩의 **좌표를 지금 재 둔다.** 서버가 확정을 받아들이면 상태 푸시가 곧바로 와서
    //    탭이 다시 그려지고, 그때는 잴 칩이 이미 없다 (실제로 그래서 아무것도 안 날았다)
    const spots = chipSpots();
    void act('placeBet', [TEAM, draft, PIN], btn).then((d) => {
      if (!d) return;
      buzz([20, 50, 20]);
      flyAwayChips(spots);       // 칩이 화면 위로 날아가 사라진다 (§11-5)
      draft = {}; lastBumped = null;
      drawTab();
    });
  });
}

function chipSpots(): { x: number; y: number }[] {
  if (reducedMotion()) return [];
  return [...document.querySelectorAll<HTMLElement>('#pane .chip')].map((c) => {
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top };
  });
}

/**
 * 확정 순간 칩이 화면 위로 날아간다 (MIGRATION §11-5).
 * 이 연출이 시선을 TV 로 올려 보낸다 — 05 §1 의 "고개 들어 TV 를 본다" 가 이것이다.
 *
 * ⚠️ 원래 칩을 그대로 애니메이션할 수 없다 — 바로 뒤 `drawTab()` 이 탭을 통째로 다시
 *    그려서 그 요소들이 사라진다. 그래서 **재 둔 자리에 사본을 얹고** 사본만 날려 보낸다.
 * ⚠️ `pointer-events:none` — 날아가는 동안 화면을 못 누르면 안 된다.
 */
function flyAwayChips(spots: { x: number; y: number }[]): void {
  if (!spots.length || reducedMotion()) return;
  const layer = document.createElement('div');
  layer.className = 'flyaway';
  spots.forEach((p, i) => {
    const s = document.createElement('span');
    s.className = 'chip';
    s.style.left = p.x + 'px';
    s.style.top = p.y + 'px';
    s.style.animationDelay = (i * 26) + 'ms';
    layer.appendChild(s);
  });
  document.body.appendChild(layer);
  window.setTimeout(() => layer.remove(), 1400);
}

// ────────────────────────────────────────────────────────────
// S6 결과
// ────────────────────────────────────────────────────────────

function showResult(d: TeamView): void {
  $('game').classList.add('hidden');
  const r = $('result');
  r.classList.remove('hidden');

  const truth = d.truth || [];
  const mine = (d.settlement || []).filter((s: Settlement) => s.teamNo === TEAM)[0];
  const medal = ['🥇', '🥈', '🥉'];

  // 정산 뒤에만 오는 값이다. 정산 전 뷰에는 이 열쇠가 아예 없다 (LEAK 게이트)
  const fr = (d as TeamView & { fraudRound?: number | null }).fraudRound;
  let html = '<div class="card"><h1>🏁 최종 결과</h1><div style="font-size:20px;line-height:2;margin-top:10px">' +
    truth.slice(0, 3).map((c, i) => `${medal[i]} ${i + 1}등 ${d.emojis[c] || ''} ${esc(d.animals[c])}`).join('<br>') +
    '</div>' + (fr ? `<div class="fraudnote" style="margin-top:12px">🎭 ${fr}라운드 힌트가 거짓이었습니다</div>` : '') + '</div>';

  if (mine) {
    html += '<div class="card"><h1>우리 모둠</h1>' + mine.lines.map((l) =>
      `<div style="padding:8px 0;border-bottom:1px solid #EEF2F6">${l.gained ? '✅' : '❌'} ` +
      `${esc(d.animals[l.animalCode])} (${l.finalRank}등) ${l.coins}코인 → <b>${l.gained}코인</b></div>`
    ).join('') +
      `<div style="padding:8px 0;border-bottom:1px solid #EEF2F6">🏆 사전 우승 예측: ${mine.predictedWinner ? `${esc(d.emojis[mine.predictedWinner])} ${esc(d.animals[mine.predictedWinner])}` : '선택 안 함'} → <b>+${mine.predictionBonus || 0}코인</b></div>` +
      `<div style="margin-top:14px;font-size:20px;font-weight:800">최종 ${mine.finalCoins}코인 · 전체 ${mine.rank}위</div></div>`;
  }
  r.innerHTML = html;
}

// ────────────────────────────────────────────────────────────
// 배선
// ────────────────────────────────────────────────────────────

function wire(): void {
  ($('j1-next') as HTMLButtonElement).onclick = step1;
  ($('j3-go') as HTMLButtonElement).onclick = step3;

  ($('jcode') as HTMLInputElement).addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') step1();
  });
  ($('jpin') as HTMLInputElement).addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') step3();
  });

  $('jteams').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!b || !b.dataset.no) return;
    step2(Number(b.dataset.no), b.dataset.name || '');
  });

  document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => {
    b.onclick = () => tab(Number(b.dataset.tab));
  });

  // ⚠️ 탭 내용은 innerHTML 로 갈아끼우므로 버튼에 직접 붙일 수 없다.
  //    한 곳에서 위임으로 받는다 — 원본이 onclick 문자열을 쓰던 자리다
  $('pane').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!b || !b.dataset.act) return;
    switch (b.dataset.act) {
      case 'level':  chooseLevel(b.dataset.level as Level, b); break;
      case 'pick':   sel = Number(b.dataset.choice); drawTab(); break;
      case 'submit': submit(b); break;
      case 'bonus':  buyBonus(Number(b.dataset.box), b); break;
      case 'predict': predictWinner(b.dataset.code as AnimalCode, b); break;
      case 'bet':    bet(b.dataset.code as AnimalCode, Number(b.dataset.delta)); break;
      case 'commit': confirmBet(b); break;
    }
  });
}

function start(): void {
  wire();

  // 배포 버전 — 재배포 누락을 눈으로 잡는 자리 (원본 gwVersion)
  api('/api/version').then((env) => {
    if (isOk(env)) $('ver').textContent = '배포 ' + (env.data as { v: string }).v;
  }).catch(() => { /* 버전 표시는 없어도 게임은 돈다 */ });

  // 지난 접속의 판 코드를 채워 둔다. 암호는 저장하지 않으므로 다시 넣어야 한다
  try {
    const saved = JSON.parse(localStorage.getItem('wd') || 'null') as { code: string; team: number } | null;
    if (saved && saved.code) ($('jcode') as HTMLInputElement).value = saved.code;
  } catch { /* 막힌 브라우저 */ }
}

start();
