/**
 * rules.ts — 게임 규칙 전부. **순수 함수만.**
 *
 * apps-script/Game.gs 를 그대로 옮겼다. 저장소도, 시각도, 통신도 건드리지 않는다.
 * 상태를 받아 값을 돌려준다. 이래야 게이트로 100판을 돌려볼 수 있고,
 * 통신 방식을 앱스 스크립트에서 Durable Object 로 바꿔도 규칙은 그대로 산다.
 *
 * ── 옮기면서 고친 것 ──
 * trackCells 를 인자로 받는다. 예전에는 planRace 와 positionsAtRound 가
 * DEFAULTS.trackCells 를 직접 봤다. 그래서 '설정' 탭의 트랙칸수를 12로 바꿔도
 * 조용히 10칸이었다 — 설정이 거짓말을 하고 있었다. 이제 인자라서 못 잊는다.
 */

import {
  ANIMAL_CODES, LEVELS, LIMITS, CODE_ALPHABET, CODE_LENGTH, PIN_LENGTH, HOST_KEY_LENGTH
} from './config.ts';
import type { AnimalCode, Level, Settings } from './config.ts';
export type { Race } from './types.ts';
import type {
  Bets, Hint, Moves, Odds, Pool, Positions, Question, QuestionPlan, Race, Rng,
  Settlement, SettlementLine, Team
} from './types.ts';

// ────────────────────────────────────────────────────────────
// 1. 정답 순위 확정 + 이동 역산
// ────────────────────────────────────────────────────────────

/**
 * ⚠️ 되돌리면 게임이 무너지는 곳 (00-loop.md).
 *
 * 순위를 먼저 정하고 이동을 역산한다.
 * PDF 원본은 순위를 정해놓고 이동은 따로 랜덤으로 굴렸다. 그러면
 * "A가 최종 1등"이라는 힌트를 뿌려놓고 A가 5등으로 들어오는 판이 실제로 나온다.
 * 힌트가 거짓말이 되면 이 게임은 성립하지 않는다.
 *
 * 설계:
 *   1등        → lastRound-1 라운드에 정확히 결승선 도달, 이후 정지
 *   2·3등      → lastRound 라운드에 도달 (그 전에는 한 칸 못 미침)
 *   4~8등      → lastRound 끝에 결승선에 못 미침 (한 칸씩 뒤로)
 * 최종 위치 내림차순 + 동점은 truth 순 → 항상 truth와 일치한다.
 */
export function planRace(rng: Rng = Math.random, trackCells: number): Race | null {
  const truth = shuffle([...ANIMAL_CODES] as AnimalCode[], rng);   // truth[0] = 1등
  const lastRound = rng() < 0.5 ? 5 : 6;                           // 학생에게 비공개

  const moves = {} as Moves;
  for (let rank = 1; rank <= 8; rank++) {
    const plan = planOneAnimal(rank, lastRound, trackCells, rng);
    if (!plan) return null;                                        // 호출자가 재시도
    moves[truth[rank - 1]] = plan;
  }
  return { truth, lastRound, moves };
}

/** 한 동물의 라운드별 이동량(0~3)을 만든다. 실패하면 null */
export function planOneAnimal(
  rank: number, lastRound: number, track: number, rng: Rng = Math.random
): number[] | null {
  let arriveAt: number, total: number;

  if (rank === 1) {
    arriveAt = lastRound - 1;        // 1등만 한 라운드 먼저 골인
    total = track;
  } else if (rank === 2 || rank === 3) {
    arriveAt = lastRound;
    total = track;
  } else {
    arriveAt = lastRound;
    total = track - (rank - 3);      // 4등=track-1, 5등=track-2, …
  }

  for (let attempt = 0; attempt < LIMITS.reverseAttempts; attempt++) {
    const parts = splitIntoMoves(total, arriveAt, rng);
    if (!parts) continue;

    // 골인 라운드 이전에 미리 도착하면 안 된다 (마지막 칸을 그 라운드에 밟아야 함)
    let before = 0;
    for (let i = 0; i < parts.length - 1; i++) before += parts[i];
    if (total >= track && before >= track) continue;

    // 마지막 이동은 0이면 안 된다 — 그 라운드에 움직여서 도착해야 연출이 산다
    if (parts[parts.length - 1] === 0) continue;

    while (parts.length < lastRound) parts.push(0);   // 골인 후 정지
    return parts;
  }
  return null;
}

/**
 * total을 n개의 0~3 값으로 쪼갠다.
 * 앞 라운드는 작게, 뒤 라운드는 크게 치우치게 해서 역전 연출이 나오도록 한다.
 */
