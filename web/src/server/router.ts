/**
 * router.ts — 공개 HTTP API. **런타임에 의존하지 않는다** (ports.ts 만 안다).
 *
 * apps-script/Code.gs 의 게이트웨이 16개를 라우트로 옮긴 것이다. 응답 봉투는 그대로
 * `{ok:true, data}` / `{ok:false, error, message}` 다 (MIGRATION §8-1).
 *
 * ── 이 파일이 지키는 것 ──
 *
 * 1. **DO 의 `op` 는 공개 경로가 아니다.** 여기 있는 라우트만이 방을 부른다.
 *    2단계 스텁은 `/room/:code/op` 를 그대로 DO 로 넘겨서, 주소만 알면 누구나
 *    `create` 를 불러 아무 판이나 선점하고 교사 열쇠를 가질 수 있었다 (게이트 SEC13).
 *    판 만들기는 `POST /api/game` 하나뿐이고, 그 경로는 반드시 D1 문제은행을 거친다.
 *
 * 2. **인증은 Room 이 한다.** 여기서는 열쇠·암호를 **옮기기만** 한다.
 *    ⚠️ Worker 가 암호를 대신 채워 넣거나, 소켓 꼬리표·세션으로 권한을 판단하는 순간
 *    §4-4 의 방어가 통째로 무의미해진다. 그래서 이 파일에는 hostKey/pin 을
 *    **비교하는 코드가 한 줄도 없다** (관리자 비밀번호만 예외 — 그건 Room 밖의 것이다).
 *
 * 3. **뷰를 가공하지 않는다.** 응답 데이터는 Room 이 돌려준 것 그대로이고,
 *    전송 계층의 것(studentUrl)만 덧붙인다. 사본을 만들면 정답이 새는데 초록불이 켜진다 (§5).
 */

import { DEPLOY_VERSION } from '../game/config.ts';
import { makeCode } from '../game/rules.ts';
import { err, ok } from '../do/room.ts';
import type { Envelope, Err } from '../do/room.ts';
import { adminRoute } from './admin.ts';
import type { ApiRequest, ApiResponse, Ports, RecentGame } from './ports.ts';

// ────────────────────────────────────────────────────────────
// 봉투 → HTTP
// ────────────────────────────────────────────────────────────

/**
 * 오류 코드 → 상태 코드.
 *
 * ⚠️ 화면은 **status 가 아니라 `error` 코드로 분기한다** (config.ts MESSAGES 주석).
 *    여기 있는 숫자는 사람이 로그를 읽을 때와 프록시가 판단할 때를 위한 것이다.
 *    없는 코드는 400 이 된다 — 게임 규칙 오류(BET_CLOSED 등)도 "그 요청은 못 받는다"이므로 맞다.
 */
const STATUS: Record<string, number> = {
  NOT_HOST: 403, WRONG_PIN: 403, ADMIN_DENIED: 403,
  TOO_MANY_TRIES: 429,
  GAME_NOT_FOUND: 404, NOT_FOUND: 404,
  GAME_EXISTS: 409,
  ADMIN_DISABLED: 503
};

function reply(env: Envelope<unknown>): ApiResponse {
  return { status: env.ok ? 200 : (STATUS[env.error] ?? 400), body: env };
}

function fail(code: string, message?: string): ApiResponse {
  return reply(err(code, message));
}

// ────────────────────────────────────────────────────────────
// 요청 읽기
// ────────────────────────────────────────────────────────────

function bodyOf(req: ApiRequest): Record<string, unknown> {
  return (req.body && typeof req.body === 'object' && !Array.isArray(req.body))
    ? req.body as Record<string, unknown>
    : {};
}

/**
 * 교사 열쇠. 헤더 `X-Host-Key` 가 정본이고, 본문 `hostKey` 도 받는다.
 * ⚠️ 물음표 뒤(query)로는 절대 받지 않는다 — 주소는 로그·기록·어깨너머로 남는다.
 */
function hostKeyOf(req: ApiRequest, body: Record<string, unknown>): string | null {
  const h = req.headers['x-host-key'];
  if (h) return h;
  return body.hostKey == null ? null : String(body.hostKey);
}

/** 모둠 암호. 헤더 `X-Team-Pin` 이 정본. GET 에는 본문이 없으므로 헤더만 쓴다 */
function pinOf(req: ApiRequest, body: Record<string, unknown>): string | null {
  const h = req.headers['x-team-pin'];
  if (h) return h;
  return body.pin == null ? null : String(body.pin);
}

