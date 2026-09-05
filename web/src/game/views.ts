/**
 * views.ts — 밖으로 나가는 응답의 모양. **순수 함수만.**
 *
 * apps-script/Code.gs 의 teamView·teacherView·gwLobby·gwHandout·gwReveal·gwFinalize
 * 응답을 그대로 옮겼다. 저장소도 시각도 통신도 여기 들어오지 않는다 (시각은 인자로 받는다).
 *
 * ⚠️ **이 파일이 뷰의 유일한 한 벌이다.**
 *    오늘 실제로 밟은 함정: 게이트가 진짜 함수 대신 사본을 검사해서, 정답이 새는데
 *    초록불이 켜졌다 (MIGRATION §5). 화면이든 게이트든 뷰가 필요하면 여기를 부른다.
 *    "테스트용으로 비슷한 걸 하나 더" 만드는 순간 그 방어는 사라진다.
 *
 * ⚠️ 응답에 Date 객체를 넣지 않는다. 전부 숫자(ms) 다 (MIGRATION §5).
 */

import { ANIMAL_CODES, DEPLOY_VERSION, PHASES, SKIPPABLE_PHASES } from './config.ts';
import type { AnimalCode, Level, Phase } from './config.ts';
import { computeOdds, positionsAtRound, rankByPosition } from './rules.ts';
import type {
  Bets, GameState, Hint, Odds, Pool, Positions, Settlement
} from './types.ts';

// ────────────────────────────────────────────────────────────
// 응답 모양
// ────────────────────────────────────────────────────────────

export interface TeamBrief { no: number; name: string }

export interface TeamProgress {
  no: number; name: string; answered: boolean; betLocked: boolean;
}

export interface TeacherTeamRow extends TeamProgress { coins: number }

/** 이번 라운드의 이동량만. **moves 전체를 내보내면 미래가 샌다** (§4-1) */
export type RaceMoves = Record<AnimalCode, number>;

/**
 * 시간축. 화면은 이 세 값으로 타이머와 경주 진행률을 **서버 시각 기준**으로 계산한다.
 * secondsLeft 만 주면 늦게 들어온 폰이 다른 지점에서 경주를 시작한다 (MIGRATION §11-2).
 */
export interface Clock {
  /** 이 단계가 끝나는 서버 시각(ms). 대기·끝은 null */
  phaseEndsAt: number | null;
  /** 이 응답을 만든 서버 시각(ms). 폰 시계가 몇 분 틀려도 (serverNow - phaseEndsAt) 는 맞다 */
  serverNow: number;
  /** 이 단계의 전체 길이(초). 진행률 = 1 - secondsLeft/phaseSeconds. 대기·끝은 null */
  phaseSeconds: number | null;
}

export interface TeamView extends Clock {
  code: string;
  round: number;
  /** 트랙 칸 수. ⚠️ 화면이 10 으로 박아 두면 '설정'이 거짓말을 한다 (MIGRATION §5 trackCells) */
  trackCells: number;
  phase: Phase;
  secondsLeft: number | null;
  stateVersion: number;
  positions: Positions;
  odds: Odds;
  animals: Record<AnimalCode, string>;
  emojis: Record<AnimalCode, string>;
  maxBet: number;
  teamProgress: TeamProgress[];
  isOver: boolean;
  deployVersion: string;
  raceMoves?: RaceMoves;
  me?: {
    no: number; name: string; coins: number; hints: Hint[];
    myBets: Record<number, Bets>;
    usedThisRound: number;
    chosenLevel: Level | null;
    answerResult: { correct: boolean } | null;
    canAnswer: boolean;
    canBet: boolean;
  };
  question?: { text: string; choices: string[] };
  truth?: AnimalCode[];
  settlement?: Settlement[] | null;
}

export interface TeacherView extends Clock {
  code: string;
  className: string;
  unit: string;
  round: number;
  lastRound: number;
  /** 이번 라운드가 이미 돌았는가. 교사 화면이 '다음은 몇 라운드'를 적는 데 쓴다 (Code.gs 원본에도 있었다) */
  roundStarted: boolean;
  trackCells: number;
  phase: Phase;
  secondsLeft: number | null;
  stateVersion: number;
  positions: Positions;
  odds: Odds;
  pool: Pool;
  seedCoins: number;
  animals: Record<AnimalCode, string>;
  emojis: Record<AnimalCode, string>;
  teams: TeacherTeamRow[];
  isOver: boolean;
  settlement: Settlement[] | null;
  truth: AnimalCode[] | null;
  deployVersion: string;
  raceMoves?: RaceMoves;
  /**
   * '지금 넘어가기' 버튼을 누를 수 있는가 (문제·토론·베팅이고 멈춰 있지 않을 때).
   * ⚠️ 화면이 단계 이름으로 직접 판단하면 서버가 거절하는 상태에서도 버튼이 살아 있게 된다 —
   *    거절 규칙을 두 벌 두는 셈이다 (MIGRATION §5). 서버가 계산한 이 값만 보세요.
   */
  canSkip: boolean;
  /** 이번 단계에서 모든 모둠이 할 일을 마쳤는가. 교사 화면의 '5초 뒤 넘어갑니다' 문구용 */
  allDone: boolean;
}

