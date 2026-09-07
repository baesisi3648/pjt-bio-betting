/**
 * cleanup.ts — 판 보존 기간 게이트 (2026-09-07 사용자 결정).
 *
 * 지금까지 판은 **영원히 남았다.** 여기서 검사하는 것은 두 가지다:
 *
 *   CLEAN1~4  자동 정리 — 언제 지우는가, 그리고 **D1 과 DO 를 둘 다** 지우는가
 *   DEL1~3    수동 삭제 — 관리자만 지울 수 있는가, 지운 판이 정말 사라지는가
 *
 * ⚠️ 시간은 **가짜 시계**로 흐른다 (`Net.clock`). 진짜 30일을 기다리지 않으려고
 *    판단을 `src/server/cleanup.ts` 의 순수 함수로 뺐다 (MIGRATION §9-3).
 *
 * ⚠️ 그물(MemDb·MemRoom·Net)은 `test/harness.ts` 의 것을 그대로 쓴다 — 가짜를 한 벌 더
 *    두면 갈라지는 날 이쪽만 초록불이 된다 (MIGRATION §5 '사본' 함정).
 *
 *   node test/cleanup.ts
 */

import { RETENTION, expiredCodes, isExpired, runCleanup } from '../src/server/cleanup.ts';
import type { GameRow } from '../src/server/ports.ts';
import { Net, admin, createGates, dataOf, errOf, host, open } from './harness.ts';

const { gate, done } = createGates('판 보존 기간 게이트 (가짜 시계)');

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_767_225_600_000;      // 2026-01-01 — Net.clock 의 출발점과 같다

/** `days` 일 전에 만들어진 판 한 줄 */
function row(code: string, createdDaysAgo: number, over: boolean, finishedDaysAgo?: number): GameRow {
  return {
    code,
    createdAt: NOW - createdDaysAgo * DAY,
    isOver: over,
    finishedAt: finishedDaysAgo === undefined ? null : NOW - finishedDaysAgo * DAY
  };
}

// ────────────────────────────────────────────────────────────
// 자동 정리 — 판단 (순수 함수)
// ────────────────────────────────────────────────────────────

await gate('CLEAN1', '정산한 판은 정산 29일엔 남고 30일에 지워진다', async () => {
  // ⚠️ 만든 지는 아주 오래됐지만(200일) **정산은 최근**인 판이다. 기준이 created_at 으로
  //    되돌아가면 여기서 걸린다 — 어제 정산한 판이 오늘 사라지는 사고다
  const d29 = row('A29', 200, true, 29);
  const d30 = row('A30', 200, true, 30);
  const d31 = row('A31', 200, true, 31);
  const codes = expiredCodes([d29, d30, d31], NOW);
  return {
    ok: !isExpired(d29, NOW) && isExpired(d30, NOW) && isExpired(d31, NOW) &&
        codes.join(',') === 'A30,A31' && RETENTION.finishedDays === 30,
    detail: `정산 29일 남음 · 30일·31일 지움 (${codes.join(',')}) · RETENTION.finishedDays=${RETENTION.finishedDays}`
  };
});

await gate('CLEAN2', '정산 안 한 판은 생성 89일엔 남고 90일에 지워진다', async () => {
  const d89 = row('B89', 89, false);
  const d90 = row('B90', 90, false);
  // ⚠️ 30일 된 미정산 판이 지워지면 안 된다. 두 기준이 뒤바뀌면 여기서 걸린다 —
  //    한 달 전에 만들어 아직 안 끝낸 판이 사라진다
  const d30 = row('B30', 30, false);
  const codes = expiredCodes([d30, d89, d90], NOW);
  return {
    ok: !isExpired(d89, NOW) && isExpired(d90, NOW) && !isExpired(d30, NOW) &&
        codes.join(',') === 'B90' && RETENTION.abandonedDays === 90,
    detail: `미정산 30일·89일 남음 · 90일 지움 (${codes.join(',')}) · RETENTION.abandonedDays=${RETENTION.abandonedDays}`
  };
});

await gate('CLEAN3', 'finished_at 이 없는 옛 정산 판은 created_at 을 쓴다', async () => {
  // migrations/0007 이전에 정산된 판 — 정산 시각을 아무도 기록하지 않았다
  const old29 = row('C29', 29, true);            // finishedAt = null
  const old30 = row('C30', 30, true);
  const codes = expiredCodes([old29, old30], NOW);
  // ⚠️ `finishedAt ?? 0` 으로 읽으면 이 둘이 "1970년 정산" 이 되어 **둘 다** 지워진다
  return {
    ok: !isExpired(old29, NOW) && isExpired(old30, NOW) && codes.join(',') === 'C30',
    detail: `finishedAt=null + 정산됨 → created_at 기준 30일 (29일 남음 · 30일 지움: ${codes.join(',')})`
  };
});

