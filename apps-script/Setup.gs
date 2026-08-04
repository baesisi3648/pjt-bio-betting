/**
 * Setup.gs — 시트 탭과 기본값을 한 번에 만든다.
 * 앱스 스크립트 편집기에서 setupSheets() 를 한 번 실행하면 끝.
 */

function setupSheets() {
  var ss = SpreadsheetApp.getActive();

  make(ss, SHEETS.QUESTIONS, ['단원', '난이도', '문제', '보기1', '보기2', '보기3', '보기4', '정답', '해설']);
  make(ss, SHEETS.HINTS,     ['난이도', '종류', '문장 틀']);
  make(ss, SHEETS.ANIMALS,   ['코드', '이름', '그림']);
  make(ss, SHEETS.SETTINGS,  ['항목', '값', '설명']);
  make(ss, SHEETS.GAMES,     ['판코드', '반이름', '단원', '상태JSON', '만든시각', '갱신시각', '종료여부']);
  make(ss, SHEETS.EVENTS,    ['번호', '판코드', '라운드', '모둠', '종류', '내용', '시각']);

  fillOnce(ss, SHEETS.ANIMALS, [
    ['A', '치타', '🐆'], ['B', '사자', '🦁'], ['C', '호랑이', '🐯'], ['D', '늑대', '🐺'],
    ['E', '얼룩말', '🦓'], ['F', '타조', '🦩'], ['G', '개구리', '🐸'], ['H', '거북이', '🐢']
  ]);

  fillOnce(ss, SHEETS.SETTINGS, [
    ['초기코인', 20, '모둠당 시작 코인'],
    ['라운드당최대베팅', 3, '한 라운드에 걸 수 있는 코인'],
    ['시드코인', 15, '배당 상한 조절. 낮추면 배당이 튀고 높이면 밋밋해짐'],
    ['문제시간초', 90, '문제 풀이 제한 시간'],
    ['토론시간초', 180, '모둠 토론 시간 (베팅 잠김) — 이 수업의 실체'],
    ['베팅시간초', 60, '베팅 제한 시간'],
    ['트랙칸수', 10, '결승선까지 칸 수'],
    ['학생주소', '', '비워두면 자동. 학생이 "파일을 열 수 없습니다"라고 하면 배포 주소(/exec)를 여기에 넣으세요']
  ]);

  ensureSettingRow(ss, '학생주소', '', '비워두면 자동. 학생이 "파일을 열 수 없습니다"라고 하면 배포 주소(/exec)를 여기에 넣으세요');

  fillOnce(ss, SHEETS.HINTS, [
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
function ensureSettingRow(ss, key, value, note) {
  var sh = ss.getSheetByName(SHEETS.SETTINGS);
  if (!sh) return;
  var v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]).trim() === key) return;
  sh.appendRow([key, value, note]);
}

function make(ss, name, header) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(header);
    sh.getRange(1, 1, 1, header.length).setFontWeight('bold').setBackground('#EEF2F6');
    sh.setFrozenRows(1);
  }
  return sh;
}

function fillOnce(ss, name, rows) {
  var sh = ss.getSheetByName(name);
  if (sh.getLastRow() > 1) return;          // 이미 채워져 있으면 건드리지 않는다
  sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

/** 개발용 샘플 문제 (유전 단원 18문항) */
function insertSampleQuestions() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.QUESTIONS);
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

/** 스프레드시트 메뉴에 넣기 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('와일드 더비')
    .addItem('① 시트 준비하기', 'setupSheets')
    .addItem('② 문제은행 넣기 (54문항)', 'insertQuestionBank')
    .addItem('③ 검사 돌리기', 'test_모두')
    .addSeparator()
    .addItem('학생 주소 확인', '학생주소_확인')
    .addSeparator()
    .addItem('샘플 문제만 넣기 (개발용)', 'insertSampleQuestions')
    .addToUi();
}
