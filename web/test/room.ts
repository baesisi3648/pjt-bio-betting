/**
 * room.ts — 방 코어(src/do/room.ts) 통합 게이트.
 *
 * 가짜 시계와 가짜 알람으로 Room 을 **DO 런타임 없이** 그대로 돌린다.
 * 그게 Room 이 런타임에 의존하지 않게 만든 이유다 — workerd 를 띄우지 않고도
 * 6모둠 × 6라운드 한 판을 통째로 돌려볼 수 있다.
 *
 * 게이트 이름은 앱스 스크립트판(test/simulate-game.js)에서 그대로 이어받았다.
 * 같은 이름이면 **같은 성질을 검사한다** — 어느 쪽이 깨졌는지 바로 대조할 수 있게.
 *
 *   node test/room.ts
 */

import { ANIMAL_CODES, DEFAULTS, LEVELS, PHASES } from '../src/game/config.ts';
import type { AnimalCode, Level } from '../src/game/config.ts';
import { computeOdds } from '../src/game/rules.ts';
import type { GameState, Question, Rng } from '../src/game/types.ts';
import { teacherView, teamView } from '../src/game/views.ts';
import { Room, restore } from '../src/do/room.ts';
import type { GameEvent } from '../src/do/room.ts';

// ────────────────────────────────────────────────────────────
// 판돈: 문제은행·동물 (5단계에서 D1 이 대신할 자리)
// ────────────────────────────────────────────────────────────

const QUESTIONS: Question[] = [];
{
  let id = 1;
  for (const lv of LEVELS) {
    for (let i = 1; i <= 6; i++) {
      QUESTIONS.push({
        id: id++, unit: '유전', level: lv, text: `${lv} 문제 ${i}`,
        choices: ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ'], answer: (i % 4) + 1, explanation: '해설'
      });
    }
  }
}

const ANIMAL_NAMES = ['치타', '사자', '호랑이', '늑대', '얼룩말', '타조', '개구리', '거북이'];
const ANIMALS = {
  names: {} as Record<AnimalCode, string>,
  emojis: {} as Record<AnimalCode, string>
};
ANIMAL_CODES.forEach((c, i) => { ANIMALS.names[c] = ANIMAL_NAMES[i]!; ANIMALS.emojis[c] = '🐎'; });

// ────────────────────────────────────────────────────────────
// 가짜 시계 · 가짜 알람
// ────────────────────────────────────────────────────────────

class Table {
  now = 1_767_225_600_000;          // 2026-01-01
  alarmAt: number | null = null;
  events: GameEvent[] = [];
  snapshots: GameState[] = [];
  changes = 0;
  room: Room;
  code = '';
  hostKey = '';
  pins: Record<number, string> = {};

  constructor(rng?: Rng) {
    this.room = new Room({
      now: () => this.now,
      setAlarm: (at) => { this.alarmAt = at; },
      persist: (s) => { this.snapshots.push(JSON.parse(JSON.stringify(s))); },
      appendEvent: (ev) => { this.events.push(ev); },
      changed: () => { this.changes++; },
      rng
    });
  }

  open(teamCount = 6, code = 'TST1') {
    const r = this.room.create(
      { code, className: '2학년 3반', unit: '유전', teamCount }, QUESTIONS, ANIMALS
    );
    if (!r.ok) throw new Error('판 생성 실패: ' + r.message);
    this.code = r.data.code; this.hostKey = r.data.hostKey; this.pins = r.data.pins;
    return r.data;
  }

  /**
   * 가짜 시계를 target 까지 밀면서, 도중에 걸린 알람을 순서대로 때린다.
   * 알람이 자기를 다시 걸기만 하면(= 일찍 깨어난 경우) 무한 반복이 되므로 가드를 둔다.
   */
  advanceTo(target: number) {
    let guard = 0;
    while (this.alarmAt !== null && this.alarmAt <= target) {
      if (guard++ > 200) throw new Error('알람이 끝없이 다시 걸린다');
      const at = this.alarmAt;
      this.alarmAt = null;
      this.now = Math.max(this.now, at);
      this.room.onAlarm();
    }
    this.now = Math.max(this.now, target);
  }

  tick(ms: number) { this.advanceTo(this.now + ms); }

  /** 지금 단계가 끝나는 순간까지 시간을 민다 → 알람이 다음 단계로 넘긴다 */
  endPhase() {
    const end = this.state().phaseEndsAt;
    if (end) this.advanceTo(end);
  }

  state(): GameState { return this.room.raw()!; }
  view(teamNo: number) { return teamView(this.state(), teamNo, this.now); }
  tv() { return teacherView(this.state(), this.now); }
}