export interface LobbyView { className: string; teams: TeamBrief[] }
export interface HandoutView {
  code: string; pins: Record<number, string>; teams: TeamBrief[];
}
export interface RevealView {
  truth: AnimalCode[];
  animals: Record<AnimalCode, string>;
  emojis: Record<AnimalCode, string>;
}
export interface FinalizeView {
  finalOrder: AnimalCode[];
  animals: Record<AnimalCode, string>;
  emojis: Record<AnimalCode, string>;
  odds: Odds;
  settlement: Settlement[];
}

// ────────────────────────────────────────────────────────────
// 보조
// ────────────────────────────────────────────────────────────

/**
 * 말이 실제로 몇 라운드분 움직였는가.
 *
 * ⚠️ Code.gs 는 언제나 state.round 를 썼다. 그래서 판을 만들자마자
 *    (round=1, 아직 시작 안 함) 이미 1라운드 이동이 반영된 위치가 나갔다.
 *    앱스 스크립트판은 '경주' 단계가 없어서 티가 안 났지만, 새 구현은
 *    moving 20초 동안 말이 달리는 걸 보여준다 — 출발 전에 도착 위치를 보내면
 *    경주가 스포일러가 된다. 그래서 시작 전에는 한 라운드 뒤를 보여준다.
 */
export function appliedRound(state: GameState): number {
  return state.roundStarted ? state.round : state.round - 1;
}

/** 이동이 끝난 뒤의 위치. moving 중에도 '도착 위치'를 보낸다 — 화면이 그리로 달린다 */
export function currentPositions(state: GameState): Positions {
  return positionsAtRound(state.moves, appliedRound(state), state.settings.trackCells);
}

/**
 * 이번 라운드에 각 말이 몇 칸 갔는가 (0~3). **moving 단계에서만 내보낸다.**
 *
 * 이건 비밀이 아니다 — 20초 뒤 위치로 어차피 드러난다.
 * 비밀인 것은 state.moves 전체(라운드×동물)다. 그건 lastRound 를 역산시킨다 (§4-1).
 * 위치의 차이로 계산하므로 정의상 화면에 보이는 것과 어긋날 수 없다.
 */
export function raceMovesOf(state: GameState): RaceMoves {
  const r = appliedRound(state);
  const track = state.settings.trackCells;
  const now = positionsAtRound(state.moves, r, track);
  const before = positionsAtRound(state.moves, Math.max(0, r - 1), track);
  const out = {} as RaceMoves;
  for (const c of ANIMAL_CODES) out[c] = (now[c] || 0) - (before[c] || 0);
  return out;
}

/**
 * 남은 초. 일시정지 중이면 멈춘 시각을 기준으로 재서 숫자가 흐르지 않게 한다.
 * ⚠️ now 를 인자로 받는 이유: 이 파일에 시각을 넣지 않기 위해서다 (MIGRATION §6).
 */
export function secondsLeft(state: GameState, now: number): number | null {
  if (!state.phaseEndsAt) return null;
  const base = state.pausedAt || now;
  return Math.max(0, Math.ceil((state.phaseEndsAt - base) / 1000));
}

/** 지금 단계의 전체 길이(초). 일시정지 중이어도 밑에 깔린 단계 기준이다 */
export function phaseSecondsOf(state: GameState): number | null {
  const s = state.settings;
  switch (state.phase) {
    case PHASES.MOVING:  return s.moveSeconds;
    case PHASES.QUIZ:    return s.quizSeconds;
    case PHASES.DISCUSS: return s.discussSeconds;
    case PHASES.BETTING: return s.betSeconds;
    default:             return null;
  }
}

