/**
 * config.ts — 상수만. 로직 금지.
 *
 * apps-script/Config.gs 에서 옮겨왔다. 시트 탭 이름처럼 앱스 스크립트에만
 * 있던 것은 빼고, 게임 규칙에 필요한 것만 남긴다.
 */

export const ANIMAL_CODES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
/**
 * 난이도. '중간' → '보통' (RENEWAL §1 결정표).
 *
 * ⚠️ 이 문자열은 D1 `questions.level` 에 그대로 들어 있는 값이다.
 *    바꾸면 마이그레이션(0005)이 옛 값을 같이 옮겨야 한다 — 안 그러면
 *    옛 문항이 통째로 '난이도가 …가 아님' 으로 걸러진다 (bank.ts toQuestion).
 */
export const LEVELS = ['쉬움', '보통', '어려움'] as const;

/**
 * 한 판의 라운드 수. **10라운드 고정** (RENEWAL §1).
 *
 * ⚠️ 설정에 두지 않는다. 힌트가 라운드×난이도로 짝지어져 있어서(§2-2)
 *    라운드 수가 판마다 달라지면 힌트 30개도 판마다 달라진다.
 *
 * 2026-09-07 부터 `state.lastRound` 는 **항상 이 값(10)** 이다. 골인 라운드가
 * 1위 8R · 2위 9R · 3위 10R 로 고정됐기 때문이다 — 예전에는 3위가 9R 에 들어오면
 * 10R 없이 정산했다(lastRound 9). 필드는 이어하기(옛 판)를 위해 남아 있다.
 */
export const ROUNDS = 10;
export const BONUS_ROUND = 5;
export const BONUS_COST = 5;
export const BONUS_SECONDS = 45;
export const PREDICTION_BONUS = 15;

/** 결승선까지 이 거리만 남으면 해당 동물에 더 이상 베팅할 수 없다. */
export const NO_BET_DISTANCE = 3;

/** 20칸 트랙이면 17칸부터 베팅 금지다. 트랙 설정이 바뀌어도 결승선 기준을 유지한다. */
export function noBetStartsAt(trackCells: number): number {
  return Math.max(0, trackCells - NO_BET_DISTANCE);
}

export function isNoBetPosition(position: number, trackCells: number): boolean {
  return position >= noBetStartsAt(trackCells);
}

export type AnimalCode = (typeof ANIMAL_CODES)[number];
export type Level = (typeof LEVELS)[number];
/** 10라운드 문제 정답은 베팅 잔액이 아니라 최종 정산에만 더한다. */
export const FINAL_QUIZ_BONUS: Record<Level, number> = { 쉬움: 3, 보통: 5, 어려움: 7 };

export const PHASES = {
  WAITING: 'waiting',
  MOVING:  'moving',
  QUIZ:    'quiz',
  BONUS:   'bonus',
  DISCUSS: 'discuss',
  BETTING: 'betting',
  PAUSED:  'paused',
  DONE:    'done'
} as const;

export type Phase = (typeof PHASES)[keyof typeof PHASES];

/**
 * 교사가 '지금 넘어가기'로 끝낼 수 있는 단계 (MIGRATION §8-3).
 *
 * ⚠️ 여기에 `moving` 을 넣지 마세요. 경주 20초는 학생이 **결과를 보는** 시간이라
 *    건너뛰면 말이 순간이동한 것처럼 보입니다. `waiting`·`done` 은 애초에 시간이
 *    흐르지 않아 끝낼 것이 없습니다 (`phaseEndsAt` 이 null 이다).
 */
export const SKIPPABLE_PHASES = [PHASES.QUIZ, PHASES.BONUS, PHASES.DISCUSS, PHASES.BETTING] as readonly Phase[];

