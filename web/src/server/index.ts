/**
 * index.ts — Worker 진입점. **런타임을 꽂는 일만 한다.**
 *
 * 라우팅·인증·봉투는 router.ts 에 있고, 그건 `env` 를 모른다 (ports.ts 만 안다).
 * 이 파일이 하는 일은 세 가지뿐이다:
 *
 *   1. Request  → ApiRequest   (헤더 소문자화 · JSON 본문 파싱 · origin)
 *   2. env      → Ports        (GameRoom RPC · D1 · ADMIN_PASSWORD · 시계)
 *   3. ApiResponse → Response  (JSON)
 *
 * ⚠️ 여기에 판단을 넣지 마세요. 넣는 순간 그 판단은 게이트가 못 도는 곳으로 갑니다 —
 *    test/gateway.ts 는 workerd 없이 라우터를 인메모리 포트로 돌립니다 (MIGRATION §9-3).
 *
 * 판 코드 하나 = DO 인스턴스 하나. `idFromName(code)` 로 찾는다 —
 * 이러면 같은 코드로 들어온 요청은 전세계 어디서 오든 같은 인스턴스로 모이고,
 * 그 인스턴스가 단일 스레드라 잠금이 필요 없다 (MIGRATION §4-7).
 */

import { GameRoom } from '../do/GameRoom.ts';
import type { Env } from '../do/GameRoom.ts';
import { D1Db } from './db.ts';
import { handle } from './router.ts';
import type { ApiRequest, Ports, RoomPort } from './ports.ts';

export { GameRoom };

/** 판 코드로 그 판의 Durable Object 를 잡는다 */
export function roomOf(env: Env, code: string): DurableObjectStub<GameRoom> {
  return env.GAME_ROOM.get(env.GAME_ROOM.idFromName(code.toUpperCase()));
}

/**
 * ⚠️ 방을 부르는 통로는 **RPC 뿐이다.**
 *    2단계 스텁은 `/room/:code/op` 를 그대로 DO 로 넘겼고, 그러면 주소만 아는 누구나
 *    `create` 를 불러 아무 판이나 선점하고 교사 열쇠를 가질 수 있었다.
 *    RPC 는 GAME_ROOM 바인딩을 가진 코드만 부를 수 있어서 인터넷에서 닿는 문이 없다
 *    (게이트 SEC13).
 */
function roomPort(env: Env, code: string): RoomPort {
  const stub = roomOf(env, code);
  return {
    op: (name, args) => stub.op(name, args),
    hostKey: () => stub.adminHostKey()
  };
}

function portsOf(env: Env): Ports {
  return {
    room: (code) => roomPort(env, code),
    db: new D1Db(env.DB),
    // 비어 있으면 관리자 라우트는 전부 닫힌다 (router.ts adminHostKeyRoute)
    adminPassword: env.ADMIN_PASSWORD || undefined,
    now: () => Date.now()
  };
}

async function toApiRequest(request: Request): Promise<ApiRequest> {
  const url = new URL(request.url);

  const headers: Record<string, string> = {};
  // HTTP 헤더는 대소문자를 안 가린다. 라우터가 소문자 이름만 보게 통일한다
  request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });

  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => { query[k] = v; });

  // ⚠️ 본문이 JSON 이 아니어도 던지지 않는다. 던지면 500 이 나가고 봉투가 깨진다
  let body: unknown = undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    body = await request.json().catch(() => undefined);
  }

  return { method: request.method, path: url.pathname, query, headers, body, origin: url.origin };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ── WebSocket — 그 판의 DO 로 업그레이드를 넘긴다 ──
    // 소켓 메시지의 인증은 매 메시지 Room 이 한다. Worker 는 여기서 아무것도 확인하지 않고,
    // 확인한 척도 하지 않는다 — 소켓으로 create 는 GameRoom 이 거부한다
    const ws = /^\/ws\/([A-Za-z0-9]{1,8})$/.exec(url.pathname);
    if (ws) {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('WebSocket 업그레이드가 필요합니다', { status: 426 });
      }
      const doUrl = new URL(request.url);
      doUrl.pathname = '/ws';
      return roomOf(env, ws[1]!).fetch(new Request(doUrl.toString(), request));
    }

    // ── 화면 (4단계) ──
    //
    // wrangler.jsonc 의 `run_worker_first: ["/api/*", "/ws/*"]` 때문에 그 둘 말고는
    // 정적 자산이 **먼저** 시도된다. 여기까지 온 것은 dist/client 에 그 파일이 없다는 뜻이다.
    //
    // ⚠️ /teacher 를 여기서 한 번 더 잡는 이유: assets 의 html_handling 이
    //    /teacher → teacher.html 을 해 주지만, 그 설정에 기대는 것만으로는
    //    배포 설정 한 줄이 바뀌는 날 교사 화면이 통째로 404 가 된다.
    //    수업 시작 5분 전에 그걸 발견하고 싶지 않다.
    if (!url.pathname.startsWith('/api/')) {
      if (url.pathname === '/teacher' || url.pathname === '/teacher/') {
        return env.ASSETS.fetch(new Request(new URL('/teacher.html', url), request));
      }
      // 문제은행 관리 화면 (5단계). /teacher 와 같은 이유로 여기서 한 번 더 잡는다.
      // ⚠️ 이 화면 자체에는 비밀이 없다 — 비밀번호를 넣기 전에는 아무것도 안 보인다.
      //    지키는 것은 이 HTML 이 아니라 /api/admin/* 이다 (router.ts adminDenied)
      if (url.pathname === '/admin' || url.pathname === '/admin/') {
        return env.ASSETS.fetch(new Request(new URL('/admin.html', url), request));
      }
      return env.ASSETS.fetch(request);
    }

    const res = await handle(await toApiRequest(request), portsOf(env));

    // ⚠️ 봉투가 아닌 응답은 **JSON 내보내기 하나뿐이다** (ports.ts RawResponse 주석).
    //    브라우저가 이 응답을 파일로 저장하므로 `{ok:true,data:…}` 로 감싸면 안 된다 —
    //    감싸면 저장된 파일이 우리 형식(RENEWAL §3-2)이 아니게 되어 다시 못 가져온다.
    //    여기서 판단하지 않는다. 무엇을 파일로 낼지는 router 가 이미 정했고,
    //    이 파일은 그대로 흘려보내기만 한다 (index.ts 머리 주석)
    if (res.raw) return new Response(res.raw.body, { status: res.status, headers: res.raw.headers });

    return new Response(JSON.stringify(res.body), {
      status: res.status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        // 판 상태는 절대 캐시되면 안 된다 — 학교 프록시가 낡은 상태를 돌려주면
        // 폰마다 다른 라운드를 보게 된다
        'cache-control': 'no-store'
      }
    });
  }
} satisfies ExportedHandler<Env>;
