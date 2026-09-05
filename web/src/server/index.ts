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

    // 화면은 4단계에서 붙는다. 그때 정적 자산(assets)이 이 자리를 가져간다
    if (url.pathname === '/' ) {
      return new Response('와일드 더비 — 4단계에서 화면이 붙습니다. API 는 /api/version 부터.', {
        status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' }
      });
    }

    const res = await handle(await toApiRequest(request), portsOf(env));
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
