/**
 * race.ts — 경주 **안무**. 순수 함수 하나뿐이다.
 *
 * ⚠️ **TV(PixiJS 무대)와 폰(미니 트랙)이 이 파일 하나를 같이 쓴다.** 그래야 같은 경주가
 *    보인다 (MIGRATION §11-2). 어느 한쪽에 "여기만 조금 다르게" 를 넣는 순간, 폰에서는
 *    사자가 앞서고 TV 에서는 치타가 앞서는 판이 나온다. 그건 교실에서 게임을 망가뜨린다 —
 *    학생들은 폰을 보고 소리치는데 TV 는 다른 말이 이기고 있다.
 *
 * ⚠️ **최종 위치는 서버 값이다.** 여기서 만드는 것은 *가는 길*뿐이고, 도착점은
 *    `after`(= 서버가 준 이동 후 위치)에 정확히 맞는다. 도착점을 화면이 정하면
 *    힌트가 거짓말이 된다 (MIGRATION §4-2 — 순위를 먼저 정하고 이동을 역산한다).
 *
 * ⚠️ 시간축(t)은 **서버 시각**으로 계산해서 넣는다. `ServerClock` 참조 (§11-2).
 *    화면이 자기 시계로 재면 늦게 들어온 폰이 다른 지점에서 경주를 시작한다.
 *
 * 성질(전부 `test/race.ts` 가 지킨다):
 *   RACE-START  t=0 이면 before
 *   RACE-END    t≥정착 시작이면 after 그대로 (정수)
 *   RACE-MONO   말은 뒤로 가지 않는다
 *   RACE-BOUND  0 ≤ 위치 ≤ trackCells
 *   RACE-DET    같은 시드면 같은 궤적
 *   RACE-ZERO   이동량 0인 말은 위치가 한 번도 안 변한다 (몸 들썩임은 그리는 쪽 몫)
 *   RACE-SHAKE  중간에 서로 앞서고 뒤처진다 (등속 보간보다 순위가 더 많이 뒤집힌다)
 */

import type { AnimalCode } from '../../game/config.ts';
import type { Positions } from '../../game/types.ts';
import { hashSeed, mulberry32 } from './rng.ts';

export type RacePhase = 'countdown' | 'running' | 'settle';

/**
 * 20초를 3 : 15 : 2 로 나눈다 (MIGRATION §11-2).
 * ⚠️ 초가 아니라 **비율**이다. '설정'의 경주시간초(5~60)를 바꿔도 이 비율이 유지된다 —
 *    초를 박아 두면 10초로 줄였을 때 카운트다운만 하다 끝난다 (§5 '설정값을 화면이 다시 정하지 말 것').
 */
export const RACE_SPLIT = { countdown: 3, running: 15, settle: 2 } as const;

const TOTAL = RACE_SPLIT.countdown + RACE_SPLIT.running + RACE_SPLIT.settle;
/** 게이트가 열리는 지점 (t) */
export const COUNTDOWN_END = RACE_SPLIT.countdown / TOTAL;              // 0.15
/** 정착이 시작되는 지점 (t). 여기서부터 위치는 서버 값 그대로다 */
export const RUN_END = (RACE_SPLIT.countdown + RACE_SPLIT.running) / TOTAL;  // 0.90

export function racePhase(t: number): RacePhase {
  if (t < COUNTDOWN_END) return 'countdown';
  if (t < RUN_END) return 'running';
  return 'settle';
}

/**
 * 질주 구간을 몇 토막으로 나눠 말마다 다른 속도를 주는가.
 *
 * ⚠️ 1 로 낮추면 전부 등속이 되어 **순위 흔들림이 사라진다** — 경주가 "길이만 다른 막대
 *    8개가 동시에 자라는" 그림이 되고, 그건 지금 CSS 트랙과 같다. RACE-SHAKE 가 잡는다.
 * ⚠️ 너무 키우면 말이 딸꾹질하듯 끊긴다. 5 토막 × 15초 = 토막당 3초 정도가 눈에 자연스럽다.
 */
const SEGMENTS = 6;
/**
 * 한 토막의 속도 가중치 = MIN_W + SPAN·r^SKEW (정규화 전).
 * SKEW>1 이면 '느린 토막'이 흔해져 빠른 토막과의 대비가 커진다 — 그게 추월이 나오는 이유다.
 *
 * ⚠️ MIN_W 를 0 에 가깝게 낮추면 말이 2~3초 멈춰 섰다가 튀어나간다. 극적이긴 한데
 *    "고장난 것 같다"는 인상을 준다. 지금 값은 400시드로 재서 고른 것이다:
 *    등속 대비 순위 교체 2.15배, 진짜 되치기(한 쌍이 두 번 뒤집힘)가 시드의 절반.
 *    바꾸면 `node test/race.ts` 의 RACE-SHAKE 숫자로 확인할 것.
 */
