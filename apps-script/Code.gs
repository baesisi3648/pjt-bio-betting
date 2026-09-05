/**
 * Code.gs — doGet 라우팅 + GameGateway 8개 함수.
 * 화면은 이 8개 밖으로 서버를 부르지 않는다. 나중에 통신 방식을 바꾸면 여기만 갈아끼운다.
 */

function doGet(e) {
  var role = e && e.parameter && e.parameter.role;
  var file = role === 'teacher' ? 'Teacher' : 'Team';
  return HtmlService.createTemplateFromFile(file).evaluate()
    .setTitle('생명과학 와일드 더비')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/**
 * 학생용 웹앱 주소.
 *
 * ⚠️ getUrl() 을 그냥 믿으면 안 된다. 스프레드시트에 붙은 스크립트에서는
 *    '/dev' 주소가 나올 때가 있고, 그건 편집 권한이 있어야 열린다.
 *    학생 폰에서는 "현재 파일을 열 수 없습니다"가 뜬다.
 *
 * 순서: 설정 탭 → getUrl()이 /exec 로 끝날 때만 → 배포 주소 상수
 */
function webAppUrl() {
  try {
    var s = readSettings();
    // 단축 주소도 넣을 수 있어야 하므로 /exec 로 끝나는지는 따지지 않는다.
    // 다만 /dev 는 편집 권한이 있어야 열려서 학생이 못 보므로 거부한다.
    if (s.studentUrl && /^https?:\/\//.test(s.studentUrl) && !/\/dev$/.test(s.studentUrl)) {
      return s.studentUrl;
    }
  } catch (e) {}
  try {
    var u = ScriptApp.getService().getUrl();
    if (u && /\/exec$/.test(u)) return u;
  } catch (e2) {}
  return WEBAPP_URL;
}

/** 어떤 주소가 쓰이는지 확인 (메뉴에서 부른다) */
function 학생주소_확인() {
  var used = webAppUrl();
  var raw = '';
  try { raw = ScriptApp.getService().getUrl() || '(없음)'; } catch (e) { raw = '(오류)'; }
  SpreadsheetApp.getUi().alert(
    '학생에게 안내될 주소\n\n' + used +
    '\n\n─────────────\n구글이 알려준 값: ' + raw +
    (/\/dev$/.test(raw) ? '\n→ /dev 라서 학생은 못 엽니다. 위 주소를 씁니다.' : '') +
    "\n\n이 주소가 틀렸다면 '설정' 탭 학생주소 행에 올바른 주소를 넣으세요."
  );
}
function deployVersion() { return DEPLOY_VERSION; }

/**
 * 웹앱 **안에서** 환경을 점검한다.
 * 스프레드시트 메뉴에서 도는 진단은 환경이 달라서 여기 문제를 못 잡는다.
 */
function gwDiagnose() {
  var out = { deployVersion: DEPLOY_VERSION };

  try { out.getActive = SpreadsheetApp.getActive() ? '됨' : 'null (웹앱에서 흔함)'; }
  catch (e) { out.getActive = '오류: ' + e.message; }

  try { out.openById = ss().getName(); } catch (e) { out.openById = '실패: ' + e.message; }

  try {
    var q = readQuestions();
    var units = {};
    q.rows.forEach(function (x) { units[x.unit] = (units[x.unit] || 0) + 1; });
    out.questions = q.rows.length;
    out.units = units;
    out.skipped = q.skipped.length;
  } catch (e) { out.questions = '실패: ' + e.message; }

  try { out.listUnits = listUnits().join(', ') || '(빈 배열)'; } catch (e) { out.listUnits = '실패: ' + e.message; }
  try { out.recent = listRecentGames(10).length + '개'; } catch (e) { out.recent = '실패: ' + e.message; }
  try { var r = gwListUnits(); out.gwListUnits = r.ok ? ('units ' + r.data.units.length + '개' + (r.data.recentError ? ' / 최근판 오류: ' + r.data.recentError : '')) : ('실패 ' + r.message); }
  catch (e) { out.gwListUnits = '던짐: ' + e.message; }
  try { out.rawGetUrl = ScriptApp.getService().getUrl() || '(없음)'; } catch (e) { out.rawGetUrl = '오류'; }
  try { out.studentUrl = webAppUrl(); } catch (e) { out.studentUrl = '실패: ' + e.message; }

  return ok(out);
}

// ── 교사 확인 ────────────────────────────────────────────

/**
 * ⚠️ 되돌리면 학생이 정답 순위와 모둠 암호를 그대로 본다.
 *
 * 판 코드는 칠판에 적혀 있으니 비밀이 아니다. 웹앱은 로그인 없이 누구나 열 수 있고,
 * 주소 뒤에 ?role=teacher 만 붙이면 교사 화면이 열린다.
 * 그래서 "교사만 알아야 하는 것"은 코드가 아니라 이 열쇠로 지킨다.
 *
 * 지켜야 하는 것: 정답 순위(truth) · 마지막 라운드 · 모든 모둠 암호 · 진행/정산 조작
 */
function isHost(state, hostKey) {
  return !!state.hostKey && String(hostKey || '') === String(state.hostKey);
}

/**
 * 열쇠가 없는 판은 이 수정 이전에 만들어진 것이다.
 * 스프레드시트 메뉴('교사 열쇠 확인')에서 열쇠를 발급받으면 이어서 쓸 수 있다 —
 * 시트는 교사만 열 수 있으므로 그 경로는 안전하다.
 */
function hostGate(state, hostKey) {
  if (!state.hostKey) {
    return { ok: false, error: 'NOT_HOST',
             message: '이 판은 교사 열쇠가 없는 예전 판이에요.\n' +
                      "스프레드시트 메뉴 '와일드 더비 → 교사 열쇠 확인' 에서 열쇠를 받아주세요." };
  }
  if (!isHost(state, hostKey)) return err('NOT_HOST');
  return null;
}

/**
 * ⚠️ 되돌리면 한 학생이 다른 모둠의 답과 베팅을 대신 낸다.
 *
 * 모둠 암호는 접속할 때 한 번 맞춰보는 것으로 끝나면 아무것도 지키지 못한다.
 * 판 코드만 알면 모둠 번호는 1~6 중 하나이므로 그냥 찍으면 되기 때문이다.
 * 그래서 모둠 이름으로 무언가를 하는 함수는 매번 암호를 다시 본다.
 * (힌트도 마찬가지다 — 남의 모둠 상태를 읽으면 벌어온 힌트를 그냥 가져간다)
 */
function checkTeam(state, teamNo, pin) {
  var team = findTeam(state, teamNo);
  if (!team) return { error: err('GAME_NOT_FOUND') };
  if (String(team.pin) !== String(pin)) return { error: err('WRONG_PIN') };
  return { team: team };
}

// ── 응답 봉투 ────────────────────────────────────────────
/**
 * ⚠️ 앱스 스크립트는 google.script.run 응답에 Date 객체를 담지 못한다.
 *    하나라도 섞이면 "returned value is not a supported return type" 으로
 *    **응답 전체가 실패**한다. 화면에서는 그냥 아무것도 안 온 것처럼 보인다.
 *
 *    실제로 이것 때문에 '게임' 탭에 판이 하나 생기는 순간
 *    (만든시각이 Date 로 읽힌다) 단원 목록이 통째로 사라졌다.
 *
 *    그래서 내보내기 직전에 전부 문자열로 바꾼다.
 */
function plain(v) {
  if (v instanceof Date) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return v.getFullYear() + '-' + p(v.getMonth() + 1) + '-' + p(v.getDate()) +
           ' ' + p(v.getHours()) + ':' + p(v.getMinutes());
  }
  if (v instanceof Array) { return v.map(plain); }
  if (v && typeof v === 'object') {
    var o = {};
    for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = plain(v[k]);
    return o;
  }
  return v;
}

