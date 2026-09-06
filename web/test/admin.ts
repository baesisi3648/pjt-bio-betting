/**
 * admin.ts — 문제은행 관리 라우트 게이트 (MIGRATION §7 5단계).
 *
 * `test/harness.ts` 의 그물을 그대로 쓴다 — 게이트웨이 게이트와 **같은 가짜**다.
 * 관리용으로 MemDb 를 하나 더 쓰면 두 가짜가 갈라지는 날 한쪽만 초록불이 된다 (§5).
 *
 * 여기서 지키는 것:
 *
 *   ADM1        비밀번호 없이는 아무것도 안 열린다. secret 미설정이면 통째로 닫힌다
 *   ADM2~ADM6   CRUD · 검사 · 동물 8줄 · 설정 범위 · 건강 표
 *   LEAK-ADMIN  **관리자 라우트 밖으로 정답이 나가지 않는다** (§4-1)
 *   ADM-GAME    고친 문항은 **다음 판**부터 (§4-6). 이미 만든 판은 옛 문제 그대로
 *
 *   node test/admin.ts
 */

import { ANIMAL_CODES, LEVELS, LIMITS, SETTING_RANGE } from '../src/game/config.ts';
import type { ApiResponse } from '../src/server/ports.ts';
import type { AdminAnimal, AdminQuestion } from '../src/server/ports.ts';
import { Net, admin, allKeys, createGates, dataOf, errOf, host, open, pin } from './harness.ts';

const { gate, done } = createGates('문제은행 관리 게이트');

const PW = 'sEcRet-비밀번호-1234';

/**
 * 관리자 비밀번호를 요구하는 라우트 전부. ADM1 이 이 표를 통째로 순회한다.
 *
 * ⚠️ `POST /api/game` 도 여기 있다. 주소가 `/api/admin/` 으로 시작하지 않을 뿐
 *    **같은 문**(`router.ts` 의 `adminDenied`)을 지나기 때문이다 (2026-09-05 사용자 결정).
 *    이 표에 없으면, 그 문을 옮기다가 판 만들기만 빠뜨리는 날 아무도 모른다.
 *    (판이 실제로 안 만들어지는지는 게이트웨이 쪽 `GW-CREATE-AUTH` 가 더 자세히 본다)
 */
const ROUTES: [string, string, unknown][] = [
  ['POST', '/api/game', { roomTitle: '2학년 3반', unit: '유전', teamCount: 6 }],
  ['GET', '/api/admin/questions', undefined],
  ['GET', '/api/admin/questions?unit=유전', undefined],
  ['POST', '/api/admin/questions', { unit: '유전', level: '쉬움', text: 'ㅁ', choices: ['1', '2', '3', '4'], answer: 1 }],
  ['PUT', '/api/admin/questions/1', { unit: '유전', level: '쉬움', text: 'ㅁ', choices: ['1', '2', '3', '4'], answer: 1 }],
  ['DELETE', '/api/admin/questions/1', undefined],
  ['GET', '/api/admin/animals', undefined],
  ['PUT', '/api/admin/animals', { animals: ANIMAL_CODES.map((c) => ({ code: c, name: '가', emoji: '🐎' })) }],
  ['GET', '/api/admin/settings', undefined],
  ['PUT', '/api/admin/settings', { settings: { quizSeconds: 90 } }],
  ['GET', '/api/admin/summary', undefined]
];

const q = (over: Record<string, unknown> = {}) => ({
  unit: '유전', level: '보통', text: '새로 넣은 문제',
  choices: ['보기1', '보기2', '보기3', '보기4'], answer: 3, explanation: '새 해설',
  ...over
});

// ════════════════════════════════════════════════════════════