/**
 * ⚠️ 길이가 달라도 항상 같은 만큼 돌고 나서 답한다.
 *
 * `a === b` 로 비교하면 첫 글자가 틀린 비밀번호가 더 빨리 돌아온다.
 * 이론적으로는 그 차이로 한 글자씩 알아낼 수 있고, 실제로 그렇게 뚫린 서비스들이 있다.
 * (workerd 에는 crypto.subtle.timingSafeEqual 이 있지만, 이 함수는 라우터 코어에
 *  있어야 하고 코어는 런타임을 몰라야 한다 — 그래서 순수 JS 로 둔다)
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  return diff === 0;
}

/** 학생 폰에 안내할 주소. QR 은 화면(4단계)이 그린다 — 서버는 주소만 (MIGRATION §7) */
function studentUrlOf(req: ApiRequest): string {
  return req.origin.replace(/\/+$/, '') + '/';
}

// ────────────────────────────────────────────────────────────
// 라우트 표
// ────────────────────────────────────────────────────────────

const GAME = /^\/api\/game\/([A-Za-z0-9]{1,8})(?:\/([a-z-]+))?$/;

export async function handle(req: ApiRequest, ports: Ports): Promise<ApiResponse> {
  const path = req.path.length > 1 ? req.path.replace(/\/+$/, '') : req.path;
  const method = req.method.toUpperCase();
  const body = bodyOf(req);

  // ── 인증 없음 ──────────────────────────────────────
  if (path === '/api/version') return reply(ok({ v: DEPLOY_VERSION }));
  if (path === '/api/units') return unitsRoute(ports);
  if (path === '/api/prepare') return prepareRoute(req, ports);

  // ── 관리자 비밀번호 필요 ──
  // 판 만들기는 `/api/admin/` 으로 시작하지 않지만 **같은 문**(adminDenied)을 지난다.
  // 이유는 createRoute 머리 주석에 적혀 있다
  if (path === '/api/game' && method === 'POST') return createRoute(req, ports);

  const m = GAME.exec(path);
  if (m) {
    const code = m[1]!.toUpperCase();
    const what = m[2] || '';
    const room = ports.room(code);

    // 인증 없음 — 게임의 비밀을 하나도 담지 않는 응답
    if (what === 'lobby' && method === 'GET') return reply(await room.op('lobby', []));

    // 모둠 암호 필요 — ⚠️ **매 호출** 확인한다. 접속할 때 한 번으로는 아무것도 못 지킨다 (§4-4)
    if (what === 'join' && method === 'POST') {
      return reply(await room.op('join', [Number(body.teamNo), pinOf(req, body)]));
    }
    if (what === 'level' && method === 'POST') {
      return reply(await room.op('chooseLevel', [Number(body.teamNo), body.level, pinOf(req, body)]));
    }
    if (what === 'answer' && method === 'POST') {
      return reply(await room.op('submitAnswer', [Number(body.teamNo), body.level, Number(body.choice), pinOf(req, body)]));
    }
    if (what === 'bet' && method === 'POST') {
      return reply(await room.op('placeBet', [Number(body.teamNo), body.bets, pinOf(req, body)]));
    }

    // 교사 열쇠 필요
    if (what === 'advance' && method === 'POST') return reply(await room.op('advanceRound', [hostKeyOf(req, body)]));
    if (what === 'pause' && method === 'POST') return reply(await room.op('togglePause', [hostKeyOf(req, body)]));
    // '지금 넘어가기'. 문제·토론·베팅만 — 다른 단계면 Room 이 NOT_SKIPPABLE 로 거절한다
    if (what === 'skip' && method === 'POST') return reply(await room.op('skipPhase', [hostKeyOf(req, body)]));
    if (what === 'reveal' && method === 'POST') return reply(await room.op('reveal', [hostKeyOf(req, body)]));
    if (what === 'finalize' && method === 'POST') {
      const res = await room.op('finalize', [hostKeyOf(req, body)]);
      // '이어하기' 목록에서 끝난 판을 구분하기 위한 것. 실패해도 정산 결과는 그대로 돌려준다 —
      // ⚠️ 여기서 던지면 수업 마지막에 정산 화면이 통째로 안 뜬다
      if (res.ok) { try { await ports.db.markOver(code); } catch { /* 목록 표시용일 뿐 */ } }
      return reply(res);
    }
    if (what === 'handout' && method === 'POST') {
      const res = await room.op('handout', [hostKeyOf(req, body)]);
      // ⚠️ 거부된 응답에는 아무것도 덧붙이지 않는다. 모둠 암호가 전부 담긴 뷰다 (SEC4)
      if (!res.ok) return reply(res);
      return reply(ok({ ...(res.data as object), studentUrl: studentUrlOf(req) }));
    }

    // 조회 — viewer 로 갈린다. team: 이 아닌 것은 전부 교사 경로다 (SEC2)
    if (what === 'state' && method === 'GET') {
      const viewer = req.query.viewer ?? null;
      return reply(await room.op('getState', [viewer, hostKeyOf(req, body), pinOf(req, body)]));
    }

    return fail('NOT_FOUND');
  }

  if (path === '/api/admin/host-key' && method === 'POST') return adminHostKeyRoute(req, ports);

  // ── 관리자 — 문제은행 관리 (5단계) ──
  //
  // ⚠️ **관리자 경로가 열리는 문은 여기 하나뿐이다.** 확인이 admin.ts 안이 아니라
  //    이 앞에 있는 이유: 라우트를 하나 더 더하는 날 그 하나만 확인을 빠뜨리게 되기
  //    때문이다. 여기 있으면 `/api/admin/` 으로 시작하는 무엇을 더해도 이 문을 지난다.
  //
  // ⚠️ **매 호출 확인한다.** 세션도 쿠키도 토큰도 만들지 않는다 (MIGRATION §10).
  //    브라우저가 sessionStorage 에 두고 매번 헤더로 싣는다 — 서버는 그 사정을 모른다.
  if (path.startsWith('/api/admin/')) {
    const denied = adminDenied(req, ports);
    if (denied) return denied;
    return reply(await adminRoute(req, ports, path, method, body));
  }

  return fail('NOT_FOUND');
}

