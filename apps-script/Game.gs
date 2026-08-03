/**
 * Game.gs — 게임 규칙 전부. **순수 함수만.**
 *
 * 시트도, 캐시도, 현재 시각도 건드리지 않는다. 상태를 받아 새 상태를 돌려준다.
 * 이래야 Test.gs에서 100판을 돌려볼 수 있고, 나중에 통신 방식을 바꿔도 규칙은 그대로 산다.
 *
 * 무작위성은 전부 rng 인자로 주입한다 (기본 Math.random). 테스트에서 시드 고정 가능.
 */

// ────────────────────────────────────────────────────────────
// 1. 정답 순위 확정 + 이동 역산
// ────────────────────────────────────────────────────────────

/**
 * ⚠️ 되돌리면 게임이 무너지는 곳 (00-loop.md).
 *
 * 순위를 먼저 정하고 이동을 역산한다.
 * PDF 원본은 순위를 정해놓고 이동은 따로 랜덤으로 굴렸다. 그러면
 * "A가 최종 1등"이라는 힌트를 뿌려놓고 A가 5등으로 들어오는 판이 실제로 나온다.
 * 힌트가 거짓말이 되면 이 게임은 성립하지 않는다.
 *
 * 설계:
 *   1등        → lastRound-1 라운드에 정확히 10칸 도달, 이후 정지
 *   2·3등      → lastRound 라운드에 10칸 도달 (그 전에는 9칸 이하)
 *   4~8등      → lastRound 끝에 9,8,7,6,5칸 (10칸에 못 미침)
 * 최종 위치 내림차순 + 동점은 truth 순 → 항상 truth와 일치한다.
 */
function planRace(rng) {
  rng = rng || Math.random;

  var truth = shuffle(ANIMAL_CODES.slice(), rng);   // truth[0] = 1등
  var lastRound = rng() < 0.5 ? 5 : 6;              // 학생에게 비공개
  var track = DEFAULTS.trackCells;

  var moves = {};
  for (var rank = 1; rank <= 8; rank++) {
    var code = truth[rank - 1];
    var plan = planOneAnimal(rank, lastRound, track, rng);
    if (!plan) return null;                          // 호출자가 재시도
    moves[code] = plan;
  }

  return { truth: truth, lastRound: lastRound, moves: moves };
}

/** 한 동물의 라운드별 이동량(0~3)을 만든다. 실패하면 null */
function planOneAnimal(rank, lastRound, track, rng) {
  var arriveAt, total;

  if (rank === 1) {
    arriveAt = lastRound - 1;   // 1등만 한 라운드 먼저 골인
    total = track;
  } else if (rank === 2 || rank === 3) {
    arriveAt = lastRound;
    total = track;
  } else {
    arriveAt = lastRound;
    total = track - (rank - 3);  // 4등=9, 5등=8, 6등=7, 7등=6, 8등=5
  }

  for (var attempt = 0; attempt < LIMITS.reverseAttempts; attempt++) {
    var parts = splitIntoMoves(total, arriveAt, rng);
    if (!parts) continue;

    // 골인 라운드 이전에 미리 도착하면 안 된다 (마지막 칸을 그 라운드에 밟아야 함)
    var before = 0;
    for (var i = 0; i < parts.length - 1; i++) before += parts[i];
    if (total >= track && before >= track) continue;

    // 마지막 이동은 0이면 안 된다 — 그 라운드에 움직여서 도착해야 연출이 산다
    if (parts[parts.length - 1] === 0) continue;

    // 골인 후 남은 라운드는 정지
    while (parts.length < lastRound) parts.push(0);
    return parts;
  }
  return null;
}

/**
 * total을 n개의 0~3 값으로 쪼갠다.
 * 앞 라운드는 작게, 뒤 라운드는 크게 치우치게 해서 역전 연출이 나오도록 한다.
 */
function splitIntoMoves(total, n, rng) {
  if (total > n * 3 || total < 0) return null;

  var parts = [];
  var remaining = total;
  for (var i = 0; i < n; i++) {
    var slotsLeft = n - i - 1;
    var min = Math.max(0, remaining - slotsLeft * 3);
    var max = Math.min(3, remaining);
    if (min > max) return null;

    var pick;
    if (i < n / 2) {
      pick = min + Math.floor(rng() * (Math.min(max, min + 2) - min + 1));  // 앞: 작게
    } else {
      var lo = Math.max(min, max - 2);
      pick = lo + Math.floor(rng() * (max - lo + 1));                        // 뒤: 크게
    }
    parts.push(pick);
    remaining -= pick;
  }
  return remaining === 0 ? parts : null;
}