function answerOf(t: Table, round: number, level: Level): number {
  const st = t.state();
  const id = st.questionPlan[round]![level]!;
  return st.questionById[id]!.answer;
}

/** 한 판을 끝까지 돌린다. 라운드마다 진행 버튼 → 경주 → 문제 → 토론 → 베팅 */
function playFullGame(t: Table, teams = 6): number[] {
  const last = t.state().lastRound;
  const roundsSeen: number[] = [];
  for (let r = 1; r <= last; r++) {
    t.room.advanceRound(t.hostKey);      // waiting → moving
    t.endPhase();                        // moving  → quiz
    for (let n = 1; n <= teams; n++) {
      const lv = LEVELS[n % 3]!;
      t.room.chooseLevel(n, lv, t.pins[n]!);
      // 4모둠은 맞히고 2모둠은 틀린다 — 힌트가 골고루 나가야 D6 이 의미가 있다
      t.room.submitAnswer(n, lv, n <= 4 ? answerOf(t, r, lv) : 99, t.pins[n]!);
    }
    t.endPhase();                        // quiz    → discuss
    t.endPhase();                        // discuss → betting
    for (let n = 1; n <= teams; n++) {
      t.room.placeBet(n, { [ANIMAL_CODES[(n + r) % 8]!]: 2 }, t.pins[n]!);
    }
    t.endPhase();                        // betting → waiting
    roundsSeen.push(t.state().round);
  }
  return roundsSeen;
}

/** 응답에 들어 있는 모든 열쇠 이름 (중첩 포함). 문자열 포함 검사보다 정확하다 */
function allKeys(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) { for (const x of v) allKeys(x, out); return out; }
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v as object)) { out.add(k); allKeys((v as Record<string, unknown>)[k], out); }
  }
  return out;
}

// ────────────────────────────────────────────────────────────
// 게이트 실행기
// ────────────────────────────────────────────────────────────

