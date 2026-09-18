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

import { ANIMAL_CODES, BONUS_COST, BONUS_ROUND, DEFAULTS, LEVELS, PHASES, PREDICTION_BONUS, ROUNDS, isNoBetPosition } from '../src/game/config.ts';
import type { AnimalCode, Level } from '../src/game/config.ts';
import { computeOdds, positionsAtRound } from '../src/game/rules.ts';
import type { GameState, Question, Rng } from '../src/game/types.ts';
import { allTeamsDone, teacherView, teamView } from '../src/game/views.ts';
import { Room, restore } from '../src/do/room.ts';
import type { GameEvent } from '../src/do/room.ts';

// ────────────────────────────────────────────────────────────
// 판돈: 문제은행·동물 (5단계에서 D1 이 대신할 자리)
// ────────────────────────────────────────────────────────────

const QUESTIONS: Question[] = [];
{
  let id = 1;
  // 10라운드가 되었으므로 난이도별 10문항. 모자랄 때의 순환 재사용은 gates.ts D5b 가 본다
  for (const lv of LEVELS) {
    for (let i = 1; i <= ROUNDS; i++) {
      QUESTIONS.push({
        id: id++, setName: '유전', level: lv, text: `${lv} 문제 ${i}`,
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

  open(teamCount = 6, code = 'TST1', fraudEnabled?: boolean) {
    const r = this.room.create(
      { code, roomTitle: '2학년 3반', setName: '유전', teamCount, fraudEnabled },
      QUESTIONS, ANIMALS
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

/**
 * 한 판을 끝까지 돌린다. 라운드마다 진행 버튼 → 경주 → 문제 → 토론 → 베팅.
 *
 * ⚠️ 8라운드쯤부터 1위가 골인해 있다. 골인한 동물에 걸면 서버가 BET_FINISHED 로
 *    거절하므로(RENEWAL §1), 여기서도 아직 안 들어온 동물을 고른다 —
 *    "베팅이 조용히 안 들어간 채로 판이 도는" 상태에서 정산을 검사하면 안 된다.
 */
function playFullGame(t: Table, teams = 6): number[] {
  const last = t.state().lastRound;
  const roundsSeen: number[] = [];
  for (let r = 1; r <= last; r++) {
    t.room.advanceRound(t.hostKey);      // waiting → moving
    t.endPhase();                        // moving  → quiz
    for (let n = 1; n <= teams; n++) {
      const lv = LEVELS[n % 3]!;
      t.room.chooseLevel(n, lv, t.pins[n]!);
      // 4모둠은 맞히고 2모둠은 틀린다 — 힌트가 골고루 나가야 검사가 의미 있다
      t.room.submitAnswer(n, lv, n <= 4 ? answerOf(t, r, lv) : 99, t.pins[n]!);
    }
    t.endPhase();                        // quiz    → bonus(5R) 또는 discuss
    if (r === BONUS_ROUND) t.endPhase(); // bonus   → discuss
    t.endPhase();                        // discuss → betting
    const trackCells = t.state().settings.trackCells;
    const positions = t.view(1).positions;
    const open = ANIMAL_CODES.filter((c) => !isNoBetPosition(positions[c] ?? 0, trackCells));
    for (let n = 1; n <= teams; n++) {
      const bet = t.room.placeBet(n, { [open[(n + r) % open.length]!]: 1 }, t.pins[n]!);
      if (!bet.ok && bet.error !== 'NOT_ENOUGH_COINS') {
        throw new Error(`${r}R ${n}모둠 베팅 실패: ${bet.error}`);
      }
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

gate('PREDICT-1', '1라운드 전 무료 예측은 한 번만 받고 시작 후 잠근다', () => {
  const t = new Table();
  t.open(3, 'PRED');
  const winner = t.state().truth[0]!;
  const loser = t.state().truth[1]!;
  const initialCoins = t.state().teams[0]!.coins;
  const wrongPin = t.room.predictWinner(1, winner, '0000');
  const invalid = t.room.predictWinner(1, 'Z' as AnimalCode, t.pins[1]!);
  const first = t.room.predictWinner(1, winner, t.pins[1]!);
  const repeat = t.room.predictWinner(1, loser, t.pins[1]!);
  const second = t.room.predictWinner(2, loser, t.pins[2]!);
  const before = t.view(1);
  const other = t.view(3);
  const recovered = restore(t.snapshots[0]!, t.events);
  t.room.advanceRound(t.hostKey);
  const late = t.room.predictWinner(3, winner, t.pins[3]!);
  const fin = t.room.finalize(t.hostKey);
  const winnerLine = fin.ok ? fin.data.settlement.find((s) => s.teamNo === 1) : null;
  const loserLine = fin.ok ? fin.data.settlement.find((s) => s.teamNo === 2) : null;
  const absentLine = fin.ok ? fin.data.settlement.find((s) => s.teamNo === 3) : null;
  return { ok: !wrongPin.ok && wrongPin.error === 'WRONG_PIN' &&
      !invalid.ok && invalid.error === 'BAD_ANIMAL' && first.ok && second.ok &&
      !repeat.ok && repeat.error === 'PREDICTION_LOCKED' &&
      before.predictionOpen && before.me?.predictedWinner === winner && !before.me.canPredictWinner &&
      other.me?.predictedWinner === null && other.me.canPredictWinner &&
      t.tv().predictionCount === 2 && recovered.teams[0]?.predictedWinner === winner &&
      recovered.teams[1]?.predictedWinner === loser &&
      t.state().teams[0]?.coins === initialCoins && !t.view(1).predictionOpen && !late.ok && late.error === 'PREDICTION_CLOSED' &&
      winnerLine?.predictionBonus === PREDICTION_BONUS &&
      winnerLine.finalCoins === initialCoins + winnerLine.gained + PREDICTION_BONUS &&
      winnerLine.rank === 1 &&
      loserLine?.predictionBonus === 0 && absentLine?.predictionBonus === 0,
    detail: `PIN·동물 검증, 재선택·늦은 선택 차단, 복구, 정답 +${PREDICTION_BONUS}코인 확인` };
});

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

gate('SIM1b', `판이 ${ROUNDS}라운드로 만들어진다 — lastRound = ${ROUNDS}, 문항도 ${ROUNDS}라운드 분`, () => {
  const s = T.state();
  const plans = Object.keys(s.questionPlan).length;
  // ⚠️ 문항을 lastRound 만큼만 배정하면 "10라운드에 문제가 없다"로 마지막 라운드가 샌다.
  //    지금은 lastRound 가 언제나 ROUNDS 라 둘이 같지만, 기준은 계속 ROUNDS 다
  const finish = [0, 1, 2].map((k) => s.finishRound[s.truth[k]!]);
  return {
    ok: s.lastRound === ROUNDS && finish.join('/') === `${ROUNDS - 2}/${ROUNDS - 1}/${ROUNDS}` &&
        plans === ROUNDS &&
        !s.hintPool && s.settings.trackCells === DEFAULTS.trackCells,
    detail: `lastRound ${s.lastRound} (학생 비공개) · 1·2·3위 골인 ${finish.join('/')}R · ` +
            `문항 배정 ${plans}라운드 분 · 힌트는 정답 시 생성 · 트랙 ${s.settings.trackCells}칸`
  };
});

/**
 * 옛 판(이어하기) 호환 — `lastRound` 가 9 로 저장된 판은 여전히 9라운드에서 끝난다.
 *
 * 2026-09-07 부터 새 판의 lastRound 는 항상 10 이라 `round >= lastRound` 분기는
 * 사실상 죽은 코드다. 지우지 않은 이유가 이것이고, 그 이유를 게이트로 붙들어 둔다 —
 * ROUNDS 로 바꿔 박으면 옛 판이 문제도 힌트도 없는 10라운드를 한 번 더 돈다.
 */
/**
 * 골인한 동물은 **골인 순서**로 담긴다 (2026-09-07). 트랙 레인이 골인한 동물끼리의 등수를
 * `finished` 배열 자리로 가르므로(client/shared/rank.ts), 코드 순서로 담으면 8R 에 들어온
 * 1위가 9R 에 들어온 2위 뒤에 적히는 판이 나온다. 코드 순서와 골인 순서가 어긋나는 판을
 * 골라 확인한다 — 어긋나지 않는 판에서는 변이가 안 잡힌다.
 */
gate('FIN-ORDER', '골인한 동물은 코드 순이 아니라 골인 순서로 담긴다 (1위 8R → 2위 9R)', () => {
  let t: Table | null = null;
  for (let k = 0; k < 40 && !t; k++) {
    const cand = new Table();
    cand.open(2, 'FO' + String(k).padStart(2, '0'));
    const [a, b] = cand.state().truth;
    if (ANIMAL_CODES.indexOf(a!) > ANIMAL_CODES.indexOf(b!)) t = cand;   // 코드 순이면 2위가 먼저 온다
  }
  if (!t) return { ok: false, detail: '어긋나는 판을 못 찾았다' };
  for (let r = 1; r <= ROUNDS - 1; r++) {
    t.room.advanceRound(t.hostKey);
    for (let g = 0; g < 8 && t.state().phase !== PHASES.WAITING; g++) t.endPhase();
  }
  const st = t.state();
  const got = t.tv().finished.join(',');
  const want = [st.truth[0], st.truth[1]].join(',');
  const phone = t.view(1).finished.join(',');
  return {
    ok: got === want && phone === want,
    detail: `9R 뒤 finished: 교사 ${got} · 폰 ${phone} · 기대 ${want} (코드 순이면 ${[st.truth[1], st.truth[0]].join(',')})`
  };
});

gate('SIM1c', '옛 판(lastRound 9)을 이어 열면 9라운드에서 끝난다', () => {
  const t = new Table();
  t.open(2, 'OLD9');
  const st = t.state();
  st.lastRound = 9;                       // 예전 규칙으로 저장된 판을 흉내낸다
  const seen: number[] = [];
  for (let r = 1; r <= 12 && t.state().phase !== PHASES.DONE; r++) {
    t.room.advanceRound(t.hostKey);
    if (t.state().phase === PHASES.DONE) break;
    seen.push(t.state().round);
    while (t.state().phase !== PHASES.WAITING) t.endPhase(); // 5R bonus 포함
  }
  return {
    ok: t.state().phase === PHASES.DONE && t.state().round === 9 && seen.length === 9,
    detail: `돈 라운드 ${seen.join(',')} → ${t.state().phase} (round ${t.state().round})`
  };
});

gate('FRAUD-ROOM', '새 판에는 거짓 힌트가 생성되지 않는다', () => {
  const on = T.state();
  const off = new Table();
  off.open(2, 'NOFR', false);
  const so = off.state();
  const bad: string[] = [];
  if (on.fraudEnabled || on.fraudRound !== null) bad.push(`기본 판 fraudRound=${String(on.fraudRound)}`);
  if (so.fraudEnabled || so.fraudRound !== null) bad.push(`끈 판 fraudRound=${String(so.fraudRound)}`);
  if (on.hintPool || so.hintPool) bad.push('미리 생성된 힌트 풀 존재');
  return { ok: bad.length === 0,
           detail: bad.length ? '⛔ ' + bad.join(', ') : '두 판 모두 거짓 힌트 없음' };
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

gate('BONUS-5', '5라운드 문제 뒤 추가 단서 구입: 5코인·세 상자·모둠별 비밀', () => {
  const t = new Table();
  t.open(3, 'BON5');
  for (let r = 1; r < BONUS_ROUND; r++) {
    t.room.advanceRound(t.hostKey);
    for (let step = 0; step < 4; step++) t.endPhase();
  }
  t.room.advanceRound(t.hostKey);
  t.endPhase(); // moving → quiz
  const early = t.room.buyBonusHint(1, 1, t.pins[1]!);
  t.endPhase(); // quiz → bonus
  const phaseOk = t.state().phase === PHASES.BONUS && t.tv().bonusBoughtCount === 0;
  const secrets = t.state().bonusHints!;
  const first = t.state().truth[0]!, second = t.state().truth[1]!;
  const positions = positionsAtRound(t.state().moves, 6, t.state().settings.trackCells);
  const rank = 1 + ANIMAL_CODES.filter((code) => positions[code] > positions[first]).length;
  const trueHints = secrets[0].includes(t.state().animals[second]) &&
    secrets[1].includes(t.state().animals[first]) && secrets[2].includes(`${rank}등`);
  const hidden = !JSON.stringify(t.view(1)).includes('bonusHints') &&
    !JSON.stringify(t.tv()).includes('bonusHints') &&
    secrets.every((secret) => !JSON.stringify(t.view(1)).includes(secret) && !JSON.stringify(t.tv()).includes(secret));
  const wrongPin = t.room.buyBonusHint(1, 1, '0000');
  const buys = [1, 2, 3].map((box) => t.room.buyBonusHint(box, box, t.pins[box]!));
  const again = t.room.buyBonusHint(1, 2, t.pins[1]!);
  const costOk = t.state().teams.every((team) => team.coins === DEFAULTS.initialCoins - BONUS_COST && team.hints.some((hint) => hint.level === '추가 단서'));
  const boxOk = buys.every((buy) => buy.ok) && t.tv().bonusBoughtCount === 3 && t.state().teams.every((team, i) => team.bonusBox === i + 1);
  const privateOk = t.state().teams.every((team) => {
    const view = t.view(team.no);
    return view.me?.hints.length === team.hints.length && view.me?.bonusBox === team.bonusBox && !JSON.stringify(view).includes('bonusBoxes');
  });
  t.endPhase(); // bonus → discuss
  const late = t.room.buyBonusHint(1, 3, t.pins[1]!);
  return { ok: phaseOk && trueHints && hidden && !early.ok && !wrongPin.ok && wrongPin.error === 'WRONG_PIN' &&
    boxOk && costOk && privateOk && !again.ok && again.error === 'BONUS_BOUGHT' &&
    t.state().phase === PHASES.DISCUSS && !late.ok && late.error === 'BONUS_CLOSED',
    detail: `phase=${phaseOk}, truth=${trueHints}, boxes=${boxOk}, cost=${costOk}, private=${privateOk}, late=${late.ok ? 'ok' : late.error}` };
});

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

gate('BET-FIN', '골인한 동물에는 못 걸고, 폰 뷰의 finished 에 그 동물이 뜬다', () => {
  // 1위가 골인한 **뒤에도 라운드가 남는** 판이 필요하다 (골인 8R + lastRound 9·10 등).
  // 1위가 마지막 라운드에 들어오는 판에서는 검사할 베팅 단계 자체가 없다
  let t = new Table();
  for (let i = 0; i < 50; i++) {
    t = new Table();
    t.open(2, 'BFIN');
    if (t.state().finishRound[t.state().truth[0]!]! < t.state().lastRound) break;
  }
  const winner = t.state().truth[0]!;
  const firstFinish = t.state().finishRound[winner]!;   // 8 또는 9라운드 (서버만 안다)
  if (firstFinish >= t.state().lastRound) return { ok: false, detail: '검사할 판을 못 만들었다' };

  // 아직 베팅 금지구역에 들어가지 않은 1라운드에는 1위에게도 걸 수 있다
  let early: ReturnType<typeof t.room.placeBet> | null = null;
  for (let r = 1; r <= firstFinish; r++) {
    t.room.advanceRound(t.hostKey);
    while (t.state().phase !== PHASES.BETTING) t.endPhase();
    if (r === 1) early = t.room.placeBet(1, { [winner]: 1 }, t.pins[1]!);
    t.endPhase();                                       // → waiting
  }

  // 이제 1위는 결승선에 있다
  const pos = t.view(1).positions[winner]!;
  const atGoal = pos === t.state().settings.trackCells;

  t.room.advanceRound(t.hostKey);
  while (t.state().phase !== PHASES.BETTING) t.endPhase();
  const finished = t.view(1).finished;
  const tvFinished = t.tv().finished;
  const blocked = t.room.placeBet(2, { [winner]: 1 }, t.pins[2]!);
  const current = t.view(1);
  const open = ANIMAL_CODES.find((c) => !isNoBetPosition(current.positions[c] ?? 0, current.trackCells))!;
  const allowed = t.room.placeBet(2, { [open]: 1 }, t.pins[2]!);

  return {
    ok: !!early?.ok && atGoal &&
        finished.indexOf(winner) >= 0 && tvFinished.indexOf(winner) >= 0 &&
        !blocked.ok && blocked.error === 'BET_FINISHED' && allowed.ok,
    detail: `${firstFinish}R 에 1위 골인(${pos}칸, lastRound ${t.state().lastRound}) · 그전 라운드에는 걸렸다(${!!early?.ok}) · ` +
            `골인 뒤 ${blocked.ok ? 'ok⛔' : blocked.error} · 폰·교사 finished ${finished.length}/${tvFinished.length}마리 · ` +
            `아직 안 들어온 동물은 통과(${allowed.ok})`
  };
});

gate('HINT-ROUND', '모둠별 힌트가 저장되고 같은 정보는 반복되지 않는다', () => {
  const st = FULL.state();
  const bad: string[] = [];
  for (const t of st.teams) {
    if (new Set(t.hints.map((h) => h.text)).size !== t.hints.length) bad.push(`${t.no}모둠 중복`);
    for (const h of t.hints) {
      if (h.level !== '추가 단서' && (!h.key || !h.animalIds || !h.tags)) bad.push(`${t.no}모둠 힌트 메타데이터 없음`);
    }
  }
  return { ok: bad.length === 0,
           detail: bad.length ? '⛔ ' + bad.slice(0, 4).join(', ')
             : FULL.state().teams.map((t) => `${t.no}모둠 ${t.hints.length}개`).join(', ') };
});

gate('HINT-ONCE', '한 라운드에 두 번 제출할 수 없다 — 그래서 힌트가 두 번 갈 길이 없다', () => {
  const t = new Table();
  t.open(2, 'HONE');
  t.room.advanceRound(t.hostKey);
  t.endPhase();                                   // → quiz
  const first = t.room.submitAnswer(1, '어려움', answerOf(t, 1, '어려움'), t.pins[1]!);
  const again = t.room.submitAnswer(1, '어려움', answerOf(t, 1, '어려움'), t.pins[1]!);
  const other = t.room.submitAnswer(1, '쉬움', answerOf(t, 1, '쉬움'), t.pins[1]!);
  const hints = t.state().teams[0]!.hints;
  return {
    ok: first.ok && !again.ok && again.error === 'ALREADY_ANSWERED' &&
        !other.ok && other.error === 'ALREADY_ANSWERED' && hints.length === 1,
    detail: `첫 제출 통과 · 같은 난이도 재제출 ${again.ok ? 'ok⛔' : again.error} · 다른 난이도도 ${other.ok ? 'ok⛔' : other.error} · 힌트 ${hints.length}개`
  };
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
    const answer = team.answered[ROUNDS];
    const expectedQuizBonus = answer?.correct && answer.level ? { 쉬움: 3, 보통: 5, 어려움: 7 }[answer.level] : 0;
    if (gained !== s.gained || s.finalQuizBonus !== expectedQuizBonus ||
        s.finalCoins !== team.coins + s.gained + s.predictionBonus + expectedQuizBonus) allOk = false;
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

gate('LEAK', '어떤 단계에서도 정산 전에 truth·moves·lastRound·fraudRound·finishRound 가 안 나간다', () => {
  const t = new Table();
  t.open(2, 'H4D');
  const seen: string[] = [];
  const bad: string[] = [];
  const truthStr = t.state().truth.join('","');
  const fraudRound = t.state().fraudRound;

  const inspect = () => {
    const phase = t.state().phase;
    seen.push(phase);
    const tv = t.tv();
    const tvKeys = allKeys(JSON.parse(JSON.stringify(tv)));
    const tvJson = JSON.stringify(tv);
    if (tvKeys.has('moves')) bad.push(`교사뷰(${phase}).moves`);
    if (tvKeys.has('finishRound')) bad.push(`교사뷰(${phase}).finishRound`);
    if (tvKeys.has('hintPool')) bad.push(`교사뷰(${phase}).hintPool`);
    if (tv.truth !== null) bad.push(`교사뷰(${phase}).truth`);
    // ⚠️ 정산 전에는 null 이다. 교사 화면은 TV 에 그대로 뜬다 (RENEWAL §2-3)
    if (tv.fraudRound !== null) bad.push(`교사뷰(${phase}).fraudRound=${String(tv.fraudRound)}`);
    if (tvJson.includes(truthStr)) bad.push(`교사뷰(${phase}) 정답 문자열`);

    for (const n of [1, 2]) {
      const v = JSON.parse(JSON.stringify(t.view(n)));
      const keys = allKeys(v);
      const json = JSON.stringify(v);
      for (const k of ['truth', 'moves', 'lastRound', 'fraudRound', 'finishRound', 'hintPool', 'fraudEnabled']) {
        if (keys.has(k)) bad.push(`모둠뷰(${phase}).${k}`);
      }
      if (json.includes(truthStr)) bad.push(`모둠뷰(${phase}) 정답 문자열`);
      // 스위치가 켜졌다는 것만 알린다 — 어느 라운드인지는 아니다
      if (t.view(n).fraudNotice !== false) bad.push(`모둠뷰(${phase}).fraudNotice`);
    }
  };

  inspect();                                    // waiting
  t.room.advanceRound(t.hostKey); inspect();    // moving
  t.endPhase(); inspect();                      // quiz
  t.endPhase(); inspect();                      // discuss
  t.endPhase(); inspect();                      // betting
  t.endPhase(); inspect();                      // waiting

  // 스위치를 끈 판은 안내 자체가 꺼진다
  const off = new Table();
  off.open(2, 'NOFR2', false);
  if (off.view(1).fraudNotice !== false) bad.push('끈 판인데 fraudNotice=true');

  return { ok: bad.length === 0,
           detail: bad.length ? '⛔ ' + bad.join(', ')
             : `${seen.join('·')} — 6개 단계 × 3개 뷰에서 0건 · 사기 라운드 ${fraudRound} · fraudNotice false` };
});

gate('REVEAL-FRAUD', '거짓 힌트 없는 판은 정산 뒤에도 사기 라운드가 없다', () => {
  const t = new Table();
  t.open(2, 'RVFR');
  const secret = t.state().fraudRound;
  playFullGame(t, 2);
  const before = t.tv().fraudRound;
  const teamBefore = allKeys(JSON.parse(JSON.stringify(t.view(1))));
  t.room.finalize(t.hostKey);
  const after = t.tv().fraudRound;
  // 학생 결과 화면이 "N라운드 힌트가 거짓이었습니다" 를 띄운다 (RENEWAL §4-3) — 정산 뒤에만
  const teamAfter = t.view(1).fraudRound;
  return {
    ok: before === null && after === null && secret === null && !teamBefore.has('fraudRound') && teamAfter === null,
    detail: `정산 전 교사 ${String(before)}·모둠 열쇠 없음 → 정산 후 교사 ${String(after)}·모둠 ${String(teamAfter)}라운드 공개`
  };
});

gate('H4f-raceMoves', 'moving 뷰의 raceMoves 는 동물 8개, 값 0~4 뿐', () => {
  const t = new Table();
  t.open(2, 'H4F');
  t.room.advanceRound(t.hostKey);
  const v = t.view(1), tv = t.tv();
  const okShape = (m: Record<string, number> | undefined) =>
    !!m && Object.keys(m).length === 8 &&
    ANIMAL_CODES.every((c) => Number.isInteger(m[c]) && m[c]! >= 0 && m[c]! <= 4);
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

gate('D6b', 'restore 가 힌트를 되살리고, 복구 뒤에도 같은 자리의 힌트만 나온다', () => {
  const t = new Table();
  t.open(2, 'D6B');
  t.room.advanceRound(t.hostKey);
  t.endPhase();                                  // → quiz
  const first = t.room.submitAnswer(1, '어려움', answerOf(t, 1, '어려움'), t.pins[1]!);
  if (!first.ok) return { ok: false, detail: '첫 제출 실패' };
  const firstHint = first.data.newHint!.text;

  // 스냅샷이 이벤트보다 뒤처진 상황: 판 만든 직후 스냅샷 + 그 뒤 이벤트 전부
  const rec = restore(t.snapshots[0]!, t.events);
  const restoredHints = rec.teams[0]!.hints.length;

  // ⚠️ 예전에는 여기서 hintGiven(모둠별 '이미 준 힌트' 자리)까지 되살려야 했고,
  //    빠뜨리면 복구 직후 1번 힌트가 다시 나갔다. 이제 그 상태가 아예 없다 —
  //    힌트는 (라운드, 난이도)로 정해지므로 되살릴 것이 없다 (RENEWAL §2-2)
  const noGiven = !('hintGiven' in (rec as unknown as Record<string, unknown>));

  // 복구된 상태로 방을 다시 세우고, **다음 라운드**에 같은 난이도를 맞힌다
  const t2 = new Table();
  t2.now = t.now;
  rec.round = 2;
  rec.teams[0]!.answered = {};
  rec.phase = PHASES.QUIZ;
  rec.phaseEndsAt = t2.now + 99_999;
  t2.room.hydrate(rec);
  const second = t2.room.submitAnswer(1, '어려움', answerOf(t2, 2, '어려움'), t.pins[1]!);
  if (!second.ok) return { ok: false, detail: '복구 후 제출 실패: ' + second.message };
  const secondHint = second.data.newHint?.text || '(없음)';

  return {
    ok: restoredHints === 1 && noGiven && secondHint !== firstHint &&
        !!second.data.newHint?.key,
    detail: `복구된 힌트 ${restoredHints}개 · hintGiven 필드 없음 ${noGiven} · ` +
            `2라운드에 다시 맞히니 ` + (secondHint === firstHint ? '⛔ 같은 힌트' : '그 라운드 자리의 힌트가 나갔다')
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
    { code: 'CFG', roomTitle: 'X', setName: '유전', teamCount: 2 },
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

gate('VIEW-TRACK', '뷰가 트랙칸수를 싣고, 교사 뷰만 roundStarted 를 싣는다', () => {
  const t = new Table();
  const r = t.room.create(
    { code: 'TRK', roomTitle: 'X', setName: '유전', teamCount: 2 }, QUESTIONS, ANIMALS, { trackCells: 14 }
  );
  if (!r.ok) return { ok: false, detail: '판 생성 실패' };
  t.hostKey = r.data.hostKey;
  const before = t.tv();
  const adv = t.room.advanceRound(t.hostKey);
  if (!adv.ok) return { ok: false, detail: '진행 실패 ' + adv.error };
  const tv = t.tv(), v = t.view(1);
  return {
    ok: tv.trackCells === 14 && v.trackCells === 14 && before.roundStarted === false && tv.roundStarted === true &&
        !('roundStarted' in v),
    detail: `trackCells 교사 ${tv.trackCells} · 모둠 ${v.trackCells} · roundStarted 시작 전 ${before.roundStarted} → 시작 후 ${tv.roundStarted} · 모둠 뷰에는 없음`
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

// ── 조기 종료 — 교사 버튼 · 자동 단축 ───────────────────────

gate('SKIP1', 'quiz 중 넘기면 즉시 discuss — 안 낸 모둠은 알람 경로와 똑같이 timeout', () => {
  const t = new Table();
  t.open(3, 'SKP1');
  t.room.advanceRound(t.hostKey);
  t.endPhase();                                   // → quiz
  const sub = t.room.submitAnswer(1, '쉬움', answerOf(t, 1, '쉬움'), t.pins[1]!);
  t.tick(4_000);                                  // 아직 86초 남았다
  const r = t.room.skipPhase(t.hostKey);

  const st = t.state();
  const a1 = st.teams[0]!.answered[1]!;
  const a2 = st.teams[1]!.answered[1];
  const a3 = st.teams[2]!.answered[1];
  const skips = t.events.filter((e) => e.kind === 'skip');
  return {
    ok: sub.ok && r.ok && st.phase === PHASES.DISCUSS && r.data.phase === PHASES.DISCUSS &&
        a1.correct === true && !a1.timeout && a2?.timeout === true && a3?.timeout === true &&
        st.phaseEndsAt === t.now + DEFAULTS.discussSeconds * 1000 && t.alarmAt === st.phaseEndsAt &&
        skips.length === 1 && skips[0]!.payload.phase === PHASES.QUIZ,
    detail: `86초 남기고 넘김 → ${st.phase} (${DEFAULTS.discussSeconds}초 새로 시작) · ` +
            `1모둠 정답 그대로, 안 낸 2·3모둠만 미제출 · skip 이벤트 ${skips.length}건`
  };
});

gate('SKIP2', 'discuss 스킵 → betting, betting 스킵 → waiting + 전 모둠 betLocked', () => {
  const t = new Table();
  t.open(3, 'SKP2');
  t.room.advanceRound(t.hostKey);
  t.endPhase(); t.endPhase();                     // moving → quiz → discuss
  const a = t.room.skipPhase(t.hostKey);
  const toBetting = t.state().phase === PHASES.BETTING &&
                    t.state().phaseEndsAt === t.now + DEFAULTS.betSeconds * 1000;

  t.room.placeBet(1, { A: 1 }, t.pins[1]!);       // 3모둠 중 하나만 걸었다
  const b = t.room.skipPhase(t.hostKey);
  const st = t.state();
  const locked = st.teams.every((x) => x.betLocked[st.round] === true);
  return {
    ok: a.ok && b.ok && toBetting && st.phase === PHASES.WAITING &&
        st.phaseEndsAt === null && t.alarmAt === null && locked,
    detail: `discuss → ${toBetting ? `betting(${DEFAULTS.betSeconds}초)` : '⛔'} → ${st.phase} · ` +
            `안 건 모둠까지 betLocked ${locked} (알람 경로와 같다) · 알람 해제 ${t.alarmAt === null}`
  };
});

gate('SKIP3', 'moving·waiting·done·일시정지 중에는 못 넘기고 상태가 그대로다', () => {
  const notes: string[] = [];
  let allOk = true;
  // ⚠️ phaseEndsAt·stateVersion·알람까지 본다. 코드만 맞고 시각이 당겨지면 화면은 이미 망가진다
  const snap = (x: Table) =>
    JSON.stringify([x.state().phase, x.state().phaseEndsAt, x.state().stateVersion, x.alarmAt]);

  const check = (label: string, x: Table, expect: string) => {
    const before = snap(x);
    const r = x.room.skipPhase(x.hostKey);
    const code = r.ok ? 'ok⛔' : r.error;
    allOk = allOk && code === expect && snap(x) === before;
    notes.push(`${label} ${code}`);
  };

  const w = new Table(); w.open(2, 'SKP3A');
  check('waiting', w, 'NOT_SKIPPABLE');

  const m = new Table(); m.open(2, 'SKP3B');
  m.room.advanceRound(m.hostKey);                 // → moving
  check('moving', m, 'NOT_SKIPPABLE');

  const d = new Table(); d.open(2, 'SKP3C');
  playFullGame(d, 2);
  d.room.advanceRound(d.hostKey);                 // → done
  check('done', d, 'NOT_SKIPPABLE');

  const p = new Table(); p.open(2, 'SKP3D');
  p.room.advanceRound(p.hostKey); p.endPhase();   // → quiz
  p.room.togglePause(p.hostKey);
  check('멈춤(quiz)', p, 'PAUSED');
  // 재개하면 다시 넘길 수 있어야 한다 — 멈춤이 버튼을 영영 죽이면 안 된다
  p.room.togglePause(p.hostKey);
  const resumed = p.room.skipPhase(p.hostKey);
  allOk = allOk && resumed.ok && p.state().phase === PHASES.DISCUSS;

  return {
    ok: allOk,
    detail: `${notes.join(' · ')} — 네 경우 모두 단계·마감시각·stateVersion·알람 불변 · ` +
            `재개 후에는 ${p.state().phase} 로 넘어감`
  };
});

gate('SKIP4', '틀린 열쇠로는 못 넘긴다', () => {
  const t = new Table();
  t.open(2, 'SKP4');
  t.room.advanceRound(t.hostKey);
  t.endPhase();                                   // → quiz
  const before = JSON.stringify([t.state().phase, t.state().phaseEndsAt, t.state().stateVersion]);
  const wrong = t.room.skipPhase('AAAAAAAAAAAA');
  const empty = t.room.skipPhase('');
  const after = JSON.stringify([t.state().phase, t.state().phaseEndsAt, t.state().stateVersion]);
  const real = t.room.skipPhase(t.hostKey);
  return {
    ok: !wrong.ok && wrong.error === 'NOT_HOST' && !empty.ok && empty.error === 'NOT_HOST' &&
        before === after && real.ok && t.state().phase === PHASES.DISCUSS,
    detail: `틀린 열쇠 ${wrong.ok ? 'ok⛔' : wrong.error} · 빈 열쇠 ${empty.ok ? 'ok⛔' : empty.error} · ` +
            `거부 뒤에도 quiz 그대로 · 진짜 열쇠로는 ${t.state().phase}`
  };
});

gate('AUTO1', 'quiz — 마지막 모둠이 답을 내면 마감이 5초 뒤로 당겨진다 (일부만 냈을 땐 그대로)', () => {
  const t = new Table();
  t.open(3, 'AUT1');
  t.room.advanceRound(t.hostKey);
  t.endPhase();                                   // → quiz
  const full = t.state().phaseEndsAt!;

  t.room.submitAnswer(1, '쉬움', answerOf(t, 1, '쉬움'), t.pins[1]!);
  t.room.submitAnswer(2, '쉬움', 99, t.pins[2]!);
  const partialKept = t.state().phaseEndsAt === full && t.alarmAt === full;

  t.tick(3_000);
  t.room.submitAnswer(3, '보통', answerOf(t, 1, '보통'), t.pins[3]!);
  const st = t.state();
  const target = t.now + DEFAULTS.autoSkipSeconds * 1000;
  const shortened = st.phaseEndsAt === target && t.alarmAt === target;
  // ⚠️ 당기기만 한다. 여기서 단계를 바꾸면 전환 로직이 두 벌이 된다
  const stillQuiz = st.phase === PHASES.QUIZ;
  t.endPhase();
  const moved = t.state().phase === PHASES.DISCUSS;

  // 남은 시간이 이미 5초보다 짧으면 그대로 둔다 — 마지막 제출이 단계를 **늘리면** 안 된다
  const t2 = new Table();
  t2.open(2, 'AUT1B');
  t2.room.advanceRound(t2.hostKey); t2.endPhase();
  const end2 = t2.state().phaseEndsAt!;
  t2.advanceTo(end2 - 2_000);
  t2.room.submitAnswer(1, '쉬움', answerOf(t2, 1, '쉬움'), t2.pins[1]!);
  t2.room.submitAnswer(2, '쉬움', answerOf(t2, 1, '쉬움'), t2.pins[2]!);
  const notExtended = t2.state().phaseEndsAt === end2 && t2.alarmAt === end2;

  return {
    ok: partialKept && shortened && stillQuiz && moved && notExtended,
    detail: `2/3모둠 제출: 마감 그대로(${partialKept}) → 3/3모둠: ${(full - target) / 1000}초 당겨져 ` +
            `${DEFAULTS.autoSkipSeconds}초 뒤 · 단계는 아직 quiz(${stillQuiz}), 알람이 discuss 로(${moved}) · ` +
            `2초 남았을 때 전원 제출해도 안 늘어남(${notExtended})`
  };
});

gate('AUTO2', 'betting — 마지막 모둠이 확정하면 같은 방식으로 당겨진다', () => {
  const t = new Table();
  t.open(3, 'AUT2');
  t.room.advanceRound(t.hostKey);
  t.endPhase(); t.endPhase(); t.endPhase();       // → betting
  const full = t.state().phaseEndsAt!;

  t.room.placeBet(1, { A: 1 }, t.pins[1]!);
  t.room.placeBet(2, { B: 2 }, t.pins[2]!);
  const partialKept = t.state().phaseEndsAt === full && t.alarmAt === full;

  t.tick(2_000);
  t.room.placeBet(3, { C: 3 }, t.pins[3]!);
  const st = t.state();
  const target = t.now + DEFAULTS.autoSkipSeconds * 1000;
  const shortened = st.phaseEndsAt === target && t.alarmAt === target && st.phase === PHASES.BETTING;
  t.endPhase();
  const moved = t.state().phase === PHASES.WAITING;

  const t2 = new Table();
  t2.open(2, 'AUT2B');
  t2.room.advanceRound(t2.hostKey);
  t2.endPhase(); t2.endPhase(); t2.endPhase();
  const end2 = t2.state().phaseEndsAt!;
  t2.advanceTo(end2 - 1_000);
  t2.room.placeBet(1, { A: 1 }, t2.pins[1]!);
  t2.room.placeBet(2, { A: 1 }, t2.pins[2]!);
  const notExtended = t2.state().phaseEndsAt === end2;

  return {
    ok: partialKept && shortened && moved && notExtended,
    detail: `2/3모둠 확정: 마감 그대로(${partialKept}) → 3/3모둠: ${DEFAULTS.autoSkipSeconds}초 뒤로 당겨짐 · ` +
            `알람이 ${t.state().phase} 로(${moved}) · 1초 남았을 땐 안 늘어남(${notExtended})`
  };
});

gate('AUTO3', `discuss 는 어떤 조건에도 당겨지지 않는다 (토론 ${DEFAULTS.discussSeconds}초가 이 수업의 실체)`, () => {
  const t = new Table();
  t.open(2, 'AUT3');
  t.room.advanceRound(t.hostKey);
  t.endPhase();                                   // → quiz
  // '모둠이 다 했다'가 참인 가장 강한 조건으로 토론에 들어간다
  t.room.submitAnswer(1, '쉬움', answerOf(t, 1, '쉬움'), t.pins[1]!);
  t.room.submitAnswer(2, '보통', answerOf(t, 1, '보통'), t.pins[2]!);
  t.endPhase();                                   // → discuss

  const full = t.state().phaseEndsAt!;
  const okFull = full === t.now + DEFAULTS.discussSeconds * 1000;

  // 토론 중에 학생이 무엇을 눌러도 마감이 움직이지 않는다
  const sub = t.room.submitAnswer(1, '쉬움', 1, t.pins[1]!);
  const bet = t.room.placeBet(1, { A: 1 }, t.pins[1]!);
  t.tick(30_000);
  const bet2 = t.room.placeBet(2, { A: 1 }, t.pins[2]!);
  const untouched = t.state().phaseEndsAt === full && t.alarmAt === full;
  const neverDone = allTeamsDone(t.state()) === false && t.tv().allDone === false;

  t.endPhase();
  const rode = t.state().phase === PHASES.BETTING;

  return {
    ok: okFull && !sub.ok && !bet.ok && !bet2.ok && untouched && neverDone && rode,
    detail: `전원 제출한 채 토론 시작 → ${DEFAULTS.discussSeconds}초 그대로(${okFull}) · ` +
            `30초 뒤에도 마감 불변(${untouched}) · allDone 은 토론에서 언제나 false(${neverDone}) · ` +
            `제 시각에 ${t.state().phase}`
  };
});

gate('AUTO4', '자동단축초가 0 이면 자동 단축이 없다', () => {
  const t = new Table();
  const r = t.room.create(
    { code: 'AUT4', roomTitle: 'X', setName: '유전', teamCount: 2 }, QUESTIONS, ANIMALS,
    { autoSkipSeconds: 0 }
  );
  if (!r.ok) return { ok: false, detail: '판 생성 실패' };
  t.hostKey = r.data.hostKey; t.pins = r.data.pins;

  t.room.advanceRound(t.hostKey);
  t.endPhase();                                   // → quiz
  const qFull = t.state().phaseEndsAt!;
  t.room.submitAnswer(1, '쉬움', answerOf(t, 1, '쉬움'), t.pins[1]!);
  t.room.submitAnswer(2, '쉬움', answerOf(t, 1, '쉬움'), t.pins[2]!);
  const quizKept = t.state().phaseEndsAt === qFull && t.alarmAt === qFull;

  t.endPhase(); t.endPhase();                     // → discuss → betting
  const bFull = t.state().phaseEndsAt!;
  t.room.placeBet(1, { A: 1 }, t.pins[1]!);
  t.room.placeBet(2, { A: 1 }, t.pins[2]!);
  const betKept = t.state().phaseEndsAt === bFull && t.alarmAt === bFull;

  return {
    ok: quizKept && betKept && t.state().settings.autoSkipSeconds === 0 && r.data.warnings.length === 0,
    detail: `문제 ${DEFAULTS.quizSeconds}초·베팅 ${DEFAULTS.betSeconds}초 전부 그대로 흐름 · ` +
            `0 은 범위 안이라 경고 ${r.data.warnings.length}건`
  };
});

gate('VIEW-SKIP', '교사 뷰에만 canSkip·allDone 이 있고, 값이 단계·진행과 맞는다', () => {
  const t = new Table();
  t.open(2, 'VSKP');
  const seen: string[] = [];
  const bad: string[] = [];
  const check = (label: string, canSkip: boolean, allDone: boolean) => {
    const tv = t.tv();
    seen.push(`${label}${tv.canSkip ? '↦' : '·'}${tv.allDone ? '✓' : '·'}`);
    if (tv.canSkip !== canSkip) bad.push(`${label}.canSkip=${tv.canSkip}`);
    if (tv.allDone !== allDone) bad.push(`${label}.allDone=${tv.allDone}`);
  };

  check('waiting', false, false);
  t.room.advanceRound(t.hostKey);            check('moving', false, false);
  t.endPhase();                              check('quiz', true, false);
  t.room.submitAnswer(1, '쉬움', answerOf(t, 1, '쉬움'), t.pins[1]!);
  check('quiz-1모둠', true, false);
  t.room.togglePause(t.hostKey);             check('quiz-멈춤', false, false);
  t.room.togglePause(t.hostKey);
  t.room.submitAnswer(2, '쉬움', 99, t.pins[2]!);
  check('quiz-전원', true, true);
  t.endPhase();                              check('discuss', true, false);
  t.endPhase();                              check('betting', true, false);
  t.room.placeBet(1, { A: 1 }, t.pins[1]!);
  t.room.placeBet(2, { A: 1 }, t.pins[2]!);
  check('betting-전원', true, true);
  t.endPhase();                              check('waiting2', false, false);

  // ⚠️ 모둠 뷰에는 없어야 한다 — 학생 폰이 '곧 넘어간다'를 먼저 알면 안 낸 모둠이 재촉당한다
  const keys = allKeys(JSON.parse(JSON.stringify(t.view(1))));
  for (const k of ['canSkip', 'allDone']) if (keys.has(k)) bad.push(`모둠뷰.${k}`);

  return { ok: bad.length === 0,
           detail: bad.length ? '⛔ ' + bad.join(', ') : `${seen.join(' ')} (↦=canSkip, ✓=allDone) · 모둠 뷰에는 두 열쇠 모두 없음` };
});

console.log('\n====================================================');
console.log(`방 코어 게이트 — 통과 ${pass} / 실패 ${fail}`);
console.log('====================================================\n');
if (fail) process.exit(1);
