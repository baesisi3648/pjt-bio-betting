/**
 * Sheet.gs — 시트 읽기·쓰기, 캐시, 잠금, 사건 기록.
 * 게임 규칙은 여기 넣지 않는다 (07-coding-convention §1).
 */

// ── 잠금 ────────────────────────────────────────────────

/**
 * ⚠️ 되돌리면 6모둠 동시 베팅에 코인이 어긋난다 (00-loop.md).
 * 상태를 바꾸는 모든 함수는 이 안에서 돈다. 읽기만 하는 getState는 예외.
 */
function withLock(fn, waitMs) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(waitMs || LIMITS.lockWaitMs)) {
    return { ok: false, error: 'LOCK_TIMEOUT', message: ERRORS.LOCK_TIMEOUT };
  }
  try { return fn(); }
  finally { lock.releaseLock(); }
}

// ── 캐시 ────────────────────────────────────────────────

function cacheKey(code) { return 'wd_' + code; }

function cacheGet(code) {
  var raw = CacheService.getScriptCache().get(cacheKey(code));
  return raw ? JSON.parse(raw) : null;
}

function cachePut(state) {
  var raw = JSON.stringify(state);
  if (raw.length > LIMITS.maxStateBytes) throw new Error('상태가 캐시 한도를 넘었습니다: ' + raw.length);
  CacheService.getScriptCache().put(cacheKey(state.code), raw, LIMITS.cacheSeconds);
}

// ── 마스터 탭 읽기 ───────────────────────────────────────

/**
 * 스프레드시트를 얻는 유일한 통로.
 * ⚠️ getActive() 를 직접 부르지 말 것 — 웹앱에서는 null 이 나온다.
 */
function ss() {
  var s = null;
  try { s = SpreadsheetApp.getActive(); } catch (e) {}
  if (!s && typeof SPREADSHEET_ID === 'string' && SPREADSHEET_ID) {
    s = SpreadsheetApp.openById(SPREADSHEET_ID);
  }
  if (!s) throw new Error('스프레드시트를 열 수 없습니다. Config.gs 의 SPREADSHEET_ID 를 확인해주세요.');
  return s;
}

function sheetOf(name) {
  var sh = ss().getSheetByName(name);
  if (!sh) throw new Error("'" + name + "' 탭이 없어요. 시트 구성을 확인해주세요.");
  return sh;
}

function readRows(name) {
  var v = sheetOf(name).getDataRange().getValues();
  return v.length > 1 ? v.slice(1) : [];
}

/** 잘못된 행은 건너뛰고 사유를 같이 돌려준다 */
function readQuestions() {
  var out = [], skipped = [];
  readRows(SHEETS.QUESTIONS).forEach(function (r, i) {
    var row = i + 2;
    var unit = String(r[0] || '').trim();
    var level = String(r[1] || '').trim();
    var text = String(r[2] || '').trim();
    var answer = Number(r[7]);
    if (!unit || !text) return;
    if (LEVELS.indexOf(level) < 0) { skipped.push(row + '행: 난이도가 쉬움/중간/어려움이 아님 (' + level + ')'); return; }
    if (!(answer >= 1 && answer <= 4)) { skipped.push(row + '행: 정답이 1~4가 아님 (' + r[7] + ')'); return; }
    out.push({
      id: row, unit: unit, level: level, text: text,
      choices: [r[3], r[4], r[5], r[6]].map(function (c) { return String(c || ''); }),
      answer: answer, explanation: String(r[8] || '')
    });
  });
  return { rows: out, skipped: skipped };
}

function readAnimals() {
  var rows = readRows(SHEETS.ANIMALS).filter(function (r) { return String(r[1] || '').trim(); });
  if (rows.length !== 8) {
    return { ok: false, error: 'SHEET_INVALID', message: "'동물' 탭이 " + rows.length + '줄이에요. 정확히 8줄이어야 합니다.' };
  }
  var names = {}, emojis = {};
  rows.forEach(function (r, i) {
    var code = ANIMAL_CODES[i];
    names[code] = String(r[1]).trim();
    emojis[code] = String(r[2] || '').trim();
  });
  return { ok: true, names: names, emojis: emojis };
}