/** 라운드 r까지 굴렸을 때의 위치 */
function positionsAtRound(moves, round) {
  var pos = {};
  for (var code in moves) {
    var sum = 0;
    for (var i = 0; i < round && i < moves[code].length; i++) sum += moves[code][i];
    pos[code] = Math.min(sum, DEFAULTS.trackCells);
  }
  return pos;
}

/** 최종 위치로 순위를 매긴다. 동점은 truth 순서(미리 정한 순위)가 이긴다 */
function rankByPosition(positions, truth) {
  return truth.slice().sort(function (a, b) {
    var d = positions[b] - positions[a];
    if (d !== 0) return d;
    return truth.indexOf(a) - truth.indexOf(b);
  });
}

// ────────────────────────────────────────────────────────────
// 2. 힌트 생성 + 검산
// ────────────────────────────────────────────────────────────

/**
 * 난이도별 힌트 풀을 만든다. **모든 힌트는 truth 기준으로 참이다.**
 *
 * 어려움 6개는 다 합치면 1·2·3등을 정확히 특정하도록 설계했다 (게이트 H3-b).
 * 일부만 받으면 부분 정보만 얻는다 — 그래서 어려움을 계속 고를 이유가 생긴다.
 */
function buildHints(truth, names) {
  var n = function (code) { return names && names[code] ? names[code] : code; };
  var at = function (rank) { return truth[rank - 1]; };   // rank(1~8) → code

  var hard = [
    n(at(1)) + '는 1·2·3등 안에 반드시 듭니다.',
    n(at(2)) + '는 1·2·3등 안에 반드시 듭니다.',
    n(at(3)) + '는 1·2·3등 안에 반드시 듭니다.',
    n(at(1)) + '가 ' + n(at(2)) + '보다 순위가 높습니다.',
    n(at(2)) + '가 ' + n(at(3)) + '보다 순위가 높습니다.',
    n(at(4)) + '는 1·2·3등에 들지 못합니다.'
  ];

  var normal = [
    n(at(1)) + '가 ' + n(at(5)) + '보다 순위가 높습니다.',
    n(at(2)) + '가 ' + n(at(6)) + '보다 순위가 높습니다.',
    n(at(3)) + '가 ' + n(at(7)) + '보다 순위가 높습니다.',
    n(at(4)) + '가 ' + n(at(8)) + '보다 순위가 높습니다.',
    n(at(5)) + '는 ' + n(at(4)) + '보다 느리고 ' + n(at(6)) + '보다 빠릅니다.',
    n(at(6)) + '는 ' + n(at(5)) + '보다 느리고 ' + n(at(7)) + '보다 빠릅니다.'
  ];

  var easy = [
    n(at(8)) + '는 5등 이하입니다.',
    n(at(7)) + '는 5등 이하입니다.',
    n(at(6)) + '는 5등 이하입니다.',
    n(at(8)) + '는 1·2·3등에 들지 못합니다.',
    n(at(7)) + '는 1·2·3등에 들지 못합니다.',
    n(at(5)) + '는 최종 1등이 아닙니다.'
  ];

  return { '어려움': hard, '중간': normal, '쉬움': easy };
}

/**
 * 힌트를 논리식으로도 만든다. 검산(H3)에 쓴다.
 * 각 원소: { level, index, test(order) } — order는 1등부터 8등까지의 code 배열
 */