function ok(data) { return { ok: true, data: plain(data) }; }
function err(code) { return { ok: false, error: code, message: ERRORS[code] || '문제가 생겼어요' }; }

// ── 1. 판 만들기 ─────────────────────────────────────────

function gwPrepare(unit) {
  var v = validateSheets(unit);
  return ok({ blocking: v.blocking, warnings: v.warnings, units: listUnits() });
}

function gwVersion() { return ok({ v: DEPLOY_VERSION }); }

function gwListUnits() {
  // '게임' 탭 읽기가 실패해도 단원 목록은 살아야 한다.
  // 예전엔 여기서 터지면 드롭다운이 통째로 비었고, 화면에는 아무 표시도 안 났다.
  var recent = [], recentError = null;
  try { recent = listRecentGames(10); }
  catch (e) { recentError = e.message; }
  return ok({ units: listUnits(), recent: recent, recentError: recentError });
}

function gwCreateGame(config) {
  return withLock(function () {
    var v = validateSheets(config.unit);
    if (v.blocking.length) return { ok: false, error: 'SHEET_INVALID', message: v.blocking.join('\n') };

    var settings = readSettings();
    var race = null, tries = 0;
    while (!race && tries++ < LIMITS.reverseAttempts) race = planRace();
    if (!race) return { ok: false, error: 'SHEET_INVALID', message: '경주를 만들지 못했어요. 다시 시도해주세요.' };

    // 문제를 미리 다 배정한다 — 라운드마다 뽑으면 캐시 복구 시 문제가 바뀐다
    var byLevel = { '쉬움': [], '중간': [], '어려움': [] };
    v.questions.forEach(function (q) { byLevel[q.level].push(q); });

    var code;
    do { code = makeCode(); } while (findGameRow(code));

    var teams = [];
    for (var i = 0; i < config.teamCount; i++) {
      teams.push({
        no: i + 1,
        name: (config.teamNames && config.teamNames[i]) || (i + 1) + '모둠',
        pin: makePin(), coins: settings.initialCoins,
        hints: [], answered: {}, bets: {}, betLocked: {}
      });
    }

    var pool = {};
    ANIMAL_CODES.forEach(function (c) { pool[c] = settings.seedCoins; });

    var state = {
      version: 1, code: code, hostKey: makeHostKey(), className: config.className, unit: config.unit,
      round: 1, lastRound: race.lastRound, phase: PHASES.WAITING, roundStarted: false,
      phaseEndsAt: null, pausedAt: null, stateVersion: 1, eventSeq: 0,
      truth: race.truth, moves: race.moves, lastRoundHidden: true,
      animals: v.animals.names, emojis: v.animals.emojis,
      hintPool: buildHints(race.truth, v.animals.names),
      hintGiven: {},
      questionPlan: planQuestions(byLevel, race.lastRound),
      pool: pool, teams: teams, settings: settings, isOver: false
    };

    saveSnapshot(state);

    var pins = {};
    teams.forEach(function (t) { pins[t.no] = t.pin; });
    var url = webAppUrl();
    return ok({ code: code, hostKey: state.hostKey, pins: pins,
                teams: teams.map(function (t) { return { no: t.no, name: t.name }; }),
                studentUrl: url, qr: qrSvg(url, 7), warnings: v.warnings });
  });
}

