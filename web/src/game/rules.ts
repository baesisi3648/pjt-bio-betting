/**
 * rules.ts — 게임 규칙 전부. **순수 함수만.**
 *
 * 저장소도, 시각도, 통신도 건드리지 않는다. 상태를 받아 값을 돌려준다.
 * 이래야 게이트로 300판을 돌려볼 수 있고, 통신 방식을 바꿔도 규칙은 그대로 산다.
 *
 * ── 트랙칸수는 언제나 인자다 ──
 * 예전에는 planRace 와 positionsAtRound 가 DEFAULTS.trackCells 를 직접 봤다.
 * 그래서 '설정' 탭의 트랙칸수를 12로 바꿔도 조용히 10칸이었다 — 설정이 거짓말을
 * 하고 있었다. 이제 인자라서 못 잊는다 (MIGRATION §5).
 *
 * ── 2026-09-06 리뉴얼 (RENEWAL.md) ──
 * 앱스 스크립트판(`apps-script/Game.gs`)과 여기는 이제 **다른 규칙**이다.
 * 20칸 10라운드, 라운드×난이도로 짝지은 힌트 30개, 사기 라운드.
 * 그래서 `test/parity.ts`(문자 하나까지 대조)를 폐기했다 — 대조할 것이 없다.
 */

import {
  ANIMAL_CODES, LEVELS, LIMITS, ROUNDS, CODE_ALPHABET, CODE_LENGTH, PIN_LENGTH, HOST_KEY_LENGTH
} from './config.ts';
import type { AnimalCode, Level, Settings } from './config.ts';
export type { Race } from './types.ts';
import type {
  Bets, FinishRound, Moves, Odds, Pool, Positions, Question, QuestionPlan, Race, Rng,
  Settlement, SettlementLine, Team
} from './types.ts';

// ────────────────────────────────────────────────────────────
// 1. 경주 — 순위를 먼저 정하고 이동을 역산한다
// ────────────────────────────────────────────────────────────

/**
 * ⚠️ 되돌리면 게임이 무너지는 곳 (MIGRATION §4-2).
 *
 * 순위를 먼저 정하고 이동을 역산한다. PDF 원본은 순위를 정해놓고 이동을 따로
 * 랜덤으로 굴렸다. 그러면 "A가 최종 1등"이라는 힌트를 뿌려놓고 A가 5등으로
 * 들어오는 판이 실제로 나온다. 힌트가 거짓말이 되면 이 게임은 성립하지 않는다.
 *
 * ── RENEWAL §2-1 의 조건 7가지 ──
 *   1. truth 는 무작위 순열이고, 10라운드 끝 위치로 매긴 순위가 truth 와 같다
 *   2. 이동량은 라운드마다 0~3
 *   3. 1위는 8 또는 9라운드에 골인하고 그 뒤로는 0
 *   4. 2위 ≥ 1위, 3위 ≥ 2위, 전부 10 이하. lastRound = 3위의 골인 라운드(9|10)
 *   5. 4~8위는 10라운드 끝에 결승선 미만이고 **서로 다른 칸**에 선다
 *   6. 선두가 최소 2번 바뀌고, 1위 동물은 **4라운드 이후에** 처음 선두에 선다
 *   7. 같은 시드면 같은 결과
 *
 * 6번은 굴려 보고 아니면 다시 굴린다. 대신 그냥 굴리면 거의 안 걸리므로
 * (20칸을 8라운드에 가려면 1위는 처음부터 3칸씩 달려야 한다) **페이스를 나눠 준다** —
 * 1위는 늦게 붙고, 4~8위 중 앞쪽 둘은 초반에 튀어나간다. 그래서 초반 선두는
 * 끝내 못 들어오는 말이고, 1위는 중반 이후에 올라온다. '사기경마'의 그림이다.
 */
export function planRace(
  rng: Rng = Math.random, trackCells: number, rounds: number = ROUNDS
): Race | null {
  for (let attempt = 0; attempt < LIMITS.reverseAttempts; attempt++) {
    const race = tryPlanRace(rng, trackCells, rounds);
    if (race) return race;
  }
  return null;                                   // 호출자가 한 번 더 시도한다 (Room.create)
}