// ────────────────────────────────────────────────────────────
// 판 만들기 — 여기만이 판을 만든다
// ────────────────────────────────────────────────────────────

/** 한 판에 모둠이 12개를 넘을 일은 없다. 넘겨 받으면 암호 12개를 뽑아 두는 셈이라 막는다 */
const MAX_TEAMS = 12;
/** 판 코드가 이미 쓰이고 있으면 다시 뽑는다 */
const CODE_ATTEMPTS = 5;

/**
 * 판 만들기. **관리자 비밀번호를 매 호출 요구한다** (2026-09-05 사용자 결정).
 *
 * 예전에는 인증이 없었다. 근거는 "열쇠를 발급하는 호출이라 열쇠를 요구할 수 없다"였고
 * 그건 지금도 맞다 — 다만 요구하는 것이 열쇠가 아니라 **관리자 비밀번호**라 상관없다.
 * 바꾼 이유: 주소만 알면 학생이 빈 판을 얼마든지 만들어 '최근 판' 목록을 어지럽힐 수 있었다.
 * 목록은 인증 없이 나가는 것이라(`GET /api/units`) 지운 흔적도 남지 않는다.
 *
 * ⚠️ `ADMIN_PASSWORD` 를 안 넣고 배포하면 판이 **하나도** 안 만들어진다 (`ADMIN_DISABLED`).
 *    이건 의도다. 그런 배포에서 만들어진 판은 열쇠를 잃어버려도 회수할 길이 없다
 *    (`POST /api/admin/host-key` 도 같은 문에 막혀 있다) — 수업 중에 그걸 알게 되는 것보다
 *    판을 못 만드는 편이 낫다.
 *
 * ⚠️ 확인이 **맨 앞**에 있다. D1 을 읽기 전에, 방을 부르기 전에 거절한다 —
 *    거절당한 요청이 문제은행 검사만 돌리고 가도, 방 객체만 만들고 가도 안 된다.
 */
async function createRoute(req: ApiRequest, ports: Ports): Promise<ApiResponse> {
  const denied = adminDenied(req, ports);
  if (denied) return denied;

  const body = bodyOf(req);
  const className = String(body.className ?? '').trim();
  const unit = String(body.unit ?? '').trim();
  const teamCount = Math.floor(Number(body.teamCount));
  const teamNames = Array.isArray(body.teamNames) ? body.teamNames.map((x) => String(x ?? '')) : undefined;

  if (!className) return fail('BAD_REQUEST', '반 이름을 넣어주세요');
  if (!unit) return fail('BAD_REQUEST', '단원을 골라주세요');
  if (!(teamCount >= 1 && teamCount <= MAX_TEAMS)) {
    return fail('BAD_REQUEST', `모둠 수는 1~${MAX_TEAMS} 사이여야 해요`);
  }

  // ⚠️ 문제은행 검사가 **판 만들기 앞에** 있다. 이 순서를 되돌리면 문항이 모자란 판이
  //    만들어지고, 수업 중 라운드가 넘어가는 순간에야 그걸 알게 된다 (validateSheets)
  const prep = await ports.db.prepareUnit(unit);
  if (prep.blocking.length) return fail('SHEET_INVALID', prep.blocking.join('\n'));

  const rng = ports.rng;
  let lastErr: Err | null = null;

  for (let i = 0; i < CODE_ATTEMPTS; i++) {
    const code = makeCode(rng);
    // 이미 쓴 코드인가 (apps-script 의 `do { code = makeCode() } while (findGameRow(code))`)
    if (await ports.db.hasGame(code)) { lastErr = err('GAME_EXISTS'); continue; }

    const res = await ports.room(code).op('create', [
      { code, className, unit, teamCount, teamNames, warnings: prep.warnings },
      prep.questions, prep.animals, prep.settings
    ]);

    // DO 쪽에 이미 방이 있다 = D1 목록이 못 따라온 코드다. 다시 뽑는다
    if (!res.ok && res.error === 'GAME_EXISTS') { lastErr = res; continue; }
    if (!res.ok) return reply(res);

    // 목록('이어하기')용 한 줄. ⚠️ 상태 자체는 DO 에 있다 — 이 표는 목록일 뿐이다 (§7 3단계)
    await ports.db.addGame({ code, className, unit, createdAt: ports.now() });

    return reply(ok({ ...(res.data as object), studentUrl: studentUrlOf(req) }));
  }

  return reply(lastErr ?? err('GAME_EXISTS', '판 코드를 만들지 못했어요. 다시 시도해주세요'));
}