/** 판 코드·학생 주소·QR·암호를 다시 띄운다 (2차시에 학생들이 재접속할 때) */
function gwHandout(code, hostKey) {
  var state = loadState(code);
  if (!state) return err('GAME_NOT_FOUND');
  var gate = hostGate(state, hostKey);   // 모둠 암호가 전부 담긴 응답이다
  if (gate) return gate;
  var url = webAppUrl();
  var pins = {};
  state.teams.forEach(function (t) { pins[t.no] = t.pin; });
  return ok({ code: state.code, studentUrl: url, qr: qrSvg(url, 7), pins: pins,
              teams: state.teams.map(function (t) { return { no: t.no, name: t.name }; }) });
}

// ── 2. 모둠 접속 ─────────────────────────────────────────

/** 접속 점유를 두지 않는다 — 두면 새로고침한 폰이 자기 자신 때문에 막힌다 (00-loop.md) */
function gwJoinGame(code, teamNo, pin) {
  var state = loadState(code);
  if (!state) return err('GAME_NOT_FOUND');
  if (state.isOver) return err('GAME_ENDED');

  var team = findTeam(state, teamNo);
  if (!team) return err('GAME_NOT_FOUND');
  if (String(team.pin) !== String(pin)) {
    Utilities.sleep(1000);   // 잠금 대신 지연만. 모둠 단위 잠금은 장난 도구가 된다
    return err('WRONG_PIN');
  }
  return ok(teamView(state, teamNo));
}