/** 한 번 굴려 본다. 조건 6을 못 맞추면 null */
function tryPlanRace(rng: Rng, track: number, rounds: number): Race | null {
  const truth = shuffle([...ANIMAL_CODES] as AnimalCode[], rng);   // truth[0] = 1등

  // ── 골인 라운드 (조건 3·4) ──
  // 20칸을 3칸씩 가도 7라운드가 필요하다. 트랙이 넓으면 8라운드로는 못 가므로 9로 민다
  const first = track > 3 * (rounds - 2) ? rounds - 1 : (rng() < 0.5 ? rounds - 2 : rounds - 1);
  if (track > 3 * first) return null;            // 트랙이 너무 넓다 (설정 상한 30)
  const second = first + Math.floor(rng() * (rounds - first + 1));
  const thirdLow = Math.max(second, rounds - 1); // lastRound 는 9 또는 10 이어야 한다
  const third = thirdLow + Math.floor(rng() * (rounds - thirdLow + 1));
  const lastRound = third;

  const moves = {} as Moves;
  const finishRound = {} as FinishRound;

  // ── 1·2·3위: 결승선까지 (조건 3·4) ──
  const arrive = [first, second, third];
  for (let rank = 1; rank <= 3; rank++) {
    const at = arrive[rank - 1]!;
    // 1위만 '늦게 붙는' 페이스다. 그래야 초반 선두를 남에게 내준다 (조건 6)
    const parts = planOneAnimal(track, at, rounds, rng, rank === 1 ? 'slow' : 'even');
    if (!parts) return null;
    moves[truth[rank - 1]!] = parts;
    finishRound[truth[rank - 1]!] = at;
  }

  // ── 4~8위: 결승선 미만, 서로 다른 칸 (조건 5) ──
  const tail = tailPositions(track, rng);
  if (!tail) return null;
  for (let i = 0; i < 5; i++) {
    const rank = i + 4;
    // 4·5위는 초반에 튀어나간다 — 끝내 못 들어오는 말이 초반 선두를 잡는 그림 (조건 6)
    const parts = planOneAnimal(tail[i]!, lastRound, rounds, rng, i < 2 ? 'fast' : 'even');
    if (!parts) return null;
    moves[truth[rank - 1]!] = parts;
    finishRound[truth[rank - 1]!] = null;
  }

  // ── 조건 1: 굳이 다시 확인한다. 여기가 틀리면 힌트가 전부 거짓말이 된다 ──
  const finalOrder = rankByPosition(positionsAtRound(moves, rounds, track), truth);
  if (finalOrder.join('') !== truth.join('')) return null;

  // ── 조건 6 ──
  const leaders = leaderSequence(moves, truth, track, rounds);
  let changes = 0;
  for (let i = 1; i < leaders.length; i++) if (leaders[i] !== leaders[i - 1]) changes++;
  if (changes < 2) return null;
  const firstLead = leaders.indexOf(truth[0]!) + 1;      // 1-based 라운드
  if (firstLead <= 3) return null;                       // 초반 선두면 다시

  return { truth, lastRound, moves, finishRound };
}

/**
 * 4~8위의 최종 위치 5개. 서로 다르고, 전부 결승선 미만이고, 내림차순이다.
 *
 * ⚠️ 같은 칸에 두 마리를 세우면 순위는 truth 로 갈리지만 **화면에서는 겹친다** —
 *    선생님이 "얘네 둘 중 누가 4등이냐"는 질문을 받는다 (RENEWAL §2-1 조건 5).
 */
function tailPositions(track: number, rng: Rng): number[] | null {
  const out: number[] = [];
  let hi = track - 1;                    // 결승선 미만
  for (let k = 0; k < 5; k++) {
    const below = 4 - k;                 // 아래에 서로 다르게 세워야 할 마리 수
    if (hi < below) return null;         // 트랙이 좁아 5마리를 못 세운다 (trackCells < 5)
    const lo = Math.max(below, hi - 3);  // 한 번에 3칸 넘게 벌리지 않는다 — 너무 늘어지면 재미없다
    const p = lo + Math.floor(rng() * (hi - lo + 1));
    out.push(p);
    hi = p - 1;
  }
  return out;
}

export type Pace = 'slow' | 'even' | 'fast';

/**
 * 한 동물의 라운드별 이동량(0~3)을 만든다. 길이는 언제나 `rounds`.
 *
 * `arriveAt` 라운드에 정확히 `total` 칸이 되고 그 뒤는 0이다. 결승선까지 가는
 * 말이면 **마지막 이동이 0이면 안 된다** — 그 라운드에 움직여서 들어와야 경주가 산다.
 */