// ────────────────────────────────────────────────────────────
// 목록 · 미리보기
// ────────────────────────────────────────────────────────────

async function unitsRoute(ports: Ports): Promise<ApiResponse> {
  // ⚠️ 최근 판 목록이 실패해도 단원 목록은 살아야 한다. 앱스 스크립트판은 여기서 터지면
  //    드롭다운이 통째로 비었고 화면에는 아무 표시도 안 났다 (gwListUnits)
  let recent: RecentGame[] = [];
  let recentError: string | null = null;
  try { recent = await ports.db.recentGames(10); }
  catch (e) { recentError = (e as Error).message; }

  return reply(ok({ units: await ports.db.listUnits(), recent, recentError }));
}

/** 판을 만들기 전 문제은행을 미리 본다 (apps-script 의 gwPrepare) */
async function prepareRoute(req: ApiRequest, ports: Ports): Promise<ApiResponse> {
  const unit = String(req.query.unit ?? '').trim();
  const units = await ports.db.listUnits();
  if (!unit) return reply(ok({ blocking: [], warnings: [], units }));
  const prep = await ports.db.prepareUnit(unit);
  return reply(ok({
    blocking: prep.blocking,
    // 미리보기에서만 설정 경고를 합친다 (PreparedUnit.settingWarnings 주석)
    warnings: [...prep.warnings, ...prep.settingWarnings],
    units
  }));
}

// ────────────────────────────────────────────────────────────
// 관리자 — 교사 열쇠 회수 (MIGRATION §10)
// ────────────────────────────────────────────────────────────

/**
 * 관리자 확인. 거부할 이유가 있으면 그 응답을, 통과면 null 을 준다.
 *
 * ⚠️ `ADMIN_PASSWORD` 를 안 넣고 배포하면 **전부 거부**한다.
 *    "비밀번호가 없으면 확인을 건너뛴다" 로 만들면 secret 하나 빠뜨린 배포에서
 *    판 코드만 아는 학생이 정답 순위와 모든 모둠 암호를 가져간다.
 *
 * ⚠️ 관리자 라우트가 늘어도 **이 함수 하나**를 지난다. 각 라우트가 저마다 확인하면
 *    새 라우트 하나에서 빠뜨리는 날이 오고, 그때 문제은행 전체가 열린다.
 *
 * 이 문을 지나는 것: `/api/admin/*` 전부 · `POST /api/admin/host-key` ·
 * **`POST /api/game`**(판 만들기 — 왜인지는 `createRoute` 머리 주석에).
 */
function adminDenied(req: ApiRequest, ports: Ports): ApiResponse | null {
  if (!ports.adminPassword) return fail('ADMIN_DISABLED');

  const given = req.headers['x-admin-password'] ?? '';
  if (!timingSafeEqual(given, ports.adminPassword)) return fail('ADMIN_DENIED');

  return null;
}

/**
 * 교사 열쇠는 판을 만든 브라우저에만 저장된다. 기기를 바꾸거나 기록을 지웠으면
 * 여기서 되찾는다. 앱스 스크립트판은 스프레드시트 메뉴가 그 통로였다 (Setup.gs).
 */
async function adminHostKeyRoute(req: ApiRequest, ports: Ports): Promise<ApiResponse> {
  const denied = adminDenied(req, ports);
  if (denied) return denied;

  const code = String(bodyOf(req).code ?? '').toUpperCase().trim();
  if (!code) return fail('BAD_REQUEST', '판 코드를 넣어주세요');

  const hostKey = await ports.room(code).hostKey();
  if (!hostKey) return fail('GAME_NOT_FOUND');
  return reply(ok({ code, hostKey }));
}
