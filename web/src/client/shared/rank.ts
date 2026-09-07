/**
 * rank.ts — **현 위치 기준 순위** 계산 한 벌.
 *
 * ⚠️ **사본을 만들지 마세요** (MIGRATION §5). 이 순위는 지금 세 자리에 동시에 나온다 —
 *    ① PixiJS 무대의 레인(`teacher/stage.ts`), ② CSS 폴백 트랙과 ③ 동물 카드
 *    (`teacher/main.ts`). 셋이 같은 순간에 다른 등수를 적으면 8m 밖의 학생은
 *    어느 쪽이 맞는지 알 길이 없다. 그래서 계산은 여기 한 곳에만 있다.
 *
 * ⚠️ 이건 **정산 전 최종 순위가 아니다.** 지금 위치를 읽어 세어 본 것뿐이고,
 *    다음 라운드에 그대로 뒤집힌다. 서버의 tie-break(`truth` 순)는 여기 없다 —
 *    위치가 같으면 **공동 순위**다 (RENEWAL §1 결정표). 순서를 매기는 순간
 *    화면이 정답의 일부를 흘리게 된다.
 *
 * ⚠️ 경주 15초 동안 무대는 **안무 위치**(`raceFrame` 이 준 실수)를 넣고, 나머지
 *    단계에서는 서버가 준 `positions`(정수)를 넣는다. 같은 함수가 둘 다 받는다 —
 *    "지금 몇 칸에 있나"만 보기 때문이다.
 *
 * ── 골인한 동물 (2026-09-07 사용자 결정) ──
 *
 * 예전에는 골인하면 등수 없이 '🏁 골인'뿐이었다 (RENEWAL §4-2 "골인 표시만, 등수 없음").
 * 골인 라운드가 **1위 8R · 2위 9R · 3위 10R 로 고정**되면서 그 이유가 사라졌다 —
 * 몇 라운드에 들어왔는지가 곧 등수라 감출 것이 없다. 그래서 골인한 동물도 등수를 보여준다.
 *
 * ⚠️ 골인한 동물끼리는 **공동이 아니다.** 위치는 셋 다 20칸으로 같지만 먼저 들어온 말이
 *    앞이다. 그 순서를 `finished` 배열의 자리로 가른다.
 *    `views.finishedOf` 가 **골인 라운드 순**으로 담아 준다 (같은 라운드면 코드 순 — 옛 판).
 *    여기서는 그 배열 순서를 믿고 그대로 쓴다. 매 프레임 같은 답이 나온다.
 */

import type { AnimalCode } from '../../game/config.ts';

/** 실수 위치를 비교할 때의 여유. 안무 위치는 실수라 `===` 로 재면 공동이 안 잡힌다 */
const EPS = 1e-9;

export interface Rank {
  /** 1부터. 공동이면 여럿이 같은 값을 가진다 */
  rank: number;
  /** 같은 자리에 다른 동물이 또 있는가 (= '공동 3위') */
  tied: boolean;
  /** 결승선을 넘었는가 */
  done: boolean;
}

/**
 * 지금 위치로 셈한 등수 한 벌.
 *
 * @param positions 지금 위치 (서버 `positions` 또는 `raceFrame` 의 안무 위치)
 * @param codes     화면에 그리는 동물 (= 서버가 준 목록. 여기에 박아 두지 않는다)
 * @param trackCells 결승선까지의 칸수 (서버 설정값 — 20 으로 박아 두지 말 것)
 * @param finished  골인한 동물. **골인한 것들끼리의 순서**로만 쓴다
 */
export function ranksOf(
  positions: Partial<Record<AnimalCode, number>>,
  codes: readonly AnimalCode[],
  trackCells: number,
  finished: readonly AnimalCode[]
): Partial<Record<AnimalCode, Rank>> {
  const cells = Math.max(1, trackCells || 1);
  const at = (c: AnimalCode): number => {
    const v = positions[c];
    return typeof v === 'number' && isFinite(v) ? v : 0;
  };
  const done = (c: AnimalCode): boolean => at(c) >= cells - EPS;
  // 골인 순서. 목록에 없으면 맨 뒤로 — 경주 도중에는 아직 서버가 안 담은 말이 결승선을
  // 넘는 순간이 있다(안무가 먼저 도착한다). 그런 말끼리는 공동이 된다
  const order = (c: AnimalCode): number => {
    const i = finished.indexOf(c);
    return i < 0 ? finished.length : i;
  };

  const dones = codes.filter(done);
  const out: Partial<Record<AnimalCode, Rank>> = {};

  for (const c of codes) {
    if (done(c)) {
      const k = order(c);
      let ahead = 0, tied = 0;
      for (const o of dones) {
        if (o === c) continue;
        const ko = order(o);
        if (ko < k) ahead++;
        else if (ko === k) tied++;
      }
      out[c] = { rank: ahead + 1, tied: tied > 0, done: true };
    } else {
      // 골인한 말은 전부 앞이다 (위치가 결승선이므로). 그 수만큼 밀고 시작한다
      const p = at(c);
      let ahead = dones.length, tied = 0;
      for (const o of codes) {
        if (o === c || done(o)) continue;
        const q = at(o);
        if (q > p + EPS) ahead++;
        else if (q > p - EPS) tied++;
      }
      out[c] = { rank: ahead + 1, tied: tied > 0, done: false };
    }
  }
  return out;
}

/**
 * 캔버스에 그대로 그리는 한 줄. `'1위'` · `'공동3위'` · `'1위 🏁'`.
 *
 * ⚠️ 무대(캔버스)와 카드(HTML)가 **같은 글자**를 보여야 한다. 카드 쪽은 '공동'을 작게
 *    쓰려고 태그를 감싸므로 여기서 만든 문자열을 그대로 쓰지 않지만, 읽었을 때 같은
 *    말이 나오는지는 이 함수 하나를 보면 된다.
 */
export function rankPlain(r: Rank | undefined): string {
  if (!r) return '';
  return (r.tied ? '공동' : '') + r.rank + '위' + (r.done ? ' 🏁' : '');
}

/** 1·2·3위만 왕관을 쓴다. 공동이면 둘 다 같은 왕관 (RENEWAL §4-2 — 2026-09-07 결정) */
export function crownTier(r: Rank | undefined): 0 | 1 | 2 | 3 {
  if (!r) return 0;
  return r.rank === 1 ? 1 : r.rank === 2 ? 2 : r.rank === 3 ? 3 : 0;
}

/**
 * 지금 **단독 1위**는 누구인가. 공동 1위면 null 이다.
 *
 * ⚠️ 판정이 두 벌이 되면 안 된다 — 무대의 카메라 흔들림과 "역전!" 글자가 **같은
 *    순간**에 나가야 하기 때문이다 (2026-09-07 사용자 결정). 그래서 둘 다 이 함수를 본다.
 * ⚠️ `p > best` 로 최대를 고르면 동률일 때 **먼저 나온 동물이 뽑힌다.** 그러면 두 마리가
 *    나란히 달리는 동안 목록 순서가 곧 선두가 되어, 아무 일도 없는데 화면이 흔들린다.
 */
export function soleLeader(
  positions: Partial<Record<AnimalCode, number>>,
  codes: readonly AnimalCode[]
): AnimalCode | null {
  let best = -Infinity, who: AnimalCode | null = null, ties = 0;
  for (const c of codes) {
    const v = positions[c];
    const p = typeof v === 'number' && isFinite(v) ? v : 0;
    if (p > best + EPS) { best = p; who = c; ties = 0; }
    else if (p > best - EPS) ties++;
  }
  return ties > 0 ? null : who;
}
