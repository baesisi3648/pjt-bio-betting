/**
 * gates.ts — 규칙 게이트 (`src/game/` 순수 함수).
 *
 * 여기가 RENEWAL §2 의 판정석이다. §2-1 의 조건 7가지, §2-2 의 힌트 30개와
 * 사기 라운드, 그리고 골인 동물 베팅 금지를 **각각** 검사한다.
 *
 * ⚠️ 앱스 스크립트판과의 대조(`test/parity.ts`)는 폐기했다 (2026-09-06).
 *    20칸 10라운드·힌트 30개로 규칙이 갈라졌으므로 대조할 것이 없다.
 *    그래서 "옮긴 게 맞나"를 봐 주던 방어가 사라졌다 — 그만큼 여기가 촘촘해야 한다.
 *
 * ⚠️ 무작위성은 전부 시드로 고정한다. `Math.random` 으로 300판을 돌리면
 *    깨지는 날 어떤 판에서 깨졌는지 다시 못 만든다.
 *
 *   node test/gates.ts
 */

import {
  planRace, positionsAtRound, rankByPosition, leaderSequence,
  buildHintPlan, buildHints, buildHintPredicates, buildFraudRound,
  enumerateHintSpecs, hintText, hintPredicate, hintTemplateIds, countTop3Candidates,
  computeOdds, validateBet, settle, planQuestions, makeCode, makeHostKey
} from '../src/game/rules.ts';
import type { HintPredicate } from '../src/game/rules.ts';
import { ANIMAL_CODES, DEFAULTS, LEVELS, ROUNDS } from '../src/game/config.ts';
import type { AnimalCode, Level } from '../src/game/config.ts';
import type { Pool, Positions, Question, Race, Rng } from '../src/game/types.ts';

const TRACK = DEFAULTS.trackCells;          // 20
let pass = 0, fail = 0;

