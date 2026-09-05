/**
 * ops.ts — 방으로 들어가는 **하나뿐인 입구**. 런타임에 의존하지 않는다.
 *
 * Room 은 게임 규칙과 인증을 갖고 있고, 여기에는 그 위에 얹히는 두 가지가 있다:
 *
 *   1. dispatch  — 이름(문자열) → Room 메서드. Worker 라우트·WebSocket·테스트가 같은 표를 쓴다
 *   2. Throttle  — 암호를 연속으로 틀리면 잠시 막는다
 *
 * ⚠️ 이 파일을 GameRoom.ts(어댑터) 안에 도로 집어넣지 마세요.
 *    그러면 브루트포스 게이트(SEC14)를 돌리는 데 workerd 가 필요해지고,
 *    "Worker 쪽에도 하나, DO 쪽에도 하나" 로 표가 두 벌 생깁니다 —
 *    뷰를 두 벌 만들었다가 정답이 새던 것과 같은 함정입니다 (MIGRATION §5).
 */

import type { Level, Settings } from '../game/config.ts';
import type { Bets, Question } from '../game/types.ts';
import { Room, err } from './room.ts';
import type { AnimalTable, CreateConfig, Envelope } from './room.ts';

// ────────────────────────────────────────────────────────────
// 이름 → Room 메서드
// ────────────────────────────────────────────────────────────

/**
 * ⚠️ 여기부터 Room 메서드가 끝날 때까지 await 가 하나도 없다 (MIGRATION §4-7).
 *    하나라도 끼면 6모둠 동시 베팅에서 코인이 증발한다.
 */
export function dispatch(room: Room, op: string, a: unknown[]): Envelope<unknown> {
  switch (op) {
    case 'create':
      return room.create(
        a[0] as CreateConfig, a[1] as Question[], a[2] as AnimalTable, a[3] as Partial<Settings>
      );
    case 'join':         return room.join(Number(a[0]), String(a[1]));
    case 'lobby':        return room.lobby();
    case 'getState':     return room.getState(a[0] as string | null, a[1] as string | null, a[2] as string | null);
    case 'chooseLevel':  return room.chooseLevel(Number(a[0]), a[1] as Level, String(a[2]));
    case 'submitAnswer': return room.submitAnswer(Number(a[0]), a[1] as Level, Number(a[2]), String(a[3]));
    case 'placeBet':     return room.placeBet(Number(a[0]), a[1] as Bets, String(a[2]));
    case 'advanceRound': return room.advanceRound(String(a[0]));
    case 'togglePause':  return room.togglePause(String(a[0]));
    case 'skipPhase':    return room.skipPhase(String(a[0]));
    case 'finalize':     return room.finalize(String(a[0]));
    case 'reveal':       return room.reveal(String(a[0]));
    case 'handout':      return room.handout(String(a[0]));
    default:             return err('SHEET_INVALID', `모르는 요청이에요: ${op}`);
  }
}

// ────────────────────────────────────────────────────────────
// 암호 연속 실패 제한
// ────────────────────────────────────────────────────────────

export const THROTTLE = {
  /** 이만큼 연속으로 틀리면 잠근다 */
  maxFails: 5,
  /** 잠기는 시간(ms) */
  lockMs: 30_000
};

/** 자격 증명 하나(모둠 하나 · 교사 열쇠)당 한 줄 */
export interface ThrottleRow { fails: number; lockedUntil: number }
export type ThrottleState = Record<string, ThrottleRow>;

