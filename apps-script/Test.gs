/**
 * Test.gs — 앱스 스크립트 편집기에서 직접 돌리는 검사.
 * 코드를 고칠 때마다 test_모두()를 실행한다 (07-coding-convention §9).
 *
 * 같은 검사를 node에서도 돌린다: `node test/run-gates.js`
 * 게이트 정의: docs/planning/loop/08-derived-gates.md
 */

function test_모두() {
  var log = [], pass = 0, fail = 0;
  function t(id, title, fn) {
    var r;
    try { r = fn(); } catch (e) { r = { ok: false, detail: 'ERROR ' + e.message }; }
    log.push((r.ok ? 'PASS  ' : 'FAIL  ') + id + '  ' + title + '  —  ' + r.detail);
    r.ok ? pass++ : fail++;
  }

  var N = 100, races = [];
  for (var i = 0; i < N; i++) {
    var r = null, tries = 0;
    while (!r && tries++ < 20) r = planRace();
    if (!r) throw new Error('planRace 실패');
    races.push(r);
  }

  t('H1', '최종 도착 순서 = 정답 순위', function () {
    var hit = 0;
    races.forEach(function (r) {
      var order = rankByPosition(positionsAtRound(r.moves, r.lastRound), r.truth);
      if (order.join('') === r.truth.join('')) hit++;
    });
    return { ok: hit === N, detail: hit + '/' + N + ' 일치' };
  });

  t('H1b', '이동값 0~3 범위', function () {
    var bad = 0;
    races.forEach(function (r) {
      for (var c in r.moves) r.moves[c].forEach(function (m) { if (m < 0 || m > 3) bad++; });
    });
    return { ok: bad === 0, detail: '범위 밖 ' + bad + '개' };
  });

  t('H2', '모든 힌트가 참', function () {
    var bad = 0, n = 0;
    races.forEach(function (r) {
      var preds = buildHintPredicates(r.truth);
      for (var lv in preds) preds[lv].forEach(function (p) { n++; if (!p(r.truth)) bad++; });
    });
    return { ok: bad === 0, detail: n + '개 검사, 거짓 ' + bad + '개' };
  });

  t('H3-b', '어려움 6개로 1·2·3등 유일 결정', function () {
    var uniq = 0, sample = races.slice(0, 10);
    sample.forEach(function (r) {
      if (countTop3Candidates(buildHintPredicates(r.truth)['어려움'], 5) === 1) uniq++;
    });
    return { ok: uniq === sample.length, detail: uniq + '/' + sample.length };
  });

  t('H4', '모둠 응답에 정답 유출 없음', function () {
    var r = races[0], pool = {};
    ANIMAL_CODES.forEach(function (c) { pool[c] = DEFAULTS.seedCoins; });
    var state = {
      code: 'TEST', round: 3, phase: PHASES.BETTING, truth: r.truth, moves: r.moves,
      lastRound: r.lastRound, isOver: false, pool: pool, settings: DEFAULTS,
      animals: {}, emojis: {}, questionPlan: {},
      teams: [{ no: 1, name: 'A', pin: '1111', coins: 14, hints: [], answered: {}, bets: {}, betLocked: {} },
              { no: 2, name: 'B', pin: '2222', coins: 20, hints: [{ round: 1, level: '쉬움', text: '비밀힌트' }], answered: {}, bets: {}, betLocked: {} }]
    };
    var s = JSON.stringify(teamView(state, 1));
    var leaks = [];
    ['truth', 'moves', 'lastRound', '2222', '비밀힌트'].forEach(function (k) { if (s.indexOf(k) >= 0) leaks.push(k); });
    return { ok: leaks.length === 0, detail: leaks.length ? '유출: ' + leaks.join(',') : '유출 0건' };
  });

  t('H9', '정산 계산', function () {
    var order = ['C', 'A', 'F', 'B', 'H', 'D', 'G', 'E'];
    var odds = { C: 2, A: 2.14, F: 4, B: 5, H: 3, D: 3, G: 3, E: 3 };
    var out = settle([{ no: 1, name: 'A', coins: 8, bets: { 1: { A: 4 }, 2: { D: 2 } } }], order, odds, DEFAULTS);
    return { ok: out[0].gained === 6 && out[0].finalCoins === 14,
             detail: '획득 ' + out[0].gained + ' / 최종 ' + out[0].finalCoins };
  });

  t('D1', '3라운드까지 골인 0마리', function () {
    var bad = 0;
    races.forEach(function (r) {
      var pos = positionsAtRound(r.moves, 3);
      for (var c in pos) if (pos[c] >= DEFAULTS.trackCells) bad++;
    });
    return { ok: bad === 0, detail: bad + '마리' };
  });

  t('D2', '베팅 규칙을 서버가 막는다', function () {
    var st = DEFAULTS, base = { coins: 20, bets: {}, betLocked: {} };
    var a = validateBet(base, 1, { A: 4 }, st).error;
    var b = validateBet({ coins: 1, bets: {}, betLocked: {} }, 1, { A: 2 }, st).error;
    var c = validateBet({ coins: 20, bets: {}, betLocked: { 1: true } }, 1, { A: 1 }, st).error;
    return { ok: a === 'TOO_MANY_COINS' && b === 'NOT_ENOUGH_COINS' && c === 'ALREADY_BET',
             detail: [a, b, c].join(' / ') };
  });

  t('M6', '최대 배당률 16배 이하', function () {
    var pool = {};
    ANIMAL_CODES.forEach(function (c) { pool[c] = DEFAULTS.seedCoins; });
    pool.A += 108;
    var max = 0, o = computeOdds(pool);
    for (var c in o) if (o[c] > max) max = o[c];
    return { ok: max <= 16, detail: '최대 ' + max + '배' };
  });

  t('M7', '난이도별 힌트 6개 이상', function () {
    var h = buildHints(races[0].truth), sizes = [];
    var ok = true;
    for (var lv in h) { sizes.push(lv + ' ' + h[lv].length); if (h[lv].length < LIMITS.minHintsPerLevel) ok = false; }
    return { ok: ok, detail: sizes.join(' / ') };
  });

  log.push('');
  log.push('통과 ' + pass + ' / 실패 ' + fail);
  Logger.log(log.join('\n'));
  return { pass: pass, fail: fail, log: log };
}