let pass = 0, fail = 0;
function gate(id: string, title: string, fn: () => { ok: boolean; detail: string }) {
  let ok = false, detail = '';
  try { const r = fn(); ok = r.ok; detail = r.detail; }
  catch (e) { ok = false; detail = 'ERROR ' + (e as Error).message + '\n          ' + ((e as Error).stack || '').split('\n')[1]; }
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(11)} ${title}\n              ${detail}`);
}

console.log('\n=== 방 코어 통합 게이트 (가짜 시계 · 가짜 알람) ===\n');

// ── 한 판 통째로 ─────────────────────────────────────────

const T = new Table();
const created = T.open(6);

gate('SIM1', '판 생성 — 6모둠, 암호 발급, 대기 단계에서 시작', () => {
  const s = T.state();
  return {
    ok: created.code === 'TST1' && created.teams.length === 6 &&
        Object.keys(created.pins).length === 6 &&
        created.hostKey.length === 12 &&
        s.phase === PHASES.WAITING && s.roundStarted === false,
    detail: `코드 ${created.code}, 모둠 6개, 열쇠 ${created.hostKey.length}자리, 단계 ${s.phase}`
  };
});

gate('SIM2', '모둠 접속', () => {
  const r = T.room.join(3, T.pins[3]!);
  return { ok: r.ok && r.data.me!.coins === DEFAULTS.initialCoins,
           detail: r.ok ? `3모둠 입장, 보유 ${r.data.me!.coins}코인` : r.message };
});

gate('SIM3', '틀린 암호 거부', () => {
  const r = T.room.join(3, '0000');
  return { ok: !r.ok && r.error === 'WRONG_PIN', detail: r.ok ? '통과돼 버렸다' : r.error };
});

gate('H8', '같은 모둠 두 번째 기기 접속 허용 (점유 없음)', () => {
  const a = T.room.join(3, T.pins[3]!), b = T.room.join(3, T.pins[3]!);
  return { ok: a.ok && b.ok, detail: '두 기기 모두 입장 — 새로고침한 폰이 자기 때문에 막히지 않는다' };
});

const phaseLog: string[] = [];
{
  // 1라운드만 손으로 밟아 단계 순서를 기록한다
  T.room.advanceRound(T.hostKey);
  phaseLog.push(T.state().phase);
  T.endPhase(); phaseLog.push(T.state().phase);
  T.endPhase(); phaseLog.push(T.state().phase);
  T.endPhase(); phaseLog.push(T.state().phase);
  T.endPhase(); phaseLog.push(T.state().phase);
}

gate('SIM4', '단계 순서 moving→quiz→discuss→betting→waiting', () => ({
  ok: phaseLog.join(',') === 'moving,quiz,discuss,betting,waiting',
  detail: phaseLog.join(' → ') + '  (앱스 스크립트판에는 moving 이 없었다)'
}));

// ── 라운드 진행 · 정산 ────────────────────────────────────

const FULL = new Table();
FULL.open(6, 'FULL');
const roundsSeen = playFullGame(FULL);

gate('BUG1', '라운드가 실제로 앞으로 나간다 (1라운드 반복 방지)', () => {
  const expect = Array.from({ length: FULL.state().lastRound }, (_, i) => i + 1);
  // 진행 중에 진행 버튼을 여러 번 눌러도 라운드가 두 번 시작하면 안 된다
  const t = new Table();
  t.open(2, 'BUG1');
  t.room.advanceRound(t.hostKey);
  const endsAt = t.state().phaseEndsAt;
  t.tick(3000);
  t.room.advanceRound(t.hostKey);
  t.room.advanceRound(t.hostKey);
  const stable = t.state().round === 1 && t.state().phase === PHASES.MOVING &&
                 t.state().phaseEndsAt === endsAt;
  const startEvents = t.events.filter((e) => e.kind === 'round_start').length;
  return {
    ok: roundsSeen.join(',') === expect.join(',') && stable && startEvents === 1,
    detail: `진행한 라운드 ${roundsSeen.join('→')} (기대 1..${expect.length}) · ` +
            `진행 버튼 3번에 round_start ${startEvents}건`
  };
});

gate('D3', '토론 단계에는 베팅이 잠긴다', () => {
  const t = new Table();
  t.open(2, 'D3');
  t.room.advanceRound(t.hostKey);
  t.endPhase(); t.endPhase();                    // moving → quiz → discuss
  const r = t.room.placeBet(1, { A: 1 }, t.pins[1]!);
  return { ok: !r.ok && r.error === 'BET_CLOSED', detail: `단계 ${t.state().phase} 에서 베팅 → ${r.ok ? 'ok' : r.error}` };
});

gate('D2b', '3코인 초과·남의 코인을 서버가 막는다', () => {
  const t = new Table();
  t.open(2, 'D2B');
  t.room.advanceRound(t.hostKey);
  t.endPhase(); t.endPhase(); t.endPhase();      // → betting
  const many = t.room.placeBet(1, { A: 4 }, t.pins[1]!);
  const frac = t.room.placeBet(1, { A: 1.5 }, t.pins[1]!);
  const okBet = t.room.placeBet(1, { A: 2 }, t.pins[1]!);
  const again = t.room.placeBet(1, { A: 1 }, t.pins[1]!);
  const codes = [many, frac, again].map((x) => (x.ok ? 'ok' : x.error)).join('/');
  return { ok: codes === 'TOO_MANY_COINS/BAD_AMOUNT/ALREADY_BET' && okBet.ok, detail: codes + ' · 정상 베팅은 통과' };
});

gate('D6', '같은 모둠에 같은 힌트 두 번 안 감', () => {
  const teams = FULL.state().teams;
  const ok = teams.every((t) => new Set(t.hints.map((h) => h.text)).size === t.hints.length);
  return { ok, detail: teams.map((t) => `${t.no}모둠 ${t.hints.length}개`).join(', ') };
});

const fin = FULL.room.finalize(FULL.hostKey);

gate('H9b', '정산 실행', () => ({
  ok: fin.ok && fin.data.settlement.length === 6,
  detail: fin.ok ? `우승 ${fin.data.settlement[0]!.teamNo}모둠 ${fin.data.settlement[0]!.finalCoins}코인` : (fin as { message: string }).message
}));

gate('H1c', '도착 순서 = 정답 순위', () => {
  if (!fin.ok) return { ok: false, detail: '정산 실패' };
  const st = FULL.state();
  return { ok: fin.data.finalOrder.join('') === st.truth.join(''),
           detail: `도착 ${fin.data.finalOrder.join('')} vs 정답 ${st.truth.join('')}` };
});

gate('H9c', '최종 = 남은 보유 + 획득, 그리고 정산 규칙과 일치', () => {
  if (!fin.ok) return { ok: false, detail: '정산 실패' };
  const st = FULL.state();
  const odds = computeOdds(st.pool);
  const rankOf: Partial<Record<AnimalCode, number>> = {};
  fin.data.finalOrder.forEach((c, i) => { rankOf[c] = i + 1; });

  let allOk = true;
  for (const s of fin.data.settlement) {
    const team = st.teams.find((t) => t.no === s.teamNo)!;
    // 정산 규칙을 여기서 독립적으로 다시 계산한다 — settle() 을 부르면 자기 자신을 검사하게 된다
    const byAnimal: Partial<Record<AnimalCode, number>> = {};
    for (const r of Object.keys(team.bets)) {
      const b = team.bets[Number(r)]!;
      for (const c of Object.keys(b) as AnimalCode[]) byAnimal[c] = (byAnimal[c] || 0) + b[c]!;
    }
    let gained = 0;
    for (const c of Object.keys(byAnimal) as AnimalCode[]) {
      gained += Math.round(byAnimal[c]! * odds[c] * (st.settings.payout[rankOf[c]!] || 0));
    }
    if (gained !== s.gained || s.finalCoins !== team.coins + s.gained) allOk = false;
  }
  return { ok: allOk, detail: `6모둠 전부 일치 — 총 획득 ${fin.data.settlement.reduce((a, s) => a + s.gained, 0)}코인` };
});

// ── 정답 유출 ────────────────────────────────────────────

gate('H4c', '정산 후에만 정답이 공개된다', () => {
  const v = FULL.view(1);
  const tv = FULL.tv();
  return { ok: Array.isArray(v.truth) && Array.isArray(tv.truth) && v.truth!.join('') === FULL.state().truth.join(''),
           detail: `모둠·교사 뷰 모두 truth 포함 (${v.truth!.join('')})` };
});

gate('H4d/H4f', '어떤 단계에서도 정산 전에는 truth·moves·lastRound 가 안 나간다', () => {
  const t = new Table();
  t.open(2, 'H4D');
  const seen: string[] = [];
  const bad: string[] = [];
  const truthStr = t.state().truth.join('","');

  const inspect = () => {
    const phase = t.state().phase;
    seen.push(phase);
    const tvKeys = allKeys(JSON.parse(JSON.stringify(t.tv())));
    const tvJson = JSON.stringify(t.tv());
    if (tvKeys.has('moves')) bad.push(`교사뷰(${phase}).moves`);
    if (t.tv().truth !== null) bad.push(`교사뷰(${phase}).truth`);
    if (tvJson.includes(truthStr)) bad.push(`교사뷰(${phase}) 정답 문자열`);

    for (const n of [1, 2]) {
      const v = JSON.parse(JSON.stringify(t.view(n)));
      const keys = allKeys(v);
      const json = JSON.stringify(v);
      for (const k of ['truth', 'moves', 'lastRound']) if (keys.has(k)) bad.push(`모둠뷰(${phase}).${k}`);
      if (json.includes(truthStr)) bad.push(`모둠뷰(${phase}) 정답 문자열`);
    }
  };

  inspect();                                    // waiting
  t.room.advanceRound(t.hostKey); inspect();    // moving
  t.endPhase(); inspect();                      // quiz
  t.endPhase(); inspect();                      // discuss
  t.endPhase(); inspect();                      // betting
  t.endPhase(); inspect();                      // waiting

  return { ok: bad.length === 0,
           detail: bad.length ? '⛔ ' + bad.join(', ') : `${seen.join('·')} — 6개 단계 × 3개 뷰에서 0건` };
});

gate('H4f-raceMoves', 'moving 뷰의 raceMoves 는 동물 8개, 값 0~3 뿐', () => {
  const t = new Table();
  t.open(2, 'H4F');
  t.room.advanceRound(t.hostKey);
  const v = t.view(1), tv = t.tv();
  const okShape = (m: Record<string, number> | undefined) =>
    !!m && Object.keys(m).length === 8 &&
    ANIMAL_CODES.every((c) => Number.isInteger(m[c]) && m[c]! >= 0 && m[c]! <= 3);
  const gone = (() => { t.endPhase(); return t.view(1).raceMoves === undefined && t.tv().raceMoves === undefined; })();
  return { ok: okShape(v.raceMoves) && okShape(tv.raceMoves) && gone,
           detail: `moving: ${ANIMAL_CODES.map((c) => v.raceMoves![c]).join('')} (8개) · quiz 로 넘어가면 사라짐: ${gone}` };
});

// ── 동시성 ───────────────────────────────────────────────

gate('H5', '6모둠이 같은 틱에 베팅해도 코인 합계가 보존된다', () => {
  const t = new Table();
  t.open(6, 'H5');
  t.room.advanceRound(t.hostKey);
  t.endPhase(); t.endPhase(); t.endPhase();     // → betting

  const before = t.state().teams.reduce((a, x) => a + x.coins, 0);
  const poolBefore = ANIMAL_CODES.reduce((a, c) => a + t.state().pool[c], 0);

  // 시간을 한 틱도 밀지 않고 6모둠이 동시에 건다
  const results = [1, 2, 3, 4, 5, 6].map((n) => t.room.placeBet(n, { [ANIMAL_CODES[n % 8]!]: 3 }, t.pins[n]!));

  const after = t.state().teams.reduce((a, x) => a + x.coins, 0);
  const poolAfter = ANIMAL_CODES.reduce((a, c) => a + t.state().pool[c], 0);
  const allOk = results.every((r) => r.ok);
  return {
    ok: allOk && before - after === 18 && poolAfter - poolBefore === 18 && (before + poolBefore) === (after + poolAfter),
    detail: `보유 ${before}→${after}, 판돈 ${poolBefore}→${poolAfter} — 합계 ${before + poolBefore} 그대로`
  };
});

gate('RACE1', '마감 직전 제출은 알람이 와도 미제출로 덮이지 않는다', () => {
  const t = new Table();
  t.open(2, 'RACE');
  t.room.advanceRound(t.hostKey);
  t.endPhase();                                  // → quiz

  const end = t.state().phaseEndsAt!;
  t.advanceTo(end - 100);                        // 마감 0.1초 전
  const sub = t.room.submitAnswer(2, '쉬움', answerOf(t, 1, '쉬움'), t.pins[2]!);
  if (!sub.ok) return { ok: false, detail: '제출 자체가 실패: ' + sub.message };

  t.endPhase();                                  // 이제 알람이 온다 → discuss

  const st = t.state();
  const a2 = st.teams[1]!.answered[st.round];
  const a1 = st.teams[0]!.answered[st.round];
  const kept = !!a2 && a2.correct && !a2.timeout && st.teams[1]!.hints.length > 0;
  return {
    ok: kept && a1?.timeout === true && st.phase === PHASES.DISCUSS,
    detail: kept
      ? `2모둠 정답·힌트 그대로(힌트 ${st.teams[1]!.hints.length}개), 안 낸 1모둠만 미제출, 단계 ${st.phase}`
      : '⛔ 2모둠 답이 ' + (a2?.timeout ? '미제출로 덮였다' : '사라졌다')
  };
});

// ── 복구 ─────────────────────────────────────────────────

gate('D6b', 'restore 뒤에도 hintGiven 이 복원되어 같은 힌트가 다시 안 나간다', () => {
  const t = new Table();
  t.open(2, 'D6B');
  t.room.advanceRound(t.hostKey);
  t.endPhase();                                  // → quiz
  const first = t.room.submitAnswer(1, '어려움', answerOf(t, 1, '어려움'), t.pins[1]!);
  if (!first.ok) return { ok: false, detail: '첫 제출 실패' };
  const firstHint = first.data.newHint!.text;

  // 스냅샷이 이벤트보다 뒤처진 상황: 판 만든 직후 스냅샷 + 그 뒤 이벤트 전부
  const stale = t.snapshots[0]!;
  const rec = restore(stale, t.events);

  const restoredKeys = JSON.stringify(rec.hintGiven);
  const restoredHints = rec.teams[0]!.hints.length;

  // 복구된 상태로 방을 다시 세우고, 같은 난이도를 또 맞힌다
  const t2 = new Table();
  t2.now = t.now;
  rec.teams[0]!.answered = {};
  rec.phase = PHASES.QUIZ;
  rec.phaseEndsAt = t2.now + 99_999;
  t2.room.hydrate(rec);
  const second = t2.room.submitAnswer(1, '어려움', answerOf(t2, rec.round, '어려움'), t.pins[1]!);
  if (!second.ok) return { ok: false, detail: '복구 후 제출 실패: ' + second.message };
  const secondHint = second.data.newHint?.text || '(없음)';

  return {
    ok: restoredHints === 1 && restoredKeys !== '{}' && secondHint !== firstHint,
    detail: `복구된 hintGiven ${restoredKeys}, 힌트 ${restoredHints}개 · 다시 맞히니 ` +
            (secondHint === firstHint ? '⛔ 같은 힌트' : '다른 힌트가 나갔다')
  };
});

gate('D6b-2', 'restore 가 코인·베팅·판돈까지 되살린다', () => {
  const t = new Table();
  t.open(2, 'D6B2');
  t.room.advanceRound(t.hostKey);
  t.endPhase(); t.endPhase(); t.endPhase();      // → betting
  t.room.placeBet(1, { A: 2 }, t.pins[1]!);
  t.room.placeBet(2, { B: 1 }, t.pins[2]!);

  const live = t.state();
  const rec = restore(t.snapshots[0]!, t.events);
  const same = rec.teams.map((x) => x.coins).join(',') === live.teams.map((x) => x.coins).join(',') &&
               ANIMAL_CODES.every((c) => rec.pool[c] === live.pool[c]) &&
               rec.round === live.round;
  return { ok: same, detail: `코인 ${rec.teams.map((x) => x.coins).join(',')} · A판돈 ${rec.pool.A} (실제 ${live.pool.A})` };
});

// ── 시간 ─────────────────────────────────────────────────

gate('PAUSE', '일시정지 → 재개하면 phaseEndsAt 이 멈춘 만큼 밀린다 (moving 포함)', () => {
  const notes: string[] = [];
  let allOk = true;

  for (const where of ['moving', 'quiz'] as const) {
    const t = new Table();
    t.open(2, where === 'moving' ? 'PZ1' : 'PZ2');
    t.room.advanceRound(t.hostKey);
    if (where === 'quiz') t.endPhase();

    const phase0 = t.state().phase;
    const end0 = t.state().phaseEndsAt!;
    t.tick(5_000);
    t.room.togglePause(t.hostKey);
    const alarmCleared = t.alarmAt === null;      // 멈춘 동안 알람이 남아 있으면 단계가 넘어간다
    t.tick(30_000);                               // 멈춘 채로 30초
    const stillThere = t.state().phase === phase0;
    t.room.togglePause(t.hostKey);
    const end1 = t.state().phaseEndsAt!;
    const okShift = end1 === end0 + 30_000 && t.alarmAt === end1;
    t.endPhase();
    const moved = t.state().phase !== phase0;

    allOk = allOk && alarmCleared && stillThere && okShift && moved;
    notes.push(`${phase0}: +${(end1 - end0) / 1000}초 밀림, 멈춤 중 단계 유지 ${stillThere}, 재개 후 ${t.state().phase}`);
  }
  return { ok: allOk, detail: notes.join(' / ') };
});

gate('MOVE1', 'moving 진입 시 위치 갱신량이 raceMoves 와 일치하고 알람으로 quiz 로 넘어간다', () => {
  const t = new Table();
  t.open(2, 'MOVE');
  const before = t.view(1).positions;            // 시작 전 — 아직 아무도 안 움직였다
  const zero = ANIMAL_CODES.every((c) => before[c] === 0);

  t.room.advanceRound(t.hostKey);
  const v = t.view(1);
  const st = t.state();
  const matches = ANIMAL_CODES.every((c) =>
    v.positions[c] - before[c] === v.raceMoves![c] && v.raceMoves![c] === st.moves[c]![0]
  );
  const endsIn = (st.phaseEndsAt! - t.now) / 1000;

  t.endPhase();
  const toQuiz = t.state().phase === PHASES.QUIZ;

  return { ok: zero && matches && endsIn === DEFAULTS.moveSeconds && toQuiz,
           detail: `시작 전 전부 0칸 → ${ANIMAL_CODES.map((c) => v.positions[c]).join('')} (이동 ${ANIMAL_CODES.map((c) => v.raceMoves![c]).join('')}), ` +
                   `경주 ${endsIn}초 뒤 ${t.state().phase}` };
});

gate('ALARM-LATE', '알람이 예정보다 일찍 오면 전환하지 않고 다시 건다', () => {
  const t = new Table();
  t.open(2, 'ALRM');
  t.room.advanceRound(t.hostKey);
  const end = t.state().phaseEndsAt!;
  const version0 = t.state().stateVersion;

  t.alarmAt = null;
  t.tick(1_000);
  t.room.onAlarm();                              // 예정보다 19초 이르다

  const stayed = t.state().phase === PHASES.MOVING && t.state().phaseEndsAt === end &&
                 t.state().stateVersion === version0;
  const rescheduled = t.alarmAt === end;

  // 그리고 제 시각에는 제대로 넘어간다
  t.advanceTo(end);
  const moved = t.state().phase === PHASES.QUIZ;

  return { ok: stayed && rescheduled && moved,
           detail: `이른 알람에 단계·stateVersion 불변 ${stayed}, 알람 재설정 ${rescheduled}, 제 시각엔 ${t.state().phase}` };
});

gate('ALARM-PAUSED', '멈춰 있는 동안 알람이 와도 단계가 넘어가지 않는다', () => {
  const t = new Table();
  t.open(2, 'ALRP');
  t.room.advanceRound(t.hostKey);
  t.room.togglePause(t.hostKey);
  t.tick(60_000);
  t.room.onAlarm();                              // 취소가 안 먹은 알람이 왔다고 가정
  return { ok: t.state().phase === PHASES.MOVING,
           detail: `60초 뒤에도 ${t.state().phase} (멈춤 중엔 시간이 흐르지 않는다)` };
});

// ── 인증 (SEC 게이트 본체는 3단계에서 전송 계층까지 포함해 다시 쓴다) ──

gate('AUTH-PIN', '틀린 암호로는 상태 조회·답 제출·베팅 전부 거부', () => {
  const t = new Table();
  t.open(2, 'AUTP');
  t.room.advanceRound(t.hostKey);
  t.endPhase();                                  // → quiz

  const other = t.pins[2]!;
  const codes = [
    t.room.getState('team:1', null, null),
    t.room.getState('team:1', null, other),
    t.room.submitAnswer(1, '쉬움', 1, other),
    t.room.chooseLevel(1, '쉬움', other)
  ].map((r) => (r.ok ? 'ok' : r.error));

  const own = t.room.getState('team:1', null, t.pins[1]!);
  t.endPhase(); t.endPhase();                    // → betting
  const stolen = t.room.placeBet(1, { A: 1 }, other);
  const mine = t.room.placeBet(1, { A: 1 }, t.pins[1]!);

  return {
    ok: codes.every((c) => c === 'WRONG_PIN') && own.ok && !stolen.ok && stolen.error === 'WRONG_PIN' && mine.ok,
    detail: `조회·제출·난이도 ${codes.join('/')} · 베팅 ${stolen.ok ? 'ok' : stolen.error} — 제 암호로는 전부 통과`
  };
});

gate('AUTH-HOST', '틀린 열쇠로는 진행·정지·정산·공개·암호배부 전부 거부', () => {
  const t = new Table();
  t.open(2, 'AUTH');
  const wrong = 'AAAAAAAAAAAA';
  const codes = [
    t.room.advanceRound(wrong), t.room.togglePause(wrong), t.room.finalize(wrong),
    t.room.reveal(wrong), t.room.handout(wrong),
    t.room.getState('teacher', null),            // 열쇠 없음
    t.room.getState('teacher', wrong),
    t.room.getState('zzz', null),                // 아무 문자열도 교사 경로다
    t.room.getState('', null),
    t.room.getState(undefined, null)
  ].map((r) => (r.ok ? 'ok' : r.error));

  const handout = t.room.handout(wrong);
  const leaked = JSON.stringify(handout).includes('"pins"');
  const real = t.room.getState('teacher', t.hostKey);

  return {
    ok: codes.every((c) => c === 'NOT_HOST') && !leaked && real.ok,
    detail: `10가지 호출 전부 NOT_HOST, 거부 응답에 암호 미포함 · 진짜 열쇠는 통과`
  };
});

gate('AUTH-EMPTY', '없는 판에 대한 호출은 GAME_NOT_FOUND', () => {
  const t = new Table();                          // create 를 부르지 않았다
  const codes = [
    t.room.getState('teacher', 'X'), t.room.join(1, '0000'), t.room.lobby(),
    t.room.placeBet(1, { A: 1 }, '0000'), t.room.advanceRound('X'), t.room.finalize('X')
  ].map((r) => (r.ok ? 'ok' : r.error));
  return { ok: codes.every((c) => c === 'GAME_NOT_FOUND'), detail: codes.join('/') };
});

// ── 저장·알림 ────────────────────────────────────────────

gate('PERSIST', '상태를 바꾼 호출마다 스냅샷과 알림이 나간다', () => {
  const t = new Table();
  t.open(2, 'PERS');
  const s0 = t.snapshots.length, c0 = t.changes;
  t.room.advanceRound(t.hostKey);
  t.endPhase();                                   // 알람 전환도 저장돼야 한다
  t.room.submitAnswer(1, '쉬움', answerOf(t, 1, '쉬움'), t.pins[1]!);
  const reads = t.snapshots.length;
  // 읽기는 아무것도 쓰지 않는다 (§5 — 읽기 경로에서 상태를 쓰면 마감 직전 답이 날아간다)
  t.room.getState('team:1', null, t.pins[1]!);
  t.room.getState('teacher', t.hostKey);
  t.tv(); t.view(1);
  return {
    ok: t.snapshots.length - s0 === 3 && t.changes - c0 === 3 && t.snapshots.length === reads,
    detail: `쓰기 3번 → 스냅샷 ${t.snapshots.length - s0}건 · 알림 ${t.changes - c0}건 · 읽기 4번 → 스냅샷 0건 추가`
  };
});

gate('NO-DATE', '모든 응답에 Date 객체가 없다 (숫자 ms 만)', () => {
  const t = new Table();
  t.open(2, 'DATE');
  t.room.advanceRound(t.hostKey);
  const responses: unknown[] = [
    t.room.getState('teacher', t.hostKey), t.room.getState('team:1', null, t.pins[1]!),
    t.room.lobby(), t.room.handout(t.hostKey), t.room.join(1, t.pins[1]!),
    t.room.reveal(t.hostKey), ...t.events
  ];
  const bad: string[] = [];
  const walk = (v: unknown, p: string) => {
    if (v instanceof Date) { bad.push(p); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${p}[${i}]`)); return; }
    if (v && typeof v === 'object') for (const k of Object.keys(v as object)) walk((v as Record<string, unknown>)[k], `${p}.${k}`);
  };
  responses.forEach((r, i) => walk(r, '#' + i));
  return { ok: bad.length === 0, detail: bad.length ? 'Date 발견: ' + bad.join(', ') : `${responses.length}개 응답·이벤트 검사, Date 0건` };
});

