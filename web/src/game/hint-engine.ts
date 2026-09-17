import { ANIMAL_CODES } from './config.ts';
import type { AnimalCode, Level } from './config.ts';
import type { Hint, Rng } from './types.ts';

type Difficulty = NonNullable<Hint['difficulty']>;
type Candidate = Required<Pick<Hint, 'key' | 'type' | 'difficulty' | 'animalIds' | 'tags' | 'text'>>;

export interface HintContext {
  truth: AnimalCode[];
  finishedAnimalIds: readonly AnimalCode[];
  history: readonly Hint[];
  names: Record<AnimalCode, string>;
  rng: Rng;
}

const levelDifficulty: Record<Level, Difficulty> = { 쉬움: 'easy', 보통: 'medium', 어려움: 'hard' };

/** Build only true statements from the final order. Never inspect rendered DOM or future race positions. */
export function hintCandidates(level: Level, ctx: HintContext): Candidate[] {
  const finished = new Set(ctx.finishedAnimalIds);
  const active = ANIMAL_CODES.filter((id) => !finished.has(id));
  const rank = new Map(ctx.truth.map((id, index) => [id, index + 1]));
  const r = (id: AnimalCode): number => rank.get(id)!;
  const n = (id: AnimalCode): string => ctx.names[id];
  const out: Candidate[] = [];
  const difficulty = levelDifficulty[level];
  const add = (type: string, ids: AnimalCode[], key: string, tags: string[], text: string): void => {
    if (ids.every((id) => !finished.has(id))) out.push({ key, type, difficulty, animalIds: ids, tags, text });
  };

  for (const a of active) {
    const ra = r(a);
    if (level === '쉬움') {
      for (let excluded = 1; excluded <= 8; excluded++) if (excluded !== ra) {
        add('notRank', [a], `notRank:${a}:${excluded}`, [`notRank:${a}:${excluded}`], `${n(a)}의 최종 순위는 ${excluded}위가 아니다.`);
      }
      const half = ra <= 4 ? 'top' : 'bottom';
      add('half', [a], `half:${a}:${half}`, [`half:${a}`], `${n(a)}는 ${half === 'top' ? '상위' : '하위'} 4위 안에 들어온다.`);
      for (let start = 1; start <= 5; start++) if (ra >= start && ra <= start + 3) {
        add('broadRange', [a], `broad:${a}:${start}`, [`broad:${a}`], `${n(a)}의 최종 순위는 ${start}~${start + 3}위 사이이다.`);
      }
      for (let boundary = 2; boundary <= 7; boundary++) if (ra !== boundary) {
        const higher = ra < boundary;
        add('threshold', [a], `threshold:${a}:${boundary}:${higher}`, [`threshold:${a}:${boundary}`], `${n(a)}는 최종 ${boundary}위보다 ${higher ? '높은' : '낮은'} 순위이다.`);
      }
    } else if (level === '보통') {
      for (let start = 1; start <= 7; start++) if (ra === start || ra === start + 1) {
        add('narrowRange', [a], `narrow:${a}:${start}`, [`narrow:${a}`], `${n(a)}의 최종 순위는 ${start}~${start + 1}위 중 하나이다.`);
      }
    }
  }

  for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
    const [a, b] = [active[i]!, active[j]!];
    const [first, second] = r(a) < r(b) ? [a, b] : [b, a];
    const gap = r(second) - r(first);
    const pair = `${a}:${b}`;
    if (level === '쉬움') {
      add('comparison', [first, second], `before:${first}:${second}`, [`relation:${first}>${second}`], `${n(first)}는 ${n(second)}보다 먼저 결승선을 통과한다.`);
    } else if (level === '보통') {
      add('rankGap', [a, b], `gap:${pair}:${gap}`, [`gap:${pair}`], `${n(a)}와 ${n(b)}의 최종 순위 차이는 ${gap}이다.`);
      const top3 = Number(r(a) <= 3) + Number(r(b) <= 3);
      add('pairTop3', [a, b], `pairTop3:${pair}:${top3}`, [`pairTop3:${pair}`], `${n(a)}와 ${n(b)} 중 정확히 ${top3}마리가 최종 3위 안에 들어간다.`);
    } else {
      add('directedGap', [first, second], `directedGap:${first}:${second}:${gap}`, [`gap:${pair}`, `relation:${first}>${second}`], `${n(first)}는 ${n(second)}보다 정확히 ${gap}등 앞선다.`);
      if (gap === 1) add('consecutive', [a, b], `consecutive:${pair}`, [`gap:${pair}`], `${n(a)}와 ${n(b)}는 연속된 순위로 결승선을 통과한다.`);
      add('rankEquation', [a, b], `equation:${a}:${b}`, [`equation:${pair}`], `2 × ${n(a)}의 순위 + ${n(b)}의 순위 = ${2 * r(a) + r(b)}`);
    }
  }

  for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) for (let k = j + 1; k < active.length; k++) {
    const ids = [active[i]!, active[j]!, active[k]!];
    const sorted = [...ids].sort((a, b) => r(a) - r(b));
    const group = ids.join(':');
    if (level === '보통') {
      add('tripleOrder', sorted, `tripleOrder:${sorted.join(':')}`, [`relation:${sorted[0]}>${sorted[1]}`, `relation:${sorted[1]}>${sorted[2]}`], `${n(sorted[1]!)}는 ${n(sorted[2]!)}보다 빠르지만 ${n(sorted[0]!)}보다는 느리다.`);
      const count = ids.filter((id) => r(id) <= 4).length;
      add('tripleTop4', ids, `tripleTop4:${group}:${count}`, [`tripleTop4:${group}`], `${ids.map(n).join(', ')} 중 정확히 ${count}마리가 상위 4위 안에 있다.`);
    } else if (level === '어려움') {
      add('rankSum', ids, `rankSum:${group}`, [`rankSum:${group}`], `${ids.map(n).join(', ')}의 최종 순위 합은 ${ids.reduce((sum, id) => sum + r(id), 0)}이다.`);
      const count = ids.filter((id) => r(id) <= 3).length;
      add('tripleTop3', ids, `tripleTop3:${group}:${count}`, [`tripleTop3:${group}`], `${ids.map(n).join(', ')} 중 정확히 ${count}마리가 최종 3위 안에 들어간다.`);
    }
  }

  if (level === '어려움' && active.length <= 2) for (const id of active) {
    add('exactRank', [id], `exactRank:${id}:${r(id)}`, [`exactRank:${id}`], `${n(id)}의 최종 순위는 ${r(id)}위이다.`);
  }
  // Defense in depth: every candidate is checked again at the final boundary.
  return out.filter((candidate) => candidate.animalIds.every((id) => active.includes(id)));
}

export function generateHint(round: number, level: Level, ctx: HintContext): Hint | null {
  const candidates = hintCandidates(level, ctx);
  const keys = new Set(ctx.history.map((hint) => hint.key).filter(Boolean));
  const texts = new Set(ctx.history.map((hint) => hint.text));
  const tags = new Set(ctx.history.flatMap((hint) => hint.tags || []));
  const fresh = candidates.filter((candidate) => !keys.has(candidate.key) && !texts.has(candidate.text) && !candidate.tags.some((tag) => tags.has(tag)));
  const unused = candidates.filter((candidate) => !keys.has(candidate.key) && !texts.has(candidate.text));
  const choices = fresh.length ? fresh : unused;
  if (!choices.length) return null;
  const chosen = choices[Math.min(choices.length - 1, Math.floor(ctx.rng() * choices.length))]!;
  const active = new Set(ANIMAL_CODES.filter((id) => !ctx.finishedAnimalIds.includes(id)));
  if (!chosen.animalIds.every((id) => active.has(id))) return null;
  return { round, level, ...chosen };
}
