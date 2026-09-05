/**
 * index.ts — Worker 진입점. **3단계에서 채운다.**
 *
 * 지금은 wrangler 가 GameRoom 클래스를 찾을 수 있게 하고, 타입 검사가 돌게 하는
 * 최소 스텁이다. 게이트웨이 16개(§8-1)·교사 열쇠 회수·D1 접근은 3단계의 몫이다.
 *
 * 판 코드 하나 = DO 인스턴스 하나. `idFromName(code)` 로 찾는다 —
 * 이러면 같은 코드로 들어온 요청은 전세계 어디서 오든 같은 인스턴스로 모이고,
 * 그 인스턴스가 단일 스레드라 잠금이 필요 없다 (MIGRATION §4-7).
 */

import { GameRoom } from '../do/GameRoom.ts';
import type { Env } from '../do/GameRoom.ts';

export { GameRoom };

/** 판 코드로 그 판의 Durable Object 를 잡는다 */
export function roomOf(env: Env, code: string): DurableObjectStub<GameRoom> {
  return env.GAME_ROOM.get(env.GAME_ROOM.idFromName(code.toUpperCase()));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // /room/:code/op  ·  /room/:code/ws  → 그 판의 DO 로 그대로 넘긴다
    const m = /^\/room\/([A-Za-z0-9]{1,8})\/(op|ws)$/.exec(url.pathname);
    if (m) return roomOf(env, m[1]!).fetch(request);

    return new Response('와일드 더비 — 3단계에서 화면과 게이트웨이가 붙습니다', {
      status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' }
    });
  }
} satisfies ExportedHandler<Env>;