function gwLobby(code) {
  var state = loadState(code);
  if (!state) return err('GAME_NOT_FOUND');
  if (state.isOver) return err('GAME_ENDED');
  return ok({ className: state.className, teams: state.teams.map(function (t) { return { no: t.no, name: t.name }; }) });
}

// ── 3. 상태 조회 (2초 폴링) ───────────────────────────────

function gwGetState(code, viewer, hostKey, pin) {
  var state = loadState(code);
  if (!state) return err('GAME_NOT_FOUND');

  state = advanceIfDue(code, state);

  if (viewer && viewer.indexOf('team:') === 0) {
    var teamNo = Number(viewer.split(':')[1]);
    var t = checkTeam(state, teamNo, pin);   // 이 응답에는 그 모둠이 벌어온 힌트가 담긴다
    if (t.error) return t.error;
    return ok(teamView(state, teamNo));
  }
  var gate = hostGate(state, hostKey);   // teacherView 는 마지막 라운드까지 담는다
  if (gate) return gate;
  return ok(teacherView(state));
}

/** 단계가 끝났는가. 실제로 넘기지는 않는다 — 잠금을 잡을지 판단만 한다 */
function needsAdvance(state) {
  if (state.pausedAt || !state.phaseEndsAt) return false;
  if (Date.now() < state.phaseEndsAt) return false;
  return state.phase === PHASES.QUIZ || state.phase === PHASES.DISCUSS || state.phase === PHASES.BETTING;
}

/**
 * ⚠️ 되돌리면 단계가 바뀌는 순간 방금 낸 답과 베팅이 사라진다.
 *
 * gwGetState 는 2초마다 7대(교사+6모둠)가 동시에 부른다. 예전에는 이 안에서
 * 잠금 없이 autoAdvance → saveSnapshot 을 했다. 그래서 단계가 끝나는 그 순간,
 *   ① A가 상태를 읽고
 *   ② 그 사이 잠금 안에서 어떤 모둠의 답·베팅이 확정되고
 *   ③ A가 ①의 낡은 상태를 그대로 덮어쓰는
 * 순서가 나올 수 있었다. 기록 탭에는 남지만 캐시가 살아 있으면 재생되지 않아
 * 그 모둠은 답도 코인도 잃는다.
 *
 * 그래서 넘길 일이 있을 때만 잠금을 잡고, 잠금 안에서 상태를 다시 읽어 넘긴다.
 * 잠금을 못 잡으면 아무것도 쓰지 않고 읽은 상태를 그대로 보여준다 — 2초 뒤 어차피 다시 온다.
 */
function advanceIfDue(code, state) {
  if (!needsAdvance(state)) return state;
  var r = withLock(function () {
    var fresh = loadState(code);
    if (fresh && autoAdvance(fresh)) saveSnapshot(fresh);
    return { state: fresh };
  }, LIMITS.pollLockWaitMs);
  return (r && r.state) ? r.state : state;   // 잠금 실패 시 r 은 LOCK_TIMEOUT 봉투다
}