function gate(id: string, title: string, fn: () => { ok: boolean; detail: string }) {
  let ok = false, detail = '';
  try { const r = fn(); ok = r.ok; detail = r.detail; }
  catch (e) { ok = false; detail = 'ERROR ' + (e as Error).message; }
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(10)} ${title}\n             ${detail}`);
}

/** 시드 고정 난수 (mulberry32). 깨진 판을 그대로 다시 만들 수 있어야 한다 */
function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seedPool = (): Pool => {
  const p = {} as Pool;
  for (const c of ANIMAL_CODES) p[c] = DEFAULTS.seedCoins;
  return p;
};

const ANIMAL_NAMES: Partial<Record<AnimalCode, string>> = {
  A: '치타', B: '사자', C: '호랑이', D: '늑대', E: '얼룩말', F: '타조', G: '개구리', H: '거북이'
};

// ── 판 300개 (시드 1~300) ──────────────────────────────────

const N = 300;
const races: Race[] = [];
const badSeeds: number[] = [];
for (let s = 1; s <= N; s++) {
  const r = planRace(seeded(s), TRACK, ROUNDS);
  if (!r) { badSeeds.push(s); continue; }
  races.push(r);
}
const finalPos = races.map((r) => positionsAtRound(r.moves, ROUNDS, TRACK));

console.log(`\n=== 규칙 게이트 (${TRACK}칸 · ${ROUNDS}라운드 · 시드 1~${N}) ===\n`);

// ════════════════════════════════════════════════════════════
// RACE — RENEWAL §2-1 의 조건 7가지를 **각각**
// ════════════════════════════════════════════════════════════

gate('RACE-0', `${N}개 시드 전부에서 경주가 만들어진다`, () => ({
  ok: badSeeds.length === 0 && races.length === N,
  detail: badSeeds.length ? `⛔ 실패한 시드 ${badSeeds.slice(0, 10).join(',')} (총 ${badSeeds.length}개)`
                          : `${races.length}판 · planRace 는 안에서 다시 굴린다 (LIMITS.reverseAttempts)`
}));

gate('RACE-1', '조건 1 — 10라운드 끝 순위 = 정답 순위 (truth)', () => {
  let hit = 0;
  const uniq = new Set<string>();
  races.forEach((r, i) => {
    uniq.add(r.truth.join(''));
    if (rankByPosition(finalPos[i]!, r.truth).join('') === r.truth.join('')) hit++;
  });
  return { ok: hit === races.length, detail: `${hit}/${races.length} 일치 · 서로 다른 정답 순위 ${uniq.size}가지` };
});

gate('RACE-2', '조건 2 — 이동량은 라운드마다 0~3, 길이는 10', () => {
  let bad = 0, lenBad = 0;
  for (const r of races) for (const c of ANIMAL_CODES) {
    if (r.moves[c].length !== ROUNDS) lenBad++;
    for (const m of r.moves[c]) if (!Number.isInteger(m) || m < 0 || m > 3) bad++;
  }
  return { ok: bad === 0 && lenBad === 0, detail: `범위 밖 ${bad}개 · 길이가 ${ROUNDS} 아닌 줄 ${lenBad}개` };
});

gate('RACE-3', '조건 3 — 1위는 8 또는 9라운드에 골인하고 그 뒤로는 0칸', () => {
  const seen: Record<number, number> = {};
  const bad: string[] = [];
  races.forEach((r, i) => {
    const first = r.truth[0]!;
    const at = r.finishRound[first];
    if (at !== 8 && at !== 9) { bad.push(`시드${i + 1} 골인 ${String(at)}R`); return; }
    seen[at] = (seen[at] || 0) + 1;
    // 그 라운드에 정확히 결승선에 닿고, 그 전에는 못 미치고, 그 뒤로는 안 움직인다
    const on = positionsAtRound(r.moves, at, TRACK)[first]!;
    const before = positionsAtRound(r.moves, at - 1, TRACK)[first]!;
    if (on !== TRACK || before >= TRACK) bad.push(`시드${i + 1} ${before}→${on}칸`);
    for (let k = at; k < ROUNDS; k++) if (r.moves[first]![k] !== 0) bad.push(`시드${i + 1} 골인 뒤 이동`);
  });
  return { ok: bad.length === 0, detail: bad.length ? '⛔ ' + bad.slice(0, 4).join(', ') : `8R ${seen[8] || 0}판 · 9R ${seen[9] || 0}판 (둘 다 나온다)` };
});

gate('RACE-4', '조건 4 — 2위 ≥ 1위, 3위 ≥ 2위, lastRound = 3위 골인 라운드(9|10)', () => {
  const seen: Record<number, number> = {};
  const bad: string[] = [];
  races.forEach((r, i) => {
    const [a, b, c] = [r.finishRound[r.truth[0]!], r.finishRound[r.truth[1]!], r.finishRound[r.truth[2]!]];
    if (a == null || b == null || c == null) { bad.push(`시드${i + 1} 골인 라운드 없음`); return; }
    if (!(b >= a && b <= ROUNDS && c >= b && c <= ROUNDS)) bad.push(`시드${i + 1} ${a}/${b}/${c}`);
    if (r.lastRound !== c || (c !== 9 && c !== 10)) bad.push(`시드${i + 1} lastRound ${r.lastRound} vs 3위 ${c}`);
    // 4~8위는 골인 라운드가 없다 (끝까지 못 들어온다)
    for (let k = 3; k < 8; k++) if (r.finishRound[r.truth[k]!] !== null) bad.push(`시드${i + 1} ${k + 1}위에 골인 라운드`);
    seen[r.lastRound] = (seen[r.lastRound] || 0) + 1;
  });
  return { ok: bad.length === 0, detail: bad.length ? '⛔ ' + bad.slice(0, 4).join(', ') : `lastRound 9R ${seen[9] || 0}판 · 10R ${seen[10] || 0}판 · 4~8위 골인 라운드 전부 null` };
});

gate('RACE-5', '조건 5 — 4~8위는 결승선 미만이고 서로 다른 칸에 선다', () => {
  const bad: string[] = [];
  races.forEach((r, i) => {
    const tail = [3, 4, 5, 6, 7].map((k) => finalPos[i]![r.truth[k]!]!);
    if (tail.some((p) => p >= TRACK)) bad.push(`시드${i + 1} 골인 ${tail.join(',')}`);
    if (new Set(tail).size !== 5) bad.push(`시드${i + 1} 겹침 ${tail.join(',')}`);
    // 순위대로 내림차순이라야 화면의 줄 순서와 정답 순위가 맞는다
    for (let k = 1; k < 5; k++) if (tail[k]! >= tail[k - 1]!) bad.push(`시드${i + 1} 역전 ${tail.join(',')}`);
  });
  return { ok: bad.length === 0, detail: bad.length ? '⛔ ' + bad.slice(0, 3).join(', ') : `${races.length}판 × 5마리 — 겹침 0건, 전부 ${TRACK}칸 미만` };
});

gate('RACE-6', '조건 6 — 선두가 2번 이상 바뀌고, 1위는 4라운드 이후에 처음 선두', () => {
  const bad: string[] = [];
  let minChanges = 99, minFirst = 99;
  const sample: string[] = [];
  races.forEach((r, i) => {
    const L = leaderSequence(r.moves, r.truth, TRACK, ROUNDS);
    let ch = 0;
    for (let k = 1; k < L.length; k++) if (L[k] !== L[k - 1]) ch++;
    const first = L.indexOf(r.truth[0]!) + 1;
    if (ch < 2) bad.push(`시드${i + 1} 선두 교체 ${ch}회`);
    if (first < 4) bad.push(`시드${i + 1} 1위가 ${first}R 부터 선두`);
    minChanges = Math.min(minChanges, ch);
    minFirst = Math.min(minFirst, first);
    if (i < 2) sample.push(L.join('→'));
  });
  return { ok: bad.length === 0, detail: bad.length ? '⛔ ' + bad.slice(0, 4).join(', ')
    : `최소 교체 ${minChanges}회 · 1위의 첫 선두 최소 ${minFirst}R · 예: ${sample[0]}` };
});

gate('RACE-7', '조건 7 — 같은 시드면 같은 판 (다른 시드면 다른 판)', () => {
  const same = [1, 42, 300].every((s) =>
    JSON.stringify(planRace(seeded(s), TRACK, ROUNDS)) === JSON.stringify(planRace(seeded(s), TRACK, ROUNDS)));
  const differ = JSON.stringify(races[0]) !== JSON.stringify(races[1]);
  return { ok: same && differ, detail: `시드 1·42·300 재현 ${same} · 다른 시드는 다른 판 ${differ}` };
});

gate('RACE-TRK', '트랙칸수 설정이 실제로 반영된다 (5~26칸)', () => {
  const bad: string[] = [];
  for (const t of [5, 8, 14, 20, 26]) {
    const r = planRace(seeded(t * 7), t, ROUNDS);
    if (!r) { bad.push(`${t}칸 실패`); continue; }
    const pos = positionsAtRound(r.moves, ROUNDS, t);
    if (pos[r.truth[0]!] !== t) bad.push(`${t}칸: 1위가 ${pos[r.truth[0]!]}칸`);
    if (rankByPosition(pos, r.truth).join('') !== r.truth.join('')) bad.push(`${t}칸: 순위 불일치`);
  }
  // 범위 밖(설정 4~30 안이지만 경주가 성립하지 않는 값)은 조용히 넘어가지 않고 null 이다
  const tooNarrow = planRace(seeded(1), 4, ROUNDS);   // 4~8위 5마리를 서로 다른 칸에 못 세운다
  const tooWide = planRace(seeded(1), 28, ROUNDS);    // 전원이 매 라운드 3칸이라 선두가 안 바뀐다
  return { ok: bad.length === 0 && tooNarrow === null && tooWide === null,
           detail: bad.length ? '⛔ ' + bad.join(', ')
             : `5·8·14·20·26칸 전부 1위가 결승선 도달 · 4칸/28칸은 null (Room 이 이유를 말한다)` };
});

// ════════════════════════════════════════════════════════════
// HINT — RENEWAL §2-2
// ════════════════════════════════════════════════════════════

/**
 * 문장 → 논리식 지도. **만들 수 있는 문장 전부**(600줄 남짓)를 미리 굽는다.
 *
 * 판에 저장된 `hintPool` 은 문장뿐이라, 그것이 참인지 보려면 논리식이 필요하다.
 * 여기서 비슷한 판정 코드를 새로 쓰면 게이트가 **사본**을 검사하게 되므로
 * (MIGRATION §5) 진짜 틀 표(rules.TEMPLATES)에서 나온 spec 만 쓴다.
 */
function predicateMap(names?: Partial<Record<AnimalCode, string>>): Map<string, HintPredicate> {
  const m = new Map<string, HintPredicate>();
  for (const spec of enumerateHintSpecs()) m.set(hintText(spec, names), hintPredicate(spec));
  return m;
}
const PREDS = predicateMap(ANIMAL_NAMES);

gate('HINT-30', '난이도별 10개 · 30문장 전부 다름 · 참 힌트는 truth 에서 참', () => {
  const bad: string[] = [];
  let checked = 0;
  for (let s = 1; s <= 60; s++) {
    const r = races[s - 1]!;
    const plan = buildHintPlan(r.truth, ANIMAL_NAMES, seeded(9000 + s), {});
    const all: string[] = [];
    for (const lv of LEVELS) {
      if (plan.texts[lv].length !== ROUNDS) bad.push(`시드${s} ${lv} ${plan.texts[lv].length}개`);
      if (plan.predicates[lv].length !== plan.texts[lv].length) bad.push(`시드${s} ${lv} 문장·논리식 개수 불일치`);
      all.push(...plan.texts[lv]);
      plan.predicates[lv].forEach((p, i) => {
        checked++;
        if (!p(r.truth)) bad.push(`시드${s} ${lv}#${i} 거짓`);
        // ⚠️ 문장과 논리식이 정말 짝인가 — 문장에서 되찾은 논리식과 판정이 같아야 한다
        const back = PREDS.get(plan.texts[lv][i]!);
        if (!back) bad.push(`시드${s} ${lv}#${i} 되찾을 수 없는 문장`);
        else if (back(r.truth) !== p(r.truth)) bad.push(`시드${s} ${lv}#${i} 문장·논리식 어긋남`);
      });
    }
    if (new Set(all).size !== 30) bad.push(`시드${s} 중복 문장 ${30 - new Set(all).size}개`);
  }
  return { ok: bad.length === 0, detail: bad.length ? '⛔ ' + bad.slice(0, 4).join(', ')
    : `60판 × 30문장 = ${checked}개 전부 참 · 문장 중복 0건 · 문장↔논리식 짝 확인` };
});