export function planOneAnimal(
  total: number, arriveAt: number, rounds: number, rng: Rng = Math.random, pace: Pace = 'even'
): number[] | null {
  if (total < 0 || arriveAt < 1 || arriveAt > rounds) return null;

  for (let attempt = 0; attempt < LIMITS.reverseAttempts; attempt++) {
    const parts = splitIntoMoves(total, arriveAt, rng, pace);
    if (!parts) continue;
    if (total > 0 && parts[parts.length - 1] === 0) continue;   // 그 라운드에 움직여서 도착
    while (parts.length < rounds) parts.push(0);                // 도착 후 정지
    return parts;
  }
  return null;
}

/**
 * total 을 n 개의 0~3 값으로 쪼갠다.
 *
 * pace 로 앞뒤 치우침을 준다 — 이게 조건 6(선두 교체)을 굴려서 맞히는 대신
 * **설계로** 만드는 장치다. slow 는 앞을 죽이고, fast 는 앞에 몰아준다.
 */
export function splitIntoMoves(
  total: number, n: number, rng: Rng = Math.random, pace: Pace = 'even'
): number[] | null {
  if (total > n * 3 || total < 0 || n < 1) return null;

  const parts: number[] = [];
  let remaining = total;
  for (let i = 0; i < n; i++) {
    const slotsLeft = n - i - 1;
    const min = Math.max(0, remaining - slotsLeft * 3);
    const max = Math.min(3, remaining);
    if (min > max) return null;

    const early = i < n / 2;
    let lo = min, hi = max;
    if ((pace === 'slow' && early) || (pace === 'fast' && !early)) {
      hi = Math.min(max, min + 1);          // 눌러 둔다
    } else if ((pace === 'fast' && early) || (pace === 'slow' && !early)) {
      lo = Math.max(min, max - 1);          // 밀어 준다
    }
    parts.push(lo + Math.floor(rng() * (hi - lo + 1)));
    remaining -= parts[i]!;
  }
  return remaining === 0 ? parts : null;
}

