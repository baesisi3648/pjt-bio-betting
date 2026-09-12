/**
 * room.ts — 판 하나의 코어. **런타임에 의존하지 않는다.**
 *
 * apps-script/Code.gs 의 게이트웨이 16개 중 게임에 관한 것을 전부 옮겼다.
 * 시각·저장·알람·통신은 전부 생성자로 주입받는다(RoomDeps). 그래서
 *   - 테스트는 가짜 시계와 가짜 알람으로 이 클래스를 그대로 돌린다 (test/room.ts)
 *   - Durable Object 어댑터(GameRoom.ts)는 진짜 시계·storage·WebSocket 을 꽂는다
 * 이 분리를 없애면 통합 게이트를 돌리는 데 workerd 가 필요해진다.
 *
 * ── 앱스 스크립트판과 일부러 다르게 한 것 ──
 *
 * 1. `withLock` 이 없다. Durable Object 는 판마다 단일 스레드다 (MIGRATION §4-7).
 *    대신 **이 파일의 모든 메서드는 동기 함수다.** 읽고→고치고→쓰기 사이에 await 가
 *    하나라도 들어가면 그 틈으로 다른 요청이 끼어들어 코인이 증발한다.
 *    저장은 deps.persist 로 던지기만 하고 기다리지 않는다 — DO 의 output gate 가
 *    "저장이 끝나기 전에는 응답이 나가지 않는다"를 보장한다.
 *
 * 2. `autoAdvance` 가 없다. 앱스 스크립트에는 타이머가 없어서 "누가 상태를 읽을 때
 *    시간이 지났으면 그때 넘긴다"로 처리했고, 그게 마감 직전 정답을 '미제출'로
 *    덮어쓰는 경합을 낳았다 (게이트 RACE1). 여기서는 단계 전환이 오직 onAlarm()
 *    한 곳에서만 일어난다. **읽기 경로는 상태를 절대 쓰지 않는다.**
 *
 * 3. `moving`(경주) 단계가 있다. 사용자 결정 (MIGRATION §8-3, §10).
 */

import {
  ANIMAL_CODES, DEFAULTS, LEVELS, MESSAGES, PHASES, ROUNDS, SETTING_RANGE
} from '../game/config.ts';
import type { AnimalCode, Level, Settings } from '../game/config.ts';
import {
  buildFraudRound, buildHintPlan, computeOdds, makeCode, makeHostKey, makePin,
  planQuestions, planRace, positionsAtRound, rankByPosition, settle, validateBet
} from '../game/rules.ts';
import type {
  AnswerRecord, Bets, GameState, Hint, Question, Rng, Team
} from '../game/types.ts';
import {
  allTeamsDone, canSkipNow, currentPositions, finalizeView, handoutView, lobbyView,
  revealView, teacherView, teamView
} from '../game/views.ts';
import type {
  FinalizeView, HandoutView, LobbyView, RevealView, TeacherView, TeamView
} from '../game/views.ts';

// ────────────────────────────────────────────────────────────
// 봉투 · 이벤트 · 의존성
// ────────────────────────────────────────────────────────────

/** 게이트웨이 응답 봉투 (MIGRATION §8-1). error 는 코드, message 는 학생이 읽을 문장 */
export type Ok<T> = { ok: true; data: T };
export type Err = { ok: false; error: string; message: string };
export type Envelope<T> = Ok<T> | Err;

export function ok<T>(data: T): Ok<T> { return { ok: true, data }; }
export function err(code: string, message?: string): Err {
  return { ok: false, error: code, message: message || MESSAGES[code] || '문제가 생겼어요' };
}

export type EventKind = 'answer' | 'bet' | 'round_start' | 'pause' | 'skip';

/**
 * 이벤트 로그 한 줄 (MIGRATION §8-4).
 * '기록' 시트의 [번호, 판코드, 라운드, 모둠번호, 종류, JSON내용, 시각] 과 같은 순서다.
 *
 * ⚠️ at 은 숫자(ms)다. Date 객체를 넣으면 직렬화 경계에서 응답이 통째로 죽는다 (§5).
 *
 * DO 는 상태를 잃지 않으므로 이 로그는 복구용이라기보다 **감사용**이다.
 * 그래도 restore() 를 유지하는 이유는, 상태가 이상해졌을 때 스냅샷+재생으로
 * 무슨 일이 있었는지 되짚을 수 있는 유일한 수단이기 때문이다 (MIGRATION §6).
 */
export interface GameEvent {
  seq: number;
  code: string;
  round: number;
  teamNo: number | null;
  kind: EventKind;
  payload: Record<string, unknown>;
  at: number;
}

export interface RoomDeps {
  now(): number;
  /** null = 알람 취소 */
  setAlarm(at: number | null): void;
  /** ⚠️ await 하지 않는다 — §4-7 */
  persist(state: GameState): void;
  appendEvent(ev: GameEvent): void;
  /** 상태가 바뀌었다 → 어댑터가 연결된 소켓에 각자의 뷰를 푸시한다 */
  changed(): void;
  /** 테스트에서 시드를 고정한다 */
  rng?: Rng;
}

