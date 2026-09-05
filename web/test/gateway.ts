/**
 * gateway.ts — 게이트웨이(HTTP 라우트 + 인증) 게이트.
 *
 * 라우터를 **인메모리 포트**로 돌린다. RoomPort 뒤에는 진짜 `Room` 이 있고,
 * DbPort 뒤에는 진짜 `validateUnit` 이 있다. workerd 도 D1 도 띄우지 않는다 —
 * 그게 라우터가 `env` 대신 ports.ts 만 보게 만든 이유다 (MIGRATION §9-3).
 *
 * 게이트 이름은 앱스 스크립트판(test/simulate-game.js)에서 그대로 이어받았다.
 * 같은 이름이면 **같은 성질을 검사한다** — 다만 검사하는 층이 게이트웨이 함수가
 * 아니라 HTTP 라우트다. SEC12~SEC14 는 새 구현에서 처음 생긴 것이다.
 *
 * ⚠️ 그물(MemDb·MemRoom·Net)은 `test/harness.ts` 에 있다. `test/admin.ts` 가 **같은 것**을
 *    쓰기 위해서다 — 가짜를 두 벌 두면 갈라지는 날 한쪽만 초록불이 된다 (MIGRATION §5).
 *
 *   node test/gateway.ts
 */

import { ANIMAL_CODES, DEFAULTS, LEVELS, PHASES } from '../src/game/config.ts';
import type { AnimalCode } from '../src/game/config.ts';
import { THROTTLE } from '../src/do/ops.ts';
import { validateUnit } from '../src/server/bank.ts';
import type { ApiResponse, RecentGame } from '../src/server/ports.ts';
import {
  Net, ORIGIN, allKeys, answerOf, createGates, dataOf, errOf, host, open, pin
} from './harness.ts';

const { gate, done } = createGates('게이트웨이 게이트 (인메모리 포트 · 가짜 시계)');

await gate('SEC1', '열쇠 없이 교사 상태를 못 본다', async () => {
  const net = new Net();
  const g = await open(net);
  const r = await net.call('GET', `/api/game/${g.code}/state?viewer=teacher`);
  return { ok: !r.body.ok && errOf(r) === 'NOT_HOST' && r.status === 403,
           detail: `GET state?viewer=teacher → ${errOf(r)} (${r.status})` };
});

await gate('SEC2', '아무 문자열을 viewer 로 넣어도 못 본다', async () => {
  const net = new Net();
  const g = await open(net);
  // ⚠️ 'team' 은 'team:' 이 아니다. 접두어만 보고 통과시키면 여기서 뚫린다
  const viewers = ['zzz', '', 'team', 'TEACHER', 'teacher '];
  const codes: string[] = [];
  for (const v of viewers) {
    codes.push(errOf(await net.call('GET', `/api/game/${g.code}/state?viewer=${encodeURIComponent(v)}`)));
  }
  // viewer 자체가 없는 경우. ⚠️ 새 판에서 본다 — 위 5회로 교사 열쇠 잠금이 걸려서
  //    같은 판에서 부르면 NOT_HOST 가 아니라 TOO_MANY_TRIES 가 온다 (SEC14)
  const g2 = await open(net, '유전', 2);
  const none = errOf(await net.call('GET', `/api/game/${g2.code}/state`));
  return { ok: codes.every((c) => c === 'NOT_HOST') && none === 'NOT_HOST',
           detail: `${viewers.length}가지 viewer + viewer 없음 전부 ${none} (${codes.join('/')})` };
});

await gate('SEC3', '틀린 열쇠를 거부한다', async () => {
  const net = new Net();
  const g = await open(net);
  const wrong = errOf(await net.call('GET', `/api/game/${g.code}/state?viewer=teacher`, { headers: host('AAAAAAAAAAAA') }));
  const body = errOf(await net.call('GET', `/api/game/${g.code}/state?viewer=teacher`, { headers: {} }));
  const real = await net.call('GET', `/api/game/${g.code}/state?viewer=teacher`, { headers: host(g.hostKey) });
  return { ok: wrong === 'NOT_HOST' && body === 'NOT_HOST' && real.body.ok,
           detail: `틀린 열쇠 ${wrong} · 열쇠 없음 ${body} · 진짜 열쇠는 통과` };
});