// ────────────────────────────────────────────────────────────
// 자동 정리 — 실행 (D1 + DO)
// ────────────────────────────────────────────────────────────

await gate('CLEAN4', 'runCleanup 이 DO 상태와 D1 줄을 둘 다 지운다 (하나 실패해도 나머지는)', async () => {
  const net = new Net();
  const a = await open(net, '유전', 2);
  const b = await open(net, '유전', 2);
  const c = await open(net, '유전', 2);
  const keep = await open(net, '유전', 2);       // 오늘 만든 판 — 지워지면 안 된다

  // 셋을 200일 전으로 보낸다 (미정산 90일을 훌쩍 넘긴다)
  for (const g of [a, b, c]) {
    net.db.games.find((x) => x.code === g.code)!.createdAt = net.clock.now - 200 * DAY;
  }
  // b 의 DO 만 응답하지 않는다
  net.roomOf(b.code).wipeThrows = true;

  const res = await runCleanup(net.ports(), net.clock.now);

  const bad: string[] = [];
  // a·c 는 양쪽에서 사라져야 한다
  for (const g of [a, c]) {
    if (net.db.games.some((x) => x.code === g.code)) bad.push(`${g.code} D1 줄이 남음`);
    if (net.roomOf(g.code).room.raw() !== null) bad.push(`${g.code} DO 상태가 남음`);
  }
  // ⚠️ b 는 **D1 줄이 남아 있어야** 한다. 지워 버리면 그 판은 어느 목록에도 없으면서
  //    DO 상태만 남아 영원히 정리되지 않는다 (cleanup.ts 순서 주석)
  if (!net.db.games.some((x) => x.code === b.code)) bad.push('실패한 판의 D1 줄까지 지웠다');
  if (net.roomOf(b.code).room.raw() === null) bad.push('실패한 판의 DO 상태가 사라졌다');
  // 오늘 만든 판은 그대로
  if (!net.db.games.some((x) => x.code === keep.code)) bad.push('오늘 만든 판이 지워졌다');
  if (net.roomOf(keep.code).room.raw() === null) bad.push('오늘 만든 판의 DO 가 지워졌다');

  if (res.deleted !== 2 || res.failed.join(',') !== b.code || res.scanned !== 4) {
    bad.push(`결과 ${JSON.stringify(res)}`);
  }

  return {
    ok: bad.length === 0,
    detail: bad.length ? '⛔ ' + bad.join(', ')
      : `4판 중 2판 삭제(D1+DO) · ${b.code} 는 wipe 실패로 양쪽 다 남음(다음에 다시 시도) · 오늘 만든 판 그대로`
  };
});

await gate('CLEAN-FIN', '정산하면 finished_at 이 같이 적힌다', async () => {
  const net = new Net();
  const g = await open(net, '유전', 2);
  net.tick(5 * 60 * 1000);                       // 수업 5분
  const fin = await net.call('POST', `/api/game/${g.code}/finalize`, { headers: host(g.hostKey), body: {} });
  const r = net.db.games.find((x) => x.code === g.code)!;

  // ⚠️ 이게 없으면 정산한 판이 미정산(90일) 취급으로 두 달을 더 남는다.
  //    그리고 CLEAN1 의 순수 함수는 아무 문제 없이 초록불이다 — 먹일 값이 안 들어올 뿐이다
  const rows = await net.db.allGames();
  const asRow = rows.find((x) => x.code === g.code)!;
  return {
    ok: fin.body.ok && r.isOver === true && r.finishedAt === net.clock.now &&
        asRow.finishedAt === net.clock.now &&
        !isExpired(asRow, net.clock.now + 29 * DAY) && isExpired(asRow, net.clock.now + 30 * DAY),
    detail: `정산 시각 기록 ${r.finishedAt === net.clock.now} · 그 값으로 29일 남고 30일 지움`
  };
});

// ────────────────────────────────────────────────────────────
// 수동 삭제
// ────────────────────────────────────────────────────────────