export interface AnimalTable {
  names: Record<AnimalCode, string>;
  emojis: Record<AnimalCode, string>;
}

export interface CreateConfig {
  /** DO 는 판 코드 하나가 인스턴스 하나라, 코드는 보통 Worker 가 정해서 넘긴다 */
  code?: string;
  /** 화면에 뜨는 방 이름 (예전 className) */
  roomTitle: string;
  /** 문제 세트 이름. 전체를 고르면 비운다 (예전 unit) */
  setName?: string | null;
  /** 사기 라운드 스위치. **기본은 켬** (RENEWAL §1) */
  fraudEnabled?: boolean;
  teamCount: number;
  teamNames?: string[];
  /** 문제은행 검증에서 나온 경고를 그대로 교사 화면까지 흘려보낸다 */
  warnings?: string[];
}

export interface CreateResult {
  code: string;
  hostKey: string;
  pins: Record<number, string>;
  teams: { no: number; name: string }[];
  warnings: string[];
}

/**
 * '설정' 값이 범위를 벗어나면 기본값으로 되돌리고 무엇을 되돌렸는지 알린다.
 *
 * ⚠️ 되돌리면 '90초' 같은 값이 NaN 이 되어 타이머가 멎는다 (MIGRATION §5).
 *    새로 생긴 moveSeconds 가 NaN 이면 phaseEndsAt 이 NaN 이 되고,
 *    알람 시각이 NaN 이라 **경주가 영원히 안 끝난다.** 여기서 막는다.
 */
export function normalizeSettings(raw: Partial<Settings> | undefined, issues: string[]): Settings {
  const out: Settings = { ...DEFAULTS, payout: { ...DEFAULTS.payout } };
  if (!raw) return out;

  for (const key of Object.keys(SETTING_RANGE) as (keyof Settings)[]) {
    const rule = SETTING_RANGE[key as string]!;
    const v = raw[key] as unknown;
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    const okNum = isFinite(n) && Math.floor(n) === n;
    if (!okNum || n < rule.min || n > rule.max) {
      issues.push(
        `설정 ${rule.label} — ` +
        (okNum ? `${n} 은(는) ${rule.min}~${rule.max} 범위 밖이라` : `'${String(v)}' 은(는) 숫자가 아니라`) +
        ` 기본값 ${String(DEFAULTS[key as keyof typeof DEFAULTS])} 을(를) 씁니다.`
      );
      continue;
    }
    (out as Record<string, unknown>)[key as string] = n;
  }
  if (raw.payout && typeof raw.payout === 'object') out.payout = { ...raw.payout };
  return out;
}

// ────────────────────────────────────────────────────────────
// 방
// ────────────────────────────────────────────────────────────

export class Room {
  private state: GameState | null = null;
  private deps: RoomDeps;

  // ⚠️ 생성자 매개변수 속성(`constructor(private deps)`)을 쓰지 않는다.
  //    Node 24 가 .ts 를 그대로 실행할 때(strip-only) 그 문법만은 못 지운다 —
  //    빌드 단계 없이 테스트가 도는 이 저장소의 전제가 깨진다.
  constructor(deps: RoomDeps) { this.deps = deps; }

  private get rng(): Rng { return this.deps.rng || Math.random; }

  /** 깨어날 때 저장소에서 올린 상태를 꽂는다 */
  hydrate(state: GameState | null): void { this.state = state; }

  /** 감사·디버깅용. 뷰가 아니므로 밖으로 내보내면 안 된다 (truth 가 들어 있다) */
  raw(): GameState | null { return this.state; }

  exists(): boolean { return !!this.state; }

  /** 스냅샷 + 그 뒤 이벤트 재생으로 상태를 되살린다 (게이트 D6b) */
  restoreFrom(snapshot: GameState, events: GameEvent[]): void {
    this.state = restore(snapshot, events);
  }

  // ── 인증 ──────────────────────────────────────────────

  /**
   * ⚠️ 되돌리면 학생이 정답 순위와 모둠 암호를 그대로 본다.
   *
   * 판 코드는 칠판에 적혀 있으니 비밀이 아니다 (MIGRATION §4-4).
   * 교사만 알아야 하는 것은 코드가 아니라 이 열쇠로 지킨다.
   */
  private hostGate(state: GameState, hostKey: string | null | undefined): Err | null {
    if (!state.hostKey) return err('NOT_HOST');
    if (String(hostKey || '') !== String(state.hostKey)) return err('NOT_HOST');
    return null;
  }