/** 라운드 r까지 굴렸을 때의 위치 (결승선에서 멈춘다) */
export function positionsAtRound(moves: Moves, round: number, trackCells: number): Positions {
  const pos = {} as Positions;
  for (const code of Object.keys(moves) as AnimalCode[]) {
    let sum = 0;
    for (let i = 0; i < round && i < moves[code].length; i++) sum += moves[code][i]!;
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

/**
 * 라운드 1..rounds 의 선두 동물. 동점이면 rankByPosition 과 **같은 규칙**으로 가른다.
 *
 * ⚠️ 화면이 보는 '1위 줄'과 여기서 세는 선두가 갈라지면 조건 6이 아무것도 안 지킨다.
 *    그래서 따로 세지 않고 rankByPosition 의 맨 앞을 쓴다.
 */
export function leaderSequence(
  moves: Moves, truth: AnimalCode[], trackCells: number, rounds: number
): AnimalCode[] {
  const out: AnimalCode[] = [];
  for (let r = 1; r <= rounds; r++) {
    out.push(rankByPosition(positionsAtRound(moves, r, trackCells), truth)[0]!);
  }
  return out;
}

// ────────────────────────────────────────────────────────────
// 2. 힌트 — 라운드 × 난이도로 30개
// ────────────────────────────────────────────────────────────

export type HintPredicate = (order: AnimalCode[]) => boolean;

/**
 * 힌트 한 줄의 설계도. **문장과 논리식이 여기 하나에서 같이 나온다.**
 *
 * ⚠️ 예전에는 `buildHints`(문장)와 `buildHintPredicates`(논리식)가 각각 배열을 만들고
 *    "한 줄씩 짝이 맞는다"를 사람이 지켰다. 이제 문장이 무작위로 골라지므로 그 방식은
 *    못 쓴다 — 어긋나면 게이트가 거짓말을 검증하게 된다 (MIGRATION §4-3).
 *    그래서 spec 하나에서 문장과 논리식이 **같이** 나온다.
 */
export interface HintSpec {
  level: Level;
  /** 문장 틀 이름 (게이트 HINT-TPL 이 이걸 센다) */
  tpl: string;
  args: AnimalCode[];
  /** '정확히 n등' 틀만 쓴다 */
  n?: number;
}

interface Template {
  level: Level;
  id: string;
  text(names: (c: AnimalCode) => string, a: AnimalCode[], n: number): string;
  pred(a: AnimalCode[], n: number): HintPredicate;
  /** 동물 인자 개수 */
  arity: number;
  /** 쓰는 등수 값들 ('정확히 n등' 만). 비어 있으면 n 을 안 쓴다 */
  ns?: number[];
}

const rankOf = (o: AnimalCode[], c: AnimalCode) => o.indexOf(c) + 1;

/**
 * 받침에 맞는 조사를 붙인다. '얼룩말는', '타조과' 같은 문장이 TV 에 뜨는 걸 막는다.
 *
 * ⚠️ 동물 이름은 '동물' 설정에서 오므로 선생님이 언제든 바꾼다 — 문장 틀에 '는'을
 *    박아 두면 이름을 바꾼 다음 수업에서 어색한 문장이 나온다. 여기서 한 번에 고른다.
 * 한글 음절(가~힣)만 받침을 따진다. 코드(A~H)나 다른 문자는 받침 없음으로 본다.
 */
function josa(word: string, withBatchim: string, without: string): string {
  const last = word.charCodeAt(word.length - 1);
  const hangul = last >= 0xAC00 && last <= 0xD7A3;
  return word + (hangul && (last - 0xAC00) % 28 !== 0 ? withBatchim : without);
}
/** 'X는/은' */
const topic = (w: string) => josa(w, '은', '는');
/** 'X와/과' */
const and = (w: string) => josa(w, '과', '와');
/** 'X가/이' */
const subj = (w: string) => josa(w, '이', '가');

/**
 * 문장 틀 15종 (RENEWAL §2-2, 사용자 확정). 난이도별 5종.
 *
 * ⚠️ 문장을 고치면 바로 아래 `pred` 도 같이 고친다. 둘은 한 객체 안에 있으므로
 *    "한쪽만 고쳤다"가 눈에 보인다 — 그게 이 표를 이렇게 묶어 둔 이유다.
 * ⚠️ '정확히 n등' 의 n 은 **4~8 뿐이다.** 1·2·3등을 문장 하나로 주면 추리가 끝난다.
 */
const TEMPLATES: Template[] = [
  // ── 쉬움 ──
  { level: '쉬움', id: 'top4', arity: 1,
    text: (n_, a) => `${topic(n_(a[0]!))} 1~4등 안에 듭니다.`,
    pred: (a) => (o) => rankOf(o, a[0]!) <= 4 },
  { level: '쉬움', id: 'below5', arity: 1,
    // ⚠️ '5등 아래'라고 쓰면 학생이 "6등부터"로 읽는다. 뜻(등수 ≥ 5)을 문장이 그대로 말하게 한다
    text: (n_, a) => `${topic(n_(a[0]!))} 1~4등 안에 들지 못합니다.`,
    pred: (a) => (o) => rankOf(o, a[0]!) >= 5 },
  { level: '쉬움', id: 'notFirst', arity: 1,
    text: (n_, a) => `${topic(n_(a[0]!))} 1등이 아닙니다.`,
    pred: (a) => (o) => rankOf(o, a[0]!) !== 1 },
  { level: '쉬움', id: 'notLast', arity: 1,
    text: (n_, a) => `${topic(n_(a[0]!))} 꼴찌가 아닙니다.`,
    pred: (a) => (o) => rankOf(o, a[0]!) !== ANIMAL_CODES.length },
  { level: '쉬움', id: 'eitherTop3', arity: 2,
    text: (n_, a) => `${and(n_(a[0]!))} ${n_(a[1]!)} 중 적어도 하나는 1·2·3등 안에 듭니다.`,
    pred: (a) => (o) => rankOf(o, a[0]!) <= 3 || rankOf(o, a[1]!) <= 3 },

  // ── 보통 ──
  { level: '보통', id: 'ahead', arity: 2,
    text: (n_, a) => `${topic(n_(a[0]!))} ${n_(a[1]!)}보다 앞입니다.`,
    pred: (a) => (o) => rankOf(o, a[0]!) < rankOf(o, a[1]!) },
  { level: '보통', id: 'aheadBoth', arity: 3,
    text: (n_, a) => `${topic(n_(a[0]!))} ${and(n_(a[1]!))} ${n_(a[2]!)} 둘 다보다 앞입니다.`,
    pred: (a) => (o) => rankOf(o, a[0]!) < rankOf(o, a[1]!) && rankOf(o, a[0]!) < rankOf(o, a[2]!) },
  { level: '보통', id: 'gap3', arity: 2,
    text: (n_, a) => `${and(n_(a[0]!))} ${topic(n_(a[1]!))} 등수 차이가 3 이상입니다.`,
    pred: (a) => (o) => Math.abs(rankOf(o, a[0]!) - rankOf(o, a[1]!)) >= 3 },
  { level: '보통', id: 'oneBetween', arity: 2,
    text: (n_, a) => `${and(n_(a[0]!))} ${n_(a[1]!)} 사이에 정확히 한 마리가 있습니다.`,
    pred: (a) => (o) => Math.abs(rankOf(o, a[0]!) - rankOf(o, a[1]!)) === 2 },
  { level: '보통', id: 'neitherFirst', arity: 2,
    text: (n_, a) => `1등은 ${n_(a[0]!)}도 ${n_(a[1]!)}도 아닙니다.`,
    pred: (a) => (o) => rankOf(o, a[0]!) !== 1 && rankOf(o, a[1]!) !== 1 },

  // ── 어려움 ──
  { level: '어려움', id: 'firstIsOneOf', arity: 2,
    text: (n_, a) => `1등은 ${n_(a[0]!)} 또는 ${n_(a[1]!)}입니다.`,
    pred: (a) => (o) => rankOf(o, a[0]!) === 1 || rankOf(o, a[1]!) === 1 },
  { level: '어려움', id: 'second3', arity: 1,
    text: (n_, a) => `${topic(n_(a[0]!))} 2등 또는 3등입니다.`,
    pred: (a) => (o) => rankOf(o, a[0]!) === 2 || rankOf(o, a[0]!) === 3 },
  { level: '어려움', id: 'justAhead', arity: 2,
    text: (n_, a) => `${topic(n_(a[0]!))} ${n_(a[1]!)} 바로 앞입니다.`,
    pred: (a) => (o) => rankOf(o, a[0]!) === rankOf(o, a[1]!) - 1 },
  { level: '어려움', id: 'bothTop3', arity: 2,
    text: (n_, a) => `1·2·3등 안에 ${and(n_(a[0]!))} ${subj(n_(a[1]!))} 모두 있습니다.`,
    pred: (a) => (o) => rankOf(o, a[0]!) <= 3 && rankOf(o, a[1]!) <= 3 },
  { level: '어려움', id: 'exactRank', arity: 1, ns: [4, 5, 6, 7, 8],
    text: (n_, a, n) => `${topic(n_(a[0]!))} 정확히 ${n}등입니다.`,
    pred: (a, n) => (o) => rankOf(o, a[0]!) === n }
];

const TEMPLATE_BY_ID: Record<string, Template> = {};
for (const t of TEMPLATES) TEMPLATE_BY_ID[t.id] = t;

/** 난이도별 틀 이름 5개 */
export function hintTemplateIds(level: Level): string[] {
  return TEMPLATES.filter((t) => t.level === level).map((t) => t.id);
}

/**
 * 만들 수 있는 힌트 한 줄 전부 (600줄 남짓). 모듈이 켜질 때 한 번만 만든다.
 *
 * 게이트가 **저장된 문장에서 논리식을 되찾는** 데 쓴다 — 판 하나의 hintPool 을
 * 검사하려면 그 문장이 참인지 알아야 하는데, 그러려면 문장 → 논리식 지도가 필요하다.
 * 사본을 새로 쓰지 않고 여기 있는 진짜 틀에서 만든다 (MIGRATION §5).
 */
export function enumerateHintSpecs(): HintSpec[] {
  const out: HintSpec[] = [];
  for (const t of TEMPLATES) {
    const ns = t.ns ?? [0];
    const walk = (args: AnimalCode[]) => {
      if (args.length === t.arity) {
        for (const n of ns) out.push({ level: t.level, tpl: t.id, args: args.slice(), ...(t.ns ? { n } : {}) });
        return;
      }
      for (const c of ANIMAL_CODES) {
        if (args.indexOf(c) >= 0) continue;      // 같은 동물을 두 번 넣지 않는다
        args.push(c); walk(args); args.pop();
      }
    };
    walk([]);
  }
  return out;
}

/** spec → 학생이 읽는 문장 */
export function hintText(spec: HintSpec, names?: Partial<Record<AnimalCode, string>>): string {
  const n_ = (c: AnimalCode) => (names && names[c]) || c;
  return TEMPLATE_BY_ID[spec.tpl]!.text(n_, spec.args, spec.n ?? 0);
}

/** spec → 논리식. order 는 1등부터 8등까지의 code 배열 */
export function hintPredicate(spec: HintSpec): HintPredicate {
  return TEMPLATE_BY_ID[spec.tpl]!.pred(spec.args, spec.n ?? 0);
}

/** 힌트 한 벌 — 문장과 논리식이 **같은 spec 에서** 나온다 */
export interface HintPlan {
  specs: Record<Level, HintSpec[]>;
  texts: Record<Level, string[]>;
  predicates: Record<Level, HintPredicate[]>;
  /** 거짓 힌트가 들어간 라운드 (없으면 null) */
  fraudRound: number | null;
}

export interface HintOptions {
  /** 이 라운드의 힌트 3개를 **거짓**으로 만든다 (2~4). null 이면 전부 참 */
  fraudRound?: number | null;
  rounds?: number;
}

/**
 * 사기 라운드를 고른다 — **2·3·4 중 하나** (RENEWAL §1).
 *
 * 1라운드가 아닌 이유: 첫 힌트를 의심하면 판이 시작부터 죽는다.
 * 5라운드 이후가 아닌 이유: 학생이 나중에 되짚어 볼 시간이 있어야 한다.
 */
export function buildFraudRound(rng: Rng = Math.random): number {
  return 2 + Math.floor(rng() * 3);
}

/**
 * 힌트 30개(난이도 3 × 라운드 10)를 만든다. **이것이 정본이다.**
 *
 * 라운드 r 의 난이도 L 힌트는 `plan.texts[L][r-1]` 이고, 그 논리식은
 * `plan.predicates[L][r-1]` 이다 — 같은 spec 에서 나오므로 어긋날 수가 없다.
 *
 * 지키는 것:
 *   - 난이도마다 **5종 틀을 전부 최소 한 번** 쓴다 (게이트 HINT-TPL)
 *   - 30개 문장이 서로 다르다 (게이트 HINT-30)
 *   - 사기 라운드가 아닌 27개는 truth 에서 **참** (게이트 FRAUD-1)
 *   - 어려움 10개만으로는 1·2·3등이 **확정되지 않는다** (게이트 HINT-HARD).
 *     확정되면 그 난이도만 계속 골라 다른 모둠보다 앞서 정답을 알아낸다
 */
export function buildHintPlan(
  truth: AnimalCode[],
  names?: Partial<Record<AnimalCode, string>>,
  rng: Rng = Math.random,
  opts: HintOptions = {}
): HintPlan {
  const rounds = opts.rounds ?? ROUNDS;
  const fraudRound = opts.fraudRound ?? null;
  const fraudIdx = fraudRound == null ? -1 : fraudRound - 1;

  const specs = {} as Record<Level, HintSpec[]>;
  const texts = {} as Record<Level, string[]>;
  const predicates = {} as Record<Level, HintPredicate[]>;
  const usedText: Record<string, true> = {};

  for (const level of LEVELS) {
    let chosen: HintSpec[] | null = null;

    for (let attempt = 0; attempt < LIMITS.hintAttempts && !chosen; attempt++) {
      const mine: Record<string, true> = {};
      const ids = templateSlots(level, rounds, rng);
      const row: HintSpec[] = [];
      let failed = false;

      // 1) 먼저 **전부 참**으로 채운다. 사기 자리도 일단 참으로 둔다 —
      //    어려움의 '확정되지 않는가' 검사는 참 힌트 10개에 대한 것이기 때문이다
      for (const id of ids) {
        const spec = pickSpec(id, truth, rng, true, usedText, mine, names);
        if (!spec) { failed = true; break; }
        row.push(spec);
        mine[hintText(spec, names)] = true;
      }
      if (failed) continue;

      if (level === '어려움') {
        const preds = row.map(hintPredicate);
        if (countTop3Candidates(preds, 1) < 2) continue;    // 1·2·3등이 확정됐다 — 다시
      }

      // 2) 사기 라운드 자리만 **같은 틀의 거짓 문장**으로 바꾼다
      if (fraudIdx >= 0 && fraudIdx < row.length) {
        delete mine[hintText(row[fraudIdx]!, names)];
        const lie = pickSpec(row[fraudIdx]!.tpl, truth, rng, false, usedText, mine, names);
        if (!lie) continue;
        row[fraudIdx] = lie;
        mine[hintText(lie, names)] = true;
      }

      chosen = row;
    }

    // 여기까지 못 오는 일은 사실상 없다. 그래도 판이 안 만들어지는 것보다는
    // 참 힌트만 있는 판이 낫다 — 사기 라운드는 연출이고, 힌트는 규칙이다
    if (!chosen) chosen = fallbackRow(level, truth, rounds, usedText, names);

    for (const s of chosen) usedText[hintText(s, names)] = true;
    specs[level] = chosen;
    texts[level] = chosen.map((s) => hintText(s, names));
    predicates[level] = chosen.map(hintPredicate);
  }

  return { specs, texts, predicates, fraudRound };
}

/**
 * 10칸에 넣을 틀 이름. 5종을 한 번씩 깔고 나머지 5칸은 무작위로 채운 뒤 섞는다.
 * ⚠️ 이 방식이 "난이도마다 5종을 전부 쓴다"(게이트 HINT-TPL)를 **설계로** 보장한다.
 *    굴려서 맞히려 들면 10칸 중 한 종류가 빠지는 판이 심심찮게 나온다.
 */
function templateSlots(level: Level, rounds: number, rng: Rng): string[] {
  const ids = hintTemplateIds(level);
  const out = ids.slice(0, rounds);
  while (out.length < rounds) out.push(ids[Math.floor(rng() * ids.length)]!);
  return shuffle(out, rng);
}

/** 후보 목록 (틀 이름 → 그 틀로 만들 수 있는 spec 전부). 한 번만 만든다 */
const BY_TEMPLATE: Record<string, HintSpec[]> = {};
for (const spec of enumerateHintSpecs()) {
  (BY_TEMPLATE[spec.tpl] ||= []).push(spec);
}

/** 그 틀로, truth 에서 원하는 참/거짓이 되고, 아직 안 쓴 문장을 하나 고른다 */
function pickSpec(
  tpl: string, truth: AnimalCode[], rng: Rng, want: boolean,
  usedGlobal: Record<string, true>, usedHere: Record<string, true>,
  names?: Partial<Record<AnimalCode, string>>
): HintSpec | null {
  const pool = BY_TEMPLATE[tpl] || [];
  const start = Math.floor(rng() * pool.length);
  for (let i = 0; i < pool.length; i++) {
    const spec = pool[(start + i) % pool.length]!;
    if (hintPredicate(spec)(truth) !== want) continue;
    const t = hintText(spec, names);
    if (usedGlobal[t] || usedHere[t]) continue;
    return spec;
  }
  return null;
}

/** 마지막 안전망 — 틀 순서대로 참 문장을 채운다 (사기 라운드 없음) */
function fallbackRow(
  level: Level, truth: AnimalCode[], rounds: number,
  usedGlobal: Record<string, true>, names?: Partial<Record<AnimalCode, string>>
): HintSpec[] {
  const ids = hintTemplateIds(level);
  const mine: Record<string, true> = {};
  const row: HintSpec[] = [];
  for (let i = 0; row.length < rounds && i < rounds * ids.length; i++) {
    const tpl = ids[i % ids.length]!;
    const spec = pickSpec(tpl, truth, () => 0, true, usedGlobal, mine, names);
    if (!spec) continue;
    row.push(spec);
    mine[hintText(spec, names)] = true;
  }
  return row;
}

/**
 * 난이도별 힌트 문장 10개.
 *
 * ⚠️ `buildHintPredicates` 와 **인덱스가 짝이다.** 다만 두 함수를 따로 부르려면
 *    **같은 시드의 rng** 를 줘야 한다 — 문장이 무작위로 골라지기 때문이다.
 *    확실한 길은 `buildHintPlan` 을 한 번 부르는 것이다. Room.create 가 그렇게 한다.
 */
export function buildHints(
  truth: AnimalCode[], names?: Partial<Record<AnimalCode, string>>,
  rng: Rng = Math.random, opts: HintOptions = {}
): Record<Level, string[]> {
  return buildHintPlan(truth, names, rng, opts).texts;
}

/** 위 문장들의 논리식. 검산(HINT-30·FRAUD)에 쓴다 */
export function buildHintPredicates(
  truth: AnimalCode[], names?: Partial<Record<AnimalCode, string>>,
  rng: Rng = Math.random, opts: HintOptions = {}
): Record<Level, HintPredicate[]> {
  return buildHintPlan(truth, names, rng, opts).predicates;
}

/**
 * 힌트 묶음으로 좁혀지는 1·2·3등 후보 조합 수를 센다.
 * `limit` 을 주면 그만큼 넘어가는 순간 멈춘다 (판을 만들 때마다 40320개를 다 돌지 않게).
 */
export function countTop3Candidates(predicates: HintPredicate[], limit?: number): number {
  const found: Record<string, true> = {};
  let count = 0;
  // ⚠️ 자리 배열을 복사하지 않는다. 판을 만들 때마다 40320개를 새로 할당하면
  //    수업 시작 버튼이 눈에 띄게 늦는다. 논리식은 order 를 읽기만 한다
  permuteInPlace([...ANIMAL_CODES] as AnimalCode[], (order) => {
    for (const p of predicates) if (!p(order)) return true;    // 계속
    const key = order[0]! + order[1]! + order[2]!;
    if (!found[key]) { found[key] = true; count++; }
    return !(limit !== undefined && count > limit);
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

/**
 * 베팅이 규칙에 맞는지. 화면에서 막아도 서버가 다시 막는다.
 *
 * ⚠️ `positions` 를 **인자로 받는다.** 골인한 동물에는 걸 수 없기 때문이다 (RENEWAL §1).
 *    1위가 8라운드에 들어와 화면에 보이는 순간부터 그 줄은 닫힌다 — 안 그러면
 *    마지막 라운드 베팅이 "이미 1등이 누군지 보이는" 공짜가 된다.
 *    옵션으로 두지 않은 이유는 trackCells 와 같다: 빼먹으면 컴파일이 안 되게 (MIGRATION §5).
 */
export function validateBet(
  team: Pick<Team, 'coins' | 'betLocked'>, round: number, bets: Bets,
  settings: Settings, positions: Positions
): BetCheck {
  let sum = 0;
  for (const c of Object.keys(bets) as AnimalCode[]) {
    if (!(ANIMAL_CODES as readonly string[]).includes(c)) return { ok: false, error: 'BAD_ANIMAL' };
    const v = bets[c]!;
    if (typeof v !== 'number' || !isFinite(v) || v < 0 || v !== Math.floor(v)) {
      return { ok: false, error: 'BAD_AMOUNT' };
    }
    if (v > 0 && (positions[c] ?? 0) >= settings.trackCells) return { ok: false, error: 'BET_FINISHED' };
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
  const rank: Partial<Record<AnimalCode, number>> = {};
  finalOrder.forEach((c, i) => { rank[c] = i + 1; });

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
      const finalRank = rank[c]!;
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
 *
 * ⚠️ `rounds` 는 **10**(ROUNDS)이다. `lastRound`(9 또는 10)가 아니다 —
 *    마지막 라운드는 학생에게 비공개인데, 9라운드 분만 배정해 두면 10라운드에
 *    문제가 없는 것으로 마지막 라운드가 드러난다.
 */
export function planQuestions(
  questionsByLevel: Partial<Record<Level, Question[]>>, rounds: number = ROUNDS, rng: Rng = Math.random
): QuestionPlan {
  const plan: QuestionPlan = {};
  for (let r = 1; r <= rounds; r++) plan[r] = {};

  for (const level of LEVELS) {
    const pool = (questionsByLevel[level] || []).slice();
    if (pool.length === 0) {
      for (let r = 1; r <= rounds; r++) plan[r][level] = null;
      continue;
    }
    shuffle(pool, rng);
    for (let r = 1; r <= rounds; r++) {
      plan[r][level] = pool[(r - 1) % pool.length]!.id;   // 모자라면 순환 재사용
    }
  }
  return plan;
}

// ────────────────────────────────────────────────────────────
// 5. 보조
// ────────────────────────────────────────────────────────────

export function shuffle<T>(arr: T[], rng: Rng = Math.random): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/** cb 가 false 를 돌려주면 중단 (Heap's algorithm) */
export function permute<T>(arr: T[], cb: (order: T[]) => boolean): void {
  permuteInPlace(arr, (order) => cb(order.slice()));
}

/**
 * 위와 같지만 **배열을 복사하지 않는다.** cb 는 order 를 읽기만 해야 한다.
 * 40320번의 배열 할당이 판 만들기에서 눈에 띄게 느려서 나눠 두었다.
 */
function permuteInPlace<T>(arr: T[], cb: (order: T[]) => boolean): void {
  const n = arr.length;
  const c = new Array(n).fill(0);
  let i = 1;
  if (cb(arr) === false) return;
  while (i < n) {
    if (c[i] < i) {
      const k = i % 2 ? c[i] : 0;
      [arr[k], arr[i]] = [arr[i]!, arr[k]!];
      if (cb(arr) === false) return;
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
