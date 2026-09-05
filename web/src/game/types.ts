/**
 * types.ts — 게임 상태의 모양.
 *
 * 앱스 스크립트판에서는 상태가 그냥 객체였다. 여기서 타입을 못박아 두는 이유는
 * 이식 중에 필드 하나가 빠지거나 이름이 달라지는 걸 컴파일러가 잡게 하려는 것이다.
 */

import type { AnimalCode, Level, Phase, Settings } from './config.ts';

/** 동물별 라운드별 이동량(0~3) */
export type Moves = Record<AnimalCode, number[]>;

/** 한 판의 경주 계획. truth[0] = 1등, lastRound 는 학생에게 비공개 */
export interface Race {
  truth: AnimalCode[];
  lastRound: number;
  moves: Moves;
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
  unit: string;
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
  className: string;
  unit: string;

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

  animals: Record<AnimalCode, string>;
  emojis: Record<AnimalCode, string>;

  hintPool: Record<Level, string[]>;
  hintGiven: Record<number, string[]>;   // 모둠번호 → ['어려움#0', ...]

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
