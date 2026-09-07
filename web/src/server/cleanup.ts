/**
 * cleanup.ts — 판 보존 기간 (2026-09-07 사용자 결정).
 *
 * 지금까지 판은 **영원히 남았다.** 지우는 코드가 어디에도 없었고, 한 판은 두 곳에 있다:
 *
 *   D1 `games` 한 줄        — '최근 판' 목록 (인증 없이 나간다)
 *   Durable Object 상태 하나 — 모둠 암호·정답·힌트·코인 (판 코드 하나 = 인스턴스 하나)
 *
 * **둘 다 지워야 한다.** D1 만 지우면 목록에서는 사라지는데 DO 는 남아서, 그 판 코드를
 * 아는 사람이 `GET /api/game/CODE/lobby` 로 판을 계속 만난다. DO 만 지우면 목록에
 * 죽은 줄이 남아 '이어하기' 가 GAME_NOT_FOUND 로 끝난다.
 *
 * ── 이 파일이 `env` 를 모르는 이유 ──
 *
 * 판단(무엇이 만료인가)이 Worker 핸들러 안에 있으면, "정산 29일 뒤에는 안 지운다" 를
 * 검사하는 데 workerd 와 진짜 D1 과 **진짜 30일**이 필요해진다. 그래서 판단은 여기
 * 순수 함수로 두고, 게이트는 가짜 시계로 두드린다 (MIGRATION §9-3 · 게이트 CLEAN1~4).
 */

import type { GameRow, Ports } from './ports.ts';

const DAY = 24 * 60 * 60 * 1000;

/**
 * 얼마나 두는가 (2026-09-07 사용자 결정).
 *
 *   finishedDays  정산이 끝난 판. 수업이 끝났고, 되돌아볼 일이 있어도 한 달이면 충분하다
 *   abandonedDays 정산하지 않고 버려진 판. 만들다 만 판일 수도 있어 더 길게 둔다
 *
 * ⚠️ 이 숫자를 화면에 **박지 마세요.** 교사 화면의 안내문("정산한 판은 30일…")은
 *    이 상수와 갈라지면 안 됩니다 — `RETENTION` 을 고치는 날 안내문도 같이 고칩니다
 *    (MIGRATION §5 `trackCells` 함정과 같은 종류다).
 */
export const RETENTION = { finishedDays: 30, abandonedDays: 90 };

/**
 * 이 판을 지울 때가 됐는가.
 *
 * ⚠️ 정산한 판인데 `finishedAt` 이 null 이면 `createdAt` 을 쓴다. migrations/0007
 *    **이전에** 정산된 판에는 그 시각을 아무도 기록하지 않았기 때문이다. null 을
 *    0 으로 읽으면(`row.finishedAt ?? 0`) "1970년에 정산된 판" 이 되어 그런 줄이
 *    첫 정리에서 전부 사라진다 (게이트 CLEAN3).
 *
 * ⚠️ 경계는 `>=` 다. "30일 뒤에 지운다" 는 30일째에 지운다는 뜻이다.
 */
export function isExpired(row: GameRow, now: number): boolean {
  const days = row.isOver ? RETENTION.finishedDays : RETENTION.abandonedDays;
  const since = row.isOver ? (row.finishedAt ?? row.createdAt) : row.createdAt;
  return now - since >= days * DAY;
}

/** 지울 판 코드들. 순서는 들어온 순서 그대로다 */
export function expiredCodes(rows: GameRow[], now: number): string[] {
  return rows.filter((r) => isExpired(r, now)).map((r) => r.code);
}

export interface CleanupResult {
  /** 훑어본 판 수 */
  scanned: number;
  /** 지운 판 수 */
  deleted: number;
  /** 지우려다 실패한 판 코드들 — 다음 정리에서 다시 시도된다 */
  failed: string[];
}

/**
 * 만료된 판을 지운다. 매일 한 번 `scheduled` 가 부른다 (src/server/index.ts).
 *
 * ⚠️ **한 판이 실패해도 나머지는 계속 지운다.** try/catch 를 판마다 두는 이유가 그것이다 —
 *    묶어서 감싸면 첫 판의 DO 가 응답하지 않는 날 그날 정리가 통째로 멈추고, 아무도
 *    모른 채 판이 계속 쌓인다 (게이트 CLEAN4).
 *
 * ⚠️ 순서는 **DO 먼저, D1 나중**이다. 뒤집으면 목록에서 줄이 사라진 뒤 DO 지우기가
 *    실패했을 때, 그 판은 어느 목록에도 없으면서 상태만 남아 **영원히 지워지지 않는다** —
 *    다음 정리가 훑는 것은 `games` 표이기 때문이다.
 */
export async function runCleanup(ports: Ports, now: number): Promise<CleanupResult> {
  const rows = await ports.db.allGames();
  const codes = expiredCodes(rows, now);
  const failed: string[] = [];
  let deleted = 0;

  for (const code of codes) {
    try {
      await ports.room(code).wipe();
      await ports.db.deleteGame(code);
      deleted++;
    } catch (e) {
      // 다음 정리에서 다시 만난다 (D1 줄이 남아 있으므로). 로그만 남긴다
      failed.push(code);
      console.log(`[정리] ${code} 실패: ${(e as Error).message}`);
    }
  }

  // ⚠️ 한 줄만 남긴다. 판마다 한 줄씩 찍으면 학기 말 정리에서 로그가 수백 줄이 되고,
  //    정작 봐야 할 실패가 묻힌다
  console.log(
    `[정리] ${rows.length}판 중 ${deleted}판 삭제` +
    ` (정산 ${RETENTION.finishedDays}일 · 미정산 ${RETENTION.abandonedDays}일)` +
    (failed.length ? ` · 실패 ${failed.length}: ${failed.join(',')}` : '')
  );

  return { scanned: rows.length, deleted, failed };
}