export function splitIntoMoves(total: number, n: number, rng: Rng = Math.random): number[] | null {
  if (total > n * 3 || total < 0) return null;

  const parts: number[] = [];
  let remaining = total;
  for (let i = 0; i < n; i++) {
    const slotsLeft = n - i - 1;
    const min = Math.max(0, remaining - slotsLeft * 3);
    const max = Math.min(3, remaining);
    if (min > max) return null;

    let pick: number;
    if (i < n / 2) {
      pick = min + Math.floor(rng() * (Math.min(max, min + 2) - min + 1));   // 앞: 작게
    } else {
      const lo = Math.max(min, max - 2);
      pick = lo + Math.floor(rng() * (max - lo + 1));                        // 뒤: 크게
    }
    parts.push(pick);
    remaining -= pick;
  }
  return remaining === 0 ? parts : null;
}

/** 라운드 r까지 굴렸을 때의 위치 */
export function positionsAtRound(moves: Moves, round: number, trackCells: number): Positions {
  const pos = {} as Positions;
  for (const code of Object.keys(moves) as AnimalCode[]) {
    let sum = 0;
    for (let i = 0; i < round && i < moves[code].length; i++) sum += moves[code][i];
    pos[code] = Math.min(sum, trackCells);
  }
  return pos;
}

/** 최종 위치로 순위를 매긴다. 동점은 truth 순서(미리 정한 순위)가 이긴다 */
export function rankByPosition(positions: Positions, truth: AnimalCode[]): AnimalCode[] {
  return truth.slice().sort((a, b) => {
    const d = positions[b] - positions[a];
    return d !== 0 ? d : truth.indexOf(a) - truth.indexOf(b);
  });
}

// ────────────────────────────────────────────────────────────
// 2. 힌트 생성 + 검산
// ────────────────────────────────────────────────────────────

/**
 * 난이도별 힌트 풀을 만든다. **모든 힌트는 truth 기준으로 참이다.**
 *
 * 어려움 6개는 다 합치면 1·2·3등을 정확히 특정하도록 설계했다 (게이트 H3-b).
 * 일부만 받으면 부분 정보만 얻는다 — 그래서 어려움을 계속 고를 이유가 생긴다.
 */
export function buildHints(
  truth: AnimalCode[], names?: Partial<Record<AnimalCode, string>>
): Record<Level, string[]> {
  const n = (code: AnimalCode) => (names && names[code]) || code;
  const at = (rank: number) => truth[rank - 1];

  return {
    '어려움': [
      `${n(at(1))}는 1·2·3등 안에 반드시 듭니다.`,
      `${n(at(2))}는 1·2·3등 안에 반드시 듭니다.`,
      `${n(at(3))}는 1·2·3등 안에 반드시 듭니다.`,
      `${n(at(1))}가 ${n(at(2))}보다 순위가 높습니다.`,
      `${n(at(2))}가 ${n(at(3))}보다 순위가 높습니다.`,
      `${n(at(4))}는 1·2·3등에 들지 못합니다.`
    ],
    '중간': [
      `${n(at(1))}가 ${n(at(5))}보다 순위가 높습니다.`,
      `${n(at(2))}가 ${n(at(6))}보다 순위가 높습니다.`,
      `${n(at(3))}가 ${n(at(7))}보다 순위가 높습니다.`,
      `${n(at(4))}가 ${n(at(8))}보다 순위가 높습니다.`,
      `${n(at(5))}는 ${n(at(4))}보다 느리고 ${n(at(6))}보다 빠릅니다.`,
      `${n(at(6))}는 ${n(at(5))}보다 느리고 ${n(at(7))}보다 빠릅니다.`
    ],
    '쉬움': [
      `${n(at(8))}는 5등 이하입니다.`,
      `${n(at(7))}는 5등 이하입니다.`,
      `${n(at(6))}는 5등 이하입니다.`,
      `${n(at(8))}는 1·2·3등에 들지 못합니다.`,
      `${n(at(7))}는 1·2·3등에 들지 못합니다.`,
      `${n(at(5))}는 최종 1등이 아닙니다.`
    ]
  };
}

export type HintPredicate = (order: AnimalCode[]) => boolean;

/**
 * 힌트를 논리식으로도 만든다. 검산(H2·H3)에 쓴다.
 * order 는 1등부터 8등까지의 code 배열.
 *
 * ⚠️ buildHints 의 문장과 **한 줄씩 짝이 맞아야 한다.** 어긋나면 게이트가
 *    거짓말을 검증하게 된다. 문장을 고치면 여기도 같이 고친다.
 */