await gate('SEC4', '열쇠 없이 모둠 암호를 못 가져간다', async () => {
  const net = new Net();
  const g = await open(net);
  const r = await net.call('POST', `/api/game/${g.code}/handout`, { body: {} });
  const leaked = JSON.stringify(r.body).includes('"pins"') ||
                 Object.values(g.pins).some((p) => JSON.stringify(r.body).includes(p));
  const real = await net.call('POST', `/api/game/${g.code}/handout`, { headers: host(g.hostKey), body: {} });
  const d = dataOf(real);
  return {
    ok: errOf(r) === 'NOT_HOST' && !leaked && real.body.ok && !!d.pins && d.studentUrl === ORIGIN + '/',
    detail: `거부 ${errOf(r)} · 거부 응답에 암호 0건 · 진짜 열쇠로는 암호 ${Object.keys(d.pins as object).length}개 + ${String(d.studentUrl)}`
  };
});

await gate('SEC5', '열쇠 없이 진행·정지·정산·공개를 못 한다', async () => {
  const net = new Net();
  const g = await open(net, '유전', 2);
  const codes: string[] = [];
  for (const what of ['advance', 'pause', 'finalize', 'reveal']) {
    codes.push(errOf(await net.call('POST', `/api/game/${g.code}/${what}`, { body: {} })));
  }
  const wrongKey = errOf(await net.call('POST', `/api/game/${g.code}/advance`, { headers: host('AAAAAAAAAAAA'), body: {} }));
  const still = net.state(g.code).phase;
  return {
    ok: codes.every((c) => c === 'NOT_HOST') && wrongKey === 'NOT_HOST' && still === PHASES.WAITING,
    detail: `advance/pause/finalize/reveal ${codes.join('/')} · 틀린 열쇠 ${wrongKey} · 판은 ${still} 그대로`
  };
});

await gate('SEC6', '정산 전에는 교사 응답에도 정답이 없다', async () => {
  const net = new Net();
  const g = await open(net, '유전', 2);
  await net.call('POST', `/api/game/${g.code}/advance`, { headers: host(g.hostKey), body: {} });
  const r = await net.call('GET', `/api/game/${g.code}/state?viewer=teacher`, { headers: host(g.hostKey) });
  const truthStr = net.state(g.code).truth.join('","');
  const s = JSON.stringify(r.body);
  const d = dataOf(r);
  return {
    ok: r.body.ok && d.truth === null && !allKeys(r.body).has('moves') && !s.includes(truthStr),
    detail: `truth=${String(d.truth)} · moves 없음 · 정답 문자열도 안 샘 (단계 ${String(d.phase)})`
  };
});

await gate('SEC7', '정답 공개도 열쇠를 요구한다', async () => {
  const net = new Net();
  const g = await open(net, '유전', 2);
  const denied = await net.call('POST', `/api/game/${g.code}/reveal`, { body: {} });
  const allowed = await net.call('POST', `/api/game/${g.code}/reveal`, { headers: host(g.hostKey), body: {} });
  const truth = dataOf(allowed).truth as string[] | undefined;
  return {
    ok: errOf(denied) === 'NOT_HOST' && !JSON.stringify(denied.body).includes('truth') &&
        Array.isArray(truth) && truth.join('') === net.state(g.code).truth.join(''),
    detail: `열쇠 없으면 ${errOf(denied)} · 있으면 ${truth?.join('')}`
  };
});

await gate('SEC8', '모둠 화면은 교사 열쇠 없이 그대로 된다', async () => {
  const net = new Net();
  const g = await open(net, '유전', 2);
  const lobby = await net.call('GET', `/api/game/${g.code}/lobby`);
  const join = await net.call('POST', `/api/game/${g.code}/join`, { body: { teamNo: 1, pin: g.pins[1] } });
  const state = await net.call('GET', `/api/game/${g.code}/state?viewer=team:1`, { headers: pin(g.pins[1]!) });
  return {
    ok: lobby.body.ok && join.body.ok && state.body.ok,
    detail: `lobby·join·state 전부 통과 — 학생 경로에는 교사 열쇠가 필요 없다`
  };
});

// ════════════════════════════════════════════════════════════
// 모둠 암호 — 접속할 때 한 번 맞춰보는 것으로는 아무것도 못 지킨다 (§4-4)
// ════════════════════════════════════════════════════════════

await gate('SEC9', '암호 없이 남의 모둠 상태를 못 본다', async () => {
  const net = new Net();
  const g = await open(net, '유전', 2);
  const none = errOf(await net.call('GET', `/api/game/${g.code}/state?viewer=team:2`));
  const other = errOf(await net.call('GET', `/api/game/${g.code}/state?viewer=team:2`, { headers: pin(g.pins[1]!) }));
  const mine = await net.call('GET', `/api/game/${g.code}/state?viewer=team:2`, { headers: pin(g.pins[2]!) });
  return {
    ok: none === 'WRONG_PIN' && other === 'WRONG_PIN' && mine.body.ok,
    detail: `암호 없음 ${none} · 1모둠 암호로 2모둠 조회 ${other} · 제 암호는 통과`
  };
});

