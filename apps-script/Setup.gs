/**
 * Setup.gs — 시트 탭과 기본값을 한 번에 만든다.
 * 앱스 스크립트 편집기에서 setupSheets() 를 한 번 실행하면 끝.
 */

function setupSheets() {
  var sheets = ss();

  make(sheets, SHEETS.QUESTIONS, ['단원', '난이도', '문제', '보기1', '보기2', '보기3', '보기4', '정답', '해설']);
  make(sheets, SHEETS.HINTS,     ['난이도', '종류', '문장 틀']);
  make(sheets, SHEETS.ANIMALS,   ['코드', '이름', '그림']);
  make(sheets, SHEETS.SETTINGS,  ['항목', '값', '설명']);
  make(sheets, SHEETS.GAMES,     ['판코드', '반이름', '단원', '상태JSON', '만든시각', '갱신시각', '종료여부']);
  make(sheets, SHEETS.EVENTS,    ['번호', '판코드', '라운드', '모둠', '종류', '내용', '시각']);

  fillOnce(sheets, SHEETS.ANIMALS, [
    ['A', '치타', '🐆'], ['B', '사자', '🦁'], ['C', '호랑이', '🐯'], ['D', '늑대', '🐺'],
    ['E', '얼룩말', '🦓'], ['F', '타조', '🦩'], ['G', '개구리', '🐸'], ['H', '거북이', '🐢']
  ]);

  fillOnce(sheets, SHEETS.SETTINGS, [
    ['초기코인', 20, '모둠당 시작 코인'],
    ['라운드당최대베팅', 3, '한 라운드에 걸 수 있는 코인'],
    ['시드코인', 15, '배당 상한 조절. 낮추면 배당이 튀고 높이면 밋밋해짐'],
    ['문제시간초', 90, '문제 풀이 제한 시간'],
    ['토론시간초', 180, '모둠 토론 시간 (베팅 잠김) — 이 수업의 실체'],
    ['베팅시간초', 60, '베팅 제한 시간'],
    ['트랙칸수', 10, '결승선까지 칸 수'],
    ['학생주소', '', '비워두면 자동. 짧은 주소(bit.ly 등)를 만들어 여기 넣으면 화면·QR에 그게 나옵니다']
  ]);

  ensureSettingRow(sheets, '학생주소', '', '비워두면 자동. 짧은 주소(bit.ly 등)를 만들어 여기 넣으면 화면·QR에 그게 나옵니다');

  fillOnce(sheets, SHEETS.HINTS, [
    ['어려움', '상위확정', '{X}는 1·2·3등 안에 반드시 듭니다.'],
    ['어려움', '둘비교',   '{X}가 {Y}보다 순위가 높습니다.'],
    ['어려움', '제외',     '{X}는 1·2·3등에 들지 못합니다.'],
    ['중간',   '둘비교',   '{X}가 {Y}보다 순위가 높습니다.'],
    ['중간',   '사이끼움', '{X}는 {Y}보다 느리고 {Z}보다 빠릅니다.'],
    ['쉬움',   '범위',     '{X}는 {N}등 이하입니다.'],
    ['쉬움',   '제외',     '{X}는 1·2·3등에 들지 못합니다.'],
    ['쉬움',   '부정확정', '{X}는 최종 1등이 아닙니다.']
  ]);

  SpreadsheetApp.getUi().alert(
    '시트 준비 완료\n\n' +
    "이제 '문제' 탭에 문제를 넣어주세요.\n" +
    '단원마다 난이도별 6문항(총 18문항) 이상이면 충분합니다.'
  );
}

/** 이미 만들어진 설정 탭에도 빠진 행을 채워 넣는다 */
function ensureSettingRow(book, key, value, note) {
  var sh = book.getSheetByName(SHEETS.SETTINGS);
  if (!sh) return;
  var v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]).trim() === key) return;
  sh.appendRow([key, value, note]);
}

function make(book, name, header) {
  var sh = book.getSheetByName(name) || book.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(header);
    sh.getRange(1, 1, 1, header.length).setFontWeight('bold').setBackground('#EEF2F6');
    sh.setFrozenRows(1);
  }
  return sh;
}

