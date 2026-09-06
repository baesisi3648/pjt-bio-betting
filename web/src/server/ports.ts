/**
 * ports.ts — 라우터가 바깥 세계와 만나는 **좁은 문 세 개**.
 *
 * Worker 의 라우팅·인증·봉투 처리를 `fetch(request, env)` 안에 두면 게이트를 돌리는 데
 * workerd 와 진짜 D1 이 필요해진다. 그래서 라우터는 `env` 를 모르고 이 인터페이스만 안다:
 *
 *   RoomPort — 판 하나 (실제: Durable Object RPC / 테스트: 인메모리 Room)
 *   DbPort   — 문제은행·동물·설정·최근 판 목록 (실제: D1 / 테스트: 인메모리 표)
 *   Ports    — 그 둘 + 관리자 비밀번호 + 시계
 *
 * 2단계의 RoomDeps 와 같은 사상이다. 이래야 SEC 게이트가 HTTP 라우트 수준에서 돈다.
 */

import type { Settings } from '../game/config.ts';
import type { Question, Rng } from '../game/types.ts';
import type { AnimalTable, Envelope } from '../do/room.ts';

// ────────────────────────────────────────────────────────────
// 요청·응답 — 런타임 타입(Request/Response)을 쓰지 않는 평범한 객체
// ────────────────────────────────────────────────────────────

/**
 * ⚠️ 진짜 `Request` 를 쓰지 않는 이유: @cloudflare/workers-types 와 @types/node 가
 *    같은 이름을 다르게 선언해 한 프로그램에 섞이지 않는다 (tsconfig 가 둘인 이유).
 *    src/server/index.ts 가 Request → ApiRequest 로 옮기고, 라우터는 이 모양만 본다.
 */
export interface ApiRequest {
  method: string;
  /** 물음표 앞까지. 예: '/api/game/ABCD/handout' */
  path: string;
  query: Record<string, string>;
  /** ⚠️ 열쇠 이름은 전부 소문자다. HTTP 헤더는 대소문자를 안 가린다 */
  headers: Record<string, string>;
  /** 파싱된 JSON. 본문이 없거나 JSON 이 아니면 undefined */
  body: unknown;
  /** 요청이 들어온 곳. 학생 주소(studentUrl)를 여기서 만든다 */
  origin: string;
}

/**
 * 봉투가 아닌 **파일**로 나가는 응답 (JSON 내보내기 하나뿐이다).
 *
 * ⚠️ 이 탈출구를 늘리지 마세요. 봉투가 언제나 봉투인 것이 화면이 `error` 코드로만
 *    분기할 수 있는 이유다 (MIGRATION §8-1). 내보내기가 예외인 이유는 하나 —
 *    브라우저가 이 응답을 **파일로 저장**해야 하고, `{ok:true,data:{...}}` 로 감싸면
 *    저장된 파일이 우리 형식(§3-2)이 아니게 되어 다시 가져올 수 없기 때문이다.
 */
export interface RawResponse {
  body: string;
  /** content-type · content-disposition 처럼 이 응답에만 필요한 헤더 */
  headers: Record<string, string>;
}

export interface ApiResponse {
  status: number;
  /** ⚠️ 언제나 봉투다 (MIGRATION §8-1). 화면은 status 가 아니라 error 코드로 분기한다 */
  body: Envelope<unknown>;
  /**
   * 있으면 index.ts 가 `body` 대신 **이것을 그대로 흘려보낸다**.
   * 있는 곳은 `GET /api/admin/export` 하나뿐이다. 위 RawResponse 주석 참조.
   */
  raw?: RawResponse;
}

// ────────────────────────────────────────────────────────────
// 판 하나
// ────────────────────────────────────────────────────────────

export interface RoomPort {
  /** ops.ts 의 이름표를 그대로 쓴다 ('create' · 'join' · 'getState' …) */
  op(name: string, args: unknown[]): Promise<Envelope<unknown>>;
  /**
   * ⚠️ 관리자 전용. 교사 열쇠를 되찾는 경로 (MIGRATION §10).
   *    op() 표에 넣지 않은 이유는 GameRoom.adminHostKey 주석에 있다.
   */
  hostKey(): Promise<string | null>;
}

// ────────────────────────────────────────────────────────────
// 판 사이에서 공유되는 데이터 (앱스 스크립트판의 '문제'·'동물'·'설정'·'게임' 탭)
// ────────────────────────────────────────────────────────────