function readHintTemplates() {
  var bad = [];
  var rows = readRows(SHEETS.HINTS).filter(function (r, i) {
    var tpl = String(r[2] || '');
    if (!tpl) return false;
    if (tpl.indexOf('{X}') < 0) bad.push((i + 2) + '행: {X} 자리표시가 없어요');
    return true;
  });
  return { rows: rows, bad: bad };
}

/**
 * '설정' 탭을 읽는다. 범위를 벗어난 값은 기본값으로 되돌린다.
 * issues 배열을 넘기면 무엇을 되돌렸는지 담아준다 (판 만들기 화면 경고용).
 */
function readSettings(issues) {
  var s = {};
  for (var k in DEFAULTS) s[k] = DEFAULTS[k];
  var map = {
    '초기코인': 'initialCoins', '라운드당최대베팅': 'maxBetPerRound', '시드코인': 'seedCoins',
    '문제시간초': 'quizSeconds', '토론시간초': 'discussSeconds', '베팅시간초': 'betSeconds',
    '트랙칸수': 'trackCells', '학생주소': 'studentUrl'
  };
  readRows(SHEETS.SETTINGS).forEach(function (r) {
    var key = map[String(r[0] || '').trim()];
    if (!key || r[1] === '') return;

    if (key === 'studentUrl') { s[key] = String(r[1]).trim(); return; }

    var raw = r[1], n = Number(raw), rule = SETTING_RANGE[key];
    var okNum = typeof n === 'number' && isFinite(n) && Math.floor(n) === n;
    if (!okNum || (rule && (n < rule.min || n > rule.max))) {
      if (issues) {
        issues.push("'설정' 탭 " + (rule ? rule.label : key) + ' — ' +
                    (okNum ? n + ' 은(는) ' + rule.min + '~' + rule.max + ' 범위 밖이라'
                           : "'" + raw + "' 은(는) 숫자가 아니라") +
                    ' 기본값 ' + DEFAULTS[key] + ' 을(를) 씁니다.');
      }
      return;                                  // 기본값 유지
    }
    s[key] = n;
  });
  return s;
}

/** 판 만들기 전 검사 (specs/screens/teacher-setup.yaml validations) */
function validateSheets(unit) {
  var blocking = [], warnings = [];

  readSettings(warnings);          // 잘못 적힌 설정값을 판 만들기 전에 알린다

  var animals = readAnimals();
  if (!animals.ok) blocking.push(animals.message);

  var hints = readHintTemplates();
  hints.bad.forEach(function (m) { blocking.push("'힌트문구' 탭 " + m); });

  var q = readQuestions();
  var inUnit = q.rows.filter(function (x) { return x.unit === unit; });
  if (inUnit.length === 0) blocking.push("'" + unit + "' 단원에 문제가 하나도 없어요.");

  LEVELS.forEach(function (level) {
    var n = inUnit.filter(function (x) { return x.level === level; }).length;
    if (n < LIMITS.minHintsPerLevel) {
      warnings.push("'" + unit + "' 단원 — " + level + ' ' + n + '/6문항. 모자라면 앞 라운드 문제를 다시 냅니다.');
    }
  });
  q.skipped.forEach(function (m) { warnings.push("'문제' 탭 " + m); });

  return { blocking: blocking, warnings: warnings, animals: animals, questions: inUnit };
}

function listUnits() {
  var seen = {}, out = [];
  readQuestions().rows.forEach(function (q) { if (!seen[q.unit]) { seen[q.unit] = 1; out.push(q.unit); } });
  return out;
}

// ── 게임 저장 ────────────────────────────────────────────

function findGameRow(code) {
  var sh = sheetOf(SHEETS.GAMES);
  var v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]).trim() === code) return { sheet: sh, row: i + 1, values: v[i] };
  return null;
}

function saveSnapshot(state) {
  var sh = sheetOf(SHEETS.GAMES);
  var now = new Date();
  var found = findGameRow(state.code);
  var row = [state.code, state.className, state.unit, JSON.stringify(state),
             found ? found.values[4] : now, now, !!state.isOver];
  if (found) sh.getRange(found.row, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);
  cachePut(state);
}

/**
 * ⚠️ 되돌리면 캐시 소실 시 수업 중 코인이 증발한다 (00-loop.md).
 * 답 제출·베팅 확정은 라운드 끝을 기다리지 않고 즉시 한 줄 붙인다.
 */