  /**
   * ⚠️ 되돌리면 한 학생이 다른 모둠의 답과 베팅을 대신 낸다.
   *
   * 모둠 암호를 접속할 때 한 번만 맞춰보면 아무것도 못 지킨다 —
   * 판 코드만 알면 모둠 번호는 1~6 중 하나라 그냥 찍으면 되기 때문이다.
   * 그래서 모둠 이름으로 무언가를 하는 모든 호출이 매번 다시 본다.
   * (상태 조회도 포함이다. 남의 모둠 상태를 읽으면 벌어온 힌트를 그냥 가져간다)
   */
  private checkTeam(
    state: GameState, teamNo: number, pin: string | null | undefined
  ): { team: Team } | { error: Err } {
    const team = state.teams.find((t) => t.no === Number(teamNo));
    if (!team) return { error: err('GAME_NOT_FOUND') };
    if (String(team.pin) !== String(pin)) return { error: err('WRONG_PIN') };
    return { team };
  }

  /**
   * 마감 시각이 지났는가. 알람은 몇백 ms 늦게 올 수 있는데, 그 틈에 들어온 제출·베팅을
   * 받으면 학생 폰에서는 0초를 본 뒤에 낸 답이 들어간다 — "시간 판단은 전부 서버에서"가
   * 앱스 스크립트판부터 지켜온 원칙이다 (Code.gs 는 autoAdvance 로 같은 효과를 냈다).
   * ⚠️ 여기서는 **읽기만** 한다. 전환은 여전히 onAlarm() 의 몫이다 (RACE1).
   */
  private closedByClock(state: GameState): boolean {
    return !!state.phaseEndsAt && !state.pausedAt && this.deps.now() >= state.phaseEndsAt;
  }

  private live(): { state: GameState } | { error: Err } {
    if (!this.state) return { error: err('GAME_NOT_FOUND') };
    return { state: this.state };
  }

  // ── 1. 판 만들기 ──────────────────────────────────────

  create(
    config: CreateConfig,
    questions: Question[],
    animals: AnimalTable,
    rawSettings?: Partial<Settings>
  ): Envelope<CreateResult> {
    if (this.state) return err('GAME_EXISTS');

    const warnings = (config.warnings || []).slice();
    const settings = normalizeSettings(rawSettings, warnings);

    // 경주 계획 — 순위를 먼저 정하고 이동을 역산한다 (§4-2). 실패하면 다시 굴린다
    //
    // ⚠️ 트랙칸수가 5 미만이면 4~8위를 서로 다른 칸에 못 세우고, 24 이상이면
    //    1위가 1라운드부터 3칸씩 달려야 해서 선두가 안 바뀐다 (RENEWAL §2-1 조건 5·6).
    //    SETTING_RANGE 가 먼저 5~23 으로 막지만, 만들 수 없는 값이면 여기서도 이유를 말한다 —
    //    조용히 조건을 포기하면 힌트가 겹치거나 경주가 밋밋해진다
    const race = planRace(this.rng, settings.trackCells, ROUNDS);
    if (!race) {
      return err('SHEET_INVALID', `경주를 만들지 못했어요. '설정'의 트랙칸수를 5~23 사이로 해주세요 (지금 ${settings.trackCells}).`);
    }

    // 사기 라운드는 2·3·4 중 하나. 스위치를 끄면 없다 (RENEWAL §1)
    const fraudEnabled = config.fraudEnabled !== false;
    const fraudRound = fraudEnabled ? buildFraudRound(this.rng) : null;
    // ⚠️ 문장과 논리식이 **한 번의 호출**에서 같이 나온다. 따로 부르면 무작위 선택이
    //    갈라져 게이트가 다른 문장을 검증하게 된다 (rules.buildHintPlan 주석)
    const hintPlan = buildHintPlan(race.truth, animals.names, this.rng, { fraudRound, rounds: ROUNDS });

    const byLevel: Partial<Record<Level, Question[]>> = {};
    for (const lv of LEVELS) byLevel[lv] = [];
    for (const q of questions) if (byLevel[q.level]) byLevel[q.level]!.push(q);

    const teamCount = Math.max(1, Math.floor(Number(config.teamCount) || 0));
    const teams: Team[] = [];
    for (let i = 0; i < teamCount; i++) {
      teams.push({
        no: i + 1,
        name: (config.teamNames && config.teamNames[i]) || `${i + 1}모둠`,
        pin: makePin(this.rng),
        coins: settings.initialCoins,
        hints: [], answered: {}, bets: {}, betLocked: {}
      });
    }

    const pool = {} as GameState['pool'];
    for (const c of ANIMAL_CODES) pool[c] = settings.seedCoins;

    const state: GameState = {
      version: 1,
      code: config.code || makeCode(this.rng),
      hostKey: makeHostKey(this.rng),
      roomTitle: config.roomTitle,
      setName: config.setName ?? null,
      fraudEnabled,
      fraudRound,
      round: 1,
      lastRound: race.lastRound,
      phase: PHASES.WAITING,
      roundStarted: false,
      phaseEndsAt: null,
      pausedAt: null,
      stateVersion: 1,
      eventSeq: 0,
      truth: race.truth,
      moves: race.moves,
      finishRound: race.finishRound,
      animals: animals.names,
      emojis: animals.emojis,
      // 사기 라운드 자리는 이미 거짓 문장으로 치환돼 있다 — 지급할 때 다시 따지지 않는다
      hintPool: hintPlan.texts,
      // ⚠️ lastRound 가 아니라 ROUNDS(10)만큼 배정한다. 지금은 둘이 같지만(골인 8·9·10 고정)
      //    옛 규칙에서는 9라운드 분만 배정하면 "10라운드에 문제가 없다"로 마지막 라운드가
      //    드러났다. 배정 기준은 계속 ROUNDS 다 (§4-1)
      questionPlan: planQuestions(byLevel, ROUNDS, this.rng),
      questionById: {},
      pool,
      teams,
      settings,
      isOver: false,
      settlement: null
    };

    // ⚠️ 배정된 문항의 **내용까지** 상태에 굳힌다 (§4-6).
    //    라운드마다 문제은행을 다시 뒤지면 복구 후 다른 문제가 나온다.
    const byId: Record<number, Question> = {};
    for (const q of questions) byId[q.id] = q;
    for (const r of Object.keys(state.questionPlan)) {
      const plan = state.questionPlan[Number(r)]!;
      for (const lv of Object.keys(plan) as Level[]) {
        const id = plan[lv];
        if (id != null && byId[id]) state.questionById[id] = byId[id];
      }
    }

    this.state = state;
    this.deps.persist(state);
    this.deps.changed();

    const pins: Record<number, string> = {};
    for (const t of teams) pins[t.no] = t.pin;
    return ok({
      code: state.code, hostKey: state.hostKey, pins,
      teams: teams.map((t) => ({ no: t.no, name: t.name })),
      warnings
    });
  }

