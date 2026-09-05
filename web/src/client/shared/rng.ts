/**
 * rng.ts — 화면이 쓰는 **시드 난수**. 아주 작다.
 *
 * ⚠️ `Math.random()` 을 쓰면 안 되는 자리가 있다. 경주의 중간 순위 흔들림이 그것이다 —
 *    TV 와 폰이 각자 굴리면 폰에서는 사자가 앞서고 TV 에서는 치타가 앞선다
 *    (MIGRATION §11-2). 같은 시드(판코드 + 라운드)로 같은 궤적이 나와야 한다.
 *
 * ⚠️ `src/game/rules.ts` 에는 시드 RNG 가 없다 — 거기는 `Rng` 를 **인자로 받는** 순수
 *    함수들이고, 시드를 만드는 쪽은 서버였다. 그래서 화면용으로 여기 따로 둔다.
 *    (클라이언트는 `src/game/` 에서 타입만 가져온다 — 규칙 코드를 브라우저로 끌고 오면
 *     정답 계산이 번들에 실려 개발자 도구로 읽힌다.)
 *
 * ⚠️ 암호에 쓰면 안 된다. 모둠 암호·교사 열쇠는 서버가 만든다.
 */

/** FNV-1a 32비트. 문자열 시드를 숫자로 바꾼다 */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * mulberry32. 같은 씨앗이면 브라우저·기기가 달라도 같은 수열이 나온다.
 * ⚠️ `Math.imul` 과 `>>> 0` 을 빼면 엔진마다 부동소수 반올림이 갈려서
 *    TV 와 폰이 다른 경주를 본다. 32비트 정수 연산으로 붙들어 두는 것이 핵심이다.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