export const DEFAULTS = {
  // 20 → 30 (2026-09-07 사용자 결정). 라운드당 최대 3코인 × 10라운드 = 30 이라
  // 20 이면 7라운드째에 지갑이 비고 남은 세 라운드는 힌트를 받아도 걸 것이 없다.
  // ⚠️ 배포된 D1 `settings` 에는 0002 가 넣은 '20' 이 그대로 있다 —
  //    여기만 고치면 배포판은 안 바뀐다. `migrations/0008_coins30.sql` 이 같이 간다
  initialCoins:    30,
  maxBetPerRound:  3,
  seedCoins:       15,   // PDF는 5. 리뷰 C6 — 5면 최대 배당 29.6배라 추론이 복권이 된다
  // ── 시간 (RENEWAL §1 결정표) — 라운드 190초 × 10라운드 ≈ 32분 ──
  moveSeconds:     15,   // 경주(moving) 단계. 앱스 스크립트판에는 없던 단계다 — MIGRATION §8-3
  quizSeconds:     40,
  discussSeconds:  90,   // 감독 G-02 — 힌트를 놓고 이야기하는 시간. 이 수업의 실체
  betSeconds:      45,
  trackCells:      20,
  /**
   * 모든 모둠이 이번 단계 행동을 마친 뒤 몇 초 더 두는가 (문제·베팅 단계만).
   * 0 이면 자동 단축을 끈다.
   *
   * ⚠️ 0 으로 만들지 마세요 — 마지막으로 제출한 모둠이 정답·해설을 **한 글자도 못 보고**
   *    다음 단계로 끌려갑니다. 그 5초가 자동 단축의 값입니다.
   * ⚠️ 토론 단계에는 적용하지 않습니다. 토론 180초가 이 수업의 실체입니다 (MIGRATION §1).
   */
  autoSkipSeconds:  5,
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
  // 5 미만이면 4~8위 다섯 마리를 서로 다른 칸에 못 세운다 (조건 5).
  //
  // 23칸 상한은 기존 설정을 유지한다. 4칸 스퍼트로 산술상 더 긴 트랙도 가능해졌지만
  // 범위를 넓히는 것은 별도 결정이다. 게이트 RACE-TRK 가 5~23 전부를 검사한다.
  trackCells:     { min: 5,  max: 23,  label: '트랙칸수' },
  // 0 은 '끔' 이라 min 이 0 이다. 다른 시간 설정과 달리 하한이 없다
  autoSkipSeconds: { min: 0, max: 30,  label: '자동단축초' }
};

/** 판 코드에서 뺀다 — 칠판에 적힌 걸 30명이 폰에 입력한다 */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  // 0 O 1 I 제외
export const CODE_LENGTH = 4;
export const PIN_LENGTH = 4;
export const HOST_KEY_LENGTH = 12;

export const LIMITS = {
  /**
   * 경주 계획 재시도. 50 → 200 으로 올렸다.
   *
   * 리뉴얼 생성기는 "선두가 두 번 이상 바뀐다 · 1위는 4라운드 이후에 처음 선두"라는
   * 조건(RENEWAL §2-1 조건 6)을 **굴려 보고 안 맞으면 다시 굴린다.** 50 번으로는
   * 트랙이 좁을 때(설정 4~30) 실패해서 판이 안 만들어지는 일이 생긴다.
   */
  reverseAttempts: 200,
  /** 힌트 10개가 1·2·3등을 확정해 버리면 다시 굴린다 (RENEWAL §2-2, 게이트 HINT-HARD) */
  hintAttempts:     60,
  /**
   * 난이도별 문항이 이보다 적으면 **경고**한다 (차단은 아니다 — 판은 만들어진다).
   *
   * 6 → 10 으로 올렸다. 6 은 라운드가 5~6개이던 시절의 값이다. 지금은 10라운드 고정이라
   * (config.ts ROUNDS) 한 모둠이 10라운드 내내 같은 난이도를 고르면 그 난이도 문항 10개를
   * 다 쓴다. 9개짜리 세트로 판을 만들면 마지막 라운드에 **앞 라운드 문제가 다시 나온다** —
   * 이미 답을 아는 문제라 그 라운드의 힌트가 공짜가 된다.
   *
   * ⚠️ 이름이 `minHintsPerLevel` 이었다. 힌트는 이제 라운드×난이도로 30개가 미리 만들어지고
   *    (RENEWAL §2-2) 문항 수와 아무 상관이 없다 — 옛 이름은 그 둘이 같은 것이라고
   *    읽히게 해서 바꿨다.
   */
  minQuestionsPerLevel: 10
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
  BONUS_CLOSED:     '추가 단서 구입 시간이 아니에요',
  BONUS_BOUGHT:     '이미 추가 단서를 구입했어요',
  BAD_BOX:          '비밀 상자 번호를 다시 확인해주세요',
  ALREADY_ANSWERED: '이번 라운드는 이미 제출했어요',
  ALREADY_BET:      '이미 확정했어요',
  // 결승선 3칸 전부터 그 동물의 베팅 줄은 닫힌다.
  BET_FINISHED:     '결승선 3칸 전부터는 해당 동물에 걸 수 없어요',
  TOO_MANY_COINS:   '이번 라운드에는 3개까지만 걸 수 있어요',
  NOT_ENOUGH_COINS: '코인이 모자라요',
  BAD_AMOUNT:       '코인 수가 이상해요',
  BAD_ANIMAL:       '그런 동물이 없어요',
  PREDICTION_CLOSED: '1라운드가 시작되어 우승 예측이 마감됐어요',
  PREDICTION_LOCKED: '우승 동물은 이미 예측했어요. 변경할 수 없어요',
  PAUSED:           '선생님이 잠시 멈췄어요',
  // '지금 넘어가기' 는 문제·토론·베팅에서만 쓴다. 경주 중이거나 대기·종료 상태면 끝낼 게 없다
  NOT_SKIPPABLE:    '지금은 넘어갈 수 있는 단계가 아니에요',
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
export const DEPLOY_VERSION = 'web-2026.09.18-final-sprint-bonus';