/**
 * 이번 단계에서 **모든 모둠이 할 일을 마쳤는가.**
 *
 * ⚠️ 이 판단이 두 벌이 되면 안 된다. 교사 화면의 문구(`teacherView.allDone`)와
 *    자동 단축(`Room.submitAnswer`·`placeBet`)이 **이 함수 하나**를 본다 —
 *    갈라지는 순간 화면은 "다 끝났어요"라고 쓰는데 시계는 안 줄어드는 상태가 생긴다
 *    (게이트가 사본을 검사하던 그 함정, MIGRATION §5).
 *
 * ⚠️ 토론 단계는 언제나 false 다. 토론 180초가 이 수업의 실체이므로 줄이지 않는다 (§1).
 *    그래서 '모둠이 뭘 다 했나'를 단계별로 따지는 이 모양이 필요하다.
 */
export function allTeamsDone(state: GameState): boolean {
  if (state.phase === PHASES.QUIZ) return state.teams.every((t) => !!t.answered[state.round]);
  if (state.phase === PHASES.BETTING) return state.teams.every((t) => !!t.betLocked[state.round]);
  return false;
}

/**
 * 지금 교사가 '지금 넘어가기'를 누를 수 있는가.
 *
 * ⚠️ 교사 화면의 버튼 상태(`teacherView.canSkip`)와 서버의 거절(`Room.skipPhase`)이
 *    **이 함수 하나**를 본다. 화면 쪽에 조건을 다시 쓰면, 눌리는데 거절당하거나
 *    눌러야 하는데 죽어 있는 버튼이 생긴다.
 */
export function canSkipNow(state: GameState): boolean {
  if (state.pausedAt) return false;
  return SKIPPABLE_PHASES.indexOf(state.phase) >= 0;
}

function clockOf(state: GameState, now: number): Clock {
  return { phaseEndsAt: state.phaseEndsAt, serverNow: now, phaseSeconds: phaseSecondsOf(state) };
}

/** 정산 시점의 도착 순서. truth 와 반드시 같다 (게이트 H1·H1c) */
export function finalOrderOf(state: GameState): AnimalCode[] {
  return rankByPosition(
    positionsAtRound(state.moves, state.lastRound, state.settings.trackCells),
    state.truth
  );
}

function findTeam(state: GameState, no: number) {
  return state.teams.find((t) => t.no === Number(no)) || null;
}

function sumBets(b: Bets | undefined): number {
  let s = 0;
  for (const c of Object.keys(b || {}) as AnimalCode[]) s += (b as Bets)[c] || 0;
  return s;
}

function questionOf(state: GameState, round: number, level: Level) {
  const plan = state.questionPlan[round];
  if (!plan) return null;
  const id = plan[level];
  if (id == null) return null;
  return state.questionById[id] || null;
}

// ────────────────────────────────────────────────────────────
// 뷰
// ────────────────────────────────────────────────────────────

/**
 * ⚠️ 되돌리면 개발자 도구로 정답이 보인다 (00-loop.md).
 *
 * 이 응답에는 truth·moves·lastRound 가 **isOver 전까지 하나도 담기지 않는다.**
 * 화면에서 숨기는 게 아니라 보내지 않는 것이다 — 폰의 개발자 도구는 못 막는다.
 * lastRound 를 빼는 이유: 마지막 라운드를 알면 언제 골인하는지 역산된다.
 */
export function teamView(state: GameState, teamNo: number, now: number): TeamView {
  const me = findTeam(state, teamNo);
  const v: TeamView = {
    ...clockOf(state, now),
    code: state.code,
    round: state.round,
    trackCells: state.settings.trackCells,
    phase: state.pausedAt ? PHASES.PAUSED : state.phase,
    secondsLeft: secondsLeft(state, now),
    stateVersion: state.stateVersion,
    positions: currentPositions(state),
    odds: computeOdds(state.pool),
    animals: state.animals,
    emojis: state.emojis,
    maxBet: state.settings.maxBetPerRound,
    teamProgress: state.teams.map((t) => ({
      no: t.no, name: t.name,
      answered: !!t.answered[state.round],
      betLocked: !!t.betLocked[state.round]
    })),
    isOver: !!state.isOver,
    deployVersion: DEPLOY_VERSION
  };

  if (state.phase === PHASES.MOVING) v.raceMoves = raceMovesOf(state);

  if (me) {
    const ans = me.answered[state.round];
    v.me = {
      no: me.no, name: me.name, coins: me.coins, hints: me.hints,
      myBets: me.bets,
      usedThisRound: sumBets(me.bets[state.round]),
      chosenLevel: ans ? ans.level : null,
      answerResult: ans && ans.level ? { correct: ans.correct } : null,
      canAnswer: state.phase === PHASES.QUIZ && !ans,
      canBet: state.phase === PHASES.BETTING && !me.betLocked[state.round]
    };
    // 답을 낸 모둠은 해설을 보는 동안 문제 본문을 계속 봐야 한다. 정답(answer)은 안 담는다
    if (state.phase === PHASES.QUIZ && ans && ans.level && !ans.timeout) {
      const q = questionOf(state, state.round, ans.level);
      if (q) v.question = { text: q.text, choices: q.choices };
    }
  }

  if (state.isOver) {
    v.truth = finalOrderOf(state);
    v.settlement = state.settlement || null;
  }
  return v;
}