/**
 * 이 호출이 **무슨 모둠 암호를 겨냥하고 있는가**. null 이면 잠금 대상이 아닌 호출이다.
 *
 * ⚠️ 잠금을 모둠별로 나누는 이유: 한 덩어리로 세면 학생 한 명이 아무 번호나
 *    다섯 번 틀려서 **반 전체를 30초씩 세울 수 있다.** 수업 중에 그게 벌어지면
 *    선생님은 원인을 알 길이 없다.
 *
 * ⚠️ **교사 열쇠는 잠그지 않는다.** 열쇠는 12자리(32^12)라 브루트포스가 애초에 안 되고,
 *    잠그면 얻는 것은 없고 잃는 것만 있다 — 판 코드는 칠판에 적혀 있으므로, 학생 누구든
 *    틀린 열쇠로 다섯 번 두드려 **선생님의 진행·정지·정산 버튼을 30초씩 얼릴 수 있다.**
 *    되돌리면 수업 중에 그 일이 벌어진다 (게이트 HOST-NOLOCK).
 */
export function credentialKey(op: string, a: unknown[]): string | null {
  switch (op) {
    case 'join':
    case 'chooseLevel':
    case 'submitAnswer':
    case 'placeBet':
      return 'team:' + Number(a[0]);
    case 'getState': {
      const viewer = String(a[0] ?? '');
      return viewer.indexOf('team:') === 0 ? 'team:' + Number(viewer.split(':')[1]) : null;
    }
    default:
      // 교사 열쇠 경로(advanceRound · togglePause · skipPhase · finalize · reveal · handout) ·
      // create · lobby. ⚠️ skipPhase 를 여기 넣지 마세요 — 교사 열쇠는 잠그지 않는다 (HOST-NOLOCK)
      return null;
  }
}

export interface OpsDeps {
  now(): number;
  /** 잠금 상태가 바뀌었다. ⚠️ await 하지 않는다 — Room 과 같은 이유 (§4-7) */
  persistThrottle(state: ThrottleState): void;
}

/**
 * Room + 실패 카운터.
 *
 * ⚠️ **잠긴 동안에는 맞는 암호도 통과시키지 않는다.**
 *    "맞으면 통과" 로 만들면 잠금이 아무 일도 하지 않는다 — 공격자는 계속 찍고,
 *    맞는 순간 그냥 들어온다. 그래서 여기서는 그 모둠을 향한
 *    호출 자체를 30초간 막는다. 대신 잠금은 **틀렸을 때만** 쌓이고 성공하면 0 이 되므로,
 *    제 암호를 쓰는 모둠은 이 코드가 있는지도 모른 채 수업을 마친다.
 *    (막는 범위를 모둠 하나로 좁혀 둔 이유는 credentialKey 주석에 있다)
 */
export class RoomOps {
  private room: Room;
  private deps: OpsDeps;
  private throttle: ThrottleState = {};

  constructor(room: Room, deps: OpsDeps) { this.room = room; this.deps = deps; }

  /** 깨어날 때 저장소에서 올린 잠금 상태를 꽂는다 */
  hydrateThrottle(state: ThrottleState | null | undefined): void {
    this.throttle = state || {};
  }

  /** 감사·게이트용 */
  throttleState(): ThrottleState { return this.throttle; }

  op(name: string, args: unknown[]): Envelope<unknown> {
    const key = credentialKey(name, args);
    const now = this.deps.now();

    if (key) {
      const row = this.throttle[key];
      if (row && row.lockedUntil > now) return err('TOO_MANY_TRIES');
    }

    const res = dispatch(this.room, name, args);

    if (key) {
      if (res.ok) {
        // 정답 경로에는 지연도 잠금도 없다. 성공하면 흔적까지 지운다
        if (this.throttle[key]) { delete this.throttle[key]; this.deps.persistThrottle(this.throttle); }
      } else if (res.error === 'WRONG_PIN') {
        // ⚠️ 다른 오류(BET_CLOSED 등)로는 세지 않는다. placeBet 은 단계 검사가 암호 검사보다
        //    앞이라, 마감된 뒤 늦게 누른 제 모둠까지 잠겨 버린다
        const row = this.throttle[key] || { fails: 0, lockedUntil: 0 };
        row.fails++;
        if (row.fails >= THROTTLE.maxFails) { row.fails = 0; row.lockedUntil = now + THROTTLE.lockMs; }
        this.throttle[key] = row;
        this.deps.persistThrottle(this.throttle);
      }
    }
    return res;
  }
}
