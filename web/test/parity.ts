/**
 * parity.ts — 이식이 정말 같은 규칙인지 대조한다.
 *
 * 같은 시드 난수를 앱스 스크립트판(apps-script/Game.gs)과 이식판(src/game/rules.ts)에
 * 똑같이 먹이고, 나온 결과가 **문자 하나까지 같은지** 본다.
 * 게이트는 "규칙이 옳은가"를 보고, 이 파일은 "옮기면서 안 바뀌었는가"를 본다.
 *
 *   node test/parity.ts
 */

import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import * as New from '../src/game/rules.ts';
import { DEFAULTS } from '../src/game/config.ts';
import type { Rng } from '../src/game/types.ts';

const ROOT = new URL('../../apps-script/', import.meta.url).pathname;

// ── 앱스 스크립트판을 그대로 불러온다 ──
const sandbox: any = { module: { exports: {} }, Math, JSON, console, Array, Object, String, Number, Date, isFinite };
sandbox.global = sandbox;
createContext(sandbox);
for (const f of ['Config.gs', 'Game.gs']) {
  runInContext(readFileSync(ROOT + f, 'utf8'), sandbox, { filename: f });
}
const Old = sandbox;

/** 시드 고정 난수 (mulberry32) — 두 구현에 같은 수열을 먹인다 */
function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let pass = 0, fail = 0;
function same(label: string, a: unknown, b: unknown, note = '') {
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  const ok = ja === jb;
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(26)} ${ok ? note : '\n         옛: ' + ja + '\n         새: ' + jb}`);
}

console.log('\n=== 이식 대조 (앱스 스크립트판 vs TS판, 같은 시드) ===\n');

// ── 1. 경주 계획 — 이 게임에서 가장 되돌리면 안 되는 부분 ──
let raceHits = 0;
for (let seed = 1; seed <= 200; seed++) {
  const oldRace = Old.planRace(seeded(seed));
  const newRace = New.planRace(seeded(seed), DEFAULTS.trackCells);
  if (JSON.stringify(oldRace) === JSON.stringify(newRace)) raceHits++;
}
same('planRace 200개 시드', raceHits, 200, `${raceHits}/200 판이 완전히 동일 (truth·lastRound·moves)`);

// ── 2. 순위 계산 ──
const race = Old.planRace(seeded(42));
same('positionsAtRound',
  Old.positionsAtRound(race.moves, race.lastRound),
  New.positionsAtRound(race.moves, race.lastRound, DEFAULTS.trackCells), '최종 위치 동일');
same('rankByPosition',
  Old.rankByPosition(Old.positionsAtRound(race.moves, race.lastRound), race.truth),
  New.rankByPosition(New.positionsAtRound(race.moves, race.lastRound, DEFAULTS.trackCells), race.truth),
  '순위 동일');

// ── 3. 힌트 문구 — 학생이 실제로 읽는 문장이다 ──
const names = { A:'치타', B:'사자', C:'호랑이', D:'늑대', E:'얼룩말', F:'타조', G:'개구리', H:'거북이' };
same('buildHints (코드 이름)', Old.buildHints(race.truth), New.buildHints(race.truth), '18개 문장 동일');
same('buildHints (동물 이름)', Old.buildHints(race.truth, names), New.buildHints(race.truth, names), '18개 문장 동일');

// 논리식은 함수라 JSON 으로 못 견준다 — 8! 순열 전체에 대한 참/거짓 지문으로 견준다
const fingerprint = (preds: any) => {
  const out: Record<string, string> = {};
  for (const lv of ['쉬움','중간','어려움']) {
    out[lv] = preds[lv].map((p: any) => {
      let bits = '';
      Old.permute(Old.ANIMAL_CODES.slice(), (o: any) => { bits += p(o) ? '1' : '0'; return true; });
      return bits.length + ':' + bits.slice(0, 64);
    }).join('|');
  }
  return out;
};
same('buildHintPredicates', fingerprint(Old.buildHintPredicates(race.truth)),
     fingerprint(New.buildHintPredicates(race.truth)), '40320개 순열 전체에 대해 판정 동일');

// ── 4. 배당·정산 ──
const pool: any = {}; Old.ANIMAL_CODES.forEach((c: string) => { pool[c] = DEFAULTS.seedCoins; });
pool.A += 7; pool.D += 3; pool.F += 22;
same('computeOdds', Old.computeOdds(pool), New.computeOdds(pool), '배당률 동일');

const order = Old.rankByPosition(Old.positionsAtRound(race.moves, race.lastRound), race.truth);
const teams = [
  { no:1, name:'1모둠', coins:8,  bets:{ 1:{A:2}, 2:{D:1,F:2}, 3:{A:3} } },
  { no:2, name:'2모둠', coins:14, bets:{ 1:{F:3}, 2:{B:1} } },
  { no:3, name:'3모둠', coins:20, bets:{} }
];
same('settle', Old.settle(teams, order, Old.computeOdds(pool), DEFAULTS),
     New.settle(teams as any, order, New.computeOdds(pool), DEFAULTS), '정산 결과 동일 (순위·획득·최종)');

// ── 5. 문제 배정 ──
const q = (id: number, level: string) => ({ id, unit:'유전', level, text:'t'+id, choices:['1','2','3','4'], answer:1, explanation:'' });
const byLevel: any = {
  '쉬움': [1,2,3,4,5,6].map(i => q(i, '쉬움')),
  '중간': [7,8].map(i => q(i, '중간')),
  '어려움': [9,10,11].map(i => q(i, '어려움'))
};
for (const seed of [1, 7, 99]) {
  same(`planQuestions (시드 ${seed})`, Old.planQuestions(byLevel, 6, seeded(seed)),
       New.planQuestions(byLevel, 6, seeded(seed)), '라운드×난이도 배정 동일');
}

// ── 6. 코드·암호 생성 ──
same('makeCode', Old.makeCode(seeded(5)), New.makeCode(seeded(5)), '동일');
same('makePin',  Old.makePin(seeded(5)),  New.makePin(seeded(5)),  '동일');
same('makeHostKey', Old.makeHostKey(seeded(5)), New.makeHostKey(seeded(5)), '동일');

console.log('\n====================================================');
console.log(`이식 대조 — 통과 ${pass} / 실패 ${fail}`);
console.log('====================================================\n');
if (fail) process.exit(1);