await gate('ADM1', '비밀번호 없이는 관리자 경로가 하나도 안 열린다', async () => {
  const net = new Net();
  const bad: string[] = [];
  // ⚠️ 거절만 확인하고 끝내면 "거절은 했는데 그전에 이미 지웠다"를 못 잡는다.
  //    두드리기 전의 문제은행을 적어 두고 뒤에서 대조한다
  const before = net.db.questions.length;

  for (const [m, p, body] of ROUTES) {
    // 1) 헤더 없음  2) 틀린 값  3) 길이가 다른 값 (길이로 힌트를 주면 안 된다)
    const none = errOf(await net.call(m, p, { body }));
    const wrong = errOf(await net.call(m, p, { body, headers: admin('아무거나') }));
    const shortPw = errOf(await net.call(m, p, { body, headers: admin('s') }));
    for (const [label, code] of [['없음', none], ['틀림', wrong], ['짧음', shortPw]] as const) {
      if (code !== 'ADMIN_DENIED') bad.push(`${m} ${p} (${label}) → ${code}`);
    }
  }
  // 거부만 하고 실제로 아무것도 안 바뀌었다 — 문제은행도, '최근 판' 표도
  const untouched = net.db.questions.length === before &&
    net.db.games.length === 0 &&
    net.db.animals.map((a) => a.name).join(',') === '치타,사자,호랑이,늑대,얼룩말,타조,개구리,거북이';

  // ⚠️ secret 을 안 넣고 배포하면 **맞는 값을 줘도** 열리면 안 된다.
  //    '비밀번호 없음 = 아무나 통과' 가 되면 배포 실수 한 번에 문제은행이 통째로 열린다
  const off = new Net();
  off.adminPassword = undefined;
  for (const [m, p, body] of ROUTES) {
    const code = errOf(await off.call(m, p, { body, headers: admin(PW) }));
    if (code !== 'ADMIN_DISABLED') bad.push(`(미설정) ${m} ${p} → ${code}`);
  }
  // 그리고 맞는 비밀번호로는 열린다 (게이트가 "전부 거부"만 확인하고 끝나면 안 된다)
  const okRes = await net.call('GET', '/api/admin/summary', { headers: admin(PW) });

  return {
    ok: bad.length === 0 && untouched && okRes.body.ok,
    detail: bad.length ? '⛔ ' + bad.join(', ')
      : `라우트 ${ROUTES.length}개 × (없음·틀림·짧음) 전부 ADMIN_DENIED · 미설정이면 전부 ADMIN_DISABLED · ` +
        `문제은행·판 목록 그대로 ${untouched} · 맞는 비밀번호로는 열림`
  };
});

await gate('ADM2', '문항 CRUD 왕복 — 추가 → 목록 → 수정 → 반영 → 삭제 → 없음', async () => {
  const net = new Net();
  const before = (dataOf(await net.call('GET', '/api/admin/questions?unit=유전', { headers: admin(PW) })).questions as AdminQuestion[]).length;

  // 추가
  const add = await net.call('POST', '/api/admin/questions', { headers: admin(PW), body: q() });
  const made = dataOf(add).question as AdminQuestion;

  // 목록에 있다 (정답·해설까지 함께 — 관리 화면은 그걸 고쳐야 한다)
  const list1 = dataOf(await net.call('GET', '/api/admin/questions?unit=유전', { headers: admin(PW) })).questions as AdminQuestion[];
  const found = list1.find((x) => x.id === made.id);

  // 수정
  const put = await net.call('PUT', `/api/admin/questions/${made.id}`, {
    headers: admin(PW), body: q({ text: '고친 문제', answer: 2, level: '어려움', explanation: '고친 해설' })
  });
  const list2 = dataOf(await net.call('GET', '/api/admin/questions?unit=유전', { headers: admin(PW) })).questions as AdminQuestion[];
  const fixed = list2.find((x) => x.id === made.id);

  // 없는 id 는 NOT_FOUND
  const ghost = await net.call('PUT', '/api/admin/questions/999999', { headers: admin(PW), body: q() });
  const ghostDel = await net.call('DELETE', '/api/admin/questions/999999', { headers: admin(PW) });

  // 삭제
  const del = await net.call('DELETE', `/api/admin/questions/${made.id}`, { headers: admin(PW) });
  const list3 = dataOf(await net.call('GET', '/api/admin/questions?unit=유전', { headers: admin(PW) })).questions as AdminQuestion[];

  // unit 없이 부르면 전부
  const all = dataOf(await net.call('GET', '/api/admin/questions', { headers: admin(PW) })).questions as AdminQuestion[];

  return {
    ok: add.body.ok && !!made.id && !!found &&
        found.text === '새로 넣은 문제' && found.answer === 3 && found.explanation === '새 해설' &&
        found.choices.join('/') === '보기1/보기2/보기3/보기4' &&
        put.body.ok && !!fixed && fixed.text === '고친 문제' && fixed.answer === 2 && fixed.level === '어려움' &&
        errOf(ghost) === 'NOT_FOUND' && errOf(ghostDel) === 'NOT_FOUND' && ghost.status === 404 &&
        del.body.ok && !list3.some((x) => x.id === made.id) &&
        list1.length === before + 1 && list3.length === before &&
        all.length > list3.length,
    detail: `추가 ${made.id}번 (${before}→${list1.length}줄) · 수정 "${fixed?.text}" 정답 ${fixed?.answer} ${fixed?.level} · ` +
            `없는 id ${errOf(ghost)}/${errOf(ghostDel)} · 삭제 후 ${list3.length}줄 · unit 없이는 ${all.length}줄 전부`
  };
});