  // ── 2. 접속 ───────────────────────────────────────────

  /** 접속 점유를 두지 않는다 — 두면 새로고침한 폰이 자기 자신 때문에 막힌다 (게이트 H8) */
  join(teamNo: number, pin: string): Envelope<TeamView> {
    const g = this.live();
    if ('error' in g) return g.error;
    if (g.state.isOver) return err('GAME_ENDED');
    const t = this.checkTeam(g.state, teamNo, pin);
    if ('error' in t) return t.error;
    return ok(teamView(g.state, teamNo, this.deps.now()));
  }

  lobby(): Envelope<LobbyView> {
    const g = this.live();
    if ('error' in g) return g.error;
    if (g.state.isOver) return err('GAME_ENDED');
    return ok(lobbyView(g.state));
  }

  // ── 3. 상태 조회 ───────────────────────────────────────

  /**
   * ⚠️ 이 경로는 **상태를 절대 쓰지 않는다.**
   *    앱스 스크립트판은 여기서 autoAdvance 를 불렀고, 그 때문에 단계가 끝나는 순간의
   *    폴링이 낡은 상태를 덮어써서 마감 직전 정답이 '미제출'로 바뀌었다 (게이트 RACE1).
   *    단계 전환은 onAlarm() 한 곳에서만 일어난다.
   */
  getState(
    viewer: string | null | undefined, hostKey?: string | null, pin?: string | null
  ): Envelope<TeamView | TeacherView> {
    const g = this.live();
    if ('error' in g) return g.error;
    const now = this.deps.now();

    if (viewer && viewer.indexOf('team:') === 0) {
      const teamNo = Number(viewer.split(':')[1]);
      const t = this.checkTeam(g.state, teamNo, pin);
      if ('error' in t) return t.error;
      return ok(teamView(g.state, teamNo, now));
    }
    // team: 이 아닌 것은 전부 교사 경로다 — 아무 문자열이나 넣어도 열쇠를 요구한다 (SEC2)
    const gate = this.hostGate(g.state, hostKey);
    if (gate) return gate;
    return ok(teacherView(g.state, now));
  }

  // ── 4. 문제 · 답 ───────────────────────────────────────

  chooseLevel(
    teamNo: number, level: Level, pin: string
  ): Envelope<{ level: Level; question: { text: string; choices: string[] } }> {
    const g = this.live();
    if ('error' in g) return g.error;
    const state = g.state;
    if (state.pausedAt) return err('PAUSED');
    if (state.phase !== PHASES.QUIZ || this.closedByClock(state)) return err('QUIZ_CLOSED');

    const t = this.checkTeam(state, teamNo, pin);
    if ('error' in t) return t.error;
    if (t.team.answered[state.round]) return err('ALREADY_ANSWERED');

    const q = this.questionFor(state.round, level);
    if (!q) return err('SHEET_INVALID');
    return ok({ level, question: { text: q.text, choices: q.choices } });
  }

