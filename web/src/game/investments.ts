import { ANIMAL_CODES } from './config.ts';
import type { AnimalCode } from './config.ts';
import type { Bets, Odds } from './types.ts';

export interface InvestmentLine {
  animalId: AnimalCode;
  coins: number;
  odds: number;
  /** Simple current-odds product, not a final payout. */
  reference: number;
}

export interface InvestmentSummary {
  lines: InvestmentLine[];
  invested: number;
  referenceTotal: number;
}

/** Aggregate confirmed bets across rounds and revalue them using the current odds. */
export function summarizeInvestments(betsByRound: Record<number, Bets>, odds: Odds): InvestmentSummary {
  const lines: InvestmentLine[] = [];
  let invested = 0;
  let referenceTotal = 0;
  for (const animalId of ANIMAL_CODES) {
    let coins = 0;
    for (const bets of Object.values(betsByRound)) coins += bets[animalId] || 0;
    if (coins <= 0) continue;
    const reference = Math.round(coins * odds[animalId] * 100) / 100;
    lines.push({ animalId, coins, odds: odds[animalId], reference });
    invested += coins;
    referenceTotal += reference;
  }
  return { lines, invested, referenceTotal: Math.round(referenceTotal * 100) / 100 };
}