/**
 * '이어하기' 목록 한 줄.
 * ⚠️ **비밀이 아닌 것만** 담는다. 이 목록은 인증 없이 나간다 (MIGRATION §7 3단계).
 *    교사 열쇠·모둠 암호·정답은 물론이고 라운드 진행 상황도 넣지 않는다.
 *
 * ⚠️ 열쇠 이름이 `className`·`unit` 인 채로 남아 있다. D1 의 열은 2단계에서
 *    `class_name`·`set_name` 이 됐지만, **이 모양은 교사 화면이 지금 그대로 읽는다** —
 *    교사 화면은 3단계 몫이라 여기서 이름을 바꾸면 '이어하기' 표가 지금 당장 빈칸이 된다.
 *    3단계에서 교사 화면과 **함께** roomTitle·setName 으로 옮긴다.
 */
export interface RecentGame {
  code: string;
  className: string;
  unit: string;
  /** ms. ⚠️ Date 객체를 넣으면 직렬화 경계에서 응답이 통째로 죽는다 (MIGRATION §5) */
  createdAt: number;
  isOver: boolean;
}

/**
 * 문제 세트 한 줄 — 이름과 개수만. **정답도 문제 내용도 없다.**
 * 그래서 이 모양은 인증 없이 나갈 수 있다 (`GET /api/sets`, 게이트 LEAK-ADMIN).
 */
export interface SetInfo {
  name: string;
  total: number;
  /** 난이도(LEVELS) → 개수 */
  byLevel: Record<string, number>;
}

/**
 * 판을 만들기 전 문제은행 검사 결과. `apps-script/Sheet.gs` 의 validateSheets 가 하던 일.
 *
 * blocking 이 하나라도 있으면 판을 만들지 않는다. warnings 는 만들되 교사에게 알린다.
 */
export interface PreparedSet {
  blocking: string[];
  /** 문항 수 부족 + 건너뛴 줄. ⚠️ 설정 경고는 여기 넣지 않는다 — 아래 참조 */
  warnings: string[];
  /**
   * D1 에 있지만 **읽지 못해 건너뛴** 줄 (난이도가 LEVELS 밖이거나 정답이 1~4 밖).
   *
   * `warnings` 에도 같은 문장이 들어 있다 — 판을 만드는 교사는 둘을 구분할 이유가 없다.
   * 따로 빼 둔 것은 관리 화면 때문이다: 거기서는 문항 수 부족이 **표의 노란 칸**으로
   * 이미 보이므로, 같은 말을 문장으로 또 쓰면 세트마다 세 줄씩 쌓여서 정작 이 줄
   * ("12번 문항은 난이도가 이상해서 안 쓰입니다")이 묻힌다.
   */
  skipped: string[];
  /**
   * '설정' 값이 범위를 벗어나서 되돌린 것들.
   * warnings 와 나눠 둔 이유: Room.create 가 normalizeSettings 를 **다시** 부르며
   * 같은 경고를 만들어 붙인다. 합쳐서 넘기면 교사 화면에 같은 줄이 두 번 뜬다.
   * 판 만들기 전 미리보기(`GET /api/prepare`)에서만 합쳐 보여준다.
   */
  settingWarnings: string[];
  questions: Question[];
  animals: AnimalTable;
  /** 원본 값. 범위 검사는 Room.create 안의 normalizeSettings 가 한다 */
  settings: Partial<Settings>;
}

// ────────────────────────────────────────────────────────────
// 문제은행 관리 화면
// ────────────────────────────────────────────────────────────

/**
 * 관리 화면이 다루는 문항 한 벌.
 *
 * ⚠️ **여기에는 정답과 해설이 들어 있다.** 이 모양이 나가는 곳은 `/api/admin/*` 뿐이고,
 *    그 앞에는 관리자 비밀번호 확인이 있다 (router.ts adminDenied).
 *    `GET /api/units`·`/api/sets`·`/api/prepare` 는 지금처럼 개수와 경고만 내보낸다 —
 *    거기에 이 타입을 얹는 순간 판 코드도 필요 없이 정답이 새어 나간다 (게이트 LEAK-ADMIN).
 *
 * D1 의 choice1~4 를 `choices[4]` 로 묶어 둔 것은 화면이 다루기 쉬워서이고,
 * 열 이름을 아는 곳은 여전히 db.ts 뿐이다.
 */