await gate('ADM3', '문항 검사 — 무엇이 틀렸는지 한국어로 알려준다', async () => {
  const net = new Net();
  const before = net.db.questions.length;
  const cases: [string, unknown, string][] = [
    ['난이도 오타', q({ level: '어려웅' }), '난이도'],
    ['난이도 없음', q({ level: '' }), '난이도'],
    ['정답 0', q({ answer: 0 }), '정답'],
    ['정답 5', q({ answer: 5 }), '정답'],
    ['정답 문자', q({ answer: '셋' }), '정답'],
    ['보기 3개', q({ choices: ['ㄱ', 'ㄴ', 'ㄷ'] }), '보기는 4개'],
    ['보기 5개', q({ choices: ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ'] }), '보기는 4개'],
    ['보기 하나 빈칸', q({ choices: ['ㄱ', '', 'ㄷ', 'ㄹ'] }), '2번 보기'],
    ['빈 문제', q({ text: '   ' }), '문제를 넣어주세요'],
    ['빈 단원', q({ unit: '' }), '단원을 넣어주세요']
  ];

  const bad: string[] = [];
  const seen: string[] = [];
  for (const [label, body, must] of cases) {
    // 추가와 수정이 **같은 검사**를 지나야 한다 — 한쪽만 검사하면 수정으로 우회된다
    for (const [m, p] of [['POST', '/api/admin/questions'], ['PUT', '/api/admin/questions/1']] as const) {
      const r = await net.call(m, p, { headers: admin(PW), body });
      const msg = r.body.ok ? '(통과해버림)' : (r.body.message ?? '');
      if (errOf(r) !== 'BAD_REQUEST' || msg.indexOf(must) < 0) bad.push(`${m} ${label} → ${errOf(r)} "${msg}"`);
      if (m === 'POST') seen.push(msg);
    }
  }
  // 잘못된 것이 하나도 저장되지 않았다
  const untouched = net.db.questions.length === before &&
    net.db.questions.find((x) => x.id === 1)!.text === '유전 쉬움 문제 1';

  return {
    ok: bad.length === 0 && untouched,
    detail: bad.length ? '⛔ ' + bad.join(', ')
      : `${cases.length}가지 × (추가·수정) 전부 BAD_REQUEST + 이유 문장 · 저장 0건\n              예: ${seen[0]} / ${seen[2]} / ${seen[5]} / ${seen[7]}`
  };
});

await gate('ADM4', '동물은 8줄 · 코드 A~H 고정 · 빈 이름 거부, 이름·이모지 교체는 통과', async () => {
  const net = new Net();
  const full = (over: Partial<Record<number, Partial<AdminAnimal>>> = {}) =>
    ANIMAL_CODES.map((c, i) => ({ code: c, name: `동물${i + 1}`, emoji: '🐎', ...(over[i] || {}) }));

  const cases: [string, unknown, string][] = [
    ['7줄', { animals: full().slice(0, 7) }, '8줄'],
    ['9줄', { animals: [...full(), { code: 'I', name: '늑대2', emoji: '🐺' }] }, '8줄'],
    ['코드 바꾸기', { animals: full({ 2: { code: 'Z' } }) }, '코드는 C'],
    ['코드 순서 바꾸기', { animals: full().reverse() }, '코드는 A'],
    ['빈 이름', { animals: full({ 4: { name: '  ' } }) }, '이름이 비어 있어요'],
    ['배열 아님', { animals: { A: '치타' } }, '8줄']
  ];

  const bad: string[] = [];
  for (const [label, body, must] of cases) {
    const r = await net.call('PUT', '/api/admin/animals', { headers: admin(PW), body });
    const msg = r.body.ok ? '(통과해버림)' : (r.body.message ?? '');
    if (errOf(r) !== 'BAD_REQUEST' || msg.indexOf(must) < 0) bad.push(`${label} → ${errOf(r)} "${msg}"`);
  }
  const kept = net.db.animals.map((a) => a.name).join(',') === '치타,사자,호랑이,늑대,얼룩말,타조,개구리,거북이';

  // 이름·이모지 교체는 통과하고, 판 만들기가 그 이름을 쓴다
  const okRes = await net.call('PUT', '/api/admin/animals', {
    headers: admin(PW), body: { animals: full({ 0: { name: '쿠키', emoji: '🍪' } }) }
  });
  const after = dataOf(okRes).animals as AdminAnimal[];
  const g = await open(net, '유전', 2);
  const usedName = net.state(g.code).animals.A;
  const usedEmoji = net.state(g.code).emojis.A;

  // 망가진 표(9줄)도 화면에서 고칠 수 있어야 한다 — A~H 밖의 줄은 저장할 때 지운다
  const broken = new Net();
  broken.db.animals.push({ code: 'I', name: '침입자', emoji: '👾' });
  const beforeFix = (dataOf(await broken.call('GET', '/api/admin/animals', { headers: admin(PW) })).blocking as string[]).length;
  await broken.call('PUT', '/api/admin/animals', { headers: admin(PW), body: { animals: full() } });
  const afterFix = dataOf(await broken.call('GET', '/api/admin/animals', { headers: admin(PW) }));

  return {
    ok: bad.length === 0 && kept && okRes.body.ok &&
        after.length === 8 && after[0]!.name === '쿠키' && after[0]!.emoji === '🍪' &&
        usedName === '쿠키' && usedEmoji === '🍪' &&
        beforeFix === 1 && (afterFix.blocking as string[]).length === 0 && (afterFix.animals as AdminAnimal[]).length === 8,
    detail: bad.length ? '⛔ ' + bad.join(', ')
      : `${cases.length}가지 거부 (거부 중에는 표 그대로 ${kept}) · 이름·이모지 교체는 통과 → 새 판이 ${usedEmoji}${usedName} 로 달림 · ` +
        `9줄짜리 망가진 표도 저장 한 번으로 고쳐짐 (차단 ${beforeFix}→0)`
  };
});

await gate('ADM5', '설정 — 범위 밖은 저장하지 않고 경고 문장과 함께 거부한다', async () => {
  const net = new Net();
  const cases: [string, unknown, string][] = [
    ['quizSeconds 5', { settings: { quizSeconds: 5 } }, '10~900'],
    ['trackCells 99', { settings: { trackCells: 99 } }, '5~26'],
    ['moveSeconds 1', { settings: { moveSeconds: 1 } }, '5~60'],
    ['숫자가 아님', { settings: { betSeconds: '육십' } }, '숫자가 아니라'],
    ['빈 값', { settings: { betSeconds: '' } }, '값을 넣어주세요'],
    ['모르는 항목', { settings: { 문제시간: 90 } }, '모르는 설정 항목'],
    ['설정 없음', {}, '설정 값을 보내주세요']
  ];

  const bad: string[] = [];
  const msgs: string[] = [];
  for (const [label, body, must] of cases) {
    const r = await net.call('PUT', '/api/admin/settings', { headers: admin(PW), body });
    const msg = r.body.ok ? '(통과해버림)' : (r.body.message ?? '');
    msgs.push(msg);
    if (errOf(r) !== 'BAD_REQUEST' || msg.indexOf(must) < 0) bad.push(`${label} → ${errOf(r)} "${msg}"`);
  }
  // 거부됐으니 표는 시드값(migrations 0002+0005) 그대로여야 한다
  const untouched = net.db.settings.find((s) => s.key === 'quizSeconds')!.value === '40' &&
                    net.db.settings.find((s) => s.key === 'trackCells')!.value === '20';

  // 범위 안이면 저장되고, 새 판이 그 값으로 돈다
  const okRes = await net.call('PUT', '/api/admin/settings', {
    headers: admin(PW), body: { settings: { quizSeconds: 120, trackCells: 14, discussSeconds: 200 } }
  });
  const saved = (dataOf(okRes).settings as { key: string; value: string }[]);
  const g = await open(net, '유전', 2);
  const used = net.state(g.code).settings;
  // 범위와 한국어 이름은 서버가 준다 — 화면이 숫자를 박아 두지 않게 (§5 'trackCells 전역 참조')
  const ranges = dataOf(await net.call('GET', '/api/admin/settings', { headers: admin(PW) })).ranges as Record<string, unknown>;

  return {
    ok: bad.length === 0 && untouched && okRes.body.ok &&
        used.quizSeconds === 120 && used.trackCells === 14 && used.discussSeconds === 200 &&
        saved.find((s) => s.key === 'quizSeconds')!.value === '120' &&
        Object.keys(ranges).length === Object.keys(SETTING_RANGE).length,
    detail: bad.length ? '⛔ ' + bad.join(', ')
      : `${cases.length}가지 거부 (표 그대로 ${untouched}) · 범위 안은 저장 → 새 판이 문제 ${used.quizSeconds}초·트랙 ${used.trackCells}칸 · ` +
        `범위 안내 ${Object.keys(ranges).length}항목\n              예: ${msgs[1]!.split('\n')[0]}`
  };
});

await gate('ADM6', 'summary — 단원별 × 난이도별 개수와 6문항 미만 경고', async () => {
  const net = new Net();
  interface UnitRow {
    unit: string; counts: Record<string, number>; total: number; blocking: string[]; warnings: string[];
  }
  const read = async () => dataOf(await net.call('GET', '/api/admin/summary', { headers: admin(PW) }));

  const d1 = await read();
  const rows1 = d1.units as UnitRow[];
  const 유전 = rows1.find((r) => r.unit === '유전')!;
  const 항상성 = rows1.find((r) => r.unit === '항상성')!;

  // 한 문항을 지우면 그 난이도만 5가 되고 경고가 생긴다
  await net.call('DELETE', '/api/admin/questions/1', { headers: admin(PW) });
  const rows2 = (await read()).units as UnitRow[];
  const 유전2 = rows2.find((r) => r.unit === '유전')!;

  // 동물이 망가지면 **단원 줄이 아니라 동물 칸**에 차단이 뜬다 (같은 줄이 단원마다 반복되면 안 된다)
  net.db.animals.pop();
  const d3 = await read();
  const animals3 = d3.animals as { blocking: string[]; animals: unknown[]; codes: string[] };
  const noRepeat = (d3.units as UnitRow[]).every((r) => r.blocking.length === 0);

  return {
    ok: 유전.total === 18 && LEVELS.every((lv) => 유전.counts[lv] === 6) && 유전.warnings.length === 0 &&
        항상성.counts['어려움'] === 3 && 항상성.warnings.some((w) => w.includes('어려움 3/6')) &&
        유전2.counts['쉬움'] === 5 && 유전2.warnings.some((w) => w.includes('쉬움 5/6')) &&
        d1.minPerLevel === LIMITS.minHintsPerLevel &&
        (d1.levels as string[]).join('') === LEVELS.join('') &&
        animals3.blocking.length === 1 && animals3.blocking[0]!.includes('7줄') &&
        animals3.codes.join('') === ANIMAL_CODES.join('') && noRepeat,
    detail: `유전 ${LEVELS.map((lv) => 유전.counts[lv]).join('/')} (경고 0) · 항상성 어려움 ${항상성.counts['어려움']} → "${항상성.warnings[0]}" · ` +
            `1문항 지우니 쉬움 ${유전2.counts['쉬움']} + 경고 · 동물 7줄이면 동물 칸에만 차단 (단원 줄에는 반복 안 됨 ${noRepeat})`
  };
});

// ════════════════════════════════════════════════════════════
// 정답이 관리자 밖으로 나가지 않는다 (§4-1)
// ════════════════════════════════════════════════════════════

await gate('LEAK-ADMIN', '관리자 라우트 밖 어떤 응답에도 answer·explanation 이 없다', async () => {
  const net = new Net();

  // 정답과 해설에 눈에 띄는 표식을 박아 둔다 — 문자열이 새는지도 보기 위해
  const MARK = '☠️정답표식☠️';
  const list = dataOf(await net.call('GET', '/api/admin/questions?unit=유전', { headers: admin(PW) })).questions as AdminQuestion[];
  for (const x of list) {
    await net.call('PUT', `/api/admin/questions/${x.id}`, {
      headers: admin(PW),
      body: { ...x, explanation: MARK + ' ' + x.explanation, choices: x.choices }
    });
  }

  const g = await open(net, '유전', 2);
  const bad: string[] = [];

  const inspect = async (label: string) => {
    const responses: [string, ApiResponse][] = [
      ['units', await net.call('GET', '/api/units')],
      ['prepare', await net.call('GET', '/api/prepare?unit=유전')],
      ['prepare(없는단원)', await net.call('GET', '/api/prepare')],
      ['lobby', await net.call('GET', `/api/game/${g.code}/lobby`)],
      ['teamView', await net.call('GET', `/api/game/${g.code}/state?viewer=team:1`, { headers: pin(g.pins[1]!) })],
      ['teacherView', await net.call('GET', `/api/game/${g.code}/state?viewer=teacher`, { headers: host(g.hostKey) })]
    ];
    for (const [name, res] of responses) {
      const keys = allKeys(res.body);
      // ⚠️ 'answered'(모둠이 답을 냈는가)는 정답이 아니다. 정확히 이 이름들만 본다
      for (const k of ['answer', 'explanation', 'choices', 'questionById', 'questionPlan']) {
        if (keys.has(k)) bad.push(`${label}/${name}.${k}`);
      }
      if (JSON.stringify(res.body).includes(MARK)) bad.push(`${label}/${name} 해설 문자열`);
    }
  };

  await inspect('waiting');
  await net.call('POST', `/api/game/${g.code}/advance`, { headers: host(g.hostKey), body: {} });
  await inspect('moving');
  net.endPhase(g.code); await inspect('quiz');
  net.endPhase(g.code); await inspect('discuss');
  net.endPhase(g.code); await inspect('betting');

  // 그리고 관리자 경로에서는 **보인다** — 안 보이면 관리 화면이 문항을 못 고친다
  const adminSees = JSON.stringify(
    (await net.call('GET', '/api/admin/questions?unit=유전', { headers: admin(PW) })).body
  ).includes(MARK);

  return {
    ok: bad.length === 0 && adminSees,
    detail: bad.length ? '⛔ ' + bad.join(', ')
      : `5개 단계 × 6개 공개 응답에서 answer·explanation 0건 · 관리자 경로에서는 보임 ${adminSees}`
  };
});

// ════════════════════════════════════════════════════════════
// 고친 문항은 다음 판부터 (§4-6). 안 적으면 "고쳤는데 왜 옛날 문제가 나오냐"가 나온다
// ════════════════════════════════════════════════════════════

await gate('ADM-GAME', '고친 문항은 **다음 판**부터 — 이미 만든 판은 옛 문제 그대로', async () => {
  const net = new Net();
  const g = await open(net, '유전', 2);

  await net.call('POST', `/api/game/${g.code}/advance`, { headers: host(g.hostKey), body: {} });
  net.endPhase(g.code);                                   // moving → quiz

  const first = await net.call('POST', `/api/game/${g.code}/level`, {
    headers: pin(g.pins[1]!), body: { teamNo: 1, level: '쉬움' }
  });
  const oldText = (dataOf(first).question as { text: string }).text;

  // 문제은행의 '유전' 문항을 전부 고친다
  const list = dataOf(await net.call('GET', '/api/admin/questions?unit=유전', { headers: admin(PW) })).questions as AdminQuestion[];
  for (const x of list) {
    await net.call('PUT', `/api/admin/questions/${x.id}`, {
      headers: admin(PW), body: { ...x, text: '고침✏️ ' + x.text }
    });
  }

  // 1) 이미 만든 판은 그대로다 — 문항 내용이 상태에 굳어 있다 (questionById)
  const again = await net.call('POST', `/api/game/${g.code}/level`, {
    headers: pin(g.pins[1]!), body: { teamNo: 1, level: '쉬움' }
  });
  const stillOld = (dataOf(again).question as { text: string }).text;
  const stateClean = Object.values(net.state(g.code).questionById).every((x) => !x.text.startsWith('고침✏️'));

  // 2) 새 판은 고친 문제로 만들어진다
  const g2 = await open(net, '유전', 2);
  const fresh = Object.values(net.state(g2.code).questionById);
  const allNew = fresh.length > 0 && fresh.every((x) => x.text.startsWith('고침✏️'));

  return {
    ok: first.body.ok && oldText === stillOld && !oldText.startsWith('고침✏️') && stateClean && allNew,
    detail: `이미 만든 판: "${stillOld}" (고치기 전 그대로, 배정 문항 ${Object.keys(net.state(g.code).questionById).length}개 전부) · ` +
            `새 판: "${fresh[0]?.text}" (배정 ${fresh.length}개 전부 고친 문제)`
  };
});

done('문제은행 관리 게이트');
