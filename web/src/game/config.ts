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
  moveSeconds:     20,   // 경주(moving) 단계. 앱스 스크립트판에는 없던 단계다 — MIGRATION §8-3
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
  moveSeconds:    { min: 5,  max: 60,  label: '경주시간초' },
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

/**
 * 오류 코드 → 학생이 읽을 한국어 문장. apps-script/Config.gs 의 ERRORS 를 옮겨왔다.
 *
 * ⚠️ 코드(`error`)는 화면이 분기에 쓰고, 문장(`message`)은 사람이 읽는다.
 *    문장으로 분기하면 말투를 다듬는 순간 화면이 깨진다. 항상 코드로 분기할 것.
 *
 * 옮기면서 더한 것:
 *   BAD_AMOUNT · BAD_ANIMAL — rules.validateBet 이 예전부터 내던 코드인데
 *     ERRORS 에 없어서 학생에게 '문제가 생겼어요'만 떴다. 여기서 문장을 준다.
 *   GAME_EXISTS — DO 는 판 코드 하나가 인스턴스 하나라, 같은 코드로 두 번
 *     만들려는 시도를 서버가 직접 막는다 (앱스 스크립트판은 코드를 다시 뽑았다).
 *   LOCK_TIMEOUT 은 남겨 둔다 — Durable Object 에는 잠금이 없어 이제 나오지 않지만,
 *     예전 판을 이어 보는 화면이 이 코드를 만나면 문장이라도 있어야 한다.
 */
export const MESSAGES: Record<string, string> = {
  GAME_NOT_FOUND:   '그런 판이 없어요. 칠판의 코드를 다시 확인해주세요',
  GAME_ENDED:       '이 판은 이미 끝났어요',
  GAME_EXISTS:      '이미 만들어진 판이에요',
  WRONG_PIN:        '암호가 달라요. 모둠장에게 확인해주세요',
  QUIZ_CLOSED:      '제출 시간이 지났어요',
  BET_CLOSED:       '베팅 시간이 지났어요. 다음 라운드를 기다려주세요',
  ALREADY_ANSWERED: '이번 라운드는 이미 제출했어요',
  ALREADY_BET:      '이미 확정했어요',
  TOO_MANY_COINS:   '이번 라운드에는 3개까지만 걸 수 있어요',
  NOT_ENOUGH_COINS: '코인이 모자라요',
  BAD_AMOUNT:       '코인 수가 이상해요',
  BAD_ANIMAL:       '그런 동물이 없어요',
  PAUSED:           '선생님이 잠시 멈췄어요',
  LOCK_TIMEOUT:     '잠시 후 다시 눌러주세요',
  SHEET_INVALID:    '문제 구성을 확인해주세요',
  NOT_HOST:         '이 판의 교사 화면이 아니에요. 교사 열쇠를 확인해주세요',

  // ── 3단계(게이트웨이)에서 생긴 코드 ──
  //
  // TOO_MANY_TRIES: 모둠 암호는 4자리(1만 가지)뿐이라, 판마다 단일 스레드인 DO 를
  //   초당 수십 번 두드리면 6분이면 뚫린다. 연속 실패가 쌓이면 잠시 막는다 (src/do/ops.ts).
  //   ⚠️ 이 문장을 지우면 학생 폰에 '문제가 생겼어요' 만 떠서, 기다리면 풀린다는 걸 모른다.
  TOO_MANY_TRIES:   '암호를 여러 번 틀렸어요. 30초 뒤에 다시 해주세요',
  BAD_REQUEST:      '요청 형식이 올바르지 않아요',
  NOT_FOUND:        '없는 주소예요',
  ADMIN_DENIED:     '관리자 비밀번호가 달라요',
  // ADMIN_PASSWORD 를 안 넣고 배포하면 관리자 경로는 통째로 닫힌다.
  // '비밀번호 없음 = 아무나 통과' 가 되면 배포 실수 한 번에 모든 판의 교사 열쇠가 샌다.
  ADMIN_DISABLED:   '관리자 기능이 꺼져 있어요'
};

/** 화면 하단에 표시 — 재배포 누락 감지용 (apps-script 의 DEPLOY_VERSION 자리) */
export const DEPLOY_VERSION = 'web-3단계';
