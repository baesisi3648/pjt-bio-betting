import assert from 'node:assert/strict';
import { ANIMAL_CODES } from '../src/game/config.ts';
import { summarizeInvestments } from '../src/game/investments.ts';
import type { Bets, Odds } from '../src/game/types.ts';

const odds = Object.fromEntries(ANIMAL_CODES.map((id) => [id, 1])) as Odds;
odds.A = 6.2;
odds.B = 5.5;
odds.C = 4.3;
const rounds: Record<number, Bets> = {
  1: { A: 2, B: 1 },
  2: { B: 3 },
  3: { C: 3 },
  4: { C: 3 },
  5: { C: 3 },
  6: { C: 1 }
};

const summary = summarizeInvestments(rounds, odds);
assert.deepEqual(summary.lines.map((line) => [line.animalId, line.coins]), [['A', 2], ['B', 4], ['C', 10]]);
assert.equal(summary.invested, 16);
assert.equal(summary.referenceTotal, 77.4);
assert.deepEqual(summary.lines.map((line) => line.reference), [12.4, 22, 43]);

odds.B = 4.5;
assert.equal(summarizeInvestments(rounds, odds).referenceTotal, 73.4);
assert.equal(summarizeInvestments({}, odds).referenceTotal, 0);
assert.equal(summarizeInvestments({}, odds).invested, 0);
console.log('누적 투자: 라운드 합산, 현재 배당 재평가, 빈 베팅 확인');
