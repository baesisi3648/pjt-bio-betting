/**
 * race.ts — 경주 안무(`src/client/shared/race.ts`) 게이트.
 *
 * 연출은 "그럴듯해 보인다"로 넘기기 제일 쉬운 자리다. 그런데 여기가 틀어지면
 * 교실에서 조용히 망가진다:
 *
 *   · 도착점이 서버 값과 다르면 → 화면의 순위와 힌트가 어긋난다 (MIGRATION §4-2)
 *   · 말이 뒤로 가면 → 학생이 본 것과 최종 위치가 모순된다
 *   · 시드가 안 먹으면 → TV 와 폰이 **다른 경주**를 본다 (§11-2). 이게 제일 무섭다.
 *     둘 다 그럴듯해 보이는데 서로 다르다
 *   · 등속이면 → 순위 흔들림이 사라져 연출을 넣은 이유가 없어진다
 *
 * 그래서 200개 시드 × t 100분할로 전부 훑는다.
 *
 *   node test/race.ts
 */

import { ANIMAL_CODES } from '../src/game/config.ts';
import type { AnimalCode } from '../src/game/config.ts';
import type { Positions } from '../src/game/types.ts';
import { COUNTDOWN_END, RUN_END, raceFrame, racePhase, raceSeed } from '../src/client/shared/race.ts';
import { mulberry32 } from '../src/client/shared/rng.ts';

let pass = 0, fail = 0;