export function buildHintPredicates(truth: AnimalCode[]): Record<Level, HintPredicate[]> {
  const at = (rank: number) => truth[rank - 1];
  const rankOf = (o: AnimalCode[], code: AnimalCode) => o.indexOf(code) + 1;

  const top3     = (c: AnimalCode): HintPredicate => (o) => rankOf(o, c) <= 3;
  const notTop3  = (c: AnimalCode): HintPredicate => (o) => rankOf(o, c) > 3;
  const faster   = (a: AnimalCode, b: AnimalCode): HintPredicate => (o) => rankOf(o, a) < rankOf(o, b);
  const atOrBelow = (c: AnimalCode, k: number): HintPredicate => (o) => rankOf(o, c) >= k;
  const notFirst = (c: AnimalCode): HintPredicate => (o) => rankOf(o, c) !== 1;
  const between  = (x: AnimalCode, lo: AnimalCode, hi: AnimalCode): HintPredicate =>
    (o) => rankOf(o, x) > rankOf(o, lo) && rankOf(o, x) < rankOf(o, hi);

  return {
    '어려움': [top3(at(1)), top3(at(2)), top3(at(3)),
               faster(at(1), at(2)), faster(at(2), at(3)), notTop3(at(4))],
    '중간':   [faster(at(1), at(5)), faster(at(2), at(6)), faster(at(3), at(7)),
               faster(at(4), at(8)), between(at(5), at(4), at(6)), between(at(6), at(5), at(7))],
    '쉬움':   [atOrBelow(at(8), 5), atOrBelow(at(7), 5), atOrBelow(at(6), 5),
               notTop3(at(8)), notTop3(at(7)), notFirst(at(5))]
  };
}

/** 힌트 묶음으로 좁혀지는 1·2·3등 후보 조합 수를 센다 */
export function countTop3Candidates(predicates: HintPredicate[], limit?: number): number {
  const found: Record<string, true> = {};
  let count = 0;
  permute([...ANIMAL_CODES] as AnimalCode[], (order) => {
    for (const p of predicates) if (!p(order)) return true;    // 계속
    const key = order[0] + order[1] + order[2];
    if (!found[key]) { found[key] = true; count++; }
    return !(limit && count > limit);
  });
  return count;
}

// ────────────────────────────────────────────────────────────
// 3. 배당률 · 베팅 · 정산
// ────────────────────────────────────────────────────────────

/**
 * 파리뮤추얼. 시드는 0으로 나누기 방지 겸 배당 상한 조절 (리뷰 C6)
 *
 * 시드는 설정에서 오므로 0 이 들어올 수 있다. 그러면 total/0 이 되어
 * 화면에 'NaN배' 가 뜨고 정산 금액도 전부 NaN 이 된다. 여기서 막는다.
 */
export function computeOdds(pool: Pool): Odds {
  let total = 0;
  for (const c of Object.keys(pool) as AnimalCode[]) total += pool[c];

  const out = {} as Odds;
  for (const code of Object.keys(pool) as AnimalCode[]) {
    if (total <= 0) { out[code] = 1; continue; }
    const share = pool[code] > 0 ? pool[code] : 1;
    out[code] = Math.round((total / share) * 100) / 100;
  }
  return out;
}

export type BetCheck = { ok: true; sum: number } | { ok: false; error: string };

/** 베팅이 규칙에 맞는지. 화면에서 막아도 서버가 다시 막는다 */
export function validateBet(
  team: Pick<Team, 'coins' | 'betLocked'>, round: number, bets: Bets, settings: Settings
): BetCheck {
  let sum = 0;
  for (const c of Object.keys(bets) as AnimalCode[]) {
    if (!(ANIMAL_CODES as readonly string[]).includes(c)) return { ok: false, error: 'BAD_ANIMAL' };
    const v = bets[c]!;
    if (typeof v !== 'number' || !isFinite(v) || v < 0 || v !== Math.floor(v)) {
      return { ok: false, error: 'BAD_AMOUNT' };
    }
    sum += v;
  }
  if (team.betLocked && team.betLocked[round]) return { ok: false, error: 'ALREADY_BET' };
  if (sum > settings.maxBetPerRound)            return { ok: false, error: 'TOO_MANY_COINS' };
  if (sum > team.coins)                         return { ok: false, error: 'NOT_ENOUGH_COINS' };
  return { ok: true, sum };
}

/**
 * 정산. 최종 배당률 하나만 쓴다 (선생님 결정 — 01-prd §6-2).
 * bets 가 라운드별로 나뉘어 저장되므로, 나중에 라운드 보너스나
 * 베팅 시점 고정으로 바꿀 때 과거 판도 다시 계산할 수 있다.
 */