const MIN_W = 0.05;
const SPAN = 1.95;
const SKEW = 2.6;

/** 이 말의 누적 진행 곡선. 길이 SEGMENTS+1, 0 에서 시작해 정확히 1 로 끝난다 */
function profile(seed: string, code: string): number[] {
  const rng = mulberry32(hashSeed(seed + '#' + code));
  const w: number[] = [];
  let sum = 0;
  for (let i = 0; i < SEGMENTS; i++) {
    const v = MIN_W + SPAN * Math.pow(rng(), SKEW);
    w.push(v);
    sum += v;
  }
  const cum: number[] = [0];
  let acc = 0;
  for (const v of w) { acc += v / sum; cum.push(acc); }
  // 나눗셈 오차로 마지막 항이 1.0000000000000002 가 되면 도착 직전 위치가 `after` 를
  // 아주 잠깐 넘었다가 되돌아온다(= 뒷걸음). 눈에 보일 크기는 아니지만 그런 코드를
  // 남겨 둘 이유도 없다. 도착점 자체는 along() 의 `u >= 1` 가 따로 지킨다
  cum[SEGMENTS] = 1;
  return cum;
}

/** 누적 곡선을 u(0~1)에서 선형 보간. 가중치가 전부 양수라 단조 증가가 보장된다 */
function along(cum: number[], u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const x = u * SEGMENTS;
  const i = Math.min(SEGMENTS - 1, Math.floor(x));
  const a = cum[i] as number;
  const b = cum[i + 1] as number;
  return a + (b - a) * (x - i);
}

function num(v: number | undefined): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

/**
 * t(0~1, 단계 진행률) 에서 각 동물이 몇 번째 칸에 있는가 (실수).
 *
 * `seed` 는 `판코드 + ':' + 라운드`. `before`·`after` 는 서버가 준 이동 전·후 위치다
 * (`after` = 뷰의 `positions`, `before` = `positions - raceMoves`).
 *
 * ⚠️ 돌려주는 키는 `after` 의 키다 — 동물 코드 목록을 여기에 박아 두지 않는다.
 *    클라이언트는 `src/game/` 에서 타입만 가져오기 때문이고(값을 가져오면 규칙 코드가
 *    번들에 실린다), 애초에 화면이 그릴 동물은 서버가 준 것뿐이다.
 */
export function raceFrame(
  seed: string, before: Positions, after: Positions, trackCells: number, t: number
): Record<AnimalCode, number> {
  const cells = Math.max(1, trackCells || 1);
  const tt = t < 0 ? 0 : t > 1 ? 1 : t;
  // 게이트가 열리기 전에는 출발선, 정착부터는 도착점. 그 사이만 안무가 있다
  const u = tt <= COUNTDOWN_END ? 0
    : tt >= RUN_END ? 1
      : (tt - COUNTDOWN_END) / (RUN_END - COUNTDOWN_END);

  const out = {} as Record<AnimalCode, number>;
  for (const c of Object.keys(after) as AnimalCode[]) {
    const a = num(before[c]);
    const b = num(after[c]);
    // 이동량 0 — **위치를 건드리지 않는다.** 제자리에서 몸만 들썩이는 것은 그리는 쪽이 한다.
    // 여기서 조금이라도 흔들면 "안 움직인 말"이 움직인 것처럼 보여 힌트 추론이 오염된다
    if (b === a) { out[c] = clamp(a, cells); continue; }
    out[c] = clamp(a + (b - a) * along(profile(seed, c), u), cells);
  }
  return out;
}

function clamp(v: number, cells: number): number {
  return v < 0 ? 0 : v > cells ? cells : v;
}

/** 이번 라운드 이동 **전** 위치. 서버는 도착 위치(positions)와 이동량(raceMoves)만 준다 */
export function beforeOf(after: Positions, moves: Partial<Record<AnimalCode, number>>): Positions {
  const out = {} as Positions;
  for (const c of Object.keys(after) as AnimalCode[]) {
    out[c] = Math.max(0, num(after[c]) - num(moves[c]));
  }
  return out;
}

/** 시드. 판코드와 라운드가 같으면 TV·폰·재접속이 전부 같은 경주를 본다 */
export function raceSeed(code: string, round: number): string {
  return `${code}:${round}`;
}
