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

export interface ApiResponse {
  status: number;
  /** ⚠️ 언제나 봉투다 (MIGRATION §8-1). 화면은 status 가 아니라 error 코드로 분기한다 */
  body: Envelope<unknown>;
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
 * 판을 만들기 전 문제은행 검사 결과. `apps-script/Sheet.gs` 의 validateSheets 가 하던 일.
 *
 * blocking 이 하나라도 있으면 판을 만들지 않는다. warnings 는 만들되 교사에게 알린다.
 */
export interface PreparedUnit {
  blocking: string[];
  /** 문항 수 부족 등. ⚠️ 설정 경고는 여기 넣지 않는다 — 아래 참조 */
  warnings: string[];
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

export interface DbPort {
  listUnits(): Promise<string[]>;
  recentGames(limit: number): Promise<RecentGame[]>;
  prepareUnit(unit: string): Promise<PreparedUnit>;
  /** 뽑은 판 코드가 이미 쓰였는가 (apps-script 의 findGameRow) */
  hasGame(code: string): Promise<boolean>;
  addGame(row: { code: string; className: string; unit: string; createdAt: number }): Promise<void>;
  markOver(code: string): Promise<void>;
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