gate('HINT-MEAN', '15종 틀의 **문장과 논리식이 같은 뜻인가** — 손으로 적은 정답표와 대조', () => {
  // ⚠️ 이 게이트만이 "문장은 그대로인데 논리식이 바뀌었다"를 잡는다.
  //    다른 힌트 게이트는 전부 rules.ts 의 틀 표에서 논리식을 가져오므로,
  //    표 안에서 문장과 논리식이 함께 어긋나면 **아무도 눈치채지 못한다**.
  //    `parity.ts`(앱스 스크립트판 대조)가 사라진 자리를 메우는 것이 여기다.
  //    문장을 고치면 이 표의 문자열도 같이 고쳐야 한다 — 그게 이 게이트의 값이다.
  //
  //    정답 순위는 A > B > C > D > E > F > G > H (A가 1등, H가 8등). 이름은 안 붙인다
  const T = [...ANIMAL_CODES] as AnimalCode[];
  type Row = [string, AnimalCode[], number | undefined, string, boolean];
  const table: Row[] = [
    ['top4',         ['C'],           undefined, 'C는 1~4등 안에 듭니다.', true],
    ['top4',         ['E'],           undefined, 'E는 1~4등 안에 듭니다.', false],
    ['below5',       ['E'],           undefined, 'E는 1~4등 안에 들지 못합니다.', true],
    ['below5',       ['D'],           undefined, 'D는 1~4등 안에 들지 못합니다.', false],
    ['notFirst',     ['B'],           undefined, 'B는 1등이 아닙니다.', true],
    ['notFirst',     ['A'],           undefined, 'A는 1등이 아닙니다.', false],
    ['notLast',      ['G'],           undefined, 'G는 꼴찌가 아닙니다.', true],
    ['notLast',      ['H'],           undefined, 'H는 꼴찌가 아닙니다.', false],
    ['eitherTop3',   ['D', 'C'],      undefined, 'D와 C 중 적어도 하나는 1·2·3등 안에 듭니다.', true],
    ['eitherTop3',   ['D', 'E'],      undefined, 'D와 E 중 적어도 하나는 1·2·3등 안에 듭니다.', false],
    ['ahead',        ['B', 'F'],      undefined, 'B는 F보다 앞입니다.', true],
    ['ahead',        ['F', 'B'],      undefined, 'F는 B보다 앞입니다.', false],
    ['aheadBoth',    ['B', 'D', 'E'], undefined, 'B는 D와 E 둘 다보다 앞입니다.', true],
    ['aheadBoth',    ['D', 'B', 'E'], undefined, 'D는 B와 E 둘 다보다 앞입니다.', false],
    ['gap3',         ['A', 'D'],      undefined, 'A와 D는 등수 차이가 3 이상입니다.', true],
    ['gap3',         ['A', 'C'],      undefined, 'A와 C는 등수 차이가 3 이상입니다.', false],
    ['oneBetween',   ['A', 'C'],      undefined, 'A와 C 사이에 정확히 한 마리가 있습니다.', true],
    ['oneBetween',   ['A', 'B'],      undefined, 'A와 B 사이에 정확히 한 마리가 있습니다.', false],
    ['neitherFirst', ['B', 'C'],      undefined, '1등은 B도 C도 아닙니다.', true],
    ['neitherFirst', ['A', 'B'],      undefined, '1등은 A도 B도 아닙니다.', false],
    ['firstIsOneOf', ['A', 'D'],      undefined, '1등은 A 또는 D입니다.', true],
    ['firstIsOneOf', ['B', 'C'],      undefined, '1등은 B 또는 C입니다.', false],
    ['second3',      ['B'],           undefined, 'B는 2등 또는 3등입니다.', true],
    ['second3',      ['D'],           undefined, 'D는 2등 또는 3등입니다.', false],
    ['justAhead',    ['B', 'C'],      undefined, 'B는 C 바로 앞입니다.', true],
    ['justAhead',    ['B', 'D'],      undefined, 'B는 D 바로 앞입니다.', false],
    ['bothTop3',     ['A', 'C'],      undefined, '1·2·3등 안에 A와 C가 모두 있습니다.', true],
    ['bothTop3',     ['A', 'D'],      undefined, '1·2·3등 안에 A와 D가 모두 있습니다.', false],
    ['exactRank',    ['E'],           5,         'E는 정확히 5등입니다.', true],
    ['exactRank',    ['D'],           5,         'D는 정확히 5등입니다.', false]
  ];

  const bad: string[] = [];
  for (const [tpl, args, n, text, want] of table) {
    const spec = { level: '쉬움' as Level, tpl, args, ...(n === undefined ? {} : { n }) };
    const got = hintText(spec);
    if (got !== text) bad.push(`${tpl} 문장 "${got}" ≠ "${text}"`);
    const v = hintPredicate(spec)(T);
    if (v !== want) bad.push(`${tpl}(${args.join(',')}) 논리식 ${v} ≠ ${want}`);
  }
  // 15종을 하나도 빼먹지 않았는가 (틀을 더하고 표를 안 고치면 여기서 걸린다)
  const covered = new Set(table.map((r) => r[0]));
  const all = LEVELS.flatMap((lv) => hintTemplateIds(lv));
  for (const id of all) if (!covered.has(id)) bad.push(`표에 없는 틀 ${id}`);

  return { ok: bad.length === 0, detail: bad.length ? '⛔ ' + bad.join(' / ')
    : `${all.length}종 × (참·거짓) ${table.length}줄 — 문장과 판정이 손으로 적은 표와 일치` };
});