export function settle(
  teams: Pick<Team, 'no' | 'name' | 'coins' | 'bets'>[],
  finalOrder: AnimalCode[], odds: Odds, settings: Settings
): Settlement[] {
  const rankOf: Partial<Record<AnimalCode, number>> = {};
  finalOrder.forEach((c, i) => { rankOf[c] = i + 1; });

  return teams.map((team) => {
    const byAnimal: Partial<Record<AnimalCode, number>> = {};
    for (const r of Object.keys(team.bets)) {
      const roundBets = team.bets[Number(r)];
      for (const code of Object.keys(roundBets) as AnimalCode[]) {
        byAnimal[code] = (byAnimal[code] || 0) + roundBets[code]!;
      }
    }

    const lines: SettlementLine[] = [];
    let gained = 0;
    for (const c of Object.keys(byAnimal) as AnimalCode[]) {
      const finalRank = rankOf[c]!;
      const payoutRate = settings.payout[finalRank] || 0;
      const got = Math.round(byAnimal[c]! * odds[c] * payoutRate);
      gained += got;
      lines.push({ animalCode: c, finalRank, coins: byAnimal[c]!, odds: odds[c], payoutRate, gained: got });
    }
    lines.sort((a, b) => a.finalRank - b.finalRank);

    return { teamNo: team.no, teamName: team.name, lines, gained, finalCoins: team.coins + gained };
  }).sort((a, b) => b.finalCoins - a.finalCoins)
    .map((s, i) => ({ ...s, rank: i + 1 }));
}

// ────────────────────────────────────────────────────────────
// 4. 문제 배정 (감독 G-01)
// ────────────────────────────────────────────────────────────

/**
 * 판 생성 시 라운드×난이도마다 문항을 미리 다 정해둔다.
 * 라운드마다 그때그때 뽑으면 저장소가 날아가 복구할 때 다른 문제가 나온다.
 * 문항이 모자라면 가장 먼저 쓴 것부터 다시 낸다 (03-user-flow §6의 약속).
 */
export function planQuestions(
  questionsByLevel: Partial<Record<Level, Question[]>>, lastRound: number, rng: Rng = Math.random
): QuestionPlan {
  const plan: QuestionPlan = {};
  for (let r = 1; r <= lastRound; r++) plan[r] = {};

  for (const level of LEVELS) {
    const pool = (questionsByLevel[level] || []).slice();
    if (pool.length === 0) {
      for (let r = 1; r <= lastRound; r++) plan[r][level] = null;
      continue;
    }
    shuffle(pool, rng);
    for (let r = 1; r <= lastRound; r++) {
      plan[r][level] = pool[(r - 1) % pool.length].id;   // 모자라면 순환 재사용
    }
  }
  return plan;
}

/** 같은 모둠에 같은 힌트를 두 번 주지 않는다. 뽑은 자리의 열쇠도 같이 돌려준다 */
export function takeHint(
  hintPool: Record<Level, string[]>, given: string[], level: Level, round: number
): { hint: Hint; key: string } | null {
  const pool = hintPool[level] || [];
  for (let i = 0; i < pool.length; i++) {
    const key = `${level}#${i}`;
    if (given.indexOf(key) < 0) return { hint: { round, level, text: pool[i] }, key };
  }
  return null;
}

// ────────────────────────────────────────────────────────────
// 5. 보조
// ────────────────────────────────────────────────────────────

export function shuffle<T>(arr: T[], rng: Rng = Math.random): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** cb 가 false 를 돌려주면 중단 (Heap's algorithm) */
export function permute<T>(arr: T[], cb: (order: T[]) => boolean): void {
  const n = arr.length;
  const c = new Array(n).fill(0);
  let i = 1;
  if (cb(arr.slice()) === false) return;
  while (i < n) {
    if (c[i] < i) {
      const k = i % 2 ? c[i] : 0;
      [arr[k], arr[i]] = [arr[i], arr[k]];
      if (cb(arr.slice()) === false) return;
      c[i]++; i = 1;
    } else { c[i] = 0; i++; }
  }
}

function pick(alphabet: string, len: number, rng: Rng): string {
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(rng() * alphabet.length)];
  return s;
}

export const makeCode    = (rng: Rng = Math.random) => pick(CODE_ALPHABET, CODE_LENGTH, rng);
export const makePin     = (rng: Rng = Math.random) => pick('0123456789', PIN_LENGTH, rng);
export const makeHostKey = (rng: Rng = Math.random) => pick(CODE_ALPHABET, HOST_KEY_LENGTH, rng);
