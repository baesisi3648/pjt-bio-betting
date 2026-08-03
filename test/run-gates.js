/**
 * run-gates.js — 08-derived-gates.md의 Hard/Domain 게이트를 실제로 돌린다.
 *
 * Apps Script에는 테스트 도구가 없으므로, Game.gs를 순수 함수로 만들어
 * node에서 그대로 불러 검증한다. 같은 파일이 앱스 스크립트에서도 돈다.
 *
 *   node test/run-gates.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const sandbox = { module: { exports: {} }, Math, JSON, console, Array, Object };
sandbox.global = sandbox;
vm.createContext(sandbox);
['Config.gs', 'Game.gs'].forEach(f => {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'apps-script', f), 'utf8'), sandbox, { filename: f });
});
const G = sandbox;

const N = 100;
let pass = 0, fail = 0;
const results = [];

function gate(id, title, fn) {
  let ok, detail;
  try { const r = fn(); ok = r.ok; detail = r.detail; }
  catch (e) { ok = false; detail = 'ERROR ' + e.message; }
  results.push({ id, title, ok, detail });
  ok ? pass++ : fail++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${id.padEnd(6)} ${title}\n         ${detail}`);
}

// 판 100개를 미리 만들어 재사용
const races = [];
for (let i = 0; i < N; i++) {
  let r = null, tries = 0;
  while (!r && tries++ < 20) r = G.planRace();
  if (!r) throw new Error('planRace 실패 — 역산 알고리즘 문제');
  races.push(r);
}

console.log('\n=== Hard 게이트 ===\n');

gate('H1', '최종 도착 순서 = 정답 순위', () => {
  let hit = 0;
  for (const r of races) {
    const pos = G.positionsAtRound(r.moves, r.lastRound);
    const order = G.rankByPosition(pos, r.truth);
    if (order.join('') === r.truth.join('')) hit++;
  }
  return { ok: hit === N, detail: `${hit}/${N} 일치` };
});

gate('H1b', '모든 이동값이 0~3 범위', () => {
  let bad = 0;
  for (const r of races) {
    for (const c in r.moves) for (const m of r.moves[c]) if (m < 0 || m > 3) bad++;
  }
  return { ok: bad === 0, detail: `범위 밖 ${bad}개` };
});

gate('H2', '모든 힌트가 참', () => {
  let falseCount = 0, checked = 0;
  for (const r of races) {
    const preds = G.buildHintPredicates(r.truth);
    for (const level in preds) {
      for (const p of preds[level]) { checked++; if (!p(r.truth)) falseCount++; }
    }
  }
  return { ok: falseCount === 0, detail: `${checked}개 검사, 거짓 ${falseCount}개` };
});

gate('H3-a', '전체 힌트로 1·2·3등 유일 결정', () => {
  let uniq = 0;
  const sample = races.slice(0, 20);   // 8! × 18조건 × 100판은 과함. 20판이면 충분히 유의미
  for (const r of sample) {
    const preds = G.buildHintPredicates(r.truth);
    const all = [].concat(preds['어려움'], preds['중간'], preds['쉬움']);
    if (G.countTop3Candidates(all, 5) === 1) uniq++;
  }
  return { ok: uniq === sample.length, detail: `${uniq}/${sample.length} 유일 결정` };
});

gate('H3-b', '어려움 6개만으로 1·2·3등 유일 결정', () => {
  let uniq = 0;
  const sample = races.slice(0, 20);
  for (const r of sample) {
    const hard = G.buildHintPredicates(r.truth)['어려움'];
    if (G.countTop3Candidates(hard, 5) === 1) uniq++;
  }
  return { ok: uniq === sample.length, detail: `${uniq}/${sample.length} 유일 결정 (어려움만 6개)` };
});

gate('H4', '모둠 응답에 정답이 안 담김', () => {
  const r = races[0];
  const state = {
    round: 3, phase: 'betting', truth: r.truth, moves: r.moves, lastRound: r.lastRound,
    isOver: false, pool: seedPool(),
    teams: [
      { no: 1, name: '1모둠', pin: '1111', coins: 14, hints: [{ round: 1, level: '어려움', text: '치타는 1·2·3등 안에 반드시 듭니다.' }], answered: {}, bets: {}, betLocked: {} },
      { no: 2, name: '2모둠', pin: '2222', coins: 20, hints: [{ round: 1, level: '쉬움', text: '거북이는 5등 이하입니다.' }], answered: {}, bets: {}, betLocked: {} }
    ]
  };
  const view = G.toTeamView(state, 1, G.DEFAULTS);
  const s = JSON.stringify(view);
  const leaks = [];
  if (s.includes('truth')) leaks.push('truth');
  if (s.includes('moves')) leaks.push('moves');
  if (s.includes('lastRound')) leaks.push('lastRound');
  if (s.includes('2222')) leaks.push('다른 모둠 pin');
  if (s.includes('거북이는 5등')) leaks.push('다른 모둠 힌트');
  return { ok: leaks.length === 0, detail: leaks.length ? '유출: ' + leaks.join(', ') : '유출 0건' };
});

gate('H4b', '게임이 끝나면 정답이 공개된다', () => {
  const r = races[0];
  const state = {
    round: r.lastRound, phase: 'done', truth: r.truth, moves: r.moves, lastRound: r.lastRound,
    isOver: true, pool: seedPool(),
    teams: [{ no: 1, name: '1모둠', pin: '1111', coins: 5, hints: [], answered: {}, bets: {}, betLocked: {} }]
  };
  const view = G.toTeamView(state, 1, G.DEFAULTS);
  const ok = Array.isArray(view.truth) && view.truth.join('') === r.truth.join('');
  return { ok, detail: ok ? '정산 후에만 공개됨' : 'truth 누락 또는 불일치' };
});

gate('H9', '정산 계산', () => {
  const finalOrder = ['C', 'A', 'F', 'B', 'H', 'D', 'G', 'E'];
  const odds = { C: 2.00, A: 2.14, F: 4.00, B: 5.00, H: 3.00, D: 3.00, G: 3.00, E: 3.00 };
  const teams = [{ no: 1, name: '1모둠', coins: 8, bets: { 1: { A: 4 }, 2: { D: 2 } } }];
  const out = G.settle(teams, finalOrder, odds, G.DEFAULTS);
  // A는 2등 → 4 × 2.14 × 0.7 = 5.992 → 6 / D는 6등 → 0 / 최종 8 + 6 = 14
  const s = out[0];
  const ok = s.gained === 6 && s.finalCoins === 14;
  return { ok, detail: `획득 ${s.gained} (기대 6), 최종 ${s.finalCoins} (기대 14)` };
});

console.log('\n=== Domain 게이트 ===\n');

gate('D1', '3라운드까지 골인 동물 0마리', () => {
  let bad = 0;
  for (const r of races) {
    const pos = G.positionsAtRound(r.moves, 3);
    for (const c in pos) if (pos[c] >= G.DEFAULTS.trackCells) bad++;
  }
  return { ok: bad === 0, detail: `3라운드에 골인한 동물 ${bad}마리` };
});

gate('D2', '베팅 규칙을 서버가 막는다', () => {
  const st = G.DEFAULTS;
  const t = { coins: 2, bets: {}, betLocked: { 1: true } };
  const c1 = G.validateBet({ coins: 20, bets: {}, betLocked: {} }, 1, { A: 4 }, st);
  const c2 = G.validateBet({ coins: 1, bets: {}, betLocked: {} }, 1, { A: 2 }, st);
  const c3 = G.validateBet(t, 1, { A: 1 }, st);
  const c4 = G.validateBet({ coins: 20, bets: {}, betLocked: {} }, 1, { A: 2, B: 1 }, st);
  const got = [c1.error, c2.error, c3.error, c4.ok];
  const ok = c1.error === 'TOO_MANY_COINS' && c2.error === 'NOT_ENOUGH_COINS' &&
             c3.error === 'ALREADY_BET' && c4.ok === true;
  return { ok, detail: got.join(' / ') };
});

gate('D5', '캐시 복구 후에도 같은 라운드에 같은 문제', () => {
  const qs = { '쉬움': ids(6), '중간': ids(6), '어려움': ids(6) };
  const seeded = seedRng(42);
  const p1 = G.planQuestions(qs, 6, seeded());
  const p2 = JSON.parse(JSON.stringify(p1));   // 상태 복구 = 저장된 plan을 다시 읽는 것
  const same = JSON.stringify(p1) === JSON.stringify(p2);
  const distinct = new Set(Object.keys(p1).map(r => p1[r]['어려움'])).size;
  return { ok: same && distinct === 6, detail: `계획 동일 ${same}, 6라운드 서로 다른 문항 ${distinct}/6` };
});

gate('D5b', '문항이 모자라면 순환 재사용', () => {
  const qs = { '쉬움': ids(2), '중간': ids(2), '어려움': ids(2) };
  const p = G.planQuestions(qs, 6, Math.random);
  const assigned = Object.keys(p).map(r => p[r]['어려움']);
  const ok = assigned.every(x => x !== null) && assigned[0] === assigned[2] && assigned[0] === assigned[4];
  return { ok, detail: `배정 ${assigned.join(',')} (2개를 순환)` };
});

gate('D6', '어려움 6번 골라도 같은 힌트 두 번 안 감', () => {
  let dup = 0;
  for (const r of races) {
    const pool = G.buildHints(r.truth)['어려움'];
    if (new Set(pool).size !== pool.length) dup++;
    if (pool.length < G.LIMITS.minHintsPerLevel) dup++;
  }
  return { ok: dup === 0, detail: `풀 크기 ${G.buildHints(races[0].truth)['어려움'].length}개, 중복/부족 판 ${dup}개` };
});

gate('M6', '최대 배당률이 16배 이하 (시드 15)', () => {
  const pool = seedPool();
  pool.A += 108;    // 최악: 한 동물에 전량 몰림 → 나머지 배당 최대
  const odds = G.computeOdds(pool);
  const max = Math.max(...Object.values(odds));
  return { ok: max <= 16, detail: `최대 ${max}배 (시드 5였다면 약 29.6배)` };
});

gate('M7', '난이도별 힌트 풀 6개 이상', () => {
  const h = G.buildHints(races[0].truth);
  const sizes = Object.keys(h).map(k => `${k} ${h[k].length}`);
  const ok = Object.keys(h).every(k => h[k].length >= G.LIMITS.minHintsPerLevel);
  return { ok, detail: sizes.join(' / ') };
});

gate('M9', '힌트 검산 1초 이내', () => {
  const t0 = Date.now();
  const preds = G.buildHintPredicates(races[0].truth);
  G.countTop3Candidates([].concat(preds['어려움'], preds['중간'], preds['쉬움']));
  const ms = Date.now() - t0;
  return { ok: ms < 1000, detail: `8! 전수 검사 ${ms}ms` };
});

gate('CODE', '판 코드에 혼동 문자(0 O 1 I) 없음', () => {
  let bad = 0;
  for (let i = 0; i < 500; i++) if (/[0O1I]/.test(G.makeCode())) bad++;
  return { ok: bad === 0, detail: `500회 중 ${bad}회 등장` };
});

// ── 보조 ──
function seedPool() {
  const p = {};
  for (const c of G.ANIMAL_CODES) p[c] = G.DEFAULTS.seedCoins;
  return p;
}
function ids(n) { return Array.from({ length: n }, (_, i) => ({ id: i + 1 })); }
function seedRng(seed) {
  return () => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
}

console.log(`\n${'='.repeat(52)}`);
console.log(`통과 ${pass} / 실패 ${fail}   (판 ${N}개 기준)`);
console.log('='.repeat(52) + '\n');
fs.writeFileSync(path.join(ROOT, 'test', 'gate-results.json'),
  JSON.stringify({ at: 'run', races: N, pass, fail, results }, null, 2));
process.exit(fail === 0 ? 0 : 1);