/** 타이머가 끝났으면 다음 단계로. 시간 판단은 전부 서버에서 한다 */
function autoAdvance(state) {
  if (state.pausedAt || !state.phaseEndsAt) return false;
  if (Date.now() < state.phaseEndsAt) return false;

  if (state.phase === PHASES.QUIZ) {
    state.teams.forEach(function (t) {
      if (!t.answered[state.round]) t.answered[state.round] = { level: null, choice: null, correct: false, timeout: true };
    });
    setPhase(state, PHASES.DISCUSS, state.settings.discussSeconds);
  } else if (state.phase === PHASES.DISCUSS) {
    setPhase(state, PHASES.BETTING, state.settings.betSeconds);
  } else if (state.phase === PHASES.BETTING) {
    state.teams.forEach(function (t) { t.betLocked[state.round] = true; });
    state.phase = PHASES.WAITING;
    state.phaseEndsAt = null;
    state.stateVersion++;
  } else return false;
  return true;
}

function setPhase(state, phase, seconds) {
  state.phase = phase;
  state.phaseEndsAt = seconds ? Date.now() + seconds * 1000 : null;
  state.stateVersion++;
}

// ── 4. 답 제출 ───────────────────────────────────────────

function gwSubmitAnswer(code, teamNo, level, choice, pin) {
  return withLock(function () {
    var state = loadState(code);
    if (!state) return err('GAME_NOT_FOUND');
    if (state.pausedAt) return err('PAUSED');
    autoAdvance(state);
    if (state.phase !== PHASES.QUIZ) return err('QUIZ_CLOSED');

    var t = checkTeam(state, teamNo, pin);
    if (t.error) return t.error;
    var team = t.team;
    if (team.answered[state.round]) return err('ALREADY_ANSWERED');

    var q = questionFor(state, state.round, level);
    if (!q) return err('SHEET_INVALID');

    var correct = Number(choice) === Number(q.answer);
    var hint = correct ? takeHint(state, team, level) : null;
    var record = { level: level, choice: Number(choice), correct: correct, hint: hint };

    team.answered[state.round] = record;
    if (hint) team.hints.push(hint);

    appendEvent(state, 'answer', teamNo, record);   // 즉시 기록
    state.stateVersion++;
    saveSnapshot(state);

    return ok({ correct: correct, answer: q.answer, explanation: q.explanation, newHint: hint });
  });
}

/** 같은 모둠에 같은 힌트를 두 번 주지 않는다 */
function takeHint(state, team, level) {
  var pool = state.hintPool[level] || [];
  var given = state.hintGiven[team.no] || [];
  for (var i = 0; i < pool.length; i++) {
    if (given.indexOf(level + '#' + i) < 0) {
      given.push(level + '#' + i);
      state.hintGiven[team.no] = given;
      return { round: state.round, level: level, text: pool[i] };
    }
  }
  return null;
}

function questionFor(state, round, level) {
  var plan = state.questionPlan[round];
  if (!plan || !plan[level]) return null;
  var all = readQuestions().rows;
  for (var i = 0; i < all.length; i++) if (all[i].id === plan[level]) return all[i];
  return null;
}

// ── 5. 베팅 ──────────────────────────────────────────────

function gwPlaceBet(code, teamNo, bets, pin) {
  return withLock(function () {
    var state = loadState(code);
    if (!state) return err('GAME_NOT_FOUND');
    if (state.pausedAt) return err('PAUSED');
    autoAdvance(state);
    if (state.phase !== PHASES.BETTING) return err('BET_CLOSED');

    var t = checkTeam(state, teamNo, pin);
    if (t.error) return t.error;
    var team = t.team;

    var check = validateBet(team, state.round, bets, state.settings);
    if (!check.ok) return err(check.error);

    team.bets[state.round] = bets;
    team.betLocked[state.round] = true;
    team.coins -= check.sum;
    for (var c in bets) state.pool[c] += bets[c];

    appendEvent(state, 'bet', teamNo, { bets: bets });   // 즉시 기록
    state.stateVersion++;
    saveSnapshot(state);

    return ok(teamView(state, teamNo));
  });
}

// ── 6. 라운드 진행 · 일시정지 · 정산 ───────────────────────

