import assert from 'node:assert/strict';
import { settlementEquation, settlementTotalEquation } from '../src/game/settlement-display.ts';
import type { Settlement } from '../src/game/types.ts';

const result: Settlement = {
  teamNo: 1,
  teamName: '테스트',
  lines: [
    { animalCode: 'A', finalRank: 1, coins: 2, odds: 6.2, payoutRate: 1, gained: 12 },
    { animalCode: 'B', finalRank: 2, coins: 4, odds: 5.5, payoutRate: 0.7, gained: 15 },
    { animalCode: 'C', finalRank: 4, coins: 10, odds: 4.3, payoutRate: 0, gained: 0 },
  ],
  gained: 27,
  predictedWinner: 'A',
  predictionBonus: 15,
  finalCoins: 54,
};

assert.equal(settlementEquation(result.lines[0]!), '2코인 × 6.20배 × 1배 (1등 정산) → 12코인');
assert.equal(settlementEquation(result.lines[1]!), '4코인 × 5.50배 × 0.7배 (2등 정산) → 15코인');
assert.equal(settlementEquation(result.lines[2]!), '10코인 × 4.30배 × 0배 (4등 정산) → 0코인');
assert.equal(settlementTotalEquation(result), '남은 코인 12 + 베팅 획득 27 + 우승 예측 보너스 15 = 최종 54코인');

console.log('settlement display OK');
