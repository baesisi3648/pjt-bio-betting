/**
 * Config.gs — 상수만. 로직 금지.
 * 시트 탭 이름은 여기서만 정의한다 (07-coding-convention §2).
 */

var SHEETS = {
  QUESTIONS: '문제',
  HINTS:     '힌트문구',
  ANIMALS:   '동물',
  SETTINGS:  '설정',
  GAMES:     '게임',
  EVENTS:    '기록'
};

var DEFAULTS = {
  initialCoins:    20,
  maxBetPerRound:  3,
  seedCoins:       15,   // PDF는 5. 리뷰 C6 — 5면 최대 배당 29.6배라 추론이 복권이 된다
  quizSeconds:     90,
  discussSeconds: 180,   // 감독 G-02 — 힌트를 놓고 이야기하는 시간. 이 수업의 실체
  betSeconds:      60,
  trackCells:      10,
  payout: { 1: 1.0, 2: 0.7, 3: 0.5 }
};

var ANIMAL_CODES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
var LEVELS = ['쉬움', '중간', '어려움'];

var PHASES = {
  WAITING: 'waiting',
  MOVING:  'moving',
  QUIZ:    'quiz',
  DISCUSS: 'discuss',
  BETTING: 'betting',
  PAUSED:  'paused',
  DONE:    'done'
};

/** 판 코드에서 뺀다 — 칠판에 적힌 걸 30명이 폰에 입력한다 */
var CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  // 0 O 1 I 제외
var CODE_LENGTH = 4;
var PIN_LENGTH = 4;

var LIMITS = {
  lockWaitMs:      10000,
  cacheSeconds:    21600,   // 6시간
  maxStateBytes:   100000,  // CacheService 한도
  reverseAttempts: 50,      // 이동 역산 재시도
  minHintsPerLevel: 6       // 감독 G-03 — 한 모둠이 6라운드 내내 같은 난이도를 골라도 중복 없게
};

var ERRORS = {
  GAME_NOT_FOUND:   '그런 판이 없어요. 칠판의 코드를 다시 확인해주세요',
  GAME_ENDED:       '이 판은 이미 끝났어요',
  WRONG_PIN:        '암호가 달라요. 모둠장에게 확인해주세요',
  QUIZ_CLOSED:      '제출 시간이 지났어요',
  BET_CLOSED:       '베팅 시간이 지났어요. 다음 라운드를 기다려주세요',
  ALREADY_ANSWERED: '이번 라운드는 이미 제출했어요',
  ALREADY_BET:      '이미 확정했어요',
  TOO_MANY_COINS:   '이번 라운드에는 3개까지만 걸 수 있어요',
  NOT_ENOUGH_COINS: '코인이 모자라요',
  PAUSED:           '선생님이 잠시 멈췄어요',
  LOCK_TIMEOUT:     '잠시 후 다시 눌러주세요',
  SHEET_INVALID:    '시트 구성을 확인해주세요'
};

var DEPLOY_VERSION = '2026-08-01a';  // 화면 하단에 표시 — 재배포 누락 감지용