await gate('SEC10', '암호 없이 남의 모둠 답을 못 낸다', async () => {
  const net = new Net();
  const g = await open(net, '유전', 2);
  await net.call('POST', `/api/game/${g.code}/advance`, { headers: host(g.hostKey), body: {} });
  net.endPhase(g.code);                                     // moving → quiz

  const none = errOf(await net.call('POST', `/api/game/${g.code}/level`, { body: { teamNo: 2, level: '쉬움' } }));
  const other = errOf(await net.call('POST', `/api/game/${g.code}/level`, { body: { teamNo: 2, level: '쉬움', pin: g.pins[1] } }));
  const answer = errOf(await net.call('POST', `/api/game/${g.code}/answer`, { body: { teamNo: 2, level: '쉬움', choice: 1, pin: g.pins[1] } }));
  const mine = await net.call('POST', `/api/game/${g.code}/level`, { headers: pin(g.pins[2]!), body: { teamNo: 2, level: '쉬움' } });
  const untouched = !net.state(g.code).teams[1]!.answered[1];
  return {
    ok: none === 'WRONG_PIN' && other === 'WRONG_PIN' && answer === 'WRONG_PIN' && mine.body.ok && untouched,
    detail: `난이도 ${none}/${other} · 제출 ${answer} · 제 암호는 통과 · 2모둠 기록 그대로`
  };
});

await gate('SEC11', '암호 없이 남의 모둠 코인을 못 건다', async () => {
  const net = new Net();
  const g = await open(net, '유전', 2);
  await net.call('POST', `/api/game/${g.code}/advance`, { headers: host(g.hostKey), body: {} });
  net.endPhase(g.code); net.endPhase(g.code); net.endPhase(g.code);   // → betting

  const stolen = errOf(await net.call('POST', `/api/game/${g.code}/bet`, { body: { teamNo: 2, bets: { A: 1 }, pin: g.pins[1] } }));
  const coinsMid = net.state(g.code).teams[1]!.coins;
  const own = await net.call('POST', `/api/game/${g.code}/bet`, { headers: pin(g.pins[2]!), body: { teamNo: 2, bets: { A: 1 } } });
  return {
    ok: stolen === 'WRONG_PIN' && coinsMid === DEFAULTS.initialCoins && own.body.ok,
    detail: `남의 암호 ${stolen} (코인 ${coinsMid} 그대로) · 제 암호로는 성공`
  };
});

// ════════════════════════════════════════════════════════════
// 새 구현에서 생긴 것
// ════════════════════════════════════════════════════════════

await gate('SEC12', '관리자 비밀번호로만 교사 열쇠를 되찾는다', async () => {
  const net = new Net();
  const g = await open(net, '유전', 2);
  const url = '/api/admin/host-key';

  const none = await net.call('POST', url, { body: { code: g.code } });
  const wrong = await net.call('POST', url, { headers: { 'X-Admin-Password': '아무거나' }, body: { code: g.code } });
  // 길이가 다른 값도 같은 코드로 거부돼야 한다 (길이로 힌트를 주면 안 된다)
  const shortPw = await net.call('POST', url, { headers: { 'X-Admin-Password': 's' }, body: { code: g.code } });
  const right = await net.call('POST', url, { headers: { 'X-Admin-Password': net.adminPassword! }, body: { code: g.code } });
  const missing = await net.call('POST', url, { headers: { 'X-Admin-Password': net.adminPassword! }, body: { code: 'ZZZZ' } });

  // ⚠️ secret 을 안 넣고 배포하면 **맞는 값을 줘도** 열리면 안 된다
  const off = new Net();
  off.adminPassword = undefined;
  const g2 = await open(off, '유전', 2);
  const offRes = await off.call('POST', url, { headers: { 'X-Admin-Password': 'sEcRet-비밀번호-1234' }, body: { code: g2.code } });

  const leaked = [none, wrong, shortPw, missing, offRes].some((r) => JSON.stringify(r.body).includes(g.hostKey));

  return {
    ok: errOf(none) === 'ADMIN_DENIED' && errOf(wrong) === 'ADMIN_DENIED' && errOf(shortPw) === 'ADMIN_DENIED' &&
        right.body.ok && dataOf(right).hostKey === g.hostKey &&
        errOf(missing) === 'GAME_NOT_FOUND' && errOf(offRes) === 'ADMIN_DISABLED' && !leaked,
    detail: `없음/틀림/짧음 ${errOf(none)}/${errOf(wrong)}/${errOf(shortPw)} · 맞으면 열쇠 · 없는 판 ${errOf(missing)} · ` +
            `ADMIN_PASSWORD 미설정이면 ${errOf(offRes)} · 거부 응답에 열쇠 0건`
  };
});

