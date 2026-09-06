/**
 * types.ts — 게임 상태의 모양.
 *
 * 앱스 스크립트판에서는 상태가 그냥 객체였다. 여기서 타입을 못박아 두는 이유는
 * 이식 중에 필드 하나가 빠지거나 이름이 달라지는 걸 컴파일러가 잡게 하려는 것이다.
 */

import type { AnimalCode, Level, Phase, Settings } from './config.ts';

/** 동물별 라운드별 이동량(0~3) */
export type Moves = Record<AnimalCode, number[]>;

/** 골인 라운드. 1·2·3위만 숫자, 4~8위는 끝까지 못 들어오므로 null */
export type FinishRound = Record<AnimalCode, number | null>;

/** 한 판의 경주 계획. truth[0] = 1등, lastRound 는 학생에게 비공개 */
export interface Race {
  truth: AnimalCode[];
  /** 3위가 골인하는 라운드 = 판이 끝나는 라운드 (9 또는 10). ⚠️ 학생에게 비공개 */
  lastRound: number;
  moves: Moves;
  /**
   * 동물별 골인 라운드. ⚠️ **어느 뷰에도 담지 않는다** — 미래가 통째로 샌다.
   * 화면이 쓰는 것은 '지금 골인했는가'(views.finishedOf)뿐이다.
   */
  finishRound: FinishRound;
}

/** 동물별 현재 칸 */
export type Positions = Record<AnimalCode, number>;

/** 동물별 판돈 */
export type Pool = Record<AnimalCode, number>;

/** 동물별 배당률 */
export type Odds = Record<AnimalCode, number>;

/** 한 라운드에 건 코인 — 안 건 동물은 아예 없다 */
export type Bets = Partial<Record<AnimalCode, number>>;

export interface Question {
  id: number;
  /** 이 문항이 속한 **문제 세트** 이름 (RENEWAL §3-1. 예전 이름은 unit) */
  setName: string;
  level: Level;
  text: string;
  choices: string[];
  answer: number;        // 1~4
  explanation: string;
}

export interface Hint {
  round: number;
  level: Level;
  text: string;
}

export interface AnswerRecord {
  level: Level | null;
  choice: number | null;
  correct: boolean;
  hint?: Hint | null;
  timeout?: boolean;
}

export interface Team {
  no: number;
  name: string;
  pin: string;
  coins: number;
  hints: Hint[];
  answered: Record<number, AnswerRecord>;   // 라운드 → 기록
  bets: Record<number, Bets>;               // 라운드 → 베팅
  betLocked: Record<number, boolean>;
}

/** 라운드 → 난이도 → 문항 id */
export type QuestionPlan = Record<number, Partial<Record<Level, number | null>>>;

export interface SettlementLine {
  animalCode: AnimalCode;
  finalRank: number;
  coins: number;
  odds: number;
  payoutRate: number;
  gained: number;
}

export interface Settlement {
  teamNo: number;
  teamName: string;
  lines: SettlementLine[];
  gained: number;
  finalCoins: number;
  rank?: number;
}

export interface GameState {
  version: number;
  code: string;
  hostKey: string;
  /** 화면에 뜨는 방 이름. 예전 이름은 className 이었다 (RENEWAL §1) */
  roomTitle: string;
  /** 문제 세트 이름. '전체' 를 고르면 null (RENEWAL §1). 예전 이름은 unit */
  setName: string | null;

  /** 사기 라운드 스위치 (교사가 판을 만들 때 정한다. 기본 켬) */
  fraudEnabled: boolean;
  /**
   * 거짓 힌트가 나가는 라운드 (2~4 중 하나). 스위치가 꺼져 있으면 null.
   *
   * ⚠️ **truth 와 같은 등급의 비밀이다.** 정산 전에는 어떤 뷰에도 담기지 않는다 —
   *    학생이 알면 그 라운드 힌트만 버리면 되므로 게임이 통째로 무너진다 (RENEWAL §2-3).
   */
  fraudRound: number | null;

  round: number;
  lastRound: number;              // 학생에게 비공개
  phase: Phase;
  roundStarted: boolean;
  phaseEndsAt: number | null;
  pausedAt: number | null;
  stateVersion: number;
  eventSeq: number;

  truth: AnimalCode[];            // truth[0] = 1등. ⚠️ 정산 전에는 절대 내보내지 않는다
  moves: Moves;
  finishRound: FinishRound;       // ⚠️ 미래다. 뷰에 담지 않는다

  animals: Record<AnimalCode, string>;
  emojis: Record<AnimalCode, string>;

  /**
   * 난이도별 힌트 10개 (라운드 r 의 힌트는 hintPool[난이도][r-1]).
   *
   * ⚠️ 사기 라운드 자리는 **거짓 문장으로 이미 치환된 채** 저장된다.
   *    지급할 때 "이 라운드가 사기인가"를 다시 따지면 판단이 두 벌이 되고,
   *    그중 하나만 고치는 날 참 힌트가 나간다 (MIGRATION §5).
   * ⚠️ hintGiven 은 없앴다. 힌트는 이제 (라운드, 난이도)로 결정되므로
   *    "같은 힌트를 두 번" 이라는 상태 자체가 없다 (RENEWAL §2-2).
   */
  hintPool: Record<Level, string[]>;

  questionPlan: QuestionPlan;
  questionById: Record<number, Question>;   // 배정된 문항의 내용을 굳혀 둔다

  pool: Pool;
  teams: Team[];
  settings: Settings;

  isOver: boolean;
  settlement?: Settlement[] | null;
}

/** 무작위성은 전부 주입한다 — 테스트에서 시드를 고정할 수 있게 */
export type Rng = () => number;