gate('CFG-MOVE', '경주시간초가 이상하면 기본값으로 되돌리고 알린다', () => {
  const t = new Table();
  const r = t.room.create(
    { code: 'CFG', className: 'X', unit: '유전', teamCount: 2 },
    QUESTIONS, ANIMALS,
    { moveSeconds: NaN, quizSeconds: 99_999, betSeconds: 45 } as never
  );
  if (!r.ok) return { ok: false, detail: '판 생성 실패' };
  const s = t.state().settings;
  return {
    ok: s.moveSeconds === DEFAULTS.moveSeconds && s.quizSeconds === DEFAULTS.quizSeconds &&
        s.betSeconds === 45 && r.data.warnings.length === 2,
    detail: `경주 ${s.moveSeconds}초·문제 ${s.quizSeconds}초로 되돌림, 베팅 ${s.betSeconds}초는 유지 · 경고 ${r.data.warnings.length}건`
  };
});

gate('LATE', '마감 뒤 알람이 늦어도 제출·베팅은 받지 않는다 (상태는 안 바뀐다)', () => {
  const t = new Table();
  t.open(2, 'LATE');
  t.room.advanceRound(t.hostKey);
  t.endPhase();                                   // → quiz
  const end = t.state().phaseEndsAt!;
  t.now = end + 300;                              // 알람은 아직 안 왔다 (advanceTo 를 안 쓴다)
  const sub = t.room.submitAnswer(1, '쉬움', answerOf(t, 1, '쉬움'), t.pins[1]!);
  const lv = t.room.chooseLevel(2, '쉬움', t.pins[2]!);
  const stillQuiz = t.state().phase === PHASES.QUIZ && !t.state().teams[0]!.answered[1];
  t.advanceTo(t.now);                             // 이제 알람 → discuss
  t.endPhase();                                   // → betting
  const bend = t.state().phaseEndsAt!;
  t.now = bend + 300;
  const bet = t.room.placeBet(1, { A: 1 }, t.pins[1]!);
  const coins = t.state().teams[0]!.coins;
  return {
    ok: !sub.ok && sub.error === 'QUIZ_CLOSED' && !lv.ok && lv.error === 'QUIZ_CLOSED' && stillQuiz &&
        !bet.ok && bet.error === 'BET_CLOSED' && coins === DEFAULTS.initialCoins,
    detail: `제출 ${sub.ok ? '통과⛔' : sub.error} · 난이도 ${lv.ok ? '통과⛔' : lv.error} · 베팅 ${bet.ok ? '통과⛔' : bet.error} · 읽기 경로는 전환 안 함(${stillQuiz ? 'quiz 유지' : '⛔'})`
  };
});

gate('DONE', '마지막 라운드 뒤 진행 버튼은 done 으로 간다', () => {
  const t = new Table();
  t.open(2, 'DONE');
  playFullGame(t, 2);
  const beforePhase = t.state().phase;
  const r = t.room.advanceRound(t.hostKey);
  const after = t.state();
  const again = t.room.advanceRound(t.hostKey);
  return {
    ok: beforePhase === PHASES.WAITING && after.phase === PHASES.DONE &&
        after.round === LASTOF(t) && r.ok && again.ok && t.alarmAt === null,
    detail: `${LASTOF(t)}라운드까지 돌고 ${after.phase} · 한 번 더 눌러도 ${t.state().phase}`
  };
});

function LASTOF(t: Table) { return t.state().lastRound; }

console.log('\n====================================================');
console.log(`방 코어 게이트 — 통과 ${pass} / 실패 ${fail}`);
console.log('====================================================\n');
if (fail) process.exit(1);
