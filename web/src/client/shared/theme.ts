/**
 * theme.ts — 색값 **한 벌**. `05-design-system.md` §2 와 `shared/base.css` 의 사본이다.
 *
 * ⚠️ 사본을 만드는 것은 이 코드베이스가 여러 번 데인 함정이다 (MIGRATION §5).
 *    그런데 캔버스(PixiJS 무대·폰 미니 트랙)는 CSS 변수를 읽지 못하고 숫자만 받는다.
 *    그래서 **여기 한 곳**에만 두고 캔버스를 그리는 모든 곳이 여기서 가져간다.
 *    base.css / teacher.css 의 값을 바꾸면 여기도 같이 바꿔야 한다.
 *
 * ⚠️ 레인 색은 `teacher.css` 의 `.s0`~`.s7` 과 **순서까지 같아야 한다.**
 *    CSS 트랙(폴백)과 무대가 같은 말에 다른 색을 주면, 접근성 설정을 켠 순간
 *    학생들이 외운 "파란 2번" 이 다른 색이 된다.
 */

export const C = {
  bg: 0x0f1720,
  card: 0x1b2734,
  text: 0xe8edf2,
  muted: 0x7a8a99,
  gold: 0xf2b441,
  run: 0x4fc3f7,
  goal: 0xef5350,
  ok: 0x66bb6a,
  lane: 0x1e2c3a,
  laneDark: 0x16212c,
  grid: 0x2a3b4b
} as const;

/** 레인 배지 색. teacher.css .s0~.s7 과 같은 순서 */
export const SILK = [0xf2b441, 0x4fc3f7, 0x8bc34a, 0xef5350, 0xba68c8, 0xff8a65, 0x4db6ac, 0xdce775];

/** 05-design-system §3 — 외부 글꼴을 부르지 않는다. 학교망에서 막히면 글자가 깨진다 */
export const FONT = 'system-ui, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';

export function silkOf(i: number): number {
  return SILK[i % SILK.length] as number;
}

/** #RRGGBB 문자열 — Canvas 2D(폰 미니 트랙)는 숫자를 못 받는다 */
export function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}