function buildHintPredicates(truth) {
  var at = function (rank) { return truth[rank - 1]; };
  var rankOf = function (order, code) { return order.indexOf(code) + 1; };

  var top3 = function (code) { return function (o) { return rankOf(o, code) <= 3; }; };
  var faster = function (a, b) { return function (o) { return rankOf(o, a) < rankOf(o, b); }; };
  var notTop3 = function (code) { return function (o) { return rankOf(o, code) > 3; }; };
  var atOrBelow = function (code, k) { return function (o) { return rankOf(o, code) >= k; }; };
  var notFirst = function (code) { return function (o) { return rankOf(o, code) !== 1; }; };

  return {
    '어려움': [top3(at(1)), top3(at(2)), top3(at(3)), faster(at(1), at(2)), faster(at(2), at(3)), notTop3(at(4))],
    '중간':   [faster(at(1), at(5)), faster(at(2), at(6)), faster(at(3), at(7)), faster(at(4), at(8)),
               function (o) { return rankOf(o, at(5)) > rankOf(o, at(4)) && rankOf(o, at(5)) < rankOf(o, at(6)); },
               function (o) { return rankOf(o, at(6)) > rankOf(o, at(5)) && rankOf(o, at(6)) < rankOf(o, at(7)); }],
    '쉬움':   [atOrBelow(at(8), 5), atOrBelow(at(7), 5), atOrBelow(at(6), 5),
               notTop3(at(8)), notTop3(at(7)), notFirst(at(5))]
  };
}

/** 힌트 묶음으로 좁혀지는 1·2·3등 후보 조합 수를 센다 */
function countTop3Candidates(predicates, limit) {
  var found = {};
  var count = 0;
  permute(ANIMAL_CODES.slice(), function (order) {
    for (var i = 0; i < predicates.length; i++) {
      if (!predicates[i](order)) return true;   // 계속
    }
    var key = order[0] + order[1] + order[2];
    if (!found[key]) { found[key] = true; count++; }
    return !(limit && count > limit);
  });
  return count;
}

// ────────────────────────────────────────────────────────────
// 3. 배당률 · 베팅 · 정산
// ────────────────────────────────────────────────────────────

/** 파리뮤추얼. 시드는 0으로 나누기 방지 겸 배당 상한 조절 (리뷰 C6) */
function computeOdds(pool) {
  var total = 0;
  for (var c in pool) total += pool[c];
  var out = {};
  for (var code in pool) {
    out[code] = Math.round((total / pool[code]) * 100) / 100;
  }
  return out;
}

/** 베팅이 규칙에 맞는지. 화면에서 막아도 서버가 다시 막는다 */
function validateBet(team, round, bets, settings) {
  var sum = 0;
  for (var c in bets) {
    if (ANIMAL_CODES.indexOf(c) < 0) return { ok: false, error: 'SHEET_INVALID' };
    if (bets[c] < 0 || bets[c] !== Math.floor(bets[c])) return { ok: false, error: 'SHEET_INVALID' };
    sum += bets[c];
  }
  if (team.betLocked && team.betLocked[round]) return { ok: false, error: 'ALREADY_BET' };
  if (sum > settings.maxBetPerRound) return { ok: false, error: 'TOO_MANY_COINS' };
  if (sum > team.coins) return { ok: false, error: 'NOT_ENOUGH_COINS' };
  return { ok: true, sum: sum };
}

/**
 * 정산. 최종 배당률 하나만 쓴다 (선생님 결정 — 01-prd §6-2).
 * bets가 라운드별로 나뉘어 저장되므로, 나중에 라운드 보너스나
 * 베팅 시점 고정으로 바꿀 때 과거 판도 다시 계산할 수 있다.
 */
function settle(teams, finalOrder, odds, settings) {
  var rankOf = {};
  for (var i = 0; i < finalOrder.length; i++) rankOf[finalOrder[i]] = i + 1;

  return teams.map(function (team) {
    var byAnimal = {};
    for (var r in team.bets) {
      for (var code in team.bets[r]) {
        byAnimal[code] = (byAnimal[code] || 0) + team.bets[r][code];
      }
    }

    var lines = [], gained = 0;
    for (var c in byAnimal) {
      var rank = rankOf[c];
      var rate = settings.payout[rank] || 0;
      var got = Math.round(byAnimal[c] * odds[c] * rate);
      gained += got;
      lines.push({ animalCode: c, finalRank: rank, coins: byAnimal[c], odds: odds[c], payoutRate: rate, gained: got });
    }
    lines.sort(function (a, b) { return a.finalRank - b.finalRank; });

    return { teamNo: team.no, teamName: team.name, lines: lines, gained: gained, finalCoins: team.coins + gained };
  }).sort(function (a, b) { return b.finalCoins - a.finalCoins; })
    .map(function (s, i) { s.rank = i + 1; return s; });
}