function fillOnce(book, name, rows) {
  var sh = book.getSheetByName(name);
  if (sh.getLastRow() > 1) return;          // 이미 채워져 있으면 건드리지 않는다
  sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

/** 개발용 샘플 문제 (유전 단원 18문항) */
function insertSampleQuestions() {
  var sh = ss().getSheetByName(SHEETS.QUESTIONS);
  var U = '유전';
  var rows = [
    [U,'쉬움','DNA의 기본 단위는?','뉴클레오타이드','아미노산','포도당','지방산',1,'DNA는 뉴클레오타이드가 이어진 중합체다.'],
    [U,'쉬움','사람의 체세포 염색체 수는?','23개','46개','44개','92개',2,'상염색체 44 + 성염색체 2 = 46개.'],
    [U,'쉬움','성염색체 구성이 XY인 사람의 성별은?','여자','남자','알 수 없음','둘 다 가능',2,''],
    [U,'쉬움','유전자가 놓여 있는 구조물은?','리보솜','염색체','미토콘드리아','골지체',2,''],
    [U,'쉬움','ABO식 혈액형에서 O형의 유전자형은?','AO','BO','OO','AB',3,''],
    [U,'쉬움','감수분열로 만들어지는 세포는?','체세포','생식세포','줄기세포','신경세포',2,''],
    [U,'중간','반성유전에 해당하는 형질은?','ABO식 혈액형','적록색맹','키','귓불 모양',2,'적록색맹 유전자는 X염색체에 있다.'],
    [U,'중간','AA × aa 교배에서 자손 F1의 유전자형은?','AA','Aa','aa','AA와 aa',2,''],
    [U,'중간','Aa × Aa 교배에서 열성 표현형이 나올 확률은?','1/2','1/4','3/4','0',2,''],
    [U,'중간','감수분열 결과 딸세포의 염색체 수는 모세포의?','2배','같음','1/2','1/4',3,''],
    [U,'중간','다인자 유전의 예로 알맞은 것은?','혈우병','키','적록색맹','ABO식 혈액형',2,''],
    [U,'중간','상염색체 열성 유전병의 특징은?','남자에게만 나타남','부모가 정상이어도 자녀에게 나타날 수 있음','항상 아버지에게서 유전','여자에게만 나타남',2,''],
    [U,'어려움','정상 부모 사이에서 유전병 아들이 태어났다. 가능한 유전 방식은?','상염색체 우성','상염색체 열성 또는 반성 열성','반성 우성','Y염색체 유전',2,'정상 부모에게서 나왔으므로 열성이다.'],
    [U,'어려움','적록색맹 어머니와 정상 아버지 사이 아들의 적록색맹 확률은?','0','1/4','1/2','1',4,'어머니가 XcXc이므로 아들은 모두 Xc Y.'],
    [U,'어려움','AaBb × AaBb 교배에서 A_B_ 표현형 비율은?','9/16','3/16','1/16','1/4',1,''],
    [U,'어려움','가계도에서 형질이 딸에게만 나타난다면 가장 가능성이 낮은 것은?','상염색체 우성','상염색체 열성','반성 우성','Y염색체 유전',4,'Y염색체 유전은 아들에게만 나타난다.'],
    [U,'어려움','연관된 두 유전자가 교차 없이 유전될 때 배우자 종류는?','2가지','4가지','8가지','16가지',1,''],
    [U,'어려움','ABO식 혈액형에서 A형 아버지와 B형 어머니 사이에 나올 수 없는 혈액형은?','A형','B형','O형','없음',4,'AO × BO면 네 혈액형이 모두 가능하다.']
  ];
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

/**
 * 시트가 실제로 어떤 상태인지 그대로 보여준다.
 * "왜 단원이 안 나오지?" 같은 걸 추측하지 않고 눈으로 확인하기 위한 것.
 */
function 시트_상태_확인() {
  var lines = [];

  try {
    var q = readQuestions();
    lines.push('■ 문제 탭 — 쓸 수 있는 문항 ' + q.rows.length + '개');

    var byUnit = {};
    q.rows.forEach(function (x) {
      byUnit[x.unit] = byUnit[x.unit] || { '쉬움': 0, '중간': 0, '어려움': 0 };
      byUnit[x.unit][x.level]++;
    });
    var units = Object.keys(byUnit);
    if (units.length === 0) {
      lines.push('   ⚠️ 단원이 하나도 없습니다 → 드롭다운이 비어 보입니다');
    } else {
      units.forEach(function (u) {
        var b = byUnit[u];
        lines.push('   · ' + u + ' — 쉬움 ' + b['쉬움'] + ' / 중간 ' + b['중간'] + ' / 어려움 ' + b['어려움']);
      });
    }
    if (q.skipped.length) {
      lines.push('');
      lines.push('■ 무시된 행 ' + q.skipped.length + '개');
      q.skipped.slice(0, 8).forEach(function (m) { lines.push('   · ' + m); });
      if (q.skipped.length > 8) lines.push('   · … 외 ' + (q.skipped.length - 8) + '개');
    }
  } catch (e) {
    lines.push('■ 문제 탭을 읽지 못했습니다: ' + e.message);
  }

  lines.push('');
  try {
    var a = readAnimals();
    lines.push(a.ok ? '■ 동물 탭 — 정상 (8줄)' : '■ 동물 탭 — ⚠️ ' + a.message);
  } catch (e2) { lines.push('■ 동물 탭 — 읽기 실패: ' + e2.message); }

  try {
    var s = readSettings();
    lines.push('■ 설정 — 시드 ' + s.seedCoins + ' / 문제 ' + s.quizSeconds +
               '초 / 토론 ' + s.discussSeconds + '초 / 베팅 ' + s.betSeconds + '초');
  } catch (e3) { lines.push('■ 설정 탭 — 읽기 실패: ' + e3.message); }

  lines.push('■ 학생 주소 — ' + webAppUrl());
  lines.push('■ 코드 버전 — ' + DEPLOY_VERSION);
  lines.push('');
  lines.push('단원이 위에 보이는데 교사 화면 드롭다운이 비었다면,');
  lines.push('교사 화면을 새로고침하거나 「다시 불러오기」를 누르세요.');
  lines.push('(단원 목록은 화면을 열 때 한 번만 읽어옵니다)');

  SpreadsheetApp.getUi().alert(lines.join('\n'));
}

/**
 * 교사 열쇠를 다시 본다.
 *
 * 열쇠는 판을 만든 브라우저에만 저장된다. 다른 기기에서 이어하거나
 * 브라우저 기록을 지웠으면 여기서 다시 받는다.
 * 이 메뉴는 스프레드시트에서만 보이고 시트는 교사만 열 수 있으므로,
 * 이것이 열쇠를 되찾는 안전한 통로다.
 */
function 교사_열쇠_확인() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('교사 열쇠 확인', '판 코드 4자리를 넣어주세요', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var code = String(res.getResponseText() || '').toUpperCase().trim();
  var state = null;
  try { state = loadState(code); } catch (e) {
    ui.alert('판을 읽지 못했습니다: ' + e.message);
    return;
  }
  if (!state) { ui.alert("'" + code + "' 판을 찾지 못했어요. 코드를 다시 확인해주세요."); return; }

  // 이 수정 이전에 만든 판에는 열쇠가 없다. 여기서 한 번 발급해 붙여준다
  if (!state.hostKey) {
    state.hostKey = makeHostKey();
    saveSnapshot(state);
  }

  ui.alert(
    '판 ' + code + ' 의 교사 열쇠\n\n' + state.hostKey +
    '\n\n─────────────\n' +
    "교사 화면에서 '판 코드로 이어하기' 를 누르고 코드와 함께 넣으세요.\n" +
    '⚠️ 학생에게는 보여주지 마세요. 이 열쇠로 정답 순위와 모둠 암호를 볼 수 있습니다.'
  );
}

/** 스프레드시트 메뉴에 넣기 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('와일드 더비')
    .addItem('① 시트 준비하기', 'setupSheets')
    .addItem('② 문제은행 넣기 (54문항)', 'insertQuestionBank')
    .addItem('③ 검사 돌리기', 'test_모두')
    .addSeparator()
    .addItem('시트 상태 확인', '시트_상태_확인')
    .addItem('학생 주소 확인', '학생주소_확인')
    .addItem('교사 열쇠 확인', '교사_열쇠_확인')
    .addSeparator()
    .addItem('샘플 문제만 넣기 (개발용)', 'insertSampleQuestions')
    .addToUi();
}