await gate('SEC13', 'DO 의 op 는 공개 경로에 없다 — 판 생성은 /api/game 뿐', async () => {
  const net = new Net();
  const payload = { op: 'create', args: [{ code: 'XXXX', className: '해킹', unit: '유전', teamCount: 6 }] };
  const tried = [
    ['POST', '/room/XXXX/op'], ['POST', '/api/room/XXXX/op'], ['POST', '/api/game/XXXX/op'],
    ['POST', '/api/game/XXXX/create'], ['POST', '/api/op'], ['POST', '/api/game/XXXX'],
    ['GET', '/room/XXXX/op']
  ] as const;
  const codes: string[] = [];
  for (const [m, p] of tried) codes.push(errOf(await net.call(m, p, { body: payload })));

  // 어떤 경로로도 방이 만들어지지 않았다
  const noRoom = !net.rooms.get('XXXX') || net.rooms.get('XXXX')!.room.raw() === null;

  // 그리고 유일한 생성 경로는 D1 문제은행을 거친다 — 없는 단원으로는 판이 안 만들어진다
  const noUnit = await net.call('POST', '/api/game', { body: { className: 'A', unit: '없는단원', teamCount: 2 } });
  // 만들어진 판의 문항은 D1 에서 온 것이다 (문항 내용이 상태에 굳어 있다 — §4-6)
  const g = await open(net, '유전', 2);
  const st = net.state(g.code);
  const fromDb = Object.values(st.questionById).every(
    (q) => net.db.questions.some((row) => row.id === q.id && row.text === q.text)
  );

  return {
    ok: codes.every((c) => c === 'NOT_FOUND') && noRoom && errOf(noUnit) === 'SHEET_INVALID' && fromDb,
    detail: `${tried.length}가지 경로 전부 ${codes.join('/')} · 방 미생성 ${noRoom} · ` +
            `없는 단원 ${errOf(noUnit)} · 배정 문항 ${Object.keys(st.questionById).length}개 전부 D1 출처`
  };
});

await gate('SEC14', '암호를 연속으로 틀리면 그 모둠만 30초 잠긴다', async () => {
  const net = new Net();
  const g = await open(net, '유전', 2);
  const tryPin = (teamNo: number, p: string) =>
    net.call('POST', `/api/game/${g.code}/join`, { body: { teamNo, pin: p } });

  // 1) 연속 5회 실패 → 6회째부터 TOO_MANY_TRIES
  const firstFive: string[] = [];
  for (let i = 0; i < THROTTLE.maxFails; i++) firstFive.push(errOf(await tryPin(1, '0000')));
  const sixth = errOf(await tryPin(1, '0001'));

  // 2) 다른 모둠은 아무 영향이 없다 — 한 학생이 반 전체를 세울 수 없어야 한다
  const other = await tryPin(2, g.pins[2]!);

  // 3) ⚠️ 잠긴 동안에는 **맞는 암호도** 막는다. 맞으면 통과시키면 잠금이 아무 일도 안 한다
  const rightWhileLocked = errOf(await tryPin(1, g.pins[1]!));

  // 4) 30초 뒤 풀린다
  net.tick(THROTTLE.lockMs + 1);
  const afterWait = await tryPin(1, g.pins[1]!);

  // 5) 정답 경로에는 지연도 잠금도 없다 — 제 암호만 쓰는 모둠은 이 코드를 만나지 않는다
  const many: string[] = [];
  for (let i = 0; i < 20; i++) many.push(errOf(await tryPin(1, g.pins[1]!)));
  const cleanAfterSuccess = !net.roomOf(g.code).throttle()['team:1'];

  // 6) 성공이 카운터를 지운다 (4번 틀리고 한 번 맞으면 다시 4번까지 여유가 있다)
  const g2 = await open(net, '유전', 2);
  const t2 = (p: string) => net.call('POST', `/api/game/${g2.code}/join`, { body: { teamNo: 1, pin: p } });
  for (let i = 0; i < 4; i++) await t2('0000');
  await t2(g2.pins[1]!);
  const afterReset: string[] = [];
  for (let i = 0; i < 4; i++) afterReset.push(errOf(await t2('0000')));

  return {
    ok: firstFive.every((c) => c === 'WRONG_PIN') && sixth === 'TOO_MANY_TRIES' &&
        other.body.ok && rightWhileLocked === 'TOO_MANY_TRIES' && afterWait.body.ok &&
        many.every((c) => c === 'ok') && cleanAfterSuccess &&
        afterReset.every((c) => c === 'WRONG_PIN'),
    detail: `5회 ${firstFive[0]} → 6회째 ${sixth} · 2모둠 영향 없음 · 잠금 중 맞는 암호도 ${rightWhileLocked} · ` +
            `${THROTTLE.lockMs / 1000}초 뒤 통과 · 제 암호 20연속 전부 통과(카운터 비어 있음 ${cleanAfterSuccess}) · ` +
            `성공하면 초기화(다음 4회 ${afterReset.join('/')})`
  };
});