gate('HINT-HARD', '어려움 10개만으로는 1·2·3등이 확정되지 않는다', () => {
  const bad: string[] = [];
  let minCand = 99999;
  for (let s = 1; s <= 100; s++) {
    const r = races[s - 1]!;
    const plan = buildHintPlan(r.truth, ANIMAL_NAMES, seeded(4000 + s), {});
    // limit 3 → 4가지를 찾으면 멈춘다. 1가지면 그 판은 어려움만 계속 골라 정답을 딴다
    const n = countTop3Candidates(plan.predicates['어려움'], 3);
    if (n < 2) bad.push(`시드${s} 후보 ${n}가지`);
    minCand = Math.min(minCand, n);
  }
  return { ok: bad.length === 0, detail: bad.length ? '⛔ ' + bad.slice(0, 5).join(', ')
    : `100판 전부 1·2·3등 후보가 2가지 이상 (가장 좁은 판도 ${minCand}가지)` };
});

gate('HINT-TPL', '난이도마다 5종 틀을 전부 최소 한 번 쓴다', () => {
  const bad: string[] = [];
  const spread: Record<string, number> = {};
  for (let s = 1; s <= 60; s++) {
    const plan = buildHintPlan(races[s - 1]!.truth, ANIMAL_NAMES, seeded(5000 + s), {});
    for (const lv of LEVELS) {
      const want = hintTemplateIds(lv);
      const used = new Set(plan.specs[lv].map((x) => x.tpl));
      for (const id of plan.specs[lv].map((x) => x.tpl)) spread[id] = (spread[id] || 0) + 1;
      const missing = want.filter((id) => !used.has(id));
      if (want.length !== 5) bad.push(`${lv} 틀이 ${want.length}종`);
      if (missing.length) bad.push(`시드${s} ${lv} 안 쓴 틀 ${missing.join(',')}`);
    }
  }
  const counts = Object.keys(spread).length;
  return { ok: bad.length === 0, detail: bad.length ? '⛔ ' + bad.slice(0, 4).join(', ')
    : `60판 × 3난이도 × 5종 전부 등장 · 쓰인 틀 ${counts}종 (전체 15종 중)` };
});

