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
  studentUrl:      '',   // '설정' 탭에서 덮어쓸 수 있다
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

/**
 * 교사 열쇠 — 교사 화면만 알아야 하는 값.
 *
 * ⚠️ 판 코드는 칠판에 적혀 있어서 비밀이 아니다.
 *    코드만으로 교사 화면을 열 수 있으면 학생이 정답 순위와 모둠 암호를 그대로 본다.
 *    그래서 진행·정산·정답에 관한 함수는 전부 이 열쇠를 확인한다.
 *    열쇠는 판을 만들 때 한 번 발급되어 교사 브라우저에 저장되고,
 *    잃어버리면 스프레드시트 메뉴('교사 열쇠 확인')에서 다시 본다 — 시트는 교사만 연다.
 */
var HOST_KEY_LENGTH = 12;

var LIMITS = {
  lockWaitMs:      10000,
  pollLockWaitMs:   2000,   // 폴링은 오래 기다리지 않는다. 못 잡으면 2초 뒤 어차피 다시 온다
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
  SHEET_INVALID:    '시트 구성을 확인해주세요',
  NOT_HOST:         '이 판의 교사 화면이 아니에요. 교사 열쇠를 확인해주세요'
};

/**
 * 배포된 웹앱 주소 (최후의 수단).
 *
 * ScriptApp.getService().getUrl() 은 스프레드시트에 붙은 스크립트에서
 * '/dev' 주소를 돌려줄 때가 있다. /dev 는 편집 권한이 있어야 열려서,
 * 학생이 찍으면 "현재 파일을 열 수 없습니다"가 뜬다.
 *
 * 배포 주소는 npm run deploy 가 항상 같은 배포를 갱신하므로 바뀌지 않는다.
 * 다른 계정으로 새로 배포했다면 '설정' 탭의 학생주소 행에 넣으면 이 값보다 우선한다.
 */
/**
 * 이 게임이 쓰는 스프레드시트 ID.
 *
 * ⚠️ SpreadsheetApp.getActive() 는 스프레드시트 메뉴에서 부를 때는 되지만
 *    **웹앱으로 실행될 때는 null 을 돌려줄 수 있다.** 그러면 시트를 아예 못 읽어서
 *    단원 목록이 비고, 판도 못 만든다.
 *    그래서 openById 로 직접 연다.
 */
var SPREADSHEET_ID = '1BGPCWghYREs15EbMsO-asazFdntPiFYqjmkaxoruL1A';

var WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbyRHvpmemANRgY0Gf6I5FvRL7iKs0JrdYR7v0NkIfpZROOAaaStrWmGx4nDo0AKifo/exec';

var DEPLOY_VERSION = '2026-09-05a';  // 화면 하단에 표시 — 재배포 누락 감지용