await gate('HOST-NOLOCK', '교사 열쇠는 아무리 틀려도 잠기지 않는다 (학생이 교사 버튼을 얼릴 수 없다)', async () => {
  const net = new Net();
  const g = await open(net, '유전', 2);
  const wrong: string[] = [];
  for (let i = 0; i < 20; i++) {
    wrong.push(errOf(await net.call('POST', `/api/game/${g.code}/advance`, { headers: host('AAAAAAAAAAAA') })));
  }
  const real = await net.call('POST', `/api/game/${g.code}/advance`, { headers: host(g.hostKey) });
  const state = await net.call('GET', `/api/game/${g.code}/state?viewer=teacher`, { headers: host(g.hostKey) });
  return {
    ok: wrong.every((c) => c === 'NOT_HOST') && real.body.ok && state.body.ok &&
        dataOf(state).phase === PHASES.MOVING,
    detail: `틀린 열쇠 20회 전부 ${wrong[0]} · 바로 다음 진짜 열쇠로 진행 ${real.body.ok ? '통과' : '⛔ ' + errOf(real)} (단계 ${String(dataOf(state).phase)})`
  };
});

await gate('GW-SKIP', "'지금 넘어가기'는 교사 열쇠로만 — 넘길 수 없는 단계면 열쇠가 맞아도 거절", async () => {
  const net = new Net();
  const g = await open(net, '유전', 2);
  const url = `/api/game/${g.code}/skip`;
  await net.call('POST', `/api/game/${g.code}/advance`, { headers: host(g.hostKey), body: {} });
  net.endPhase(g.code);                                    // moving → quiz

  const none = await net.call('POST', url, { body: {} });
  const wrong = await net.call('POST', url, { headers: host('AAAAAAAAAAAA'), body: {} });
  const stillQuiz = net.state(g.code).phase === PHASES.QUIZ;

  const real = await net.call('POST', url, { headers: host(g.hostKey), body: {} });
  const moved = net.state(g.code).phase === PHASES.DISCUSS;
  // 안 낸 모둠은 알람 경로와 똑같이 미제출로 남는다
  const timedOut = net.state(g.code).teams.every((t) => t.answered[1]?.timeout === true);

  // waiting 에서는 열쇠가 맞아도 넘길 게 없다
  net.endPhase(g.code); net.endPhase(g.code);              // discuss → betting → waiting
  const atWaiting = await net.call('POST', url, { headers: host(g.hostKey), body: {} });

  return {
    ok: errOf(none) === 'NOT_HOST' && none.status === 403 && errOf(wrong) === 'NOT_HOST' &&
        stillQuiz && real.body.ok && dataOf(real).phase === PHASES.DISCUSS && moved && timedOut &&
        errOf(atWaiting) === 'NOT_SKIPPABLE' && atWaiting.status === 400 &&
        !!atWaiting.body.ok === false && typeof (atWaiting.body as { message?: string }).message === 'string',
    detail: `열쇠 없음 ${errOf(none)}(${none.status}) · 틀린 열쇠 ${errOf(wrong)} (판은 quiz 그대로 ${stillQuiz}) · ` +
            `진짜 열쇠로 ${String(dataOf(real).phase)} (미제출 기록 ${timedOut}) · ` +
            `waiting 에서는 ${errOf(atWaiting)}(${atWaiting.status})`
  };
});

// ════════════════════════════════════════════════════════════
// 게이트웨이 자체
// ════════════════════════════════════════════════════════════