gate('HINT-N', "어려움 '정확히 n등' 의 n 은 4~8 뿐 (1·2·3등을 그냥 주지 않는다)", () => {
  const ns = new Set<number>();
  const bad: string[] = [];
  for (let s = 1; s <= 100; s++) {
    const plan = buildHintPlan(races[s - 1]!.truth, ANIMAL_NAMES, seeded(6000 + s), {});
    for (const spec of plan.specs['어려움']) {
      if (spec.tpl !== 'exactRank') continue;
      ns.add(spec.n!);
      if (spec.n! < 4 || spec.n! > 8) bad.push(`시드${s} ${spec.n}등`);
    }
  }
  return { ok: bad.length === 0 && ns.size > 0,
           detail: bad.length ? '⛔ ' + bad.join(', ') : `쓰인 등수 ${[...ns].sort().join(',')}` };
});

// ════════════════════════════════════════════════════════════
// FRAUD — 사기 라운드 (RENEWAL §1·§2-2)
// ════════════════════════════════════════════════════════════

gate('FRAUD-1', '사기 라운드의 3개만 거짓, 나머지 27개는 참', () => {
  const bad: string[] = [];
  for (let s = 1; s <= 100; s++) {
    const r = races[s - 1]!;
    const rng = seeded(7000 + s);
    const fraudRound = buildFraudRound(rng);
    const plan = buildHintPlan(r.truth, ANIMAL_NAMES, rng, { fraudRound });
    const idx = fraudRound - 1;
    let lies = 0, truths = 0;
    for (const lv of LEVELS) {
      plan.texts[lv].forEach((text, i) => {
        // ⚠️ 저장되는 것은 문장이다. 그 문장에서 되찾은 논리식으로 판정한다 —
        //    plan.predicates 로만 보면 "치환은 안 됐는데 논리식만 바뀐" 판을 놓친다
        const p = PREDS.get(text);
        if (!p) { bad.push(`시드${s} ${lv}#${i} 되찾을 수 없는 문장`); return; }
        const v = p(r.truth);
        if (i === idx) { if (v) bad.push(`시드${s} ${lv} ${fraudRound}R 이 참`); else lies++; }
        else { if (!v) bad.push(`시드${s} ${lv}#${i} 가 거짓`); else truths++; }
      });
    }
    if (lies !== 3 || truths !== 27) bad.push(`시드${s} 거짓 ${lies}개 / 참 ${truths}개`);
  }
  return { ok: bad.length === 0, detail: bad.length ? '⛔ ' + bad.slice(0, 4).join(', ')
    : '100판 전부 — 그 라운드 3개만 거짓, 나머지 27개는 참' };
});