// ────────────────────────────────────────────────────────────
// 4. 문제 배정 (감독 G-01)
// ────────────────────────────────────────────────────────────

/**
 * 판 생성 시 라운드×난이도마다 문항을 미리 다 정해둔다.
 * 라운드마다 그때그때 뽑으면 캐시가 날아가 복구할 때 다른 문제가 나온다.
 * 문항이 모자라면 가장 먼저 쓴 것부터 다시 낸다 (03-user-flow §6의 약속).
 */
function planQuestions(questionsByLevel, lastRound, rng) {
  rng = rng || Math.random;
  var plan = {};
  for (var r = 1; r <= lastRound; r++) plan[r] = {};

  LEVELS.forEach(function (level) {
    var pool = (questionsByLevel[level] || []).slice();
    if (pool.length === 0) {
      for (var r = 1; r <= lastRound; r++) plan[r][level] = null;
      return;
    }
    shuffle(pool, rng);
    for (var r = 1; r <= lastRound; r++) {
      plan[r][level] = pool[(r - 1) % pool.length].id;   // 모자라면 순환 재사용
    }
  });
  return plan;
}

// ────────────────────────────────────────────────────────────
// 5. 보조
// ────────────────────────────────────────────────────────────

function shuffle(arr, rng) {
  rng = rng || Math.random;
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(rng() * (i + 1));
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

/** cb가 false를 돌려주면 중단 */
function permute(arr, cb) {
  var n = arr.length, c = new Array(n).fill(0), i = 1;
  if (cb(arr.slice()) === false) return;
  while (i < n) {
    if (c[i] < i) {
      var k = i % 2 ? c[i] : 0;
      var t = arr[k]; arr[k] = arr[i]; arr[i] = t;
      if (cb(arr.slice()) === false) return;
      c[i]++; i = 1;
    } else { c[i] = 0; i++; }
  }
}

function makeCode(rng) {
  rng = rng || Math.random;
  var s = '';
  for (var i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  return s;
}

function makePin(rng) {
  rng = rng || Math.random;
  var s = '';
  for (var i = 0; i < PIN_LENGTH; i++) s += Math.floor(rng() * 10);
  return s;
}

/** ⚠️ 되돌리면 개발자 도구로 정답이 보인다 (00-loop.md) */
function toTeamView(state, teamNo, settings) {
  var me = null, progress = [];
  state.teams.forEach(function (t) {
    progress.push({
      no: t.no, name: t.name,
      answered: !!(t.answered && t.answered[state.round]),
      betLocked: !!(t.betLocked && t.betLocked[state.round])
    });
    if (t.no === teamNo) me = t;
  });

  var view = {
    round: state.round,
    phase: state.phase,
    positions: positionsAtRound(state.moves, state.round),
    odds: computeOdds(state.pool),
    teamProgress: progress,
    isOver: !!state.isOver,
    me: me ? {
      no: me.no, name: me.name, coins: me.coins,
      hints: me.hints || [],
      myBets: me.bets || {},
      chosenLevel: me.answered && me.answered[state.round] ? me.answered[state.round].level : null,
      canAnswer: state.phase === PHASES.QUIZ && !(me.answered && me.answered[state.round]),
      canBet: state.phase === PHASES.BETTING && !(me.betLocked && me.betLocked[state.round])
    } : null
  };

  // 정답 순위는 게임이 끝난 뒤에만. 이 검사를 빼면 게임이 무너진다.
  if (state.isOver) {
    view.truth = rankByPosition(positionsAtRound(state.moves, state.lastRound), state.truth);
  }
  return view;
}

if (typeof module !== 'undefined') {
  module.exports = {
    planRace: planRace, planOneAnimal: planOneAnimal, splitIntoMoves: splitIntoMoves,
    positionsAtRound: positionsAtRound, rankByPosition: rankByPosition,
    buildHints: buildHints, buildHintPredicates: buildHintPredicates, countTop3Candidates: countTop3Candidates,
    computeOdds: computeOdds, validateBet: validateBet, settle: settle,
    planQuestions: planQuestions, shuffle: shuffle, permute: permute,
    makeCode: makeCode, makePin: makePin, toTeamView: toTeamView
  };
}