await gate('GW1', '판 생성 → 6모둠 접속 → 진행 → 정산까지 HTTP 로 완주', async () => {
  const net = new Net();
  const g = await open(net, '유전', 6);

  for (let n = 1; n <= 6; n++) {
    const j = await net.call('POST', `/api/game/${g.code}/join`, { body: { teamNo: n, pin: g.pins[n] } });
    if (!j.body.ok) return { ok: false, detail: `${n}모둠 접속 실패: ${errOf(j)}` };
  }

  const last = net.state(g.code).lastRound;      // 학생에게는 비공개. 테스트만 서버를 들여다본다
  for (let r = 1; r <= last; r++) {
    await net.call('POST', `/api/game/${g.code}/advance`, { headers: host(g.hostKey), body: {} });
    net.endPhase(g.code);                        // moving → quiz
    for (let n = 1; n <= 6; n++) {
      const lv = LEVELS[n % 3]!;
      await net.call('POST', `/api/game/${g.code}/level`, { headers: pin(g.pins[n]!), body: { teamNo: n, level: lv } });
      await net.call('POST', `/api/game/${g.code}/answer`, {
        headers: pin(g.pins[n]!),
        body: { teamNo: n, level: lv, choice: n <= 4 ? answerOf(net, g.code, r, lv) : 99 }
      });
    }
    net.endPhase(g.code);                        // quiz → discuss
    net.endPhase(g.code);                        // discuss → betting
    for (let n = 1; n <= 6; n++) {
      await net.call('POST', `/api/game/${g.code}/bet`, {
        headers: pin(g.pins[n]!), body: { teamNo: n, bets: { [ANIMAL_CODES[(n + r) % 8]!]: 2 } }
      });
    }
    net.endPhase(g.code);                        // betting → waiting
  }

  const fin = await net.call('POST', `/api/game/${g.code}/finalize`, { headers: host(g.hostKey), body: {} });
  const settlement = dataOf(fin).settlement as unknown[] | undefined;
  const after = await net.call('GET', `/api/game/${g.code}/state?viewer=team:1`, { headers: pin(g.pins[1]!) });
  const truthAfter = dataOf(after).truth as string[] | undefined;
  const marked = net.db.games.find((x) => x.code === g.code)?.isOver;

  return {
    ok: fin.body.ok && settlement?.length === 6 && Array.isArray(truthAfter) && marked === true,
    detail: `${last}라운드 · 정산 ${settlement?.length}모둠 · 정산 후에야 모둠 뷰에 정답(${truthAfter?.join('')}) · ` +
            `'이어하기' 목록에 끝남 표시 ${marked}`
  };
});

await gate('GW2', '생성 응답에 studentUrl·warnings, D1 games 에 한 줄', async () => {
  const net = new Net();
  // '항상성' 은 어려움이 3문항뿐 — 경고가 나되 판은 만들어져야 한다
  const res = await net.call('POST', '/api/game', { body: { className: '2학년 5반', unit: '항상성', teamCount: 5, teamNames: ['가', '나'] } });
  const d = dataOf(res);
  const row = net.db.games[0];
  const teams = d.teams as { no: number; name: string }[];
  const warnings = d.warnings as string[];

  const units = await net.call('GET', '/api/units');
  const recent = dataOf(units).recent as RecentGame[];

  return {
    ok: res.body.ok && d.studentUrl === ORIGIN + '/' && warnings.length === 1 &&
        warnings[0]!.includes('어려움 3/6') && teams.length === 5 &&
        teams[0]!.name === '가' && teams[2]!.name === '3모둠' &&
        net.db.games.length === 1 && row!.code === d.code && row!.className === '2학년 5반' &&
        row!.unit === '항상성' && row!.createdAt === net.clock.now && row!.isOver === false &&
        recent.length === 1 && recent[0]!.code === d.code,
    detail: `${String(d.studentUrl)} · 경고 "${warnings[0]}" · 모둠 ${teams.map((t) => t.name).join(',')} · ` +
            `games 1줄(${row!.code}, ${row!.createdAt}) · 최근 판 목록에도 1줄`
  };
});

await gate('GW3', '판 코드가 겹치면 다시 뽑아 성공한다', async () => {
  const net = new Net();

  // ⚠️ 판 코드를 결정적으로 만든다 — 처음 두 번은 같은 코드, 그다음은 다른 코드
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const at = (ch: string) => (alphabet.indexOf(ch) + 0.5) / alphabet.length;
  const script = [
    ...'AAAA', ...'AAAA',    // 1·2회차: D1 에 이미 있는 코드 → 다시 뽑는다
    ...'BBBB',               // 3회차: DO 에 방이 이미 있는 코드 → 다시 뽑는다
    ...'CCCC'                // 4회차: 성공
  ].map(at);
  let i = 0;
  net.codeRng = () => (i < script.length ? script[i++]! : Math.random());

  // AAAA 는 D1 목록에 이미 있고, BBBB 는 DO 에 방이 이미 서 있다
  await net.db.addGame({ code: 'AAAA', className: '앞반', unit: '유전', createdAt: net.clock.now - 1000 });
  const bbbb = net.roomOf('BBBB');
  bbbb.room.create({ code: 'BBBB', className: '앞반', unit: '유전', teamCount: 2 },
    validateUnit('유전', net.db.questions.filter((q) => q.unit === '유전'), net.db.animals, net.db.settings).questions,
    { names: {} as Record<AnimalCode, string>, emojis: {} as Record<AnimalCode, string> });

  const res = await net.call('POST', '/api/game', { body: { className: '뒷반', unit: '유전', teamCount: 2 } });
  const code = String(dataOf(res).code);
  // 앞 판을 덮어쓰지 않았다
  const kept = net.db.games.find((x) => x.code === 'AAAA')!.className === '앞반' &&
               net.state('BBBB').className === '앞반';

  return {
    ok: res.body.ok && code === 'CCCC' && kept && net.db.games.length === 2,
    detail: `AAAA(D1 중복) → BBBB(DO 중복) → ${code} 로 성공 · 앞 판 그대로 ${kept}`
  };
});