gate('FRAUD-2', '사기 라운드는 2·3·4 중 하나이고, 셋 다 나온다', () => {
  const seen: Record<number, number> = {};
  const bad: number[] = [];
  for (let s = 1; s <= 300; s++) {
    const n = buildFraudRound(seeded(8000 + s));
    seen[n] = (seen[n] || 0) + 1;
    if (n !== 2 && n !== 3 && n !== 4) bad.push(n);
  }
  return { ok: bad.length === 0 && [2, 3, 4].every((n) => (seen[n] || 0) > 0),
           detail: bad.length ? `⛔ 범위 밖 ${bad.slice(0, 5).join(',')}` : `2R ${seen[2]}회 · 3R ${seen[3]}회 · 4R ${seen[4]}회 (300회)` };
});

gate('FRAUD-3', '스위치를 끄면 30개 전부 참이고 fraudRound 는 null', () => {
  const bad: string[] = [];
  for (let s = 1; s <= 60; s++) {
    const r = races[s - 1]!;
    const plan = buildHintPlan(r.truth, ANIMAL_NAMES, seeded(9500 + s), { fraudRound: null });
    if (plan.fraudRound !== null) bad.push(`시드${s} fraudRound=${String(plan.fraudRound)}`);
    for (const lv of LEVELS) plan.texts[lv].forEach((t, i) => {
      const p = PREDS.get(t);
      if (!p || !p(r.truth)) bad.push(`시드${s} ${lv}#${i}`);
    });
  }
  return { ok: bad.length === 0, detail: bad.length ? '⛔ ' + bad.slice(0, 4).join(', ') : '60판 × 30문장 전부 참 · fraudRound null' };
});