/**
 * ⚠️ 정답 순위(truth)는 정산 전에는 null 이다.
 *
 * 이 응답은 교사 열쇠로 지켜지지만, TV 에 그대로 뜨는 화면이기도 하다.
 * 열쇠 검사와 이 분리는 겹치는 방어다 — 한쪽이 뚫려도 정답은 안 나간다.
 * '정답 공개' 버튼은 그때 revealView 를 따로 부른다.
 *
 * lastRound 는 Code.gs 그대로 담는다 — 교사 화면이 '마지막 라운드인가'를 보고
 * 진행 버튼 문구를 바꾼다. 학생이 보는 teamView 에는 절대 담지 않는다.
 */
export function teacherView(state: GameState, now: number): TeacherView {
  const v: TeacherView = {
    ...clockOf(state, now),
    code: state.code,
    className: state.className,
    unit: state.unit,
    round: state.round,
    lastRound: state.lastRound,
    roundStarted: state.roundStarted,
    trackCells: state.settings.trackCells,
    phase: state.pausedAt ? PHASES.PAUSED : state.phase,
    secondsLeft: secondsLeft(state, now),
    stateVersion: state.stateVersion,
    positions: currentPositions(state),
    odds: computeOdds(state.pool),
    pool: state.pool,
    seedCoins: state.settings.seedCoins,
    animals: state.animals,
    emojis: state.emojis,
    teams: state.teams.map((t) => ({
      no: t.no, name: t.name, coins: t.coins,
      answered: !!t.answered[state.round],
      betLocked: !!t.betLocked[state.round]
    })),
    isOver: !!state.isOver,
    settlement: state.settlement || null,
    truth: state.isOver ? finalOrderOf(state) : null,
    deployVersion: DEPLOY_VERSION,
    // ⚠️ 이 둘은 교사 뷰에만 있다. 모둠 뷰에 넣으면 학생 폰이 '곧 넘어간다'를 먼저 알고,
    //    아직 안 낸 모둠이 재촉당한다 — 조용해야 할 시간을 시끄럽게 만든다
    canSkip: canSkipNow(state),
    allDone: allTeamsDone(state)
  };
  if (state.phase === PHASES.MOVING) v.raceMoves = raceMovesOf(state);
  return v;
}

/** 접속 화면. 인증이 없으므로 게임의 비밀을 하나도 담지 않는다 */
export function lobbyView(state: GameState): LobbyView {
  return {
    className: state.className,
    teams: state.teams.map((t) => ({ no: t.no, name: t.name }))
  };
}

/**
 * 2차시에 학생들이 재접속할 때 암호를 다시 띄운다.
 * ⚠️ 모둠 암호가 전부 담긴 응답이다 — 교사 열쇠 없이는 절대 나가면 안 된다 (SEC4).
 * 학생 주소·QR 은 전송 계층의 몫이라 여기 없다 (3단계에서 Worker 가 덧붙인다).
 */
export function handoutView(state: GameState): HandoutView {
  const pins: Record<number, string> = {};
  for (const t of state.teams) pins[t.no] = t.pin;
  return {
    code: state.code,
    pins,
    teams: state.teams.map((t) => ({ no: t.no, name: t.name }))
  };
}

/** 정답 공개. 정산 전에 정답이 나가는 유일한 통로 — 교사 열쇠로만 부른다 */
export function revealView(state: GameState): RevealView {
  return { truth: finalOrderOf(state), animals: state.animals, emojis: state.emojis };
}

/** 정산 결과. state.settlement 가 이미 굳어 있어야 한다 (finalize 가 채운다) */
export function finalizeView(state: GameState): FinalizeView {
  return {
    finalOrder: finalOrderOf(state),
    animals: state.animals,
    emojis: state.emojis,
    odds: computeOdds(state.pool),
    settlement: state.settlement || []
  };
}