  submitAnswer(
    teamNo: number, level: Level, choice: number, pin: string
  ): Envelope<{ correct: boolean; answer: number; explanation: string; newHint: Hint | null }> {
    const g = this.live();
    if ('error' in g) return g.error;
    const state = g.state;
    if (state.pausedAt) return err('PAUSED');
    if (state.phase !== PHASES.QUIZ || this.closedByClock(state)) return err('QUIZ_CLOSED');

    const t = this.checkTeam(state, teamNo, pin);
    if ('error' in t) return t.error;
    const team = t.team;
    if (team.answered[state.round]) return err('ALREADY_ANSWERED');

    const q = this.questionFor(state.round, level);
    if (!q) return err('SHEET_INVALID');

    const correct = Number(choice) === Number(q.answer);
    const hint = correct ? this.hintFor(state.round, level) : null;
    const record: AnswerRecord = { level, choice: Number(choice), correct, hint };

    team.answered[state.round] = record;
    if (hint) team.hints.push(hint);

    this.event('answer', teamNo, record as unknown as Record<string, unknown>);
    // 마지막 모둠이 냈으면 남은 90초를 다 기다리지 않는다 (아래 주석 참조)
    this.autoShorten();
    state.stateVersion++;
    this.deps.persist(state);
    this.deps.changed();

    return ok({ correct, answer: q.answer, explanation: q.explanation, newHint: hint });
  }

  /**
   * 이 라운드·이 난이도의 힌트. **라운드와 난이도만으로 정해진다** (RENEWAL §2-2).
   *
   * ⚠️ 예전에는 모둠마다 '이미 준 힌트' 목록(`hintGiven`)을 들고 다음 것을 꺼냈고,
   *    복구할 때 그 목록을 빠뜨려 같은 힌트가 두 번 나갔다 (옛 게이트 D6b).
   *    이제 그 상태 자체가 없다 — 같은 라운드에 같은 난이도를 고른 모둠은 **같은 힌트**를
   *    받고(RENEWAL §1), 한 라운드에 한 번만 제출할 수 있으므로(ALREADY_ANSWERED)
   *    같은 모둠이 같은 힌트를 두 번 받을 길이 없다.
   * ⚠️ 사기 라운드 판단을 여기서 다시 하지 않는다. hintPool 에 이미 거짓 문장이
   *    들어 있다 — 판단이 두 벌이면 한쪽만 고치는 날 참 힌트가 나간다 (MIGRATION §5).
   */
  private hintFor(round: number, level: Level): Hint | null {
    const pool = this.state!.hintPool[level] || [];
    const text = pool[round - 1];
    return text ? { round, level, text } : null;
  }

  /**
   * 문항은 판을 만들 때 내용까지 굳혔다 (§4-6).
   * 문제은행을 다시 뒤지지 않으므로, 수업 중에 문제은행이 바뀌어도 판은 흔들리지 않는다.
   */
  private questionFor(round: number, level: Level): Question | null {
    const state = this.state!;
    const plan = state.questionPlan[round];
    if (!plan) return null;
    const id = plan[level];
    if (id == null) return null;
    return state.questionById[id] || null;
  }

  // ── 5. 베팅 ───────────────────────────────────────────

  placeBet(teamNo: number, bets: Bets, pin: string): Envelope<TeamView> {
    const g = this.live();
    if ('error' in g) return g.error;
    const state = g.state;
    if (state.pausedAt) return err('PAUSED');
    if (state.phase !== PHASES.BETTING || this.closedByClock(state)) return err('BET_CLOSED');

    const t = this.checkTeam(state, teamNo, pin);
    if ('error' in t) return t.error;
    const team = t.team;

    // ⚠️ 현재 위치를 넘긴다 — 결승선 3칸 전부터는 베팅할 수 없다.
    //    화면이 잠그는 줄과 서버가 거절하는 줄이 같은 위치 기준을 봐야 한다.
    const check = validateBet(team, state.round, bets, state.settings, currentPositions(state));
    if (!check.ok) return err(check.error);

    // ⚠️ 여기부터 아래까지 await 가 하나도 없다. 있으면 6모둠 동시 베팅에 코인이 증발한다
    team.bets[state.round] = bets;
    team.betLocked[state.round] = true;
    team.coins -= check.sum;
    for (const c of Object.keys(bets) as AnimalCode[]) state.pool[c] += bets[c]!;

    this.event('bet', teamNo, { bets });
    // 마지막 모둠이 확정했으면 남은 60초를 다 기다리지 않는다 (아래 주석 참조)
    this.autoShorten();
    state.stateVersion++;
    this.deps.persist(state);
    this.deps.changed();

    return ok(teamView(state, teamNo, this.deps.now()));
  }

  // ── 6. 진행 · 일시정지 · 정산 ──────────────────────────