gate('HINT-PAIR', 'buildHints 와 buildHintPredicates 는 같은 시드에서 인덱스가 짝', () => {
  const r = races[0]!;
  const texts = buildHints(r.truth, ANIMAL_NAMES, seeded(31), { fraudRound: 3 });
  const preds = buildHintPredicates(r.truth, ANIMAL_NAMES, seeded(31), { fraudRound: 3 });
  const bad: string[] = [];
  for (const lv of LEVELS) {
    if (texts[lv].length !== preds[lv].length) bad.push(`${lv} 길이`);
    texts[lv].forEach((t, i) => {
      const back = PREDS.get(t);
      if (!back || back(r.truth) !== preds[lv][i]!(r.truth)) bad.push(`${lv}#${i}`);
    });
  }
  return { ok: bad.length === 0, detail: bad.length ? '⛔ ' + bad.join(', ') : '30줄 전부 문장과 논리식의 판정이 같다' };
});

// ════════════════════════════════════════════════════════════
// 베팅 · 배당 · 정산 · 문항
// ════════════════════════════════════════════════════════════

gate('BET-FIN', '골인한 동물에는 못 걸고, 다른 동물은 그대로 통과', () => {
  const base = { coins: 20, betLocked: {} as Record<number, boolean> };
  const pos = {} as Positions;
  for (const c of ANIMAL_CODES) pos[c] = 3;
  pos.A = TRACK;             // 골인
  pos.B = TRACK + 5;         // 넘어선 값이 들어와도 (positionsAtRound 는 클램프하지만)

  const finished = validateBet(base, 1, { A: 1 }, DEFAULTS, pos);
  const beyond = validateBet(base, 1, { B: 1 }, DEFAULTS, pos);
  const mixed = validateBet(base, 1, { C: 1, A: 1 }, DEFAULTS, pos);
  const okBet = validateBet(base, 1, { C: 2 }, DEFAULTS, pos);
  const zero = validateBet(base, 1, { A: 0, C: 1 }, DEFAULTS, pos);   // 0 은 거는 게 아니다
  const notYet = validateBet(base, 1, { A: 1 }, DEFAULTS, { ...pos, A: TRACK - 1 });

  const codes = [finished, beyond, mixed].map((x) => (x.ok ? 'ok' : x.error)).join('/');
  return {
    ok: codes === 'BET_FINISHED/BET_FINISHED/BET_FINISHED' && okBet.ok && zero.ok && notYet.ok,
    detail: `골인·초과·섞어 걸기 ${codes} · 안 골인한 동물은 통과 · ${TRACK - 1}칸이면 아직 걸 수 있다`
  };
});

gate('BET-RULE', '베팅 규칙(코인·중복·소수)을 서버가 막는다', () => {
  const pos = {} as Positions;
  for (const c of ANIMAL_CODES) pos[c] = 0;
  const base = { coins: 20, betLocked: {} as Record<number, boolean> };
  const a = validateBet(base, 1, { A: 4 }, DEFAULTS, pos);
  const b = validateBet({ coins: 1, betLocked: {} }, 1, { A: 2 }, DEFAULTS, pos);
  const c = validateBet({ coins: 20, betLocked: { 1: true } }, 1, { A: 1 }, DEFAULTS, pos);
  const d = validateBet(base, 1, { A: 1.5 }, DEFAULTS, pos);
  const e = validateBet(base, 1, { Z: 1 } as never, DEFAULTS, pos);
  const okBet = validateBet(base, 1, { A: 2 }, DEFAULTS, pos);
  const errs = [a, b, c, d, e].map((x) => (x.ok ? 'ok' : x.error));
  return { ok: errs.join('/') === 'TOO_MANY_COINS/NOT_ENOUGH_COINS/ALREADY_BET/BAD_AMOUNT/BAD_ANIMAL' && okBet.ok,
           detail: errs.join(' / ') + ' · 정상 베팅은 ' + (okBet.ok ? '통과' : '거부') };
});

gate('D1', '3라운드까지 골인한 동물이 없다 (1위가 8R 이후에 들어온다)', () => {
  let bad = 0;
  for (const r of races) {
    const pos = positionsAtRound(r.moves, 3, TRACK);
    for (const c of ANIMAL_CODES) if (pos[c] >= TRACK) bad++;
  }
  return { ok: bad === 0, detail: `${races.length}판 × 3라운드 — 골인한 동물 ${bad}마리` };
});

