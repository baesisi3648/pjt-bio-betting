import type { Settlement, SettlementLine } from './types.ts';

/** 정산 서버와 같은 값을 사용해 두 결과 화면에 동일한 계산식을 보여준다. */
export function settlementEquation(line: SettlementLine): string {
  return `${line.coins}코인 × ${line.odds.toFixed(2)}배 × ${line.payoutRate}배 (${line.finalRank}등 정산) → ${line.gained}코인`;
}

export function settlementTotalEquation(settlement: Settlement): string {
  const finalQuizBonus = settlement.finalQuizBonus ?? 0;
  const remaining = settlement.finalCoins - settlement.gained - settlement.predictionBonus - finalQuizBonus;
  return `남은 코인 ${remaining} + 베팅 획득 ${settlement.gained} + 우승 예측 보너스 ${settlement.predictionBonus} + 10라운드 정답 보너스 ${finalQuizBonus} = 최종 ${settlement.finalCoins}코인`;
}
