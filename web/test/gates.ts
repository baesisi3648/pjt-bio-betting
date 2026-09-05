/**
 * gates.ts — 규칙 게이트. 08-derived-gates.md 의 Hard/Domain 게이트를 돌린다.
 *
 * 앱스 스크립트판(test/run-gates.js)과 **같은 것을 검사한다.** 이식이 맞았는지는
 * 여기가 판정한다. 새 규칙을 넣는 자리가 아니라, 옮긴 규칙이 그대로인지 보는 자리다.
 *
 *   node test/gates.ts
 */

import {
  planRace, positionsAtRound, rankByPosition,
  buildHints, buildHintPredicates, countTop3Candidates,
  computeOdds, validateBet, settle, planQuestions, takeHint, makeCode, makeHostKey
} from '../src/game/rules.ts';
import { ANIMAL_CODES, DEFAULTS, LEVELS, LIMITS } from '../src/game/config.ts';
import type { AnimalCode, Level } from '../src/game/config.ts';
import type { Pool, Question, Race } from '../src/game/types.ts';

const TRACK = DEFAULTS.trackCells;
let pass = 0, fail = 0;

function gate(id: string, title: string, fn: () => { ok: boolean; detail: string }) {
  let ok = false, detail = '';
  try { const r = fn(); ok = r.ok; detail = r.detail; }
  catch (e) { ok = false; detail = 'ERROR ' + (e as Error).message; }
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(7)} ${title}\n          ${detail}`);
}

const seedPool = (): Pool => {
  const p = {} as Pool;
  for (const c of ANIMAL_CODES) p[c] = DEFAULTS.seedCoins;
  return p;
};

const N = 100;
const races: Race[] = [];
for (let i = 0; i < N; i++) {
  let r: Race | null = null, tries = 0;
  while (!r && tries++ < 20) r = planRace(Math.random, TRACK);
  if (!r) throw new Error('planRace 실패');
  races.push(r);
}

console.log('\n=== 규칙 게이트 (판 ' + N + '개) ===\n');

gate('H1', '최종 도착 순서 = 정답 순위', () => {
  let hit = 0;
  for (const r of races) {
    const order = rankByPosition(positionsAtRound(r.moves, r.lastRound, TRACK), r.truth);
    if (order.join('') === r.truth.join('')) hit++;
  }
  return { ok: hit === N, detail: `${hit}/${N} 일치` };
});

gate('H1b', '모든 이동값이 0~3 범위', () => {
  let bad = 0;
  for (const r of races) for (const c of Object.keys(r.moves) as AnimalCode[])
    for (const m of r.moves[c]) if (m < 0 || m > 3) bad++;
  return { ok: bad === 0, detail: `범위 밖 ${bad}개` };
});

gate('H2', '모든 힌트가 참', () => {
  let bad = 0, n = 0;
  for (const r of races) {
    const preds = buildHintPredicates(r.truth);
    for (const lv of LEVELS) for (const p of preds[lv]) { n++; if (!p(r.truth)) bad++; }
  }
  return { ok: bad === 0, detail: `${n}개 검사, 거짓 ${bad}개` };
});

gate('H2b', '힌트 문장과 논리식의 개수가 짝이 맞는다', () => {
  const r = races[0];
  const text = buildHints(r.truth), pred = buildHintPredicates(r.truth);
  const mismatch = LEVELS.filter(lv => text[lv].length !== pred[lv].length);
  return { ok: mismatch.length === 0,
           detail: mismatch.length ? `어긋남: ${mismatch.join(',')}` :
                   LEVELS.map(lv => `${lv} ${text[lv].length}`).join(' / ') };
});

gate('H3-a', '전체 힌트로 1·2·3등 유일 결정', () => {
  let uniq = 0;
  const sample = races.slice(0, 20);
  for (const r of sample) {
    const p = buildHintPredicates(r.truth);
    if (countTop3Candidates([...p['어려움'], ...p['중간'], ...p['쉬움']], 5) === 1) uniq++;
  }
  return { ok: uniq === sample.length, detail: `${uniq}/${sample.length} 유일 결정` };
});

gate('H3-b', '어려움 6개만으로 1·2·3등 유일 결정', () => {
  let uniq = 0;
  const sample = races.slice(0, 20);
  for (const r of sample) {
    if (countTop3Candidates(buildHintPredicates(r.truth)['어려움'], 5) === 1) uniq++;
  }
  return { ok: uniq === sample.length, detail: `${uniq}/${sample.length} 유일 결정 (어려움만 6개)` };
});

gate('H9', '정산 계산', () => {
  const order = ['C','A','F','B','H','D','G','E'] as AnimalCode[];
  const odds = { C:2, A:2.14, F:4, B:5, H:3, D:3, G:3, E:3 } as Record<AnimalCode, number>;
  const out = settle([{ no:1, name:'A', coins:8, bets:{ 1:{A:4}, 2:{D:2} } }], order, odds, DEFAULTS);
  return { ok: out[0].gained === 6 && out[0].finalCoins === 14,
           detail: `획득 ${out[0].gained} (기대 6), 최종 ${out[0].finalCoins} (기대 14)` };
});

gate('D1', '3라운드까지 골인 동물 0마리', () => {
  let bad = 0;
  for (const r of races) {
    const pos = positionsAtRound(r.moves, 3, TRACK);
    for (const c of Object.keys(pos) as AnimalCode[]) if (pos[c] >= TRACK) bad++;
  }
  return { ok: bad === 0, detail: `3라운드에 골인한 동물 ${bad}마리` };
});

gate('D2', '베팅 규칙을 막는다', () => {
  const base = { coins: 20, betLocked: {} as Record<number, boolean> };
  const a = validateBet(base, 1, { A: 4 }, DEFAULTS);
  const b = validateBet({ coins: 1, betLocked: {} }, 1, { A: 2 }, DEFAULTS);
  const c = validateBet({ coins: 20, betLocked: { 1: true } }, 1, { A: 1 }, DEFAULTS);
  const d = validateBet(base, 1, { A: 1.5 }, DEFAULTS);
  const e = validateBet(base, 1, { A: 2 }, DEFAULTS);
  const errs = [a, b, c, d].map(x => (x.ok ? 'ok' : x.error));
  return { ok: errs.join('/') === 'TOO_MANY_COINS/NOT_ENOUGH_COINS/ALREADY_BET/BAD_AMOUNT' && e.ok,
           detail: errs.join(' / ') + ' · 정상 베팅은 ' + (e.ok ? '통과' : '거부') };
});

gate('D5b', '문항이 모자라면 순환 재사용', () => {
  const q = (id: number, level: Level): Question =>
    ({ id, unit:'X', level, text:'t', choices:['1','2','3','4'], answer:1, explanation:'' });
  const plan = planQuestions({ '쉬움':[q(1,'쉬움'), q(2,'쉬움')] }, 6, () => 0);
  const seq = [1,2,3,4,5,6].map(r => plan[r]['쉬움']);
  return { ok: seq[0] === seq[2] && seq[0] === seq[4] && seq[1] === seq[3],
           detail: `배정 ${seq.join(',')} (2개를 순환)` };
});

gate('D6', '같은 모둠에 같은 힌트 두 번 안 감', () => {
  const pool = buildHints(races[0].truth);
  const given: string[] = [], texts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const t = takeHint(pool, given, '어려움', i + 1);
    if (!t) break;
    given.push(t.key); texts.push(t.hint.text);
  }
  const seventh = takeHint(pool, given, '어려움', 7);
  return { ok: new Set(texts).size === 6 && seventh === null,
           detail: `6번 뽑아 서로 다른 것 ${new Set(texts).size}개, 7번째는 ${seventh ? '나옴' : '없음'}` };
});

gate('M6', '최대 배당률이 16배 이하 (시드 15)', () => {
  const pool = seedPool();
  pool.A += 108;
  const o = computeOdds(pool);
  let max = 0;
  for (const c of Object.keys(o) as AnimalCode[]) if (o[c] > max) max = o[c];
  return { ok: max <= 16, detail: `최대 ${max}배` };
});

gate('M6b', '시드가 0이어도 배당률이 NaN 이 되지 않는다', () => {
  const zero = {} as Pool; for (const c of ANIMAL_CODES) zero[c] = 0;
  const one  = {} as Pool; for (const c of ANIMAL_CODES) one[c] = 0; one.A = 5;
  const o1 = computeOdds(zero), o2 = computeOdds(one);
  const finite = (v: Record<string, number>) => Object.values(v).every(x => isFinite(x));
  return { ok: finite(o1) && finite(o2), detail: `전부 0 → ${o1.A}배 / A에만 5 → A ${o2.A}배, B ${o2.B}배` };
});

gate('M7', '난이도별 힌트 풀 6개 이상', () => {
  const h = buildHints(races[0].truth);
  return { ok: LEVELS.every(lv => h[lv].length >= LIMITS.minHintsPerLevel),
           detail: LEVELS.map(lv => `${lv} ${h[lv].length}`).join(' / ') };
});

gate('CODE', '판 코드에 혼동 문자(0 O 1 I) 없음', () => {
  let bad = 0;
  for (let i = 0; i < 500; i++) if (/[0O1I]/.test(makeCode())) bad++;
  return { ok: bad === 0, detail: `500회 중 ${bad}회 등장` };
});

gate('KEY', '교사 열쇠가 판 코드보다 충분히 길다', () => {
  const k = makeHostKey();
  return { ok: k.length === 12 && !/[0O1I]/.test(k), detail: `${k.length}자리 — 경우의 수 32^12` };
});

gate('TRACK', '트랙칸수 설정이 실제로 반영된다', () => {
  let wide: Race | null = null, tries = 0;
  while (!wide && tries++ < 20) wide = planRace(Math.random, 14);
  if (!wide) return { ok: false, detail: 'planRace 실패' };
  const pos = positionsAtRound(wide.moves, wide.lastRound, 14);
  const winner = pos[wide.truth[0]];
  const order = rankByPosition(pos, wide.truth);
  return { ok: winner === 14 && order.join('') === wide.truth.join(''),
           detail: `14칸 트랙 — 1등이 ${winner}칸 도달, 순서도 일치 (앱스 스크립트판은 10칸으로 무시됨)` };
});

console.log('\n====================================================');
console.log(`규칙 게이트 — 통과 ${pass} / 실패 ${fail}`);
console.log('====================================================\n');
if (fail) process.exit(1);