/**
 * 라운드 진행 버튼 하나가 부르는 유일한 함수.
 *
 * ⚠️ 화면이 "1라운드인가?"로 판단하면 안 된다. 베팅이 끝나도 round는 그대로 1이라,
 *    화면이 판단하면 1라운드가 무한 반복된다. 어디까지 했는지는 서버만 안다.
 */
function gwAdvanceRound(code, hostKey) {
  return withLock(function () {
    var state = loadState(code);
    if (!state) return err('GAME_NOT_FOUND');
    var gate = hostGate(state, hostKey);
    if (gate) return gate;
    if (state.phase !== PHASES.WAITING) return ok(teacherView(state));   // 진행 중이면 무시

    if (state.roundStarted) {
      // 이번 라운드는 이미 끝났다 → 다음 라운드로
      if (state.round >= state.lastRound) {
        state.phase = PHASES.DONE;
        state.stateVersion++;
        saveSnapshot(state);
        return ok(teacherView(state));
      }
      state.round++;
    }
    state.roundStarted = true;
    setPhase(state, PHASES.QUIZ, state.settings.quizSeconds);
    appendEvent(state, 'round_start', null, { phase: state.phase, phaseEndsAt: state.phaseEndsAt });
    saveSnapshot(state);
    return ok(teacherView(state));
  });
}

function gwTogglePause(code, hostKey) {
  return withLock(function () {
    var state = loadState(code);
    if (!state) return err('GAME_NOT_FOUND');
    var gate = hostGate(state, hostKey);
    if (gate) return gate;
    if (state.pausedAt) {
      if (state.phaseEndsAt) state.phaseEndsAt += Date.now() - state.pausedAt;   // 멈춘 만큼 미룬다
      state.pausedAt = null;
    } else {
      state.pausedAt = Date.now();
    }
    state.stateVersion++;
    appendEvent(state, 'pause', null, { paused: !!state.pausedAt });
    saveSnapshot(state);
    return ok(teacherView(state));
  });
}

function gwFinalize(code, hostKey) {
  return withLock(function () {
    var state = loadState(code);
    if (!state) return err('GAME_NOT_FOUND');
    var gate = hostGate(state, hostKey);
    if (gate) return gate;
    var finalPos = positionsAtRound(state.moves, state.lastRound);
    var finalOrder = rankByPosition(finalPos, state.truth);
    var odds = computeOdds(state.pool);

    state.isOver = true;
    state.phase = PHASES.DONE;
    state.settlement = settle(state.teams, finalOrder, odds, state.settings);
    state.stateVersion++;
    saveSnapshot(state);

    return ok({ finalOrder: finalOrder, animals: state.animals, emojis: state.emojis,
                odds: odds, settlement: state.settlement });
  });
}

// ── 뷰 ───────────────────────────────────────────────────

function findTeam(state, no) {
  for (var i = 0; i < state.teams.length; i++) if (state.teams[i].no === Number(no)) return state.teams[i];
  return null;
}

function secondsLeft(state) {
  if (!state.phaseEndsAt) return null;
  var base = state.pausedAt || Date.now();
  return Math.max(0, Math.ceil((state.phaseEndsAt - base) / 1000));
}

/**
 * ⚠️ 정답 순위(truth)는 여기 담지 않는다.
 *
 * 이 응답은 2초마다 나가는 것이라, 한 번이라도 담기면 정산 전 내내 흘러다닌다.
 * 교사 화면의 '정답 공개' 버튼은 그때 gwReveal 을 따로 부른다.
 * 열쇠 검사(hostGate)와 이 분리는 겹치는 방어다 — 한쪽이 뚫려도 정답은 안 나간다.
 */