  /**
   * 라운드 진행 버튼 하나가 부르는 유일한 함수.
   *
   * ⚠️ 화면이 "1라운드인가?"로 판단하면 안 된다. 베팅이 끝나도 round 는 그대로라,
   *    화면이 판단하면 1라운드가 무한 반복된다 (게이트 BUG1).
   *    어디까지 했는지는 roundStarted 로 **서버만** 안다.
   *    진행 중(waiting 이 아닐 때) 다시 눌러도 아무 일이 없어야 한다 — 교사가
   *    반응이 없다고 여러 번 누르는 일이 실제로 있다.
   */
  advanceRound(hostKey: string): Envelope<TeacherView> {
    const g = this.live();
    if ('error' in g) return g.error;
    const state = g.state;
    const gate = this.hostGate(state, hostKey);
    if (gate) return gate;

    const now = this.deps.now();
    if (state.phase !== PHASES.WAITING) return ok(teacherView(state, now));

    if (state.roundStarted) {
      // ⚠️ 새로 만드는 판의 lastRound 는 **항상 ROUNDS(10)** 이다 (골인 8·9·10 고정 —
      //    RENEWAL §2-1). 그러니 이 비교는 지금 사실상 `round >= 10` 이다.
      //    그래도 ROUNDS 로 바꿔 쓰지 않는다 — lastRound 가 9 로 저장된 옛 판을 이어 열면
      //    그 판은 9라운드에서 끝나야 하고, ROUNDS 로 박으면 10라운드째에 문제도 힌트도
      //    없는 빈 라운드가 하나 더 돈다
      if (state.round >= state.lastRound) {
        state.phase = PHASES.DONE;
        state.phaseEndsAt = null;
        state.stateVersion++;
        this.deps.setAlarm(null);
        this.deps.persist(state);
        this.deps.changed();
        return ok(teacherView(state, now));
      }
      state.round++;
    }
    state.roundStarted = true;

    // 경주부터 시작한다. moving 이 끝나면 알람이 quiz 로 넘긴다 (§8-3)
    this.setPhase(PHASES.MOVING, state.settings.moveSeconds);
    this.event('round_start', null, {
      phase: state.phase, phaseEndsAt: state.phaseEndsAt, round: state.round
    });
    this.deps.persist(state);
    this.deps.changed();
    return ok(teacherView(state, now));
  }

  /**
   * 일시정지. 멈춘 동안 시간이 흐르면 안 되므로 알람을 **취소하고**,
   * 재개할 때 phaseEndsAt 을 멈춘 만큼 미룬 뒤 알람을 다시 건다.
   * ⚠️ 알람을 안 끄면 멈춰 있는 사이에 단계가 넘어간다. moving 중에도 마찬가지다.
   */
  togglePause(hostKey: string): Envelope<TeacherView> {
    const g = this.live();
    if ('error' in g) return g.error;
    const state = g.state;
    const gate = this.hostGate(state, hostKey);
    if (gate) return gate;

    const now = this.deps.now();
    if (state.pausedAt) {
      if (state.phaseEndsAt) state.phaseEndsAt += now - state.pausedAt;
      state.pausedAt = null;
      this.deps.setAlarm(state.phaseEndsAt);
    } else {
      state.pausedAt = now;
      this.deps.setAlarm(null);
    }
    state.stateVersion++;
    this.event('pause', null, { paused: !!state.pausedAt, pausedAt: state.pausedAt, phaseEndsAt: state.phaseEndsAt });
    this.deps.persist(state);
    this.deps.changed();
    return ok(teacherView(state, now));
  }

  /**
   * '지금 넘어가기' — 교사가 이번 단계를 즉시 끝낸다 (문제·토론·베팅만).
   *
   * ⚠️ **전환 코드를 여기에 복사하지 마세요.** 마감 시각을 지금으로 당기고
   *    `onAlarm()` 을 그대로 부른다. 그래야 미제출 timeout 기록(quiz)·betLocked(betting)
   *    같은 마감 처리가 알람 경로와 **문자 하나까지 같게** 일어난다. 사본을 만드는 순간
   *    "교사가 넘겼을 때만 timeout 이 안 찍히는" 종류의 버그가 생긴다 (MIGRATION §5).
   *
   * ⚠️ 알람을 `now` 로 다시 걸고 돌아가지 않고 **동기로 부르는** 이유:
   *    DO 알람은 몇백 ms 늦게 올 수 있는데, 그동안 교사·학생 화면의 타이머는 0 에
   *    멈춘 채 아무 일도 안 일어난다. 선생님은 버튼이 안 먹었다고 다시 누른다.
   *    동기로 부르면 이 호출의 응답이 이미 다음 단계다.
   *
   * ⚠️ 멈춰 있는 동안에는 거절한다. 멈춤 중에는 시간이 흐르지 않는다는 규칙을
   *    이 버튼 하나가 깨면, 재개할 때 phaseEndsAt 을 미루는 계산이 어긋난다.
   */
  skipPhase(hostKey: string): Envelope<TeacherView> {
    const g = this.live();
    if ('error' in g) return g.error;
    const state = g.state;
    const gate = this.hostGate(state, hostKey);
    if (gate) return gate;

    if (state.pausedAt) return err('PAUSED');
    // 버튼 상태(teacherView.canSkip)와 **같은 함수**를 본다 — 두 벌이면 갈라진다
    if (!canSkipNow(state)) return err('NOT_SKIPPABLE');

    const now = this.deps.now();
    // 감사용 한 줄. 복구는 phaseEndsAt 만 되돌린다 (restore 참조)
    this.event('skip', null, { phase: state.phase, phaseEndsAt: now });

    state.phaseEndsAt = now;
    this.onAlarm();                        // ← 전환은 여전히 여기 한 곳에서만 일어난다
    return ok(teacherView(state, now));
  }