function gate(id: string, title: string, fn: () => { ok: boolean; detail: string }) {
  let ok = false, detail = '';
  try { const r = fn(); ok = r.ok; detail = r.detail; }
  catch (e) { ok = false; detail = 'ERROR ' + (e as Error).message; }
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(11)} ${title}\n              ${detail}`);
}

// ────────────────────────────────────────────────────────────
// 판돈 — 서버가 만들 법한 이동 전/후 위치 200벌
// ────────────────────────────────────────────────────────────

const SEEDS = 200;
const STEPS = 100;          // t 를 100분할
const CELLS = 10;

interface Case { seed: string; before: Positions; after: Positions; moves: Record<AnimalCode, number> }

/** 이동량 0~3, 위치는 trackCells 에서 잘린다 — rules.positionsAtRound 와 같은 모양 */
function makeCase(i: number): Case {
  const rng = mulberry32(1000 + i);
  const before = {} as Positions;
  const after = {} as Positions;
  const moves = {} as Record<AnimalCode, number>;
  for (const c of ANIMAL_CODES) {
    const b = Math.floor(rng() * (CELLS - 1));
    // 이동량 0 이 섞여야 RACE-ZERO 가 의미가 있다. 서버도 0 을 낸다 (planRace)
    const m = Math.floor(rng() * 4);
    before[c] = b;
    moves[c] = Math.min(m, CELLS - b);
    after[c] = Math.min(CELLS, b + moves[c]);
  }
  return { seed: raceSeed('AB' + (i % 90 + 10), (i % 6) + 1), before, after, moves };
}

const CASES = Array.from({ length: SEEDS }, (_, i) => makeCase(i));

function ts(): number[] {
  return Array.from({ length: STEPS + 1 }, (_, k) => k / STEPS);
}

// ────────────────────────────────────────────────────────────

console.log('\n=== 경주 안무 게이트 (src/client/shared/race.ts) ===\n');

gate('RACE-PHASE', '3 : 15 : 2 로 잘린다 (카운트다운 · 질주 · 정착)', () => {
  const ok = racePhase(0) === 'countdown' && racePhase(0.14) === 'countdown' &&
    racePhase(COUNTDOWN_END) === 'running' && racePhase(0.89) === 'running' &&
    racePhase(RUN_END) === 'settle' && racePhase(1) === 'settle' &&
    Math.abs(COUNTDOWN_END - 0.15) < 1e-9 && Math.abs(RUN_END - 0.9) < 1e-9;
  return { ok, detail: `게이트 t=${COUNTDOWN_END} · 정착 t=${RUN_END}` };
});

gate('RACE-START', 't=0 이면 정확히 출발 위치 (카운트다운 동안 안 움직인다)', () => {
  let bad = 0, worst = '';
  for (const k of CASES) {
    for (const t of [0, 0.05, 0.1, COUNTDOWN_END - 1e-9]) {
      const f = raceFrame(k.seed, k.before, k.after, CELLS, t);
      for (const c of ANIMAL_CODES) {
        if (f[c] !== k.before[c]) { bad++; worst = `${k.seed} ${c} t=${t} ${f[c]} ≠ ${k.before[c]}`; }
      }
    }
  }
  return { ok: bad === 0, detail: bad ? `어긋남 ${bad}개 — ${worst}` : `${SEEDS}시드 × 8마리 전부 출발선에 서 있다` };
});

gate('RACE-END', 't≥정착이면 서버가 준 도착 위치 그대로 (정수)', () => {
  let bad = 0, worst = '';
  for (const k of CASES) {
    for (const t of [RUN_END, 0.93, 0.99, 1, 1.5]) {
      const f = raceFrame(k.seed, k.before, k.after, CELLS, t);
      for (const c of ANIMAL_CODES) {
        if (f[c] !== k.after[c]) { bad++; worst = `${k.seed} ${c} t=${t} ${f[c]} ≠ ${k.after[c]}`; }
      }
    }
  }
  return { ok: bad === 0, detail: bad ? `어긋남 ${bad}개 — ${worst}` : `${SEEDS}시드 × 8마리 전부 서버 값에 정확히 도착 (부동소수 오차 0)` };
});

gate('RACE-MONO', '말이 뒤로 가지 않는다', () => {
  let bad = 0, worst = '';
  const T = ts();
  for (const k of CASES) {
    const prev = {} as Record<AnimalCode, number>;
    for (const c of ANIMAL_CODES) prev[c] = -1;
    for (const t of T) {
      const f = raceFrame(k.seed, k.before, k.after, CELLS, t);
      for (const c of ANIMAL_CODES) {
        if (f[c] < prev[c] - 1e-12) { bad++; worst = `${k.seed} ${c} t=${t.toFixed(2)} ${prev[c]}→${f[c]}`; }
        prev[c] = f[c];
      }
    }
  }
  return { ok: bad === 0, detail: bad ? `뒷걸음 ${bad}회 — ${worst}` : `${SEEDS}시드 × 101분할 × 8마리 = ${SEEDS * 101 * 8}회 전부 단조 증가` };
});

gate('RACE-BOUND', '0 칸 ~ trackCells 칸을 넘지 않는다', () => {
  let bad = 0, worst = '';
  for (const cells of [4, 10, 12, 30]) {
    for (const k of CASES) {
      // 트랙 길이가 바뀌면 서버 위치도 그만큼 잘린다 — 같은 조건으로 다시 만든다
      const before = {} as Positions, after = {} as Positions;
      for (const c of ANIMAL_CODES) {
        before[c] = Math.min(k.before[c], cells);
        after[c] = Math.min(k.after[c], cells);
      }
      for (const t of ts()) {
        const f = raceFrame(k.seed, before, after, cells, t);
        for (const c of ANIMAL_CODES) {
          if (f[c] < 0 || f[c] > cells) { bad++; worst = `${cells}칸 ${c} t=${t.toFixed(2)} → ${f[c]}`; }
        }
      }
    }
  }
  return { ok: bad === 0, detail: bad ? `범위 밖 ${bad}회 — ${worst}` : '4·10·12·30칸 전부 범위 안' };
});

gate('RACE-DET', '같은 시드면 같은 궤적 / 다른 시드면 다른 궤적', () => {
  let same = 0, differs = 0;
  for (const k of CASES) {
    for (const t of [0.3, 0.5, 0.7]) {
      const a = raceFrame(k.seed, k.before, k.after, CELLS, t);
      const b = raceFrame(k.seed, k.before, k.after, CELLS, t);
      for (const c of ANIMAL_CODES) if (a[c] !== b[c]) same++;
    }
  }
  // 라운드가 다르면 안무도 달라야 한다 — 그래야 매 라운드가 같은 그림이 아니다
  const k0 = CASES[0] as Case;
  let anyDiff = false;
  for (const t of [0.3, 0.5, 0.7]) {
    const a = raceFrame('ZZZZ:1', k0.before, k0.after, CELLS, t);
    const b = raceFrame('ZZZZ:2', k0.before, k0.after, CELLS, t);
    for (const c of ANIMAL_CODES) if (Math.abs(a[c] - b[c]) > 1e-9) { anyDiff = true; differs++; }
  }
  return {
    ok: same === 0 && anyDiff,
    detail: `같은 시드 재현 어긋남 ${same}개 · 라운드 1↔2 갈리는 지점 ${differs}개`
  };
});

gate('RACE-ZERO', '이동량 0인 말은 위치가 한 번도 안 변한다', () => {
  let checked = 0, bad = 0, worst = '';
  for (const k of CASES) {
    for (const c of ANIMAL_CODES) {
      if (k.after[c] !== k.before[c]) continue;
      checked++;
      for (const t of ts()) {
        const f = raceFrame(k.seed, k.before, k.after, CELLS, t);
        if (f[c] !== k.before[c]) { bad++; worst = `${k.seed} ${c} t=${t.toFixed(2)} → ${f[c]}`; break; }
      }
    }
  }
  return {
    ok: bad === 0 && checked > 100,
    detail: bad ? `움직인 말 ${bad}마리 — ${worst}` : `제자리 말 ${checked}마리 전부 위치 고정 (몸 들썩임은 그리는 쪽 몫)`
  };
});

/** 어느 시각의 순위 (위치 내림차순, 동점은 코드 순) */
function rankAt(f: Record<AnimalCode, number>): string {
  return ANIMAL_CODES.slice().sort((a, b) => (f[b] - f[a]) || (a < b ? -1 : 1)).join('');
}

/** 질주 구간에서 순위가 몇 번 바뀌는가 */
function shakes(k: Case, linear: boolean): number {
  let prev = '', n = 0;
  for (let s = 0; s <= 60; s++) {
    const t = COUNTDOWN_END + (RUN_END - COUNTDOWN_END) * (s / 60);
    let f: Record<AnimalCode, number>;
    if (linear) {
      // 등속 보간 — "연출을 안 넣었을 때" 의 그림. 비교 기준이다
      f = {} as Record<AnimalCode, number>;
      const u = s / 60;
      for (const c of ANIMAL_CODES) f[c] = k.before[c] + (k.after[c] - k.before[c]) * u;
    } else {
      f = raceFrame(k.seed, k.before, k.after, CELLS, t);
    }
    const r = rankAt(f);
    if (prev && r !== prev) n++;
    prev = r;
  }
  return n;
}

/**
 * 한 쌍이 질주 중 앞뒤를 몇 번 바꾸는가(최대값).
 *
 * ⚠️ **등속 보간에서는 이 값이 1 을 넘을 수 없다.** 직선 두 개는 한 번밖에 안 만난다.
 *    그래서 2 이상이 나오면 그건 "A 가 치고 나갔다가 B 에게 되치기당했다" 는 뜻이고,
 *    연출을 넣기 전에는 절대 나올 수 없던 그림이다. 동점 구간은 순위가 없는 것으로 보고 건너뛴다
 *    — 안 그러면 두 말이 나란히 있는 동안 코드 순서로 정렬되며 가짜 교체가 잡힌다.
 */
function backAndForth(k: Case, linear: boolean): number {
  const N = 60;
  const frames: Record<AnimalCode, number>[] = [];
  for (let s = 0; s <= N; s++) {
    const u = s / N;
    if (linear) {
      const f = {} as Record<AnimalCode, number>;
      for (const c of ANIMAL_CODES) f[c] = k.before[c] + (k.after[c] - k.before[c]) * u;
      frames.push(f);
    } else {
      frames.push(raceFrame(k.seed, k.before, k.after, CELLS, COUNTDOWN_END + (RUN_END - COUNTDOWN_END) * u));
    }
  }
  let most = 0;
  for (let i = 0; i < ANIMAL_CODES.length; i++) {
    for (let j = i + 1; j < ANIMAL_CODES.length; j++) {
      const a = ANIMAL_CODES[i] as AnimalCode, b = ANIMAL_CODES[j] as AnimalCode;
      let prev = 0, turns = 0;
      for (const f of frames) {
        const d = f[a] - f[b];
        const s = d > 1e-9 ? 1 : d < -1e-9 ? -1 : 0;
        if (s === 0) continue;
        if (prev !== 0 && s !== prev) turns++;
        prev = s;
      }
      if (turns > most) most = turns;
    }
  }
  return most;
}

gate('RACE-SHAKE', '중간에 서로 앞서고 뒤처진다 (등속 보간이면 나올 수 없는 그림)', () => {
  let anyChange = 0, more = 0, mine = 0, lin = 0, mineTurn = 0, linTurn = 0;
  for (const k of CASES) {
    const a = shakes(k, false), b = shakes(k, true);
    mine += a; lin += b;
    if (a >= 1) anyChange++;
    if (a > b) more++;
    if (backAndForth(k, false) >= 2) mineTurn++;
    if (backAndForth(k, true) >= 2) linTurn++;
  }
  // ⚠️ SEGMENTS 를 1 로 되돌리거나 profile() 을 등속으로 만들면 이 게이트가 전부 무너진다.
  //    그게 이 게이트의 존재 이유다 — "말이 8마리 나란히 자라는 막대" 로 돌아간 것을 잡는다
  const ok = anyChange >= SEEDS * 0.9 &&        // 질주 중 순위가 최소 한 번 바뀌는 시드가 대부분
    more >= SEEDS * 0.75 &&                     // 등속보다 더 흔들리는 시드가 대부분
    mine >= lin * 1.8 &&                        // 합계로도 확실히 더
    mineTurn >= SEEDS * 0.35 && linTurn === 0;  // 되치기는 등속에서 원리상 0
  return {
    ok,
    detail: `순위가 바뀌는 시드 ${anyChange}/${SEEDS} · 등속보다 더 흔들림 ${more} · ` +
      `교체 합계 ${mine}(등속 ${lin}) · 되치기 있는 시드 ${mineTurn}(등속 ${linTurn})`
  };
});

gate('RACE-SEED', '시드는 판코드 + 라운드', () => {
  return { ok: raceSeed('2H4K', 3) === '2H4K:3', detail: raceSeed('2H4K', 3) };
});

console.log('\n====================================================');
console.log(`경주 안무 게이트 — 통과 ${pass} / 실패 ${fail}`);
console.log('====================================================\n');
if (fail) process.exit(1);
