/**
 * clock.ts — 타이머는 **서버 시각**으로 센다.
 *
 * 폴링판은 서버가 준 `secondsLeft` 를 2초마다 받아 그대로 찍었다. 소켓으로 바뀐 지금은
 * 상태 푸시가 단계가 바뀔 때만 오므로, 그 사이 1초씩 흐르는 숫자는 화면이 계산해야 한다.
 *
 * ⚠️ 폰 시계로 세면 안 된다. 교실 폰은 몇 분씩 틀려 있다. 응답마다 `serverNow` 로
 *    offset(= serverNow - Date.now())을 갱신하고, 남은 시간은 `phaseEndsAt - now()` 로
 *    잰다. 이래야 늦게 들어온 폰도 같은 지점을 본다 (MIGRATION §8-2, §11-2).
 *
 * ⚠️ 일시정지 중에는 계산하지 않고 **서버가 준 secondsLeft 를 고정 표시**한다.
 *    서버는 pausedAt 을 기준으로 재기 때문에 그 값이 멈춰 있고, 여기서 다시 계산하면
 *    화면에서만 숫자가 계속 흐른다.
 */

import type { Clock } from '../../game/views.ts';

/** 화면이 시간을 재는 데 필요한 최소한. teamView·teacherView 둘 다 이 모양을 만족한다 */
export interface Timed extends Clock {
  phase: string;
  secondsLeft: number | null;
}

export class ServerClock {
  /** serverNow - Date.now(). 응답이 올 때마다 갱신한다 */
  private offset = 0;

  sync(view: Clock): void {
    if (typeof view.serverNow === 'number') this.offset = view.serverNow - Date.now();
  }

  now(): number { return Date.now() + this.offset; }

  /** 남은 초. 단계가 없으면(대기·종료) null */
  secondsLeft(view: Timed | null): number | null {
    if (!view) return null;
    if (view.phase === 'paused') return view.secondsLeft;   // 서버가 멈춰 준 값 그대로
    if (view.phaseEndsAt == null) return null;
    return Math.max(0, Math.ceil((view.phaseEndsAt - this.now()) / 1000));
  }

  /**
   * 남은 비율(1 → 0). 타이머 막대 너비에 쓴다.
   * ⚠️ 길이를 화면이 다시 정하지 않는다 — `phaseSeconds` 가 정본이다.
   *    원본 Team.html 의 `totalFor(p)` 는 90/180/60 을 하드코딩했고, 그래서 '설정' 탭에서
   *    시간을 바꾸면 막대가 거짓말을 했다 (MIGRATION §5 '설정값을 전역 기본값으로 읽지 말 것').
   */
  progress(view: Timed | null): number {
    const left = this.secondsLeft(view);
    if (left == null || !view || !view.phaseSeconds) return 1;
    return Math.max(0, Math.min(1, left / view.phaseSeconds));
  }
}
