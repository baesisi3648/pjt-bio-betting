/**
 * simulate-game.js — 6모둠 × 6라운드 전체 판을 돌려서 통합 게이트를 확인한다.
 * SpreadsheetApp / CacheService / LockService를 가짜로 만들어 Code.gs를 그대로 실행한다.
 *
 *   node test/simulate-game.js
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');

// ── 앱스 스크립트 흉내 ──
const tabs = {};
const READS = {};                       // 어떤 탭을 몇 번 읽었나 (게이트 PERF1)
function sheetStub(name) {
  tabs[name] = tabs[name] || [];
  return {
    getDataRange: () => ({ getValues: () => { READS[name] = (READS[name] || 0) + 1; return tabs[name].length ? tabs[name] : [[]]; } }),
    appendRow: r => tabs[name].push(r.slice()),
    getLastRow: () => tabs[name].length,
    getRange: (row, col, nr, nc) => ({
      setValues: vals => vals.forEach((v, i) => { tabs[name][row - 1 + i] = v.slice(); }),
      setFontWeight: () => ({ setBackground: () => {} })
    }),
    setFrozenRows: () => {}
  };
}
let cache = {};
let WEBAPP_CONTEXT = false;   // true = 웹앱 환경 흉내 (getActive 가 null)
const book = () => ({ getName: () => '와일드더비', getSheetByName: n => (tabs[n] ? sheetStub(n) : null), insertSheet: n => { tabs[n] = []; return sheetStub(n); } });
const sandbox = {
  Math, JSON, console, Date, Array, Object, String, Number, Error, isNaN,
  SpreadsheetApp: {
    getActive: () => (WEBAPP_CONTEXT ? null : book()),
    openById: () => book(),
    getUi: () => ({ alert: () => {}, createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; }, addToUi() {} }) })
  },
  CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  Utilities: { sleep: () => {} },
  ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }) },
  Logger: { log: () => {} },
  HtmlService: {}, module: { exports: {} }
};
sandbox.global = sandbox;
vm.createContext(sandbox);
['Config.gs', 'Game.gs', 'QR.gs', 'Sheet.gs', 'Code.gs'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'apps-script', f), 'utf8'), sandbox, { filename: f }));
const G = sandbox;

// ── 시트 채우기 ──
tabs['문제'] = [['단원', '난이도', '문제', '보기1', '보기2', '보기3', '보기4', '정답', '해설']];
['쉬움', '중간', '어려움'].forEach(lv => {
  for (let i = 1; i <= 6; i++) tabs['문제'].push(['유전', lv, `${lv} 문제 ${i}`, 'ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', ((i % 4) + 1), '해설']);
});
tabs['힌트문구'] = [['난이도', '종류', '문장 틀'], ['어려움', '상위확정', '{X}는 1·2·3등 안에 듭니다.']];
tabs['동물'] = [['코드', '이름', '그림']];
['치타', '사자', '호랑이', '늑대', '얼룩말', '타조', '개구리', '거북이'].forEach((n, i) =>
  tabs['동물'].push([G.ANIMAL_CODES[i], n, '🐎']));
tabs['설정'] = [['항목', '값', '설명']];
tabs['게임'] = [['판코드', '반이름', '단원', '상태JSON', '만든시각', '갱신시각', '종료여부']];
tabs['기록'] = [['번호', '판코드', '라운드', '모둠', '종류', '내용', '시각']];

// ── 시뮬레이션 ──
let pass = 0, fail = 0, DATE_DETAIL = '', D6B_DETAIL = '', RACE_DETAIL = '', PERF_DETAIL = '', PERF2_DETAIL = '', CFG_DETAIL = '', CFG2_DETAIL = '';
function check(id, title, ok, detail) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(6)} ${title}\n         ${detail}`);
  ok ? pass++ : fail++;
}

console.log('\n=== 통합 시뮬레이션 (6모둠 × 전체 라운드) ===\n');

const created = G.gwCreateGame({ className: '2학년 3반', unit: '유전', teamCount: 6, teamNames: [] });
check('SIM1', '판 생성', created.ok, created.ok ? `코드 ${created.data.code}, 모둠 6개, 암호 발급됨` : created.message);
const CODE = created.data.code;
const HKEY = created.data.hostKey;            // 교사 열쇠 — 판 코드만으로는 교사 응답을 못 받는다
const PINS = created.data.pins;               // 모둠 암호 — 모둠 행동에도 매번 필요하다

const joined = G.gwJoinGame(CODE, 3, created.data.pins[3]);
check('SIM1b', '판 생성 응답에 QR 포함', typeof created.data.qr === 'string' && created.data.qr.startsWith('<svg'),
  created.data.qr ? created.data.qr.length + '바이트 SVG' : 'QR 없음');

check('SIM2', '모둠 접속', joined.ok, joined.ok ? `3모둠 입장, 보유 ${joined.data.me.coins}코인` : joined.message);
check('SIM3', '틀린 암호 거부', G.gwJoinGame(CODE, 3, '0000').error === 'WRONG_PIN', '거부됨');
const j2 = G.gwJoinGame(CODE, 3, created.data.pins[3]);
check('H8', '같은 모둠 두 번째 기기 접속 허용 (점유 없음)', j2.ok, j2.ok ? '두 기기 모두 입장' : j2.message);

// 라운드 진행
const st0 = JSON.parse(JSON.parse(tabs['게임'][1][3]) && tabs['게임'][1][3]);
const lastRound = st0.lastRound;
let phaseLog = [], roundsSeen = [];
G.gwAdvanceRound(CODE, HKEY);

for (let round = 1; round <= lastRound; round++) {
  // 문제 풀이 — 모둠마다 다른 난이도
  for (let t = 1; t <= 6; t++) {
    const lv = ['쉬움', '중간', '어려움'][t % 3];
    const ch = G.gwChooseLevel(CODE, t, lv, PINS[t]);
    if (ch.ok) G.gwSubmitAnswer(CODE, t, lv, t <= 4 ? correctAnswerFor(round, lv) : 99, PINS[t]);  // 4팀은 정답, 2팀은 오답
  }
  forceExpire(); G.gwGetState(CODE, 'teacher', HKEY);            // quiz → discuss
  phaseLog.push(currentPhase());
  forceExpire(); G.gwGetState(CODE, 'teacher', HKEY);            // discuss → betting
  phaseLog.push(currentPhase());

  for (let t = 1; t <= 6; t++) {
    const animal = G.ANIMAL_CODES[(t + round) % 8];
    G.gwPlaceBet(CODE, t, { [animal]: 2 }, PINS[t]);
  }
  forceExpire(); G.gwGetState(CODE, 'teacher', HKEY);            // betting → waiting
  roundsSeen.push(loadRaw().round);
  if (round < lastRound) G.gwAdvanceRound(CODE, HKEY);
}

check('SIM4', '단계 순서 quiz→discuss→betting', phaseLog[0] === 'discuss' && phaseLog[1] === 'betting',
  `1라운드 단계 전이: ${phaseLog.slice(0, 2).join(' → ')}`);

check('BUG1', '라운드가 실제로 앞으로 나간다 (1라운드 반복 방지)',
  roundsSeen.join(',') === Array.from({length:lastRound},(_,i)=>i+1).join(','),
  '진행한 라운드: ' + roundsSeen.join(' → ') + ' (기대 1..' + lastRound + ')');

const st = loadRaw();
check('D3', '토론 단계에 베팅이 잠긴다', (() => {
  // 새 판으로 별도 확인
  const g2 = G.gwCreateGame({ className: 'X', unit: '유전', teamCount: 2, teamNames: [] }).data;
  const c2 = g2.code;
  G.gwAdvanceRound(c2, g2.hostKey); forceExpire(c2); G.gwGetState(c2, 'teacher', g2.hostKey);   // → discuss
  return G.gwPlaceBet(c2, 1, { A: 1 }, g2.pins[1]).error === 'BET_CLOSED';
})(), '토론 중 베팅 시도 → BET_CLOSED');

check('D6', '같은 모둠에 같은 힌트 두 번 안 감', (() => {
  return st.teams.every(t => new Set(t.hints.map(h => h.text)).size === t.hints.length);
})(), st.teams.map(t => `${t.no}모둠 힌트 ${t.hints.length}개`).join(', '));

check('D2b', '3코인 초과를 서버가 막는다',
  G.gwPlaceBet(CODE, 1, { A: 4 }, PINS[1]).error !== undefined, '거부됨');

// 캐시 소실 복구
const beforeCoins = st.teams.map(t => t.coins).join(',');
const beforeHints = st.teams.map(t => t.hints.length).join(',');
cache = {};                                            // 캐시 강제 삭제
const recovered = G.gwGetState(CODE, 'teacher', HKEY).data;
const st2 = loadRaw();
check('H5', '캐시 소실 후 복구 (손실 0)',
  st2.teams.map(t => t.coins).join(',') === beforeCoins && st2.teams.map(t => t.hints.length).join(',') === beforeHints,
  `코인 ${beforeCoins} / 힌트 ${beforeHints} → 복구 후 동일`);

// 정산
const fin = G.gwFinalize(CODE, HKEY);
check('H9b', '정산 실행', fin.ok, fin.ok ? `우승 ${fin.data.settlement[0].teamNo}모둠 ${fin.data.settlement[0].finalCoins}코인` : fin.message);
check('H1c', '도착 순서 = 정답 순위', fin.data.finalOrder.join('') === st2.truth.join(''),
  `도착 ${fin.data.finalOrder.join('')} vs 정답 ${st2.truth.join('')}`);

const teamAfter = G.gwGetState(CODE, 'team:1', null, PINS[1]).data;
check('H4c', '정산 후에만 정답 공개', Array.isArray(teamAfter.truth), '정산 후 truth 포함됨');
check('H4d', '정산 전에는 정답 없음', (() => {
  const g3 = G.gwCreateGame({ className: 'Y', unit: '유전', teamCount: 2, teamNames: [] }).data;
  const v = G.gwGetState(g3.code, 'team:1', null, g3.pins[1]).data;
  const s = JSON.stringify(v);
  return !s.includes('truth') && !s.includes('moves') && !s.includes('lastRound');
})(), 'truth·moves·lastRound 0회 등장');

const settleSum = fin.data.settlement.every(s => {
  const spent = Object.keys(s.lines).length;
  return s.finalCoins === (st2.teams.find(t => t.no === s.teamNo).coins + s.gained);
});
check('H9c', '최종 = 남은 보유 + 획득', settleSum, '전 모둠 일치');

// ══ 교사 열쇠 — 판 코드는 칠판에 적혀 있어서 비밀이 아니다 ══
check('SEC1', '열쇠 없이 교사 상태를 못 본다', (() => {
  const r = G.gwGetState(CODE, 'teacher');
  return r.ok === false && r.error === 'NOT_HOST';
})(), "gwGetState(code,'teacher') → NOT_HOST");

check('SEC2', '아무 문자열을 viewer 로 넣어도 못 본다', (() => {
  return ['zzz', '', undefined, 'team', 'TEACHER'].every(v => G.gwGetState(CODE, v).ok === false);
})(), '5가지 viewer 값 전부 거부');

check('SEC3', '틀린 열쇠를 거부한다',
  G.gwGetState(CODE, 'teacher', 'AAAAAAAAAAAA').error === 'NOT_HOST', '거부됨');

check('SEC4', '열쇠 없이 모둠 암호를 못 가져간다', (() => {
  const r = G.gwHandout(CODE);
  return r.ok === false && r.error === 'NOT_HOST' && !JSON.stringify(r).match(/"pins"/);
})(), 'gwHandout → NOT_HOST, 암호 미포함');

check('SEC5', '열쇠 없이 진행·정지·정산을 못 한다', (() => {
  const g = G.gwCreateGame({ className: 'Z', unit: '유전', teamCount: 2, teamNames: [] }).data;
  return G.gwAdvanceRound(g.code).error === 'NOT_HOST' &&
         G.gwTogglePause(g.code).error === 'NOT_HOST' &&
         G.gwFinalize(g.code).error === 'NOT_HOST';
})(), '세 함수 모두 NOT_HOST');

check('SEC6', '정산 전에는 교사 응답에도 정답이 없다', (() => {
  const g = G.gwCreateGame({ className: 'W', unit: '유전', teamCount: 2, teamNames: [] }).data;
  G.gwAdvanceRound(g.code, g.hostKey);
  const v = G.gwGetState(g.code, 'teacher', g.hostKey).data;
  const raw = JSON.parse(tabs['게임'].find(r => r[0] === g.code)[3]);
  const str = JSON.stringify(v);
  // truth 배열이 없어야 하고, 정답 순서가 문자열로도 새지 않아야 한다
  return v.truth === null && !str.includes(raw.truth.join('","')) && !str.includes('moves');
})(), 'truth null · moves 없음');

check('SEC7', '정답 공개도 열쇠를 요구한다', (() => {
  return G.gwReveal(CODE).error === 'NOT_HOST' && Array.isArray(G.gwReveal(CODE, HKEY).data.truth);
})(), '열쇠 없으면 거부 / 있으면 공개');

check('SEC8', '모둠 화면은 교사 열쇠 없이 그대로 된다',
  G.gwGetState(CODE, 'team:1', null, PINS[1]).ok === true, '학생 경로에는 영향 없음');

// ══ 모둠 암호 — 접속할 때 한 번 맞춰보는 것으로는 아무것도 못 지킨다 ══
check('SEC9', '암호 없이 남의 모둠 상태를 못 본다', (() => {
  return G.gwGetState(CODE, 'team:2').error === 'WRONG_PIN' &&
         G.gwGetState(CODE, 'team:2', null, PINS[1]).error === 'WRONG_PIN';
})(), '암호 없음·다른 모둠 암호 모두 거부');

check('SEC10', '암호 없이 남의 모둠 답을 못 낸다', (() => {
  const g = G.gwCreateGame({ className: 'P', unit: '유전', teamCount: 2, teamNames: [] }).data;
  G.gwAdvanceRound(g.code, g.hostKey);
  return G.gwChooseLevel(g.code, 2, '쉬움').error === 'WRONG_PIN' &&
         G.gwChooseLevel(g.code, 2, '쉬움', g.pins[1]).error === 'WRONG_PIN' &&
         G.gwSubmitAnswer(g.code, 2, '쉬움', 1, g.pins[1]).error === 'WRONG_PIN' &&
         G.gwChooseLevel(g.code, 2, '쉬움', g.pins[2]).ok === true;
})(), '틀린 암호 거부 / 제 암호는 통과');

check('SEC11', '암호 없이 남의 모둠 코인을 못 건다', (() => {
  const g = G.gwCreateGame({ className: 'Q', unit: '유전', teamCount: 2, teamNames: [] }).data;
  G.gwAdvanceRound(g.code, g.hostKey);
  forceExpire(g.code); G.gwGetState(g.code, 'teacher', g.hostKey);   // → discuss
  forceExpire(g.code); G.gwGetState(g.code, 'teacher', g.hostKey);   // → betting
  const stolen = G.gwPlaceBet(g.code, 2, { A: 1 }, g.pins[1]);
  const own    = G.gwPlaceBet(g.code, 2, { A: 1 }, g.pins[2]);
  return stolen.error === 'WRONG_PIN' && own.ok === true;
})(), '남의 암호로는 거부 / 제 암호로는 성공');

// ══ 캐시 복구 뒤에도 같은 힌트가 두 번 가지 않는다 ══
check('D6b', '복구 후에도 같은 힌트 두 번 안 감', (() => {
  const g = G.gwCreateGame({ className: 'R', unit: '유전', teamCount: 2, teamNames: [] }).data;
  G.gwAdvanceRound(g.code, g.hostKey);
  const answerRight = (lv) => {
    const raw = JSON.parse(tabs['게임'].find(r => r[0] === g.code)[3]);
    const q = G.readQuestions().rows.find(x => x.id === raw.questionPlan[raw.round][lv]);
    return G.gwSubmitAnswer(g.code, 1, lv, q.answer, g.pins[1]);
  };
  answerRight('어려움');

  // 스냅샷이 이벤트보다 뒤처지고 캐시도 날아간 상황 (기록은 남았지만 스냅샷 저장이 유실)
  const row = tabs['게임'].find(r => r[0] === g.code);
  const stale = JSON.parse(row[3]);
  stale.eventSeq = 0; stale.hintGiven = {};
  stale.teams.forEach(t => { t.answered = {}; t.hints = []; });
  row[3] = JSON.stringify(stale);
  cache = {};

  const rec = G.loadState(g.code);              // 기록 재생으로 복구
  const restored = JSON.stringify(rec.hintGiven);

  // 복구된 상태에서 같은 난이도를 또 맞힌다
  rec.teams[0].answered = {};
  rec.phase = 'quiz'; rec.phaseEndsAt = Date.now() + 99999;
  G.cachePut(rec);
  answerRight('어려움');

  const hints = G.loadState(g.code).teams[0].hints.map(h => h.text);
  D6B_DETAIL = `복구된 hintGiven ${restored} · 힌트 ${hints.length}개, 서로 다른 것 ${new Set(hints).size}개`;
  return new Set(hints).size === hints.length;
})(), D6B_DETAIL);

// ══ 단계 전환은 잠금 안에서 일어난다 ══
check('RACE1', '단계가 끝나는 순간의 폴링이 확정된 답을 덮어쓰지 않는다', (() => {
  // 실제로 나는 순서를 그대로 만든다:
  //   ① 어떤 기기가 상태를 읽는다 (아직 문제 시간 중)
  //   ② 그 기기가 응답을 받기 전에, 2모둠이 마감 직전에 답을 확정한다 (잠금 안)
  //   ③ 그 사이 시간이 끝나고, ①의 낡은 상태를 든 기기가 이제야 단계를 넘긴다
  // 예전 코드는 ③에서 낡은 상태를 그대로 저장해 ②의 답을 지웠다.
  const g = G.gwCreateGame({ className: 'L', unit: '유전', teamCount: 2, teamNames: [] }).data;
  G.gwAdvanceRound(g.code, g.hostKey);

  const stalePoll = G.loadState(g.code);            // ① 읽어둔 낡은 상태

  const raw = JSON.parse(tabs['게임'].find(r => r[0] === g.code)[3]);
  const q = G.readQuestions().rows.find(x => x.id === raw.questionPlan[raw.round]['쉬움']);
  const sub = G.gwSubmitAnswer(g.code, 2, '쉬움', q.answer, g.pins[2]);   // ② 마감 직전 제출 — 성공해야 한다
  if (!sub.ok) { RACE_DETAIL = '제출 자체가 실패: ' + sub.message; return false; }

  forceExpire(g.code);                              // ③ 이제 시간이 끝났다
  stalePoll.phaseEndsAt = Date.now() - 1000;        //    ①이 든 상태에서도 시간은 지났다
  G.advanceIfDue(g.code, stalePoll);

  // 낡은 상태로 덮어쓰면 2모둠의 정답은 '미제출(timeout)' 기록으로 바뀌고 힌트가 날아간다
  const after = G.loadState(g.code);
  const ans = after.teams[1].answered && after.teams[1].answered[after.round];
  const hints = after.teams[1].hints.length;
  const kept = !!(ans && ans.correct && !ans.timeout) && hints > 0;
  RACE_DETAIL = kept
    ? '2모둠 정답·힌트 그대로 (힌트 ' + hints + '개), 단계는 ' + after.phase
    : '⛔ 2모둠 답이 ' + (ans && ans.timeout ? '미제출로 덮였다' : '사라졌다') +
      ' (힌트 ' + hints + '개, phase=' + after.phase + ')';
  return kept && after.phase === 'discuss';
})(), RACE_DETAIL);

// ══ 수업 중에는 '문제' 탭을 다시 읽지 않는다 ══
check('PERF1', '모둠 폴링이 문제 탭을 다시 읽지 않는다', (() => {
  const g = G.gwCreateGame({ className: 'T', unit: '유전', teamCount: 6, teamNames: [] }).data;
  G.gwAdvanceRound(g.code, g.hostKey);
  for (let t = 1; t <= 6; t++) {
    const raw = JSON.parse(tabs['게임'].find(r => r[0] === g.code)[3]);
    const q = G.readQuestions().rows.find(x => x.id === raw.questionPlan[raw.round]['쉬움']);
    G.gwChooseLevel(g.code, t, '쉬움', g.pins[t]);
    G.gwSubmitAnswer(g.code, t, '쉬움', q.answer, g.pins[t]);
  }
  Object.keys(READS).forEach(k => delete READS[k]);
  for (let i = 0; i < 30; i++) for (let t = 1; t <= 6; t++) G.gwGetState(g.code, 'team:' + t, null, g.pins[t]);
  const n = READS['문제'] || 0;
  PERF_DETAIL = `6모둠 × 30회 폴링(약 1분) → 문제 탭 읽기 ${n}번`;
  return n === 0;
})(), PERF_DETAIL);

check('PERF2', '굳혀둔 문제와 시트의 문제가 같다', (() => {
  const g = G.gwCreateGame({ className: 'U', unit: '유전', teamCount: 2, teamNames: [] }).data;
  const raw = JSON.parse(tabs['게임'].find(r => r[0] === g.code)[3]);
  const sheet = G.readQuestions().rows;
  let n = 0;
  for (const r in raw.questionPlan) {
    for (const lv in raw.questionPlan[r]) {
      const id = raw.questionPlan[r][lv];
      const frozen = raw.questionById[id], live = sheet.find(x => x.id === id);
      if (!frozen || !live) return false;
      if (frozen.text !== live.text || frozen.answer !== live.answer) return false;
      if (frozen.choices.join('|') !== live.choices.join('|')) return false;
      n++;
    }
  }
  PERF2_DETAIL = `${n}개 배정 문항 전부 일치`;
  return n > 0;
})(), PERF2_DETAIL);

// ══ '설정' 탭에 이상한 값이 들어와도 수업이 멎지 않는다 ══
check('CFG1', '잘못 적힌 설정값은 기본값으로 되돌리고 알린다', (() => {
  const backup = tabs['설정'].slice();
  tabs['설정'] = [['항목', '값', '설명'],
    ['시드코인', 0, ''],            // 0 → 배당이 0으로 나누기가 된다
    ['문제시간초', '90초', ''],      // 숫자가 아니다 → NaN
    ['토론시간초', 99999, ''],       // 범위 밖
    ['초기코인', 25, '']];           // 정상 — 그대로 쓰여야 한다
  const issues = [];
  const st = G.readSettings(issues);
  tabs['설정'] = backup;
  CFG_DETAIL = `되돌린 값 ${issues.length}개, 정상값(초기코인 ${st.initialCoins})은 유지`;
  return st.seedCoins === G.DEFAULTS.seedCoins &&
         st.quizSeconds === G.DEFAULTS.quizSeconds &&
         st.discussSeconds === G.DEFAULTS.discussSeconds &&
         st.initialCoins === 25 && issues.length === 3;
})(), CFG_DETAIL);

check('CFG2', '시드가 0이어도 배당률이 NaN 이 되지 않는다', (() => {
  const zero = {}; G.ANIMAL_CODES.forEach(c => { zero[c] = 0; });
  const o1 = G.computeOdds(zero);
  const one = {}; G.ANIMAL_CODES.forEach(c => { one[c] = 0; }); one.A = 5;
  const o2 = G.computeOdds(one);
  const finite = v => Object.keys(v).every(k => isFinite(v[k]));
  CFG2_DETAIL = `전부 0 → ${o1.A}배 / 한 마리에만 5 → A ${o2.A}배, B ${o2.B}배`;
  return finite(o1) && finite(o2);
})(), CFG2_DETAIL);

// ── 응답에 Date 가 섞이면 앱스 스크립트가 통째로 실패시킨다 ──
function findDates(v, path, out) {
  if (v instanceof Date) { out.push(path); return out; }
  if (Array.isArray(v)) { v.forEach((x, i) => findDates(x, path + '[' + i + ']', out)); return out; }
  if (v && typeof v === 'object') { Object.keys(v).forEach(k => findDates(v[k], path + '.' + k, out)); return out; }
  return out;
}
check('DATE', '모든 응답에 Date 객체가 없다 (있으면 화면이 응답을 통째로 못 받는다)', (() => {
  const calls = {
    gwListUnits: G.gwListUnits(),
    gwGetState_teacher: G.gwGetState(CODE, 'teacher', HKEY),
    gwGetState_team: G.gwGetState(CODE, 'team:1', null, PINS[1]),
    gwHandout: G.gwHandout(CODE, HKEY),
    gwDiagnose: G.gwDiagnose(),
    gwLobby: G.gwLobby(CODE)
  };
  const bad = [];
  Object.keys(calls).forEach(k => findDates(calls[k], k, bad));
  DATE_DETAIL = bad.length ? 'Date 발견: ' + bad.join(', ') : Object.keys(calls).length + '개 응답 검사, Date 0건';
  return bad.length === 0;
})(), DATE_DETAIL);

// ── 웹앱 환경 (getActive 가 null) 에서도 동작하는가 ──
WEBAPP_CONTEXT = true;
check('WEBAPP', 'getActive()가 null 인 웹앱 환경에서도 시트를 읽는다', (() => {
  try {
    const active = G.SpreadsheetApp.getActive();
    if (active !== null) return false;                 // 흉내가 제대로 됐는지
    const units = G.listUnits();
    const st = G.gwGetState(CODE, 'teacher', HKEY);
    return units.length > 0 && st.ok;
  } catch (e) { return 'ERR ' + e.message; }
})() === true, 'openById 로 열어 단원·상태 조회 성공');
WEBAPP_CONTEXT = false;

// ── 보조 ──
function loadRaw() { return JSON.parse(tabs['게임'].find(r => r[0] === CODE)[3]); }
function currentPhase() { return loadRaw().phase; }
function forceExpire(code) {
  const c = code || CODE;
  const row = tabs['게임'].find(r => r[0] === c);
  const s = JSON.parse(row[3]);
  if (s.phaseEndsAt) { s.phaseEndsAt = Date.now() - 1000; row[3] = JSON.stringify(s); cache['wd_' + c] = JSON.stringify(s); }
}
function correctAnswerFor(round, lv) {
  const st = loadRaw();
  const id = st.questionPlan[round][lv];
  const row = tabs['문제'].find((r, i) => i + 1 === id);
  return row ? row[7] : 1;
}

console.log(`\n${'='.repeat(52)}`);
console.log(`통합 시뮬레이션 — 통과 ${pass} / 실패 ${fail}`);
console.log('='.repeat(52) + '\n');
process.exit(fail === 0 ? 0 : 1);
