/**
 * config.ts — 상수만. 로직 금지.
 *
 * apps-script/Config.gs 에서 옮겨왔다. 시트 탭 이름처럼 앱스 스크립트에만
 * 있던 것은 빼고, 게임 규칙에 필요한 것만 남긴다.
 */

export const ANIMAL_CODES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
export const LEVELS = ['쉬움', '중간', '어려움'] as const;

export type AnimalCode = (typeof ANIMAL_CODES)[number];
export type Level = (typeof LEVELS)[number];

export const PHASES = {
  WAITING: 'waiting',
  MOVING:  'moving',
  QUIZ:    'quiz',
  DISCUSS: 'discuss',
  BETTING: 'betting',
  PAUSED:  'paused',
  DONE:    'done'
} as const;

export type Phase = (typeof PHASES)[keyof typeof PHASES];

export const DEFAULTS = {
  initialCoins:    20,
  maxBetPerRound:  3,
  seedCoins:       15,   // PDF는 5. 리뷰 C6 — 5면 최대 배당 29.6배라 추론이 복권이 된다
  quizSeconds:     90,
  discussSeconds: 180,   // 감독 G-02 — 힌트를 놓고 이야기하는 시간. 이 수업의 실체
  betSeconds:      60,
  trackCells:      10,
  payout: { 1: 1.0, 2: 0.7, 3: 0.5 } as Record<number, number>
};

export type Settings = typeof DEFAULTS;

/** '설정' 값의 허용 범위. 벗어나면 기본값을 쓰고 무엇을 되돌렸는지 알린다 */
export const SETTING_RANGE: Record<string, { min: number; max: number; label: string }> = {
  initialCoins:   { min: 1,  max: 500, label: '초기코인' },
  maxBetPerRound: { min: 1,  max: 50,  label: '라운드당최대베팅' },
  seedCoins:      { min: 1,  max: 500, label: '시드코인' },
  quizSeconds:    { min: 10, max: 900, label: '문제시간초' },
  discussSeconds: { min: 10, max: 900, label: '토론시간초' },
  betSeconds:     { min: 10, max: 900, label: '베팅시간초' },
  trackCells:     { min: 4,  max: 30,  label: '트랙칸수' }
};

/** 판 코드에서 뺀다 — 칠판에 적힌 걸 30명이 폰에 입력한다 */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  // 0 O 1 I 제외
export const CODE_LENGTH = 4;
export const PIN_LENGTH = 4;
export const HOST_KEY_LENGTH = 12;

export const LIMITS = {
  reverseAttempts:  50,   // 이동 역산 재시도
  minHintsPerLevel:  6    // 감독 G-03 — 6라운드 내내 같은 난이도를 골라도 중복 없게
};
