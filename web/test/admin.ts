/**
 * admin.ts — 문제은행 관리 라우트 게이트 (MIGRATION §7 5단계 · RENEWAL §3).
 *
 * `test/harness.ts` 의 그물을 그대로 쓴다 — 게이트웨이 게이트와 **같은 가짜**다.
 * 관리용으로 MemDb 를 하나 더 쓰면 두 가짜가 갈라지는 날 한쪽만 초록불이 된다 (§5).
 *
 * 여기서 지키는 것:
 *
 *   ADM1        비밀번호 없이는 아무것도 안 열린다. secret 미설정이면 통째로 닫힌다
 *   ADM2~ADM6   CRUD · 검사 · 동물 8줄 · 설정 범위 · 건강 표
 *   IMP1~IMP4   JSON 가져오기 — 미리보기 · 오류 보고 · 세 가지 방식 · 한국어 난이도
 *   EXP1·EXP2   JSON 내보내기 — 형식과 왕복 · **관리자 밖으로는 안 나간다**
 *   SET1·SET2   세트 목록·이름 바꾸기·삭제 · 세트 없이 판 만들기(전체 은행)
 *   WARN10      난이도별 10문항 미만이면 재사용 경고
 *   LEAK-ADMIN  **관리자 라우트 밖으로 정답이 나가지 않는다** (§4-1)
 *   ADM-GAME    고친 문항은 **다음 판**부터 (§4-6). 이미 만든 판은 옛 문제 그대로
 *
 *   node test/admin.ts
 */

import { ANIMAL_CODES, LEVELS, LIMITS, ROUNDS, SETTING_RANGE } from '../src/game/config.ts';
import { DIFFICULTIES } from '../src/server/portable.ts';
import type { ApiResponse } from '../src/server/ports.ts';
import type { AdminAnimal, AdminQuestion, SetInfo } from '../src/server/ports.ts';
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
 *
 * ⚠️ **라우트를 더하면 여기에도 더하세요.** 2단계에서 더한 넷(내보내기·미리보기·가져오기·
 *    세트)이 이 표에 없었다면, 그중 하나만 문 밖에 있어도 게이트는 초록불이었을 것이다.
 */
const ROUTES: [string, string, unknown][] = [
  ['POST', '/api/game', { roomTitle: '2학년 3반', setName: '유전', teamCount: 6 }],
  ['GET', '/api/admin/questions', undefined],
  ['GET', '/api/admin/questions?set=유전', undefined],
  ['POST', '/api/admin/questions', { setName: '유전', level: '쉬움', text: 'ㅁ', choices: ['1', '2', '3', '4'], answer: 1 }],
  ['PUT', '/api/admin/questions/1', { setName: '유전', level: '쉬움', text: 'ㅁ', choices: ['1', '2', '3', '4'], answer: 1 }],
  ['DELETE', '/api/admin/questions/1', undefined],
  ['GET', '/api/admin/animals', undefined],
  ['PUT', '/api/admin/animals', { animals: ANIMAL_CODES.map((c) => ({ code: c, name: '가', emoji: '🐎' })) }],
  ['GET', '/api/admin/settings', undefined],
  ['PUT', '/api/admin/settings', { settings: { quizSeconds: 90 } }],
  ['GET', '/api/admin/summary', undefined],
  // ── 2단계에서 더한 것 ──
  ['GET', '/api/admin/export', undefined],
  ['GET', '/api/admin/export?set=유전', undefined],
  ['POST', '/api/admin/import/preview', { json: { title: 'X', questions: [] } }],
  ['POST', '/api/admin/import', { json: { title: 'X', questions: [] }, mode: 'replaceAll' }],
  ['PUT', '/api/admin/sets/유전', { name: '바뀐이름' }],
  ['DELETE', '/api/admin/sets/유전', undefined]
];

const q = (over: Record<string, unknown> = {}) => ({
  setName: '유전', level: '보통', text: '새로 넣은 문제',
  choices: ['보기1', '보기2', '보기3', '보기4'], answer: 3, explanation: '새 해설',
  ...over
});

// ────────────────────────────────────────────────────────────
// JSON 파일 만들기 (RENEWAL §3-2)
// ────────────────────────────────────────────────────────────

interface Item { difficulty: string; question: string; choices: string[]; answer: number; explanation?: string }

/** 난이도별 `per` 개씩 든 정상 파일 */
function file(title: string, per = 10): { title: string; questions: Item[] } {
  const questions: Item[] = [];
  for (const d of DIFFICULTIES) {
    for (let i = 1; i <= per; i++) {
      questions.push({
        difficulty: d, question: `${title} ${d} ${i}`,
        choices: ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ'], answer: (i % 4) + 1, explanation: `${d} 해설`
      });
    }
  }
  return { title, questions };
}

const preview = (net: Net, json: unknown, setName?: string) =>
  net.call('POST', '/api/admin/import/preview', { headers: admin(PW), body: { json, ...(setName ? { setName } : {}) } });

const doImport = (net: Net, json: unknown, mode: string, setName?: string) =>
  net.call('POST', '/api/admin/import', { headers: admin(PW), body: { json, mode, ...(setName ? { setName } : {}) } });

interface Summary {
  title: string; total: number; byDifficulty: Record<string, number>;
  errors: { index: number; reason: string }[]; existingSet: boolean;
}

/** 그 세트에 지금 몇 문항이 있는가 (게이트가 D1 대신 MemDb 를 직접 센다) */
const countIn = (net: Net, setName: string) => net.db.questions.filter((x) => x.set_name === setName).length;

// ════════════════════════════════════════════════════════════

