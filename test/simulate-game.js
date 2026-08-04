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
function sheetStub(name) {
  tabs[name] = tabs[name] || [];
  return {
    getDataRange: () => ({ getValues: () => tabs[name].length ? tabs[name] : [[]] }),
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
let pass = 0, fail = 0, DATE_DETAIL = '';
function check(id, title, ok, detail) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(6)} ${title}\n         ${detail}`);
  ok ? pass++ : fail++;
}

console.log('\n=== 통합 시뮬레이션 (6모둠 × 전체 라운드) ===\n');

const created = G.gwCreateGame({ className: '2학년 3반', unit: '유전', teamCount: 6, teamNames: [] });
check('SIM1', '판 생성', created.ok, created.ok ? `코드 ${created.data.code}, 모둠 6개, 암호 발급됨` : created.message);
const CODE = created.data.code;

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
G.gwAdvanceRound(CODE);

for (let round = 1; round <= lastRound; round++) {
  // 문제 풀이 — 모둠마다 다른 난이도
  for (let t = 1; t <= 6; t++) {
    const lv = ['쉬움', '중간', '어려움'][t % 3];
    const ch = G.gwChooseLevel(CODE, t, lv);
    if (ch.ok) G.gwSubmitAnswer(CODE, t, lv, t <= 4 ? correctAnswerFor(round, lv) : 99);  // 4팀은 정답, 2팀은 오답
  }
  forceExpire(); G.gwGetState(CODE, 'teacher');            // quiz → discuss
  phaseLog.push(currentPhase());
  forceExpire(); G.gwGetState(CODE, 'teacher');            // discuss → betting
  phaseLog.push(currentPhase());

  for (let t = 1; t <= 6; t++) {
    const animal = G.ANIMAL_CODES[(t + round) % 8];
    G.gwPlaceBet(CODE, t, { [animal]: 2 });
  }
  forceExpire(); G.gwGetState(CODE, 'teacher');            // betting → waiting
  roundsSeen.push(loadRaw().round);
  if (round < lastRound) G.gwAdvanceRound(CODE);
}

check('SIM4', '단계 순서 quiz→discuss→betting', phaseLog[0] === 'discuss' && phaseLog[1] === 'betting',
  `1라운드 단계 전이: ${phaseLog.slice(0, 2).join(' → ')}`);

check('BUG1', '라운드가 실제로 앞으로 나간다 (1라운드 반복 방지)',
  roundsSeen.join(',') === Array.from({length:lastRound},(_,i)=>i+1).join(','),
  '진행한 라운드: ' + roundsSeen.join(' → ') + ' (기대 1..' + lastRound + ')');

const st = loadRaw();
check('D3', '토론 단계에 베팅이 잠긴다', (() => {
  // 새 판으로 별도 확인
  const c2 = G.gwCreateGame({ className: 'X', unit: '유전', teamCount: 2, teamNames: [] }).data.code;
  G.gwAdvanceRound(c2); forceExpire(c2); G.gwGetState(c2, 'teacher');   // → discuss
  return G.gwPlaceBet(c2, 1, { A: 1 }).error === 'BET_CLOSED';
})(), '토론 중 베팅 시도 → BET_CLOSED');

check('D6', '같은 모둠에 같은 힌트 두 번 안 감', (() => {
  return st.teams.every(t => new Set(t.hints.map(h => h.text)).size === t.hints.length);
})(), st.teams.map(t => `${t.no}모둠 힌트 ${t.hints.length}개`).join(', '));

check('D2b', '3코인 초과를 서버가 막는다',
  G.gwPlaceBet(CODE, 1, { A: 4 }).error !== undefined, '거부됨');

// 캐시 소실 복구
const beforeCoins = st.teams.map(t => t.coins).join(',');
const beforeHints = st.teams.map(t => t.hints.length).join(',');
cache = {};                                            // 캐시 강제 삭제
const recovered = G.gwGetState(CODE, 'teacher').data;
const st2 = loadRaw();
check('H5', '캐시 소실 후 복구 (손실 0)',
  st2.teams.map(t => t.coins).join(',') === beforeCoins && st2.teams.map(t => t.hints.length).join(',') === beforeHints,
  `코인 ${beforeCoins} / 힌트 ${beforeHints} → 복구 후 동일`);

// 정산
const fin = G.gwFinalize(CODE);
check('H9b', '정산 실행', fin.ok, fin.ok ? `우승 ${fin.data.settlement[0].teamNo}모둠 ${fin.data.settlement[0].finalCoins}코인` : fin.message);
check('H1c', '도착 순서 = 정답 순위', fin.data.finalOrder.join('') === st2.truth.join(''),
  `도착 ${fin.data.finalOrder.join('')} vs 정답 ${st2.truth.join('')}`);

const teamAfter = G.gwGetState(CODE, 'team:1').data;
check('H4c', '정산 후에만 정답 공개', Array.isArray(teamAfter.truth), '정산 후 truth 포함됨');
check('H4d', '정산 전에는 정답 없음', (() => {
  const c3 = G.gwCreateGame({ className: 'Y', unit: '유전', teamCount: 2, teamNames: [] }).data.code;
  const v = G.gwGetState(c3, 'team:1').data;
  const s = JSON.stringify(v);
  return !s.includes('truth') && !s.includes('moves') && !s.includes('lastRound');
})(), 'truth·moves·lastRound 0회 등장');

const settleSum = fin.data.settlement.every(s => {
  const spent = Object.keys(s.lines).length;
  return s.finalCoins === (st2.teams.find(t => t.no === s.teamNo).coins + s.gained);
});
check('H9c', '최종 = 남은 보유 + 획득', settleSum, '전 모둠 일치');

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
    gwGetState_teacher: G.gwGetState(CODE, 'teacher'),
    gwGetState_team: G.gwGetState(CODE, 'team:1'),
    gwHandout: G.gwHandout(CODE),
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
    const st = G.gwGetState(CODE, 'teacher');
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