export interface AdminQuestion {
  id: number;
  /** 문제 세트 이름 (예전 이름은 unit). D1 열은 `questions.set_name` */
  setName: string;
  /** config.ts 의 LEVELS (쉬움 | 보통 | 어려움). 검사는 admin.ts 가 한다 */
  level: string;
  text: string;
  /** 정확히 4개 */
  choices: string[];
  /** 1~4 */
  answer: number;
  explanation: string;
}

/** 아직 id 가 없는 문항 (추가·가져오기) 또는 id 를 따로 받는 문항 (수정) */
export type QuestionDraft = Omit<AdminQuestion, 'id'>;

/**
 * JSON 가져오기가 기존 문제은행을 어떻게 다루는가 (RENEWAL §3-2).
 *
 *   append     — 그대로 더한다. 아무것도 지우지 않는다
 *   replaceSet — **같은 이름 세트만** 지우고 넣는다. 다른 세트는 그대로
 *   replaceAll — 문제은행을 통째로 비우고 넣는다 (화면에서 빨간 버튼 + 확인 대화)
 */
export type ImportMode = 'append' | 'replaceSet' | 'replaceAll';

/**
 * 동물 한 줄.
 * ⚠️ `code` 는 A~H 로 고정이다 — 게임 코드가 그 이름을 쓴다 (migrations/0001_init.sql).
 *    관리 화면이 바꾸는 것은 **이름과 이모지뿐**이고, 추가·삭제는 없다.
 */
export interface AdminAnimal { code: string; name: string; emoji: string }

/** '설정' 한 줄. label 은 SETTING_RANGE 가 갖고 있으므로 여기서는 값만 오간다 */
export interface AdminSetting { key: string; value: string }

export interface DbPort {
  /** 세트 목록 + 개수. 인증 없이 나가는 모양이라 정답이 들어 있지 않다 */
  listSets(): Promise<SetInfo[]>;
  recentGames(limit: number): Promise<RecentGame[]>;
  /** ⚠️ `setName` 이 null 이면 **전체 은행**으로 판을 만든다 (RENEWAL §1) */
  prepareSet(setName: string | null): Promise<PreparedSet>;
  /** 뽑은 판 코드가 이미 쓰였는가 (apps-script 의 findGameRow) */
  hasGame(code: string): Promise<boolean>;
  addGame(row: { code: string; className: string; unit: string; createdAt: number }): Promise<void>;
  markOver(code: string): Promise<void>;

  // ── 관리 화면. 부르는 곳은 admin.ts 하나뿐이다 ──
  /** setName 이 null 이면 전부 */
  adminQuestions(setName: string | null): Promise<AdminQuestion[]>;
  adminAddQuestion(q: QuestionDraft): Promise<AdminQuestion>;
  /** 없는 id 면 false — 라우트가 NOT_FOUND 로 바꾼다 */
  adminUpdateQuestion(id: number, q: QuestionDraft): Promise<boolean>;
  adminDeleteQuestion(id: number): Promise<boolean>;
  /** 세트 이름 바꾸기. 옮겨진 문항 수를 준다 (0 이면 그런 세트가 없었다) */
  adminRenameSet(from: string, to: string): Promise<number>;
  /** 세트 통째로 지우기. 지워진 문항 수를 준다 */
  adminDeleteSet(name: string): Promise<number>;
  /**
   * JSON 가져오기. **한 번의 원자적 쓰기**여야 한다 (D1 `batch`).
   *
   * ⚠️ 지우기와 넣기를 두 번의 왕복으로 나누지 마세요 — 그 사이에 실패하면
   *    선생님의 문제은행이 **빈 채로 남는다**. replaceAll 이 특히 그렇다.
   */
  adminImport(setName: string, mode: ImportMode, rows: QuestionDraft[]): Promise<number>;
  adminAnimals(): Promise<AdminAnimal[]>;
  /** 8줄을 통째로 바꾼다. A~H 가 아닌 줄은 지운다 (그래야 망가진 표를 화면에서 고칠 수 있다) */
  adminSaveAnimals(rows: AdminAnimal[]): Promise<void>;
  adminSettings(): Promise<AdminSetting[]>;
  adminSaveSettings(rows: AdminSetting[]): Promise<void>;
}

// ────────────────────────────────────────────────────────────

export interface Ports {
  room(code: string): RoomPort;
  db: DbPort;
  /** ⚠️ undefined 면 관리자 라우트는 전부 거부한다. '설정 안 함 = 무방비' 가 되면 안 된다 */
  adminPassword: string | undefined;
  now(): number;
  /** 판 코드 뽑기. 테스트가 충돌을 일부러 만들 수 있게 주입한다 */
  rng?: Rng;
}