  /**
   * 모든 모둠이 이번 단계 행동을 마쳤으면 마감을 `autoSkipSeconds` 초 뒤로 당긴다.
   *
   * 왜 0 초가 아닌가: 마지막으로 제출한 모둠은 자기 정답과 해설을 아직 못 봤다.
   * 그 자리에서 끊기면 "누른 순간 화면이 넘어갔다"가 되고, 그 모둠만 학습이 빠진다.
   *
   * ⚠️ 남은 시간이 이미 그보다 짧으면 **아무것도 하지 않는다.** 안 그러면 마감 1초 전에
   *    낸 마지막 제출이 단계를 오히려 4초 **늘린다.**
   * ⚠️ 여기서 단계를 바꾸지 않는다. 시각만 당기고 알람을 다시 건다 —
   *    전환은 onAlarm() 의 몫이라는 규칙을 이 경로가 깨면 RACE1 이 되살아난다.
   * ⚠️ 토론(discuss)은 여기 오지 않는다. allTeamsDone 이 토론에서 언제나 false 이기
   *    때문이다 — 토론 180초가 이 수업의 실체다 (MIGRATION §1).
   */
  private autoShorten(): void {
    const state = this.state!;
    const seconds = Number(state.settings.autoSkipSeconds);
    if (!isFinite(seconds) || seconds <= 0) return;   // 0 = 자동 단축 끔
    if (state.pausedAt || !state.phaseEndsAt) return;
    if (!allTeamsDone(state)) return;

    const target = this.deps.now() + seconds * 1000;
    if (target >= state.phaseEndsAt) return;          // 이미 더 급하다 — 그대로 둔다
    state.phaseEndsAt = target;
    this.deps.setAlarm(target);
  }

  finalize(hostKey: string): Envelope<FinalizeView> {
    const g = this.live();
    if ('error' in g) return g.error;
    const state = g.state;
    const gate = this.hostGate(state, hostKey);
    if (gate) return gate;

    // 정산은 lastRound 시점의 위치로 한다. 새 판은 항상 ROUNDS(10)라 사실상 마지막 라운드지만,
    // lastRound 가 9 로 저장된 옛 판은 9라운드 위치로 정산해야 그때 본 화면과 순위가 맞는다
    const finalPos = positionsAtRound(state.moves, state.lastRound, state.settings.trackCells);
    const finalOrder = rankByPosition(finalPos, state.truth);
    const odds = computeOdds(state.pool);

    state.isOver = true;
    state.phase = PHASES.DONE;
    state.phaseEndsAt = null;
    state.settlement = settle(state.teams, finalOrder, odds, state.settings);
    state.stateVersion++;
    this.deps.setAlarm(null);
    this.deps.persist(state);
    this.deps.changed();

    return ok(finalizeView(state));
  }

  /** 정답 공개. 정산 전에 정답이 나가는 유일한 통로라 여기만 지키면 된다 (SEC7) */
  reveal(hostKey: string): Envelope<RevealView> {
    const g = this.live();
    if ('error' in g) return g.error;
    const gate = this.hostGate(g.state, hostKey);
    if (gate) return gate;
    return ok(revealView(g.state));
  }

  /** ⚠️ 모둠 암호가 전부 담긴 응답이다 (SEC4) */
  handout(hostKey: string): Envelope<HandoutView> {
    const g = this.live();
    if ('error' in g) return g.error;
    const gate = this.hostGate(g.state, hostKey);
    if (gate) return gate;
    return ok(handoutView(g.state));
  }

  // ── 단계 기계 ─────────────────────────────────────────

  private setPhase(phase: GameState['phase'], seconds: number | null): void {
    const state = this.state!;
    state.phase = phase;
    state.phaseEndsAt = seconds ? this.deps.now() + seconds * 1000 : null;
    state.stateVersion++;
    this.deps.setAlarm(state.phaseEndsAt);
  }