await gate('ADM1', '비밀번호 없이는 관리자 경로가 하나도 안 열린다', async () => {
  const net = new Net();
  const bad: string[] = [];
  // ⚠️ 거절만 확인하고 끝내면 "거절은 했는데 그전에 이미 지웠다"를 못 잡는다.
  //    두드리기 전의 문제은행을 적어 두고 뒤에서 대조한다
  const before = net.db.questions.length;

  for (const [m, p, body] of ROUTES) {
    // 1) 헤더 없음  2) 틀린 값  3) 길이가 다른 값 (길이로 힌트를 주면 안 된다)
    const none = await net.call(m, p, { body });
    const wrong = await net.call(m, p, { body, headers: admin('아무거나') });
    const shortPw = await net.call(m, p, { body, headers: admin('s') });
    for (const [label, res] of [['없음', none], ['틀림', wrong], ['짧음', shortPw]] as const) {
      if (errOf(res) !== 'ADMIN_DENIED') bad.push(`${m} ${p} (${label}) → ${errOf(res)}`);
      // ⚠️ 내보내기는 봉투가 아닌 **파일**로도 나갈 수 있는 유일한 라우트다.
      //    거절인데 raw 가 붙어 있으면 그 파일이 인증 밖으로 나간 것이다 (EXP2)
      if (res.raw) bad.push(`${m} ${p} (${label}) 에 파일이 딸려 나옴`);
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
  const list = async (setName = '유전') =>
    dataOf(await net.call('GET', `/api/admin/questions?set=${encodeURIComponent(setName)}`, { headers: admin(PW) }))
      .questions as AdminQuestion[];
  const before = (await list()).length;

  // 추가
  const add = await net.call('POST', '/api/admin/questions', { headers: admin(PW), body: q() });
  const made = dataOf(add).question as AdminQuestion;

  // 목록에 있다 (정답·해설까지 함께 — 관리 화면은 그걸 고쳐야 한다)
  const list1 = await list();
  const found = list1.find((x) => x.id === made.id);

  // 수정
  const put = await net.call('PUT', `/api/admin/questions/${made.id}`, {
    headers: admin(PW), body: q({ text: '고친 문제', answer: 2, level: '어려움', explanation: '고친 해설' })
  });
  const fixed = (await list()).find((x) => x.id === made.id);

  // 없는 id 는 NOT_FOUND
  const ghost = await net.call('PUT', '/api/admin/questions/999999', { headers: admin(PW), body: q() });
  const ghostDel = await net.call('DELETE', '/api/admin/questions/999999', { headers: admin(PW) });

  // 삭제
  const del = await net.call('DELETE', `/api/admin/questions/${made.id}`, { headers: admin(PW) });
  const list3 = await list();

  // set 없이 부르면 전부 + 세트 이름 목록이 함께 온다
  const allRes = dataOf(await net.call('GET', '/api/admin/questions', { headers: admin(PW) }));
  const all = allRes.questions as AdminQuestion[];
  const sets = allRes.sets as string[];

  return {
    ok: add.body.ok && !!made.id && !!found &&
        found.text === '새로 넣은 문제' && found.answer === 3 && found.explanation === '새 해설' &&
        found.setName === '유전' &&
        found.choices.join('/') === '보기1/보기2/보기3/보기4' &&
        put.body.ok && !!fixed && fixed.text === '고친 문제' && fixed.answer === 2 && fixed.level === '어려움' &&
        errOf(ghost) === 'NOT_FOUND' && errOf(ghostDel) === 'NOT_FOUND' && ghost.status === 404 &&
        del.body.ok && !list3.some((x) => x.id === made.id) &&
        list1.length === before + 1 && list3.length === before &&
        all.length > list3.length && sets.join(',') === '유전,항상성',
    detail: `추가 ${made.id}번 (${before}→${list1.length}줄) · 수정 "${fixed?.text}" 정답 ${fixed?.answer} ${fixed?.level} · ` +
            `없는 id ${errOf(ghost)}/${errOf(ghostDel)} · 삭제 후 ${list3.length}줄 · set 없이는 ${all.length}줄 전부 (세트 ${sets.join('·')})`
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
    ['빈 세트', q({ setName: '' }), '문제 세트를 골라주세요']
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
    // 상한 26 → 23 (2026-09-07). 1위 골인이 8R 로 고정돼 24칸 이상은 판이 안 만들어진다
    ['trackCells 99', { settings: { trackCells: 99 } }, '5~23'],
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

await gate('ADM6', `summary — 세트별 × 난이도별 개수와 ${LIMITS.minQuestionsPerLevel}문항 미만 경고`, async () => {
  const net = new Net();
  interface SetRow {
    setName: string; counts: Record<string, number>; total: number; blocking: string[]; warnings: string[];
  }
  const read = async () => dataOf(await net.call('GET', '/api/admin/summary', { headers: admin(PW) }));

  const d1 = await read();
  const rows1 = d1.sets as SetRow[];
  const 유전 = rows1.find((r) => r.setName === '유전')!;
  const 항상성 = rows1.find((r) => r.setName === '항상성')!;

  // 한 문항을 지우면 그 난이도 칸만 9가 된다 (화면은 이 숫자를 노란색으로 칠한다)
  await net.call('DELETE', '/api/admin/questions/1', { headers: admin(PW) });
  const rows2 = (await read()).sets as SetRow[];
  const 유전2 = rows2.find((r) => r.setName === '유전')!;

  // ⚠️ **문항 수 부족은 문장으로 반복하지 않는다.** 표의 숫자와 minPerLevel 이 이미
  //    말하고 있어서, 문장으로 또 쓰면 세트마다 세 줄씩 쌓여 진짜 읽어야 할 줄이 묻힌다.
  //    (판을 만들 때의 경고 문장은 그대로다 — WARN10 이 본다)
  const noShortageNoise = rows2.every((r) => r.warnings.every((w) => w.indexOf('문항.') < 0));

  // 하지만 **못 읽는 줄**은 반드시 보여야 한다. 표의 숫자만으로는 알 수 없다 —
  // 합계가 왜 하나 모자란지 화면에 설명이 없으면 선생님은 유령을 쫓게 된다
  net.db.questions.push({
    id: 9001, set_name: '유전', level: '중간', text: '옛 난이도로 적힌 문항',
    choice1: 'ㄱ', choice2: 'ㄴ', choice3: 'ㄷ', choice4: 'ㄹ', answer: 1, explanation: ''
  });
  const 유전3 = ((await read()).sets as SetRow[]).find((r) => r.setName === '유전')!;
  const tellsSkipped = 유전3.warnings.some((w) => w.includes('9001') && w.includes('난이도'));

  // 동물이 망가지면 **세트 줄이 아니라 동물 칸**에 차단이 뜬다 (같은 줄이 세트마다 반복되면 안 된다)
  net.db.animals.pop();
  const d3 = await read();
  const animals3 = d3.animals as { blocking: string[]; animals: unknown[]; codes: string[] };
  const noRepeat = (d3.sets as SetRow[]).every((r) => r.blocking.length === 0);

  const MIN = LIMITS.minQuestionsPerLevel;
  return {
    ok: 유전.total === 30 && LEVELS.every((lv) => 유전.counts[lv] === 10) && 유전.warnings.length === 0 &&
        항상성.counts['어려움'] === 3 && 항상성.warnings.length === 0 &&
        유전2.counts['쉬움'] === 9 && noShortageNoise && tellsSkipped &&
        // 못 읽는 줄은 합계에도 안 들어간다 (넣으면 "30개인데 27개만 나온다" 가 된다)
        유전3.total === 29 &&
        d1.minPerLevel === MIN && MIN === ROUNDS &&
        (d1.levels as string[]).join('') === LEVELS.join('') &&
        animals3.blocking.length === 1 && animals3.blocking[0]!.includes('7줄') &&
        animals3.codes.join('') === ANIMAL_CODES.join('') && noRepeat,
    detail: `유전 ${LEVELS.map((lv) => 유전.counts[lv]).join('/')} · 항상성 어려움 ${항상성.counts['어려움']} · ` +
            `1문항 지우니 쉬움 ${유전2.counts['쉬움']} (기준 ${MIN} = 라운드 수 ${ROUNDS} — 색은 화면이 칠한다) · ` +
            `부족은 문장으로 반복 안 함 ${noShortageNoise} · 못 읽는 줄은 알림 "${유전3.warnings[0]}" (합계 ${유전3.total}) · ` +
            `동물 7줄이면 동물 칸에만 차단 (세트 줄에는 반복 안 됨 ${noRepeat})`
  };
});

// ════════════════════════════════════════════════════════════
// JSON 가져오기 (RENEWAL §3-2)
// ════════════════════════════════════════════════════════════

await gate('IMP1', '가져오기 미리보기 — 정상 30문항의 개수가 정확하고 오류가 없다', async () => {
  const net = new Net();
  const before = net.db.questions.length;

  const res = await preview(net, file('세포와 물질대사', 10));
  const s = dataOf(res) as unknown as Summary;

  // ⚠️ 미리보기는 **아무것도 저장하지 않는다.** 저장하면 선생님이 '취소'를 눌러도
  //    이미 들어가 있고, 되돌릴 방법이 화면에 없다
  const untouched = net.db.questions.length === before;

  // 이미 있는 세트 이름이면 '같은 이름 세트 교체' 버튼이 뜻을 갖는다
  const exists = dataOf(await preview(net, file('유전', 3))) as unknown as Summary;

  return {
    ok: res.body.ok && s.title === '세포와 물질대사' && s.total === 30 &&
        DIFFICULTIES.every((d) => s.byDifficulty[d] === 10) &&
        s.errors.length === 0 && s.existingSet === false &&
        exists.existingSet === true && exists.total === 9 && untouched,
    detail: `"${s.title}" 총 ${s.total} (${DIFFICULTIES.map((d) => `${d} ${s.byDifficulty[d]}`).join('·')}) · 오류 ${s.errors.length}건 · ` +
            `없는 세트 existingSet=${s.existingSet}, 있는 세트('유전') existingSet=${exists.existingSet} · 저장 0건 ${untouched}`
  };
});

await gate('IMP2', '가져오기 미리보기 — 잘못된 문항은 이유와 함께 걸러진다', async () => {
  const net = new Net();
  const good = file('섞인 파일', 2).questions;      // 6개 정상

  const broken: unknown[] = [
    { difficulty: 'easy', question: '보기가 셋뿐', choices: ['ㄱ', 'ㄴ', 'ㄷ'], answer: 1 },
    { difficulty: 'easy', question: '정답이 5', choices: ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ'], answer: 5 },
    { difficulty: 'eesy', question: '난이도 오타', choices: ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ'], answer: 1 },
    { type: 'ox', difficulty: 'easy', question: 'OX 문항', choices: ['O', 'X'], answer: 1 },
    { difficulty: 'hard', question: '   ', choices: ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ'], answer: 2 },
    { difficulty: 'hard', question: '보기 두 칸이 빈 문항', choices: ['ㄱ', '', 'ㄷ', ''], answer: 1 }
  ];
  const s = dataOf(await preview(net, { title: '섞인 파일', questions: [...good, ...broken] })) as unknown as Summary;

  const reason = (i: number) => s.errors.find((e) => e.index === i)?.reason ?? '(없음)';
  const bad: string[] = [];
  const want: [number, string][] = [
    [6, '보기는 4개여야 해요 (지금 3개)'],
    [7, '정답은 1~4'],
    [8, '난이도는 easy·medium·hard'],
    [9, '객관식만 지원해요'],
    [10, '문제가 비어 있어요'],
    [11, '보기 2개가 비어 있어요']
  ];
  for (const [i, must] of want) if (reason(i).indexOf(must) < 0) bad.push(`${i}번째 → "${reason(i)}"`);

  // ⚠️ `total` 은 **유효한 것만** 센다. 파일의 줄 수를 세면 화면의 요약 카드가
  //    "총 12문항" 이라고 하고 실제로는 6개만 들어간다
  const counted = s.total === 6 && DIFFICULTIES.every((d) => s.byDifficulty[d] === 2);

  // 파일 자체가 형식이 아니면 통째로 거절한다 (문항별 오류가 아니라)
  const notArray = await preview(net, { title: 'X', questions: '문항들' });
  const notObject = await preview(net, [1, 2, 3]);

  return {
    ok: bad.length === 0 && counted && s.errors.length === 6 &&
        errOf(notArray) === 'BAD_REQUEST' && (notArray.body.ok ? '' : notArray.body.message ?? '').includes("'questions'") &&
        errOf(notObject) === 'BAD_REQUEST',
    detail: bad.length ? '⛔ ' + bad.join(', ')
      : `유효 ${s.total} (${DIFFICULTIES.map((d) => s.byDifficulty[d]).join('/')}) · 오류 ${s.errors.length}건, 자리(index)도 정확\n` +
        `              예: ${s.errors[0]!.index + 1}번째 "${s.errors[0]!.reason}" / ${s.errors[3]!.index + 1}번째 "${s.errors[3]!.reason}" · ` +
        `questions 가 배열이 아니면 통째로 ${errOf(notArray)}`
  };
});

await gate('IMP3', '가져오기 — append · replaceSet · replaceAll 이 각각 맞게 동작한다', async () => {
  const bad: string[] = [];

  // ── 1) append: 아무것도 지우지 않는다 ──
  const a = new Net();
  const beforeA = a.db.questions.length;
  const r1 = dataOf(await doImport(a, file('새 세트', 4), 'append'));
  if (r1.inserted !== 12 || r1.setName !== '새 세트') bad.push(`append 결과 ${JSON.stringify(r1.inserted)}`);
  if (a.db.questions.length !== beforeA + 12) bad.push('append 가 개수를 안 늘렸다');
  if (countIn(a, '유전') !== 30 || countIn(a, '항상성') !== 23) bad.push('append 가 다른 세트를 건드렸다');

  // 같은 이름으로 한 번 더 append 하면 **쌓인다** (교체가 아니다)
  await doImport(a, file('새 세트', 4), 'append');
  if (countIn(a, '새 세트') !== 24) bad.push(`append 두 번 → ${countIn(a, '새 세트')}문항`);

  // ── 2) replaceSet: 같은 이름만 지우고 넣는다 ──
  const b = new Net();
  const r2 = dataOf(await doImport(b, file('유전', 2), 'replaceSet'));
  if (r2.inserted !== 6) bad.push(`replaceSet inserted=${String(r2.inserted)}`);
  if (countIn(b, '유전') !== 6) bad.push(`replaceSet 뒤 유전 ${countIn(b, '유전')}문항 (6이어야)`);
  if (countIn(b, '항상성') !== 23) bad.push(`replaceSet 이 항상성을 건드렸다 (${countIn(b, '항상성')})`);

  // 세트 이름을 따로 주면 파일의 title 보다 그쪽이 이긴다
  const c = new Net();
  await doImport(c, file('아무 제목', 2), 'replaceSet', '항상성');
  if (countIn(c, '항상성') !== 6 || countIn(c, '유전') !== 30) bad.push('setName 이 title 을 못 이겼다');
  if (countIn(c, '아무 제목') !== 0) bad.push('title 이름으로도 들어갔다');

  // ── 3) replaceAll: 통째로 ──
  const d = new Net();
  const r3 = dataOf(await doImport(d, file('오직 이것', 3), 'replaceAll'));
  if (r3.inserted !== 9) bad.push(`replaceAll inserted=${String(r3.inserted)}`);
  if (d.db.questions.length !== 9 || countIn(d, '오직 이것') !== 9) bad.push('replaceAll 이 통째로 안 바꿨다');

  // ⚠️ **이미 있는 이름으로** replaceAll 하는 경우도 본다. 새 이름으로만 검사하면
  //    "그 세트만 남기고 지운다"(= replaceSet 과 같은 것)로 잘못 구현해도 통과한다
  const d2 = new Net();
  await doImport(d2, file('유전', 3), 'replaceAll');
  if (d2.db.questions.length !== 9) bad.push(`이미 있는 이름 replaceAll → ${d2.db.questions.length}문항 (9여야)`);
  if (countIn(d2, '항상성') !== 0) bad.push(`replaceAll 인데 항상성이 ${countIn(d2, '항상성')}문항 남았다`);
  if (countIn(d2, '유전') !== 9) bad.push(`replaceAll 뒤 유전 ${countIn(d2, '유전')}문항`);

  // ── 4) 유효한 것이 하나도 없으면 **아무것도 바꾸지 않는다** ──
  //    ⚠️ 이걸 막지 않으면 replaceAll 이 문제은행을 비우고 끝난다
  const e = new Net();
  const beforeE = e.db.questions.length;
  const empty = await doImport(e, { title: '깨진 파일', questions: [{ difficulty: 'nope', question: '' }] }, 'replaceAll');
  if (errOf(empty) !== 'BAD_REQUEST') bad.push(`빈 가져오기 → ${errOf(empty)}`);
  if (e.db.questions.length !== beforeE) bad.push('⛔ 빈 가져오기가 문제은행을 비웠다');

  // ── 5) 모르는 방식은 거절 ──
  const f = new Net();
  const wrongMode = await doImport(f, file('X', 1), 'replace');
  if (errOf(wrongMode) !== 'BAD_REQUEST') bad.push(`모르는 mode → ${errOf(wrongMode)}`);
  if (f.db.questions.length !== 53) bad.push('모르는 mode 인데 뭔가 들어갔다');

  // ── 6) 오류가 섞여 있어도 **유효한 것만** 들어간다 ──
  const g = new Net();
  const mixed = file('섞임', 2);
  (mixed.questions as unknown[]).push({ difficulty: 'easy', question: '깨진 것', choices: ['ㄱ'], answer: 1 });
  const r6 = dataOf(await doImport(g, mixed, 'append'));
  if (r6.inserted !== 6 || r6.skipped !== 1) bad.push(`섞인 파일 inserted=${String(r6.inserted)} skipped=${String(r6.skipped)}`);
  if (countIn(g, '섞임') !== 6) bad.push('섞인 파일에서 깨진 줄도 들어갔다');

  return {
    ok: bad.length === 0,
    detail: bad.length ? '⛔ ' + bad.join(', ')
      : `append: 유전 30·항상성 23 그대로 + 새 세트 12 (두 번 넣으면 24) · ` +
        `replaceSet: 유전 30→6, 항상성 23 그대로 · replaceAll: 은행 전체 9 · ` +
        `유효 0건이면 BAD_REQUEST 로 막고 은행 그대로 · 섞인 파일은 6 넣고 1 건너뜀`
  };
});

await gate('IMP4', "가져오기 — 한국어 난이도('쉬움·보통·어려움')로 적은 파일도 받는다", async () => {
  const net = new Net();
  const questions = LEVELS.map((lv, i) => ({
    difficulty: lv, question: `한국어 ${lv}`, choices: ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ'], answer: i + 1
  }));
  const s = dataOf(await preview(net, { title: '한국어 세트', questions })) as unknown as Summary;

  await doImport(net, { title: '한국어 세트', questions }, 'append');
  const saved = net.db.questions.filter((x) => x.set_name === '한국어 세트');
  // 저장된 난이도는 **한국어(LEVELS)** 여야 한다 — 영어로 들어가면 판을 만들 때
  // 통째로 '난이도가 …가 아님' 으로 걸러진다 (bank.ts toQuestion)
  const levelsOk = LEVELS.every((lv) => saved.some((x) => x.level === lv));

  return {
    ok: s.total === 3 && s.errors.length === 0 &&
        DIFFICULTIES.every((d) => s.byDifficulty[d] === 1) &&
        saved.length === 3 && levelsOk,
    detail: `한국어 3문항 → 오류 0 · ${DIFFICULTIES.map((d) => `${d} ${s.byDifficulty[d]}`).join('·')} · ` +
            `D1 에는 ${saved.map((x) => x.level).join('/')} 로 저장`
  };
});

// ════════════════════════════════════════════════════════════
// JSON 내보내기
// ════════════════════════════════════════════════════════════

await gate('EXP1', '내보내기 — 형식이 §3-2 이고, 다시 가져오면 같은 개수가 돌아온다', async () => {
  const net = new Net();
  const res = await net.call('GET', '/api/admin/export?set=유전', { headers: admin(PW) });
  const bad: string[] = [];

  if (!res.raw) return { ok: false, detail: '⛔ 파일이 안 나왔다 (봉투로 나갔다)' };
  const h = res.raw.headers;
  if ((h['content-type'] ?? '').indexOf('application/json') < 0) bad.push(`content-type=${String(h['content-type'])}`);
  // 한글 파일 이름은 RFC 5987 로 실어야 한다 — `filename=` 만으로는 깨진다
  const cd = h['content-disposition'] ?? '';
  if (cd.indexOf("filename*=UTF-8''") < 0) bad.push(`content-disposition=${cd}`);
  const name = decodeURIComponent(cd.replace(/^.*filename\*=UTF-8''/, ''));
  if (!/^애니멀더비_유전_\d{4}-\d{2}-\d{2}\.json$/.test(name)) bad.push(`파일 이름 "${name}"`);

  const parsed = JSON.parse(res.raw.body) as { title: string; questions: Record<string, unknown>[] };
  if (parsed.title !== '유전') bad.push(`title=${parsed.title}`);
  if (parsed.questions.length !== 30) bad.push(`문항 ${parsed.questions.length}개`);
  const first = parsed.questions[0]!;
  if (first.id !== 'q001') bad.push(`id=${String(first.id)}`);
  if ((DIFFICULTIES as readonly string[]).indexOf(String(first.difficulty)) < 0) bad.push(`difficulty=${String(first.difficulty)}`);
  for (const k of ['id', 'difficulty', 'question', 'choices', 'answer', 'explanation']) {
    if (!(k in first)) bad.push(`'${k}' 칸이 없다`);
  }
  if (!Array.isArray(first.choices) || (first.choices as unknown[]).length !== 4) bad.push('choices 가 4개가 아니다');
  // 난이도별 개수가 그대로다
  const byDiff = DIFFICULTIES.map((d) => parsed.questions.filter((x) => x.difficulty === d).length);
  if (byDiff.join('/') !== '10/10/10') bad.push(`난이도별 ${byDiff.join('/')}`);

  // ── 왕복: 내보낸 파일을 그대로 다시 가져오면 같은 개수 ──
  const back = dataOf(await doImport(net, parsed, 'replaceSet'));
  if (back.inserted !== 30 || back.skipped !== 0) bad.push(`왕복 inserted=${String(back.inserted)} skipped=${String(back.skipped)}`);
  if (countIn(net, '유전') !== 30) bad.push(`왕복 뒤 유전 ${countIn(net, '유전')}문항`);
  // 문항 내용도 살아 있다 (id 만 새로 매겨진다)
  const one = net.db.questions.find((x) => x.set_name === '유전' && x.text === String(first.question));
  if (!one || one.answer !== Number(first.answer)) bad.push('왕복 뒤 문항 내용이 달라졌다');

  // ── 세트를 안 고르면 은행 전체가 '(전체)' 라는 제목으로 나간다 ──
  const all = await net.call('GET', '/api/admin/export', { headers: admin(PW) });
  const allParsed = JSON.parse(all.raw!.body) as { title: string; questions: unknown[] };
  if (allParsed.title !== '(전체)' || allParsed.questions.length !== 53) {
    bad.push(`전체 내보내기 "${allParsed.title}" ${allParsed.questions.length}문항`);
  }

  return {
    ok: bad.length === 0,
    detail: bad.length ? '⛔ ' + bad.join(', ')
      : `"${name}" · title="${parsed.title}" ${parsed.questions.length}문항 (${byDiff.join('/')}), id=q001 · ` +
        `왕복 후 유전 ${countIn(net, '유전')}문항 그대로 · 세트 없이는 "(전체)" ${allParsed.questions.length}문항`
  };
});

await gate('EXP2', '내보내기는 관리자 밖으로 나가지 않는다 (그 파일에 정답이 다 들어 있다)', async () => {
  const net = new Net();
  // 정답과 해설에 표식을 박는다 — 문자열이 새는지도 본다
  const MARK = '☠️내보내기표식☠️';
  const list = dataOf(await net.call('GET', '/api/admin/questions?set=유전', { headers: admin(PW) })).questions as AdminQuestion[];
  await net.call('PUT', `/api/admin/questions/${list[0]!.id}`, {
    headers: admin(PW), body: { ...list[0]!, explanation: MARK }
  });

  const bad: string[] = [];
  const tries: [string, ApiResponse][] = [
    ['헤더 없음', await net.call('GET', '/api/admin/export?set=유전')],
    ['틀린 비밀번호', await net.call('GET', '/api/admin/export?set=유전', { headers: admin('아무거나') })],
    // ⚠️ 물음표 뒤로 비밀번호를 받으면 `<a href>` 로 받을 수 있게 되고, 그 주소가
    //    기록·어깨너머로 남는다 (MIGRATION §8-1b). 그래서 query 로는 절대 안 받는다
    ['물음표 뒤 비밀번호', await net.call('GET', `/api/admin/export?set=유전&password=${PW}`)],
    ['물음표 뒤 헤더 이름', await net.call('GET', `/api/admin/export?X-Admin-Password=${PW}`)]
  ];
  for (const [label, res] of tries) {
    if (errOf(res) !== 'ADMIN_DENIED') bad.push(`${label} → ${errOf(res)}`);
    if (res.raw) bad.push(`${label} 에 파일이 딸려 나왔다`);
    if (JSON.stringify(res.body).includes(MARK)) bad.push(`${label} 응답에 해설 문자열`);
  }
  // secret 미설정이면 맞는 값을 줘도 안 나간다
  const off = new Net();
  off.adminPassword = undefined;
  const disabled = await off.call('GET', '/api/admin/export?set=유전', { headers: admin(PW) });
  if (errOf(disabled) !== 'ADMIN_DISABLED' || disabled.raw) bad.push(`미설정 → ${errOf(disabled)}`);

  // 그리고 맞는 비밀번호로는 나간다 (전부 막고 끝나면 내보내기가 없는 것과 같다)
  const okRes = await net.call('GET', '/api/admin/export?set=유전', { headers: admin(PW) });
  const carries = !!okRes.raw && okRes.raw.body.includes(MARK);

  return {
    ok: bad.length === 0 && carries,
    detail: bad.length ? '⛔ ' + bad.join(', ')
      : `${tries.length}가지 전부 ADMIN_DENIED (파일 0건) · 미설정이면 ADMIN_DISABLED · ` +
        `맞는 비밀번호로는 해설까지 담겨 나옴 ${carries}`
  };
});

// ════════════════════════════════════════════════════════════
// 문제 세트
// ════════════════════════════════════════════════════════════

await gate('SET1', '세트 목록 — /api/sets · /api/units, 이름 바꾸기·삭제가 곧바로 반영된다', async () => {
  const net = new Net();
  const bad: string[] = [];

  const sets = async () => dataOf(await net.call('GET', '/api/sets')).sets as SetInfo[];
  const units = async () => dataOf(await net.call('GET', '/api/units')).units as string[];

  const s0 = await sets();
  if (s0.map((s) => s.name).join(',') !== '유전,항상성') bad.push(`목록 ${s0.map((s) => s.name).join(',')}`);
  if (s0[0]!.total !== 30 || s0[0]!.byLevel['쉬움'] !== 10) bad.push('개수가 안 맞는다');
  if (s0[1]!.byLevel['어려움'] !== 3) bad.push('항상성 어려움 개수');
  // ⚠️ 인증 없이 나가는 응답이다 — 문제도 정답도 들어 있으면 안 된다
  for (const k of ['text', 'question', 'answer', 'explanation', 'choices']) {
    if (allKeys(s0).has(k)) bad.push(`/api/sets 에 '${k}' 가 있다`);
  }
  // 두 라우트가 같은 것을 본다 (교사 화면은 아직 /api/units 를 쓴다)
  if ((await units()).join(',') !== s0.map((s) => s.name).join(',')) bad.push('/api/units 와 /api/sets 가 다르다');

  // ── 이름 바꾸기 ──
  const ren = await net.call('PUT', '/api/admin/sets/' + encodeURIComponent('유전'), {
    headers: admin(PW), body: { name: '유전과 진화' }
  });
  if (!ren.body.ok || dataOf(ren).affected !== 30) bad.push(`이름 바꾸기 affected=${String(dataOf(ren).affected)}`);
  if ((await units()).join(',') !== '유전과 진화,항상성') bad.push(`바꾼 뒤 ${(await units()).join(',')}`);
  if (countIn(net, '유전과 진화') !== 30) bad.push('문항이 안 따라왔다');

  // 없는 세트·빈 이름·이미 있는 이름은 거절
  const ghost = await net.call('PUT', '/api/admin/sets/' + encodeURIComponent('없는세트'), { headers: admin(PW), body: { name: 'X' } });
  const blank = await net.call('PUT', '/api/admin/sets/' + encodeURIComponent('항상성'), { headers: admin(PW), body: { name: '  ' } });
  const dup = await net.call('PUT', '/api/admin/sets/' + encodeURIComponent('항상성'), { headers: admin(PW), body: { name: '유전과 진화' } });
  if (errOf(ghost) !== 'NOT_FOUND') bad.push(`없는 세트 → ${errOf(ghost)}`);
  if (errOf(blank) !== 'BAD_REQUEST') bad.push(`빈 이름 → ${errOf(blank)}`);
  // ⚠️ 이미 있는 이름으로 바꾸면 두 세트가 조용히 합쳐진다. 되돌릴 수 없어서 막는다
  if (errOf(dup) !== 'BAD_REQUEST') bad.push(`중복 이름 → ${errOf(dup)}`);
  if (countIn(net, '항상성') !== 23) bad.push('거절인데 항상성이 바뀌었다');

  // ── 삭제 ──
  const del = await net.call('DELETE', '/api/admin/sets/' + encodeURIComponent('항상성'), { headers: admin(PW) });
  if (!del.body.ok || dataOf(del).affected !== 23) bad.push(`삭제 affected=${String(dataOf(del).affected)}`);
  if ((await units()).join(',') !== '유전과 진화') bad.push(`삭제 뒤 ${(await units()).join(',')}`);
  if (countIn(net, '유전과 진화') !== 30) bad.push('삭제가 다른 세트를 건드렸다');
  const delGhost = await net.call('DELETE', '/api/admin/sets/' + encodeURIComponent('항상성'), { headers: admin(PW) });
  if (errOf(delGhost) !== 'NOT_FOUND') bad.push(`두 번째 삭제 → ${errOf(delGhost)}`);

  return {
    ok: bad.length === 0,
    detail: bad.length ? '⛔ ' + bad.join(', ')
      : `유전 30(10/10/10)·항상성 23(10/10/3) · /api/units 와 같은 목록 · 이름 바꾸기 30문항 따라옴 · ` +
        `없는 세트 NOT_FOUND, 빈·중복 이름 BAD_REQUEST · 삭제 23문항, 남은 세트 그대로`
  };
});

await gate('SET2', '세트를 안 고르면 **전체 은행**으로 판이 만들어진다', async () => {
  const net = new Net();
  // ⚠️ '유전'의 어려움을 전부 지운다. 이제 어려움 문항은 '항상성' 에만 있으므로,
  //    전체 은행으로 만든 판에는 반드시 항상성 문항이 섞인다 — 무작위에 기대지 않는 검사다
  net.db.questions = net.db.questions.filter((x) => !(x.set_name === '유전' && x.level === '어려움'));

  const whole = await open(net, null, 2);
  const st = net.state(whole.code);
  const used = Object.values(st.questionById);
  const fromBoth = used.some((x) => x.setName === '유전') && used.some((x) => x.setName === '항상성');

  // 세트 하나로 만든 판에는 그 세트 문항만 있다 (전체가 기본값이 되어 버리면 안 된다)
  const only = await open(net, '항상성', 2);
  const onlyOne = Object.values(net.state(only.code).questionById).every((x) => x.setName === '항상성');

  // 상태의 setName 은 null 이고, '이어하기' 목록에는 '(전체)' 로 적힌다
  const row = net.db.games.find((g) => g.code === whole.code)!;
  // 빈 문자열을 보내도 같다 (교사 화면의 '— 전체 —' 옵션 값이 빈 문자열이다)
  const blank = await net.call('POST', '/api/game', {
    headers: admin(PW), body: { roomTitle: '빈칸 반', setName: '', teamCount: 2 }
  });
  const blankState = net.state(String(dataOf(blank).code));

  return {
    ok: fromBoth && onlyOne && st.setName === null && row.unit === '(전체)' &&
        blank.body.ok && blankState.setName === null,
    detail: `전체 은행 판: 배정 ${used.length}문항이 두 세트에서 옴 ${fromBoth} (유전에는 어려움이 없다) · ` +
            `상태 setName=${String(st.setName)} · '이어하기' 표에는 "${row.unit}" · ` +
            `세트 하나로 만들면 그 세트만 ${onlyOne} · 빈 문자열도 전체 ${blankState.setName === null}`
  };
});

await gate('WARN10', `난이도별 ${LIMITS.minQuestionsPerLevel}문항 미만인 세트로 판을 만들면 재사용 경고가 온다`, async () => {
  const net = new Net();
  const MIN = LIMITS.minQuestionsPerLevel;

  /**
   * 난이도별 **9문항** — 10라운드를 채우려면 한 문제를 다시 내야 하는 세트.
   *
   * ⚠️ 9 를 `MIN - 1` 로 쓰지 않는다. 그러면 기준을 6 으로 되돌려도 이 게이트가
   *    5/6 을 검사하며 초록불이 된다 — 게이트가 자기 자신을 근거로 삼는 꼴이다.
   *    9 인 이유는 **라운드가 10개**라서이고, 그게 이 경고가 존재하는 이유다.
   */
  const NINE = ROUNDS - 1;
  await doImport(net, file('아홉씩', NINE), 'append');

  const g = await open(net, '아홉씩', 2);
  const bad: string[] = [];
  if (g.warnings.length !== LEVELS.length) bad.push(`경고 ${g.warnings.length}건 (${LEVELS.length}이어야)`);
  for (const lv of LEVELS) {
    const hit = g.warnings.find((w) => w.includes(`${lv} ${NINE}/${MIN}문항`));
    if (!hit) bad.push(`'${lv}' 경고 없음`);
    else if (hit.indexOf('앞 라운드 문제를 다시 냅니다') < 0) bad.push(`'${lv}' 경고에 이유가 없다: ${hit}`);
    else if (hit.indexOf("'아홉씩'") < 0) bad.push(`'${lv}' 경고에 세트 이름이 없다: ${hit}`);
  }

  // 그리고 실제로 재사용이 일어난다 — 10라운드 중 한 난이도에 같은 문항이 두 번 나온다
  const plan = net.state(g.code).questionPlan;
  const easyIds = Array.from({ length: ROUNDS }, (_, i) => plan[i + 1]!['쉬움']);
  const reused = new Set(easyIds).size < easyIds.length;
  if (!reused) bad.push('경고는 나왔는데 재사용이 없다 (경고가 거짓말이다)');

  // 10문항짜리 세트는 경고가 없고 재사용도 없다
  const full = await open(net, '유전', 2);
  const fullIds = Array.from({ length: ROUNDS }, (_, i) => net.state(full.code).questionPlan[i + 1]!['쉬움']);
  if (full.warnings.length !== 0) bad.push(`10문항 세트인데 경고 ${full.warnings.length}건: ${full.warnings[0]}`);
  if (new Set(fullIds).size !== ROUNDS) bad.push('10문항인데 재사용이 있다');

  return {
    ok: bad.length === 0,
    detail: bad.length ? '⛔ ' + bad.join(', ')
      : `9문항 세트 → 경고 ${g.warnings.length}건 ("${g.warnings[0]}") · 쉬움 ${ROUNDS}라운드에 문항 ${new Set(easyIds).size}종(재사용 있음) · ` +
        `${MIN}문항 세트는 경고 0건, ${ROUNDS}라운드 ${new Set(fullIds).size}종(재사용 없음)`
  };
});

// ════════════════════════════════════════════════════════════
// 정답이 관리자 밖으로 나가지 않는다 (§4-1)
// ════════════════════════════════════════════════════════════

await gate('LEAK-ADMIN', '관리자 라우트 밖 어떤 응답에도 answer·explanation 이 없다', async () => {
  const net = new Net();

  // 정답과 해설에 눈에 띄는 표식을 박아 둔다 — 문자열이 새는지도 보기 위해
  const MARK = '☠️정답표식☠️';
  const list = dataOf(await net.call('GET', '/api/admin/questions?set=유전', { headers: admin(PW) })).questions as AdminQuestion[];
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
      // ⚠️ 2단계에서 생긴 공개 라우트다. 여기 없으면 세트 목록에 문항을 얹는 날 아무도 모른다
      ['sets', await net.call('GET', '/api/sets')],
      ['prepare', await net.call('GET', '/api/prepare?set=유전')],
      ['prepare(옛 이름)', await net.call('GET', '/api/prepare?unit=유전')],
      ['prepare(전체)', await net.call('GET', '/api/prepare')],
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
      // 봉투가 아닌 파일이 딸려 나오는 공개 라우트는 하나도 없다
      if (res.raw) bad.push(`${label}/${name} 에 파일이 딸려 나옴`);
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
    (await net.call('GET', '/api/admin/questions?set=유전', { headers: admin(PW) })).body
  ).includes(MARK);
  // 내보내기 파일에도 들어 있다 (그래서 그 라우트가 관리자 뒤에 있는 것이다 — EXP2)
  const exportSees = (await net.call('GET', '/api/admin/export?set=유전', { headers: admin(PW) })).raw!.body.includes(MARK);

  return {
    ok: bad.length === 0 && adminSees && exportSees,
    detail: bad.length ? '⛔ ' + bad.join(', ')
      : `5개 단계 × 8개 공개 응답에서 answer·explanation 0건 · 관리자 목록 ${adminSees} · 내보내기 파일 ${exportSees}`
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
  const list = dataOf(await net.call('GET', '/api/admin/questions?set=유전', { headers: admin(PW) })).questions as AdminQuestion[];
  for (const x of list) {
    await net.call('PUT', `/api/admin/questions/${x.id}`, {
      headers: admin(PW), body: { ...x, text: '고침✏️ ' + x.text }
    });
  }
  // 세트 이름을 바꾸는 것도 도는 판을 건드리지 않는다
  await net.call('PUT', '/api/admin/sets/' + encodeURIComponent('유전'), { headers: admin(PW), body: { name: '유전(새)' } });

  // 1) 이미 만든 판은 그대로다 — 문항 내용이 상태에 굳어 있다 (questionById)
  const again = await net.call('POST', `/api/game/${g.code}/level`, {
    headers: pin(g.pins[1]!), body: { teamNo: 1, level: '쉬움' }
  });
  const stillOld = (dataOf(again).question as { text: string }).text;
  const stateClean = Object.values(net.state(g.code).questionById).every((x) => !x.text.startsWith('고침✏️'));
  const nameClean = net.state(g.code).setName === '유전';

  // 2) 새 판은 고친 문제로 만들어진다
  const g2 = await open(net, '유전(새)', 2);
  const fresh = Object.values(net.state(g2.code).questionById);
  const allNew = fresh.length > 0 && fresh.every((x) => x.text.startsWith('고침✏️'));

  return {
    ok: first.body.ok && oldText === stillOld && !oldText.startsWith('고침✏️') && stateClean && nameClean && allNew,
    detail: `이미 만든 판: "${stillOld}" (고치기 전 그대로, 배정 문항 ${Object.keys(net.state(g.code).questionById).length}개 전부, ` +
            `세트 이름도 "${net.state(g.code).setName}" 그대로) · 새 판: "${fresh[0]?.text}" (배정 ${fresh.length}개 전부 고친 문제)`
  };
});

done('문제은행 관리 게이트');