await gate('DEL1', '관리자만 판을 지운다. 지우면 목록·DO 양쪽에서 사라진다', async () => {
  const net = new Net();
  const g = await open(net, '유전', 2);
  const other = await open(net, '유전', 2);
  const path = `/api/admin/games/${g.code}/delete`;

  // 비밀번호 없음 · 틀린 비밀번호
  const none = await net.call('POST', path, { body: {} });
  const wrong = await net.call('POST', path, { headers: admin('틀린값'), body: {} });
  // ⚠️ 교사 열쇠로도 못 지운다. 열쇠는 그 판을 **진행**하는 권한이지 지우는 권한이 아니다
  const byKey = await net.call('POST', path, { headers: host(g.hostKey), body: {} });
  const stillThere = net.db.games.some((x) => x.code === g.code) && net.roomOf(g.code).room.raw() !== null;

  const okRes = await net.call('POST', path, { headers: admin(net.adminPassword!), body: {} });

  const bad: string[] = [];
  if (errOf(none) !== 'ADMIN_DENIED' || none.status !== 403) bad.push(`비밀번호 없음 → ${errOf(none)}`);
  if (errOf(wrong) !== 'ADMIN_DENIED') bad.push(`틀린 비밀번호 → ${errOf(wrong)}`);
  if (errOf(byKey) !== 'ADMIN_DENIED') bad.push(`교사 열쇠 → ${errOf(byKey)}`);
  if (!stillThere) bad.push('거절당한 요청이 판을 지웠다');
  if (!okRes.body.ok || dataOf(okRes).code !== g.code) bad.push(`삭제 응답 ${JSON.stringify(okRes.body)}`);

  // D1 줄 · DO 상태
  if (net.db.games.some((x) => x.code === g.code)) bad.push('D1 줄이 남음');
  if (net.roomOf(g.code).room.raw() !== null) bad.push('DO 상태가 남음');

  // '최근 판' 목록에서 빠진다 (인증 없이 나가는 그 목록이다)
  const units = dataOf(await net.call('GET', '/api/units'));
  const recent = (units.recent as { code: string }[]).map((x) => x.code);
  if (recent.indexOf(g.code) >= 0) bad.push('최근 판 목록에 남음');
  if (recent.indexOf(other.code) < 0) bad.push('다른 판까지 사라졌다');

  // 코드를 아는 사람이 로비로도 못 만난다
  const lobby = await net.call('GET', `/api/game/${g.code}/lobby`);
  if (errOf(lobby) !== 'GAME_NOT_FOUND') bad.push(`lobby → ${errOf(lobby)}`);
  // 열쇠를 알아도 마찬가지
  const state = await net.call('GET', `/api/game/${g.code}/state?viewer=teacher`, { headers: host(g.hostKey) });
  if (errOf(state) !== 'GAME_NOT_FOUND') bad.push(`state → ${errOf(state)}`);

  return {
    ok: bad.length === 0,
    detail: bad.length ? '⛔ ' + bad.join(', ')
      : `비밀번호 없음·틀림·교사 열쇠 전부 ADMIN_DENIED · 지운 뒤 D1·DO·최근 판 목록에서 사라지고 lobby/state 는 GAME_NOT_FOUND (다른 판 ${other.code} 는 그대로)`
  };
});

await gate('DEL2', '없는 코드는 NOT_FOUND (지운 척하지 않는다)', async () => {
  const net = new Net();
  const g = await open(net, '유전', 2);
  const miss = await net.call('POST', '/api/admin/games/ZZZZ/delete', {
    headers: admin(net.adminPassword!), body: {}
  });
  // 한 번 지운 판을 또 지우면 그때도 NOT_FOUND 다
  await net.call('POST', `/api/admin/games/${g.code}/delete`, { headers: admin(net.adminPassword!), body: {} });
  const again = await net.call('POST', `/api/admin/games/${g.code}/delete`, {
    headers: admin(net.adminPassword!), body: {}
  });
  return {
    ok: errOf(miss) === 'NOT_FOUND' && miss.status === 404 && errOf(again) === 'NOT_FOUND',
    detail: `없는 코드 ${errOf(miss)} (${miss.status}) · 두 번째 삭제 ${errOf(again)}`
  };
});

await gate('DEL3', 'wipe 는 op 표에 없다 — 소켓·공개 라우트로 못 부른다', async () => {
  const net = new Net();
  const g = await open(net, '유전', 2);

  // 소켓이 부르는 그 표(RoomOps.op)로 부른다. 표에 없으면 "모르는 요청"이다
  const viaOp = await net.roomOf(g.code).op('wipe', []);
  const stillAfterOp = net.roomOf(g.code).room.raw() !== null;

  // 공개 라우트에도 문이 없다
  const viaHttp = await net.call('POST', `/api/game/${g.code}/wipe`, { headers: host(g.hostKey), body: {} });
  const viaDelete = await net.call('DELETE', `/api/game/${g.code}`, { headers: host(g.hostKey) });
  const still = net.roomOf(g.code).room.raw() !== null && net.db.games.some((x) => x.code === g.code);

  return {
    ok: !viaOp.ok && (viaOp as { error: string }).error === 'SHEET_INVALID' && stillAfterOp &&
        errOf(viaHttp) === 'NOT_FOUND' && errOf(viaDelete) === 'NOT_FOUND' && still,
    detail: `op('wipe') → ${(viaOp as { error?: string }).error} · ` +
            `POST /api/game/:code/wipe → ${errOf(viaHttp)} · DELETE /api/game/:code → ${errOf(viaDelete)} · 판은 그대로`
  };
});

done('판 보존 기간 게이트');