gate('H9', '정산 계산', () => {
  const order = ['C', 'A', 'F', 'B', 'H', 'D', 'G', 'E'] as AnimalCode[];
  const odds = { C: 2, A: 2.14, F: 4, B: 5, H: 3, D: 3, G: 3, E: 3 } as Record<AnimalCode, number>;
  const out = settle([{ no: 1, name: 'A', coins: 8, bets: { 1: { A: 4 }, 2: { D: 2 } } }], order, odds, DEFAULTS);
  return { ok: out[0]!.gained === 6 && out[0]!.finalCoins === 14,
           detail: `획득 ${out[0]!.gained} (기대 6), 최종 ${out[0]!.finalCoins} (기대 14)` };
});

gate('M6', '최대 배당률이 16배 이하 (시드 15)', () => {
  const pool = seedPool();
  pool.A += 108;
  const o = computeOdds(pool);
  let max = 0;
  for (const c of ANIMAL_CODES) if (o[c] > max) max = o[c];
  return { ok: max <= 16, detail: `최대 ${max}배` };
});

gate('M6b', '시드가 0이어도 배당률이 NaN 이 되지 않는다', () => {
  const zero = {} as Pool; for (const c of ANIMAL_CODES) zero[c] = 0;
  const one = {} as Pool; for (const c of ANIMAL_CODES) one[c] = 0; one.A = 5;
  const o1 = computeOdds(zero), o2 = computeOdds(one);
  const finite = (v: Record<string, number>) => Object.values(v).every((x) => isFinite(x));
  return { ok: finite(o1) && finite(o2), detail: `전부 0 → ${o1.A}배 / A에만 5 → A ${o2.A}배, B ${o2.B}배` };
});

gate('D5b', `문항이 모자라면 순환 재사용 (${ROUNDS}라운드 분을 배정한다)`, () => {
  const q = (id: number, level: Level): Question =>
    ({ id, setName: 'X', level, text: 't', choices: ['1', '2', '3', '4'], answer: 1, explanation: '' });
  const plan = planQuestions({ '쉬움': [q(1, '쉬움'), q(2, '쉬움')] }, ROUNDS, () => 0);
  const seq = Array.from({ length: ROUNDS }, (_, i) => plan[i + 1]!['쉬움']);
  const cycles = seq.every((v, i) => v === seq[i % 2]);
  // 문항이 없는 난이도는 null 로 채워 둔다 (라운드가 비면 화면이 무한 대기한다)
  const empty = planQuestions({}, ROUNDS, () => 0);
  const allNull = LEVELS.every((lv) => Array.from({ length: ROUNDS }, (_, i) => empty[i + 1]![lv]).every((v) => v === null));
  return { ok: cycles && Object.keys(plan).length === ROUNDS && allNull,
           detail: `배정 ${seq.join(',')} (2개를 순환) · ${Object.keys(plan).length}라운드 분 · 빈 난이도는 전부 null` };
});

gate('CODE', '판 코드에 혼동 문자(0 O 1 I) 없음', () => {
  let bad = 0;
  for (let i = 0; i < 500; i++) if (/[0O1I]/.test(makeCode())) bad++;
  return { ok: bad === 0, detail: `500회 중 ${bad}회 등장` };
});

gate('KEY', '교사 열쇠가 판 코드보다 충분히 길다', () => {
  const k = makeHostKey();
  return { ok: k.length === 12 && !/[0O1I]/.test(k), detail: `${k.length}자리 — 경우의 수 32^12` };
});

// ── 사람이 읽어 보는 표본 (게이트가 아니라 눈으로 확인하는 자리) ──
{
  const r = races[0]!;
  const plan = buildHintPlan(r.truth, ANIMAL_NAMES, seeded(11), { fraudRound: 3 });
  console.log('\n  ── 표본 (시드 1 · 사기 3라운드) ──');
  console.log('  정답 순위: ' + r.truth.map((c) => ANIMAL_NAMES[c]).join(' > '));
  for (const lv of LEVELS) {
    console.log(`  [${lv}]`);
    plan.texts[lv].forEach((t, i) => {
      const p = PREDS.get(t)!;
      console.log(`    ${String(i + 1).padStart(2)}R ${p(r.truth) ? ' ' : '✖'} ${t}`);
    });
  }
}

console.log('\n====================================================');
console.log(`규칙 게이트 — 통과 ${pass} / 실패 ${fail}`);
console.log('====================================================\n');
if (fail) process.exit(1);