await gate('GW4', '모든 응답이 JSON 직렬화 가능하고 Date 가 없다', async () => {
  const net = new Net();
  const g = await open(net, '유전', 2);
  await net.call('POST', `/api/game/${g.code}/advance`, { headers: host(g.hostKey), body: {} });
  await net.call('GET', `/api/game/${g.code}/state?viewer=teacher`, { headers: host(g.hostKey) });
  await net.call('GET', `/api/game/${g.code}/state?viewer=team:1`, { headers: pin(g.pins[1]!) });
  await net.call('GET', `/api/game/${g.code}/lobby`);
  await net.call('POST', `/api/game/${g.code}/handout`, { headers: host(g.hostKey), body: {} });
  await net.call('POST', `/api/game/${g.code}/reveal`, { headers: host(g.hostKey), body: {} });
  await net.call('GET', '/api/units');
  await net.call('GET', '/api/prepare?unit=항상성');
  await net.call('GET', '/api/version');
  await net.call('GET', '/없는/주소');

  const bad: string[] = [];
  const walk = (v: unknown, p: string) => {
    if (v instanceof Date) { bad.push(p + ' (Date)'); return; }
    if (typeof v === 'function' || typeof v === 'undefined') { bad.push(p + ' (' + typeof v + ')'); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${p}[${i}]`)); return; }
    if (v && typeof v === 'object') for (const k of Object.keys(v as object)) walk((v as Record<string, unknown>)[k], `${p}.${k}`);
  };
  for (const e of net.log) {
    walk(e.res.body, e.path);
    // 굽고 다시 읽어도 같아야 한다 — 되면 Worker 가 그대로 내보낼 수 있다
    if (JSON.stringify(JSON.parse(JSON.stringify(e.res.body))) !== JSON.stringify(e.res.body)) {
      bad.push(e.path + ' (직렬화 왕복 불일치)');
    }
    if (!('ok' in e.res.body)) bad.push(e.path + ' (봉투가 아님)');
  }
  return { ok: bad.length === 0,
           detail: bad.length ? '⛔ ' + bad.join(', ') : `${net.log.length}개 응답 전부 봉투 · Date 0건 · 왕복 일치` };
});

await gate('GW5', '없는 판·없는 주소·깨진 본문에도 봉투로 답한다', async () => {
  const net = new Net();
  const notFound = await net.call('GET', '/api/game/ZZZZ/lobby');
  const badPath = await net.call('GET', '/api/모름');
  const badBody = await net.call('POST', '/api/game', { body: undefined });     // 본문 없음
  const badTeams = await net.call('POST', '/api/game', { body: { className: 'A', unit: '유전', teamCount: 99 } });
  const wrongMethod = await net.call('GET', '/api/game/ZZZZ/advance');
  return {
    ok: errOf(notFound) === 'GAME_NOT_FOUND' && notFound.status === 404 &&
        errOf(badPath) === 'NOT_FOUND' && errOf(badBody) === 'BAD_REQUEST' &&
        errOf(badTeams) === 'BAD_REQUEST' && errOf(wrongMethod) === 'NOT_FOUND' &&
        [notFound, badPath, badBody, badTeams, wrongMethod].every((r) => !r.body.ok && !!r.body.message),
    detail: `없는 판 ${errOf(notFound)}(404) · 없는 주소 ${errOf(badPath)} · 빈 본문 ${errOf(badBody)} · ` +
            `모둠 99개 ${errOf(badTeams)} · GET advance ${errOf(wrongMethod)} — 전부 한국어 문장 포함`
  };
});

await gate('GW6', '최근 판 목록이 터져도 단원 목록은 살아 있다', async () => {
  const net = new Net();
  await open(net, '유전', 2);
  net.db.recentThrows = true;
  const r = await net.call('GET', '/api/units');
  const d = dataOf(r);
  return {
    ok: r.body.ok && (d.units as string[]).length === 2 && (d.recent as unknown[]).length === 0 &&
        typeof d.recentError === 'string',
    detail: `단원 ${(d.units as string[]).join(',')} · 최근 판 0줄 + recentError "${String(d.recentError)}"`
  };
});

// ════════════════════════════════════════════════════════════
// 유출
// ════════════════════════════════════════════════════════════

await gate('LEAK', '정산 전 어떤 공개 응답에도 truth·moves·lastRound·pin·hostKey 가 없다', async () => {
  const net = new Net();
  const g = await open(net, '유전', 2);
  const truthStr = net.state(g.code).truth.join('","');
  const bad: string[] = [];

  const inspect = async (label: string) => {
    // 학생 폰이 실제로 부를 수 있는 것 전부 (인증 없음 + 모둠 암호)
    const responses: [string, ApiResponse][] = [
      ['lobby', await net.call('GET', `/api/game/${g.code}/lobby`)],
      ['units', await net.call('GET', '/api/units')],
      ['prepare', await net.call('GET', '/api/prepare?unit=유전')],
      ['version', await net.call('GET', '/api/version')],
      ['team:1', await net.call('GET', `/api/game/${g.code}/state?viewer=team:1`, { headers: pin(g.pins[1]!) })],
      ['team:2', await net.call('GET', `/api/game/${g.code}/state?viewer=team:2`, { headers: pin(g.pins[2]!) })],
      ['join', await net.call('POST', `/api/game/${g.code}/join`, { body: { teamNo: 1, pin: g.pins[1] } })],
      ['handout 거부', await net.call('POST', `/api/game/${g.code}/handout`, { body: {} })],
      ['teacher 거부', await net.call('GET', `/api/game/${g.code}/state?viewer=teacher`)]
    ];
    for (const [name, res] of responses) {
      const keys = allKeys(res.body);
      const json = JSON.stringify(res.body);
      for (const k of ['truth', 'moves', 'lastRound', 'pin', 'pins', 'hostKey', 'hintPool', 'hintGiven', 'questionById']) {
        if (keys.has(k)) bad.push(`${label}/${name}.${k}`);
      }
      if (json.includes(truthStr)) bad.push(`${label}/${name} 정답 문자열`);
      if (json.includes(g.hostKey)) bad.push(`${label}/${name} 교사 열쇠`);
      for (const p of Object.values(g.pins)) if (json.includes(`"${p}"`)) bad.push(`${label}/${name} 모둠 암호`);
    }
    // 교사 응답은 열쇠로 지켜지지만 TV 에 그대로 뜬다 — truth 는 정산 전까지 null 이어야 한다
    const tv = await net.call('GET', `/api/game/${g.code}/state?viewer=teacher`, { headers: host(g.hostKey) });
    if (allKeys(tv.body).has('moves')) bad.push(`${label}/teacher.moves`);
    if (dataOf(tv).truth !== null) bad.push(`${label}/teacher.truth`);
    if (JSON.stringify(tv.body).includes(truthStr)) bad.push(`${label}/teacher 정답 문자열`);
  };

  await inspect('waiting');
  await net.call('POST', `/api/game/${g.code}/advance`, { headers: host(g.hostKey), body: {} });
  await inspect('moving');
  net.endPhase(g.code); await inspect('quiz');
  net.endPhase(g.code); await inspect('discuss');
  net.endPhase(g.code); await inspect('betting');
  net.endPhase(g.code); await inspect('waiting2');

  return { ok: bad.length === 0,
           detail: bad.length ? '⛔ ' + bad.join(', ') : '6개 단계 × 10개 응답에서 0건' };
});

await gate('LEAK-moving', 'moving 뷰에는 이번 라운드 이동량만 실린다', async () => {
  const net = new Net();
  const g = await open(net, '유전', 2);
  await net.call('POST', `/api/game/${g.code}/advance`, { headers: host(g.hostKey), body: {} });
  const team = dataOf(await net.call('GET', `/api/game/${g.code}/state?viewer=team:1`, { headers: pin(g.pins[1]!) }));
  const tv = dataOf(await net.call('GET', `/api/game/${g.code}/state?viewer=teacher`, { headers: host(g.hostKey) }));
  const shape = (m: unknown) => {
    const r = m as Record<string, number> | undefined;
    return !!r && Object.keys(r).length === 8 &&
      ANIMAL_CODES.every((c) => Number.isInteger(r[c]) && r[c]! >= 0 && r[c]! <= 3);
  };
  return {
    ok: shape(team.raceMoves) && shape(tv.raceMoves),
    detail: `모둠·교사 뷰 모두 raceMoves 8개 (${ANIMAL_CODES.map((c) => (team.raceMoves as Record<string, number>)[c]).join('')}) — moves 전체가 아니다`
  };
});

done('게이트웨이 게이트');
