import assert from 'node:assert/strict';
import { ANIMAL_CODES, LEVELS } from '../src/game/config.ts';
import type { AnimalCode } from '../src/game/config.ts';
import { generateHint, hintCandidates } from '../src/game/hint-engine.ts';
import type { Hint } from '../src/game/types.ts';

let seed = 17;
const rng = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const names = Object.fromEntries(ANIMAL_CODES.map((id) => [id, `이름${id}`])) as Record<AnimalCode, string>;
let checked = 0;

for (let trial = 0; trial < 120; trial++) {
  const truth = [...ANIMAL_CODES].sort(() => rng() - 0.5);
  const rank = (id: AnimalCode): number => truth.indexOf(id) + 1;
  for (const finishedCount of [0, 2, 7]) {
    const finishedAnimalIds = truth.slice(0, finishedCount);
    for (const level of LEVELS) {
      const ctx = { truth, finishedAnimalIds, history: [] as Hint[], names, rng };
      const candidates = hintCandidates(level, ctx);
      assert.ok(candidates.length, `${level}, active ${8 - finishedCount}`);
      for (const hint of candidates) {
        const ids = hint.animalIds;
        assert.ok(ids.every((id) => !finishedAnimalIds.includes(id)));
        assert.ok(ids.every((id) => hint.text.includes(names[id])));
        const numbers = [...hint.text.matchAll(/\d+/g)].map((match) => Number(match[0]));
        const [a, b, c] = ids;
        switch (hint.type) {
          case 'notRank': assert.notEqual(rank(a!), numbers[0]); break;
          case 'half': assert.equal(rank(a!) <= 4, hint.text.includes('상위')); break;
          case 'broadRange': case 'narrowRange':
            assert.ok(rank(a!) >= numbers[0]! && rank(a!) <= numbers[1]!); break;
          case 'threshold': assert.equal(rank(a!) < numbers[0]!, hint.text.includes('높은')); break;
          case 'comparison': assert.ok(rank(a!) < rank(b!)); break;
          case 'rankGap': assert.equal(Math.abs(rank(a!) - rank(b!)), numbers[0]); break;
          case 'pairTop3': assert.equal(Number(rank(a!) <= 3) + Number(rank(b!) <= 3), numbers[0]); break;
          case 'directedGap': assert.equal(rank(b!) - rank(a!), numbers[0]); break;
          case 'consecutive': assert.equal(Math.abs(rank(a!) - rank(b!)), 1); break;
          case 'rankEquation': assert.equal(2 * rank(a!) + rank(b!), numbers.at(-1)); break;
          case 'tripleOrder': assert.ok(rank(a!) < rank(b!) && rank(b!) < rank(c!)); break;
          case 'tripleTop4': assert.equal(ids.filter((id) => rank(id) <= 4).length, numbers[0]); break;
          case 'rankSum': assert.equal(ids.reduce((sum, id) => sum + rank(id), 0), numbers[0]); break;
          case 'tripleTop3': assert.equal(ids.filter((id) => rank(id) <= 3).length, numbers[0]); break;
          case 'exactRank': assert.equal(rank(a!), numbers[0]); break;
          default: assert.fail(`Unknown type ${hint.type}`);
        }
        checked++;
      }
      const history: Hint[] = [];
      for (let round = 1; round <= 10; round++) {
        const hint = generateHint(round, level, { ...ctx, history });
        if (!hint) break;
        assert.equal(hint.difficulty, { 쉬움: 'easy', 보통: 'medium', 어려움: 'hard' }[level]);
        assert.ok(hint.animalIds!.every((id) => !finishedAnimalIds.includes(id)));
        assert.ok(!history.some((old) => old.key === hint.key));
        history.push(hint);
      }
      assert.ok(history.length >= 1);
    }
  }
}
console.log(`힌트 엔진: ${checked}개 참 문장, 골인 제외·팀별 비중복·1마리 잔존 확인`);