function teacherView(state) {
  return {
    code: state.code, className: state.className, unit: state.unit,
    round: state.round, lastRound: state.lastRound,
    phase: state.pausedAt ? PHASES.PAUSED : state.phase,
    secondsLeft: secondsLeft(state), stateVersion: state.stateVersion,
    positions: positionsAtRound(state.moves, state.round),
    odds: computeOdds(state.pool), pool: state.pool, seedCoins: state.settings.seedCoins,
    animals: state.animals, emojis: state.emojis,
    teams: state.teams.map(function (t) {
      return { no: t.no, name: t.name, coins: t.coins,
               answered: !!t.answered[state.round], betLocked: !!t.betLocked[state.round] };
    }),
    isOver: !!state.isOver, settlement: state.settlement || null,
    truth: state.isOver ? rankByPosition(positionsAtRound(state.moves, state.lastRound), state.truth) : null,
    deployVersion: DEPLOY_VERSION
  };
}

/**
 * 정답 순위를 TV에 띄운다. 교사가 버튼을 누른 그 순간에만 서버를 부른다.
 * 정산 전에 정답이 나가는 유일한 통로이므로, 여기만 지키면 된다.
 */
function gwReveal(code, hostKey) {
  var state = loadState(code);
  if (!state) return err('GAME_NOT_FOUND');
  var gate = hostGate(state, hostKey);
  if (gate) return gate;
  return ok({ truth: rankByPosition(positionsAtRound(state.moves, state.lastRound), state.truth),
              animals: state.animals, emojis: state.emojis });
}

/** ⚠️ 되돌리면 개발자 도구로 정답이 보인다 (00-loop.md) */
function teamView(state, teamNo) {
  var me = findTeam(state, teamNo);
  var v = {
    code: state.code, round: state.round,
    phase: state.pausedAt ? PHASES.PAUSED : state.phase,
    secondsLeft: secondsLeft(state), stateVersion: state.stateVersion,
    positions: positionsAtRound(state.moves, state.round),
    odds: computeOdds(state.pool),
    animals: state.animals, emojis: state.emojis,
    maxBet: state.settings.maxBetPerRound,
    teamProgress: state.teams.map(function (t) {
      return { no: t.no, name: t.name, answered: !!t.answered[state.round], betLocked: !!t.betLocked[state.round] };
    }),
    isOver: !!state.isOver,
    deployVersion: DEPLOY_VERSION
  };

  if (me) {
    var ans = me.answered[state.round];
    v.me = {
      no: me.no, name: me.name, coins: me.coins, hints: me.hints,
      myBets: me.bets, usedThisRound: sumBets(me.bets[state.round]),
      chosenLevel: ans ? ans.level : null,
      answerResult: ans && ans.level ? { correct: ans.correct } : null,
      canAnswer: state.phase === PHASES.QUIZ && !ans,
      canBet: state.phase === PHASES.BETTING && !me.betLocked[state.round]
    };
    if (state.phase === PHASES.QUIZ && ans && ans.level && !ans.timeout) {
      var q = questionFor(state, state.round, ans.level);
      if (q) v.question = { text: q.text, choices: q.choices };   // answer는 안 담는다
    }
  }

  if (state.isOver) {
    v.truth = rankByPosition(positionsAtRound(state.moves, state.lastRound), state.truth);
    v.settlement = state.settlement || null;
  }
  return v;
}

function sumBets(b) { var s = 0; for (var c in (b || {})) s += b[c]; return s; }

/** 모둠 화면에서 문제를 받으려면 난이도를 먼저 골라야 한다 */
function gwChooseLevel(code, teamNo, level, pin) {
  return withLock(function () {
    var state = loadState(code);
    if (!state) return err('GAME_NOT_FOUND');
    if (state.pausedAt) return err('PAUSED');
    autoAdvance(state);
    if (state.phase !== PHASES.QUIZ) return err('QUIZ_CLOSED');

    var t = checkTeam(state, teamNo, pin);
    if (t.error) return t.error;
    if (t.team.answered[state.round]) return err('ALREADY_ANSWERED');

    var q = questionFor(state, state.round, level);
    if (!q) return err('SHEET_INVALID');
    return ok({ level: level, question: { text: q.text, choices: q.choices } });
  });
}