function appendEvent(state, kind, teamNo, payload) {
  state.eventSeq = (state.eventSeq || 0) + 1;
  sheetOf(SHEETS.EVENTS).appendRow([
    state.eventSeq, state.code, state.round, teamNo === null ? '' : teamNo,
    kind, JSON.stringify(payload || {}), new Date()
  ]);
  return state.eventSeq;
}

/** 캐시가 날아갔을 때: 스냅샷 + 그 뒤 사건 재생 */
function loadState(code) {
  var cached = cacheGet(code);
  if (cached) return cached;

  var found = findGameRow(code);
  if (!found) return null;

  var state = JSON.parse(found.values[3]);
  var events = readRows(SHEETS.EVENTS).filter(function (r) {
    return String(r[1]).trim() === code && Number(r[0]) > (state.eventSeq || 0);
  }).sort(function (a, b) { return Number(a[0]) - Number(b[0]); });

  events.forEach(function (r) { replayEvent(state, r); });
  if (events.length) cachePut(state);
  return state;
}

function replayEvent(state, row) {
  var seq = Number(row[0]), round = Number(row[2]), teamNo = Number(row[3]);
  var kind = String(row[4]), payload = JSON.parse(row[5] || '{}');
  var team = null;
  for (var i = 0; i < state.teams.length; i++) if (state.teams[i].no === teamNo) team = state.teams[i];

  if (kind === 'answer' && team) {
    team.answered = team.answered || {};
    team.answered[round] = payload;
    if (payload.correct && payload.hint) {
      team.hints = team.hints || [];
      team.hints.push(payload.hint);
      markHintGiven(state, teamNo, payload.hint);
    }
  } else if (kind === 'bet' && team) {
    team.bets = team.bets || {}; team.betLocked = team.betLocked || {};
    team.bets[round] = payload.bets;
    team.betLocked[round] = true;
    var sum = 0;
    for (var c in payload.bets) { sum += payload.bets[c]; state.pool[c] += payload.bets[c]; }
    team.coins -= sum;
  } else if (kind === 'round_start') {
    state.round = round;
    state.phase = payload.phase;
    state.phaseEndsAt = payload.phaseEndsAt;
  }
  state.eventSeq = seq;
  state.stateVersion = (state.stateVersion || 0) + 1;
}

/**
 * ⚠️ 되돌리면 캐시 복구 뒤 같은 힌트가 두 번 나간다.
 *
 * takeHint 는 '어려움#0' 같은 열쇠를 state.hintGiven 에 쌓아 중복을 막는다.
 * 그런데 재생은 team.hints 만 되살리고 hintGiven 은 비워둔 채였다 —
 * 그러면 복구 직후 같은 난이도를 또 맞힌 모둠에게 1번 힌트가 다시 간다.
 * 게이트 D6 이 지키는 규칙이 정작 복구 경로에서만 깨져 있었다.
 *
 * 힌트 문구는 판을 만들 때 hintPool 에 굳어 있으므로, 문구로 자리를 되찾을 수 있다.
 * (이러면 hintKey 같은 걸 새로 기록하지 않아도 예전 판의 기록까지 그대로 복구된다)
 */
function markHintGiven(state, teamNo, hint) {
  if (!hint || !hint.level || !state.hintPool) return;
  var pool = state.hintPool[hint.level] || [];
  var idx = pool.indexOf(hint.text);
  if (idx < 0) return;                       // 풀에 없는 문구 — 되찾을 자리가 없다
  var key = hint.level + '#' + idx;
  state.hintGiven = state.hintGiven || {};
  var given = state.hintGiven[teamNo] || [];
  if (given.indexOf(key) < 0) given.push(key);
  state.hintGiven[teamNo] = given;
}

function listRecentGames(limit) {
  var rows = readRows(SHEETS.GAMES);
  return rows.slice(-(limit || 10)).reverse().map(function (r) {
    var st = {};
    try { st = JSON.parse(r[3]); } catch (e) {}
    return { code: r[0], className: r[1], unit: r[2], round: st.round || 0, isOver: r[6] === true || r[6] === 'TRUE', createdAt: r[4] };
  });
}