  /**
   * 단계 전환이 일어나는 **유일한** 곳.
   *
   *   waiting ─(교사)→ moving(20초) → quiz(90초) → discuss(180초) → betting(60초) → waiting
   *
   * ⚠️ 알람은 예정보다 일찍 깨어날 수 있고(다른 이유로 걸린 알람, 재개 직후 등),
   *    늦게 올 수도 있다. 일찍 왔으면 **아무것도 바꾸지 않고 다시 건다.**
   *    이 확인을 빼면 재개 직후 알람 한 번에 단계가 통째로 건너뛴다.
   *
   * 조기 종료(`skipPhase`)도 여기로 온다 — phaseEndsAt 을 지금으로 당긴 뒤 이 함수를
   * 그대로 부른다. 그래서 "교사가 넘겼을 때"와 "시간이 다 됐을 때"의 결과가 같다.
   */
  onAlarm(): void {
    const state = this.state;
    if (!state) return;
    if (state.pausedAt) return;          // 멈춰 있는 동안엔 시간이 흐르지 않는다
    if (!state.phaseEndsAt) return;

    const now = this.deps.now();
    if (now < state.phaseEndsAt) { this.deps.setAlarm(state.phaseEndsAt); return; }

    if (state.phase === PHASES.MOVING) {
      this.setPhase(PHASES.QUIZ, state.settings.quizSeconds);
    } else if (state.phase === PHASES.QUIZ) {
      // 마감. 안 낸 모둠만 미제출로 남긴다 — 이미 낸 기록은 절대 건드리지 않는다 (RACE1)
      for (const t of state.teams) {
        if (!t.answered[state.round]) {
          t.answered[state.round] = { level: null, choice: null, correct: false, timeout: true };
        }
      }
      this.setPhase(PHASES.DISCUSS, state.settings.discussSeconds);
    } else if (state.phase === PHASES.DISCUSS) {
      this.setPhase(PHASES.BETTING, state.settings.betSeconds);
    } else if (state.phase === PHASES.BETTING) {
      for (const t of state.teams) t.betLocked[state.round] = true;
      this.setPhase(PHASES.WAITING, null);
    } else {
      return;
    }
    this.deps.persist(state);
    this.deps.changed();
  }

  private event(kind: EventKind, teamNo: number | null, payload: Record<string, unknown>): void {
    const state = this.state!;
    state.eventSeq = (state.eventSeq || 0) + 1;
    this.deps.appendEvent({
      seq: state.eventSeq,
      code: state.code,
      round: state.round,
      teamNo,
      kind,
      payload,
      at: this.deps.now()
    });
  }
}

// ────────────────────────────────────────────────────────────
// 복구 — 스냅샷 + 그 뒤 이벤트 재생
// ────────────────────────────────────────────────────────────

/**
 * 스냅샷 + 그 뒤 이벤트 재생.
 *
 * ⚠️ 예전에는 여기서 `hintGiven`(모둠별로 이미 준 힌트 자리)을 같이 되살려야 했고,
 *    앱스 스크립트판이 정확히 그걸 빠뜨려 복구 직후 같은 힌트가 두 번 나갔다.
 *    리뉴얼에서 힌트가 (라운드, 난이도)로 정해지면서 그 상태 자체가 사라졌다 —
 *    되살릴 것이 없으므로 빠뜨릴 것도 없다 (RENEWAL §2-2).
 *    **다시 넣지 마세요.** 넣는 순간 같은 규칙이 두 벌이 된다 (MIGRATION §5).
 */
export function restore(snapshot: GameState, events: GameEvent[]): GameState {
  const state: GameState = JSON.parse(JSON.stringify(snapshot));
  const after = events
    .filter((e) => e.code === state.code && e.seq > (state.eventSeq || 0))
    .sort((a, b) => a.seq - b.seq);

  for (const ev of after) {
    const team = state.teams.find((t) => t.no === Number(ev.teamNo)) || null;

    if (ev.kind === 'answer' && team) {
      const rec = ev.payload as unknown as AnswerRecord;
      team.answered = team.answered || {};
      team.answered[ev.round] = rec;
      if (rec.correct && rec.hint) {
        team.hints = team.hints || [];
        team.hints.push(rec.hint);
      }
    } else if (ev.kind === 'bet' && team) {
      const bets = (ev.payload.bets || {}) as Bets;
      team.bets = team.bets || {};
      team.betLocked = team.betLocked || {};
      team.bets[ev.round] = bets;
      team.betLocked[ev.round] = true;
      let sum = 0;
      for (const c of Object.keys(bets) as AnimalCode[]) { sum += bets[c]!; state.pool[c] += bets[c]!; }
      team.coins -= sum;
    } else if (ev.kind === 'round_start') {
      state.round = ev.round;
      state.roundStarted = true;
      state.phase = ev.payload.phase as GameState['phase'];
      state.phaseEndsAt = (ev.payload.phaseEndsAt as number | null) ?? null;
    } else if (ev.kind === 'pause') {
      // 앱스 스크립트판은 pause 를 재생하지 않아 복구하면 멈춤이 풀렸다.
      // 결과값을 통째로 기록해 두었으므로 그대로 되돌린다 (누적 오차가 안 생긴다)
      state.pausedAt = (ev.payload.pausedAt as number | null) ?? null;
      state.phaseEndsAt = (ev.payload.phaseEndsAt as number | null) ?? null;
    } else if (ev.kind === 'skip') {
      // ⚠️ 여기서 단계를 바꾸지 않는다. 이 이벤트가 기록하는 것은 "마감을 당겼다" 뿐이고,
      //    그 뒤 전환은 onAlarm() 이 했다 — 알람 전환에는 이벤트가 없으므로 재생에도 없다.
      //    단계까지 여기서 옮기면 재생과 알람이 두 벌의 전환 로직이 된다 (MIGRATION §5).
      state.phaseEndsAt = (ev.payload.phaseEndsAt as number | null) ?? null;
    }
    state.eventSeq = ev.seq;
    state.stateVersion = (state.stateVersion || 0) + 1;
  }
  return state;
}
