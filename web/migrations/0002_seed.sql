-- 0002_seed.sql — **생성된 파일입니다. 손으로 고치지 마세요.**
--
--   cd web && npm run seed        (scripts/import-questions.ts)
--
-- 출처: apps-script/Questions.gs 의 QUESTION_BANK 54문항,
--       apps-script/Setup.gs 의 동물 8종·설정 기본값
--
-- INSERT OR IGNORE 인 이유: 선생님이 나중에 문항을 고쳤는데 이 시드가 다시 돌면
-- 그 수정이 조용히 사라진다. 되살리려면 그 행을 지우고 다시 넣어야 한다.

-- ── 동물 8종 (코드 A~H 는 게임 코드가 쓰는 이름이라 바꾸면 안 된다) ──
INSERT OR IGNORE INTO animals (code, name, emoji) VALUES ('A', '치타', '🐆');
INSERT OR IGNORE INTO animals (code, name, emoji) VALUES ('B', '사자', '🦁');
INSERT OR IGNORE INTO animals (code, name, emoji) VALUES ('C', '호랑이', '🐯');
INSERT OR IGNORE INTO animals (code, name, emoji) VALUES ('D', '늑대', '🐺');
INSERT OR IGNORE INTO animals (code, name, emoji) VALUES ('E', '얼룩말', '🦓');
INSERT OR IGNORE INTO animals (code, name, emoji) VALUES ('F', '타조', '🦩');
INSERT OR IGNORE INTO animals (code, name, emoji) VALUES ('G', '개구리', '🐸');
INSERT OR IGNORE INTO animals (code, name, emoji) VALUES ('H', '거북이', '🐢');

-- ── 설정 (key 는 src/game/config.ts 의 Settings 열쇠와 같아야 한다) ──
INSERT OR IGNORE INTO settings (key, value, label) VALUES ('initialCoins', '20', '초기코인');
INSERT OR IGNORE INTO settings (key, value, label) VALUES ('maxBetPerRound', '3', '라운드당최대베팅');
INSERT OR IGNORE INTO settings (key, value, label) VALUES ('seedCoins', '15', '시드코인');
INSERT OR IGNORE INTO settings (key, value, label) VALUES ('quizSeconds', '90', '문제시간초');
INSERT OR IGNORE INTO settings (key, value, label) VALUES ('discussSeconds', '180', '토론시간초');
INSERT OR IGNORE INTO settings (key, value, label) VALUES ('betSeconds', '60', '베팅시간초');
INSERT OR IGNORE INTO settings (key, value, label) VALUES ('trackCells', '10', '트랙칸수');
INSERT OR IGNORE INTO settings (key, value, label) VALUES ('moveSeconds', '20', '경주시간초');

-- ── 문항 54개 ──
--   사람의 물질대사 18문항
--   항상성과 몸의 조절 18문항
--   유전 18문항

INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (1, '사람의 물질대사', '쉬움', '세포 호흡이 주로 일어나는 세포 소기관은?', '미토콘드리아', '골지체', '액포', '리보솜', 1, '미토콘드리아에서 포도당이 산소와 반응해 ATP를 만든다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (2, '사람의 물질대사', '쉬움', '물질대사에서 에너지를 저장하고 전달하는 물질은?', '인슐린', '헤모글로빈', 'DNA', 'ATP', 4, 'ATP는 고에너지 인산 결합에 에너지를 저장한다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (3, '사람의 물질대사', '쉬움', '단백질이 분해될 때 생기는 질소 노폐물은?', '이산화 탄소', '포도당', '젖산', '암모니아', 4, '단백질에는 질소가 있어 분해 시 암모니아가 생긴다. 간에서 요소로 바뀐다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (4, '사람의 물질대사', '쉬움', '암모니아를 독성이 약한 요소로 바꾸는 기관은?', '폐', '콩팥', '이자', '간', 4, '간에서 요소로 바뀌고, 콩팥에서 오줌으로 나간다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (5, '사람의 물질대사', '쉬움', '다음 중 배설계에 속하는 기관은?', '위', '심장', '콩팥', '폐', 3, '배설계는 콩팥·오줌관·방광·요도로 이루어진다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (6, '사람의 물질대사', '쉬움', '기초 대사량에 대한 설명으로 옳은 것은?', '운동할 때 쓰는 에너지량', '음식으로 섭취한 에너지량', '생명 유지에 필요한 최소한의 에너지량', '하루에 쓰는 전체 에너지량', 3, '체온 유지, 심장 박동 등 살아 있기만 해도 쓰는 에너지다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (7, '사람의 물질대사', '중간', '동화 작용에 해당하는 것만을 고른 것은?', '세포 호흡, 소화', '세포 호흡, 광합성', '단백질 합성, 광합성', '소화, 발효', 3, '동화 작용은 작은 물질을 큰 물질로 만들며 에너지를 흡수한다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (8, '사람의 물질대사', '중간', '세포 호흡과 연소의 공통점으로 옳은 것은?', '산소를 사용하고 에너지가 방출된다', '여러 단계를 거쳐 천천히 일어난다', '체온 정도의 낮은 온도에서 일어난다', '효소가 관여한다', 1, '나머지 세 가지는 세포 호흡에만 해당한다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (9, '사람의 물질대사', '중간', '탄수화물이 세포 호흡으로 분해될 때 생기는 노폐물은?', '물과 요소', '이산화 탄소와 암모니아', '암모니아와 요소', '이산화 탄소와 물', 4, '탄수화물과 지방은 C, H, O로 이루어져 CO2와 H2O만 생긴다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (10, '사람의 물질대사', '중간', 'ATP와 ADP에 대한 설명으로 옳은 것은?', 'ATP가 ADP로 분해될 때 에너지가 방출된다', 'ADP는 세포 호흡에서 만들어지지 않는다', 'ATP는 유전 정보를 저장한다', 'ADP가 ATP보다 인산이 하나 더 많다', 1, 'ATP → ADP + 무기 인산 + 에너지.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (11, '사람의 물질대사', '중간', '산소가 세포까지 전달되는 경로로 옳은 것은?', '혈액 → 폐 → 조직 세포', '조직 세포 → 혈액 → 폐', '폐 → 소화계 → 조직 세포', '폐 → 혈액 → 조직 세포', 4, '호흡계에서 흡수한 산소를 순환계가 조직 세포로 나른다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (12, '사람의 물질대사', '중간', '기관계의 통합적 작용에 대한 설명으로 옳지 않은 것은?', '소화계는 영양소를 흡수한다', '호흡계는 산소를 흡수하고 이산화 탄소를 내보낸다', '순환계는 물질을 온몸으로 나른다', '배설계는 소화되지 않은 음식물 찌꺼기를 내보낸다', 4, '음식물 찌꺼기는 소화계에서 대변으로 나간다. 배설계는 세포에서 생긴 노폐물을 처리한다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (13, '사람의 물질대사', '어려움', '에너지 섭취량이 소비량보다 지속적으로 많을 때 나타나는 현상으로 옳은 것은?', '물질대사가 멈춘다', '체지방이 늘고 비만이 될 수 있다', '세포 호흡이 일어나지 않는다', '기초 대사량이 0이 된다', 2, '남는 에너지는 지방으로 저장된다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (14, '사람의 물질대사', '어려움', '대사성 질환에 대한 설명으로 옳은 것만을 고른 것은?', '대사성 질환은 생활 습관과 무관하다', '고혈압은 물질대사와 관련이 없다', '대사성 질환은 모두 감염으로 생긴다', '당뇨병은 혈당량 조절에 이상이 생긴 질환이다', 4, '대사성 질환은 물질대사 이상으로 생기며 생활 습관의 영향을 크게 받는다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (15, '사람의 물질대사', '어려움', '세포 호흡 결과 생긴 이산화 탄소가 몸 밖으로 나가는 경로로 옳은 것은?', '조직 세포 → 혈액 → 콩팥 → 오줌', '조직 세포 → 간 → 요소 → 오줌', '조직 세포 → 혈액 → 폐 → 날숨', '조직 세포 → 소화계 → 대변', 3, 'CO2는 기체라 폐로 나간다. 질소 노폐물만 콩팥으로 간다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (16, '사람의 물질대사', '어려움', '간의 기능에 해당하지 않는 것은?', '쓸개즙을 만든다', '암모니아를 요소로 바꾼다', '오줌을 만들어 노폐물을 걸러낸다', '포도당을 글리코젠으로 저장한다', 3, '오줌을 만드는 것은 콩팥이다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (17, '사람의 물질대사', '어려움', '효소에 대한 설명으로 옳은 것은?', '한 효소가 모든 기질에 작용한다', '반응이 끝나면 소모되어 없어진다', '반응에 필요한 활성화 에너지를 낮춘다', '온도가 높을수록 활성이 계속 커진다', 3, '효소는 촉매라 소모되지 않고, 기질 특이성이 있으며, 최적 온도를 넘으면 변성된다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (18, '사람의 물질대사', '어려움', '다음 중 이화 작용에 해당하는 것만을 모두 고른 것은?', '광합성, 세포 호흡', '소화, 세포 호흡', '소화, 단백질 합성', '단백질 합성, 광합성', 2, '이화 작용은 큰 물질을 작게 쪼개며 에너지를 방출한다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (19, '항상성과 몸의 조절', '쉬움', '뉴런에서 다른 뉴런의 신호를 받아들이는 부분은?', '말이집', '축삭 돌기', '가지 돌기', '랑비에 결절', 3, '가지 돌기로 받아 축삭 돌기로 내보낸다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (20, '항상성과 몸의 조절', '쉬움', '중추 신경계를 이루는 것은?', '뇌와 척수', '뇌와 감각 기관', '척수와 근육', '말초 신경과 근육', 1, '중추 신경계는 뇌와 척수, 나머지는 말초 신경계다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (21, '항상성과 몸의 조절', '쉬움', '긴장하거나 위급할 때 주로 작용하는 신경은?', '교감 신경', '운동 신경', '감각 신경', '부교감 신경', 1, '교감 신경은 심장 박동을 빠르게 하는 등 몸을 긴장 상태로 만든다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (22, '항상성과 몸의 조절', '쉬움', '혈당량을 낮추는 호르몬은?', '티록신', '글루카곤', '아드레날린', '인슐린', 4, '인슐린은 이자에서 나와 포도당을 글리코젠으로 저장시킨다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (23, '항상성과 몸의 조절', '쉬움', '항상성에 대한 설명으로 옳은 것은?', '유전 정보를 전달하는 성질', '환경에 따라 몸 상태가 계속 변하는 성질', '몸속 상태를 일정하게 유지하려는 성질', '자극을 받아들이는 능력', 3, '체온, 혈당량, 삼투압 등을 일정하게 유지한다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (24, '항상성과 몸의 조절', '쉬움', '병원체에 감염되었을 때 가장 먼저 작용하는 비특이적 방어 작용은?', '항체 생성', '세포성 면역', '식균 작용', '기억 세포 형성', 3, '식균 작용은 병원체 종류를 가리지 않고 즉시 일어난다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (25, '항상성과 몸의 조절', '중간', '흥분 전달에 대한 설명으로 옳은 것은?', '축삭 돌기에서 가지 돌기 방향으로는 전달되지 않는다', '신경 전달 물질 없이 전기로만 전달된다', '시냅스에서 양방향으로 전달된다', '시냅스에서는 한쪽 방향으로만 전달된다', 4, '신경 전달 물질이 축삭 돌기 말단에서만 나오므로 방향이 한쪽이다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (26, '항상성과 몸의 조절', '중간', '분극 상태인 뉴런의 막전위에 대한 설명으로 옳은 것은?', '세포 안이 밖에 비해 음(-)전하를 띤다', '안과 밖의 전위차가 없다', '나트륨 이온이 안으로 계속 들어온다', '세포 안이 밖에 비해 양(+)전하를 띤다', 1, '휴지 전위는 약 -70mV로 안쪽이 음전하다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (27, '항상성과 몸의 조절', '중간', '부교감 신경이 작용할 때 나타나는 반응으로 옳은 것은?', '심장 박동이 느려진다', '소화액 분비가 줄어든다', '혈압이 올라간다', '동공이 커진다', 1, '부교감 신경은 몸을 안정 상태로 되돌린다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (28, '항상성과 몸의 조절', '중간', '티록신 분비량이 지나치게 많아졌을 때 일어나는 조절로 옳은 것은?', '뇌하수체에서 갑상샘 자극 호르몬 분비가 줄어든다', '티록신이 계속 늘어난다', '갑상샘이 더 커진다', '뇌하수체에서 갑상샘 자극 호르몬 분비가 늘어난다', 1, '음성 피드백으로 상위 기관의 분비가 억제된다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (29, '항상성과 몸의 조절', '중간', '추울 때 체온을 유지하기 위한 반응으로 옳지 않은 것은?', '털이 선다', '피부 근처 혈관이 확장된다', '티록신 분비가 늘어난다', '몸이 떨린다', 2, '추울 때는 혈관이 수축해 열 방출을 줄인다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (30, '항상성과 몸의 조절', '중간', '호르몬과 신경의 작용을 비교한 것으로 옳은 것은?', '호르몬은 신경보다 빠르게 전달된다', '호르몬은 신경보다 느리지만 효과가 오래 간다', '호르몬은 특정 기관에만 연결된 통로로 전달된다', '신경은 혈액을 따라 이동한다', 2, '호르몬은 혈액을 타고 이동해 느리지만 지속적이다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (31, '항상성과 몸의 조절', '어려움', '활동 전위가 발생할 때 일어나는 이온 이동 순서로 옳은 것은?', 'K+ 유출 후 Na+ 유입', 'Na+ 유입 후 K+ 유출', 'K+ 유입 후 Na+ 유출', 'Na+ 유출 후 K+ 유입', 2, '탈분극에서 Na+가 들어오고, 재분극에서 K+가 나간다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (32, '항상성과 몸의 조절', '어려움', '식사 후 혈당량이 올라갔을 때 몸에서 일어나는 변화로 옳은 것은?', '이자에서 글루카곤 분비가 늘어난다', '콩팥에서 포도당 재흡수가 멈춘다', '이자에서 인슐린 분비가 늘고 간에서 글리코젠 합성이 촉진된다', '간에서 글리코젠이 포도당으로 분해된다', 3, '혈당이 높아지면 인슐린이 나와 포도당을 저장한다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (33, '항상성과 몸의 조절', '어려움', '땀을 많이 흘려 체액의 삼투압이 높아졌을 때의 조절로 옳은 것은?', '오줌 양이 많아진다', '항이뇨 호르몬 분비가 늘어 콩팥에서 물 재흡수가 촉진된다', '항이뇨 호르몬 분비가 줄어든다', '오줌의 농도가 묽어진다', 2, 'ADH가 물을 다시 흡수해 체액 농도를 낮춘다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (34, '항상성과 몸의 조절', '어려움', '2차 면역 반응이 1차 면역 반응보다 빠르고 강한 이유로 옳은 것은?', '항원이 약해졌기 때문', '기억 세포가 남아 있어 빠르게 형질 세포로 분화하기 때문', '식균 작용이 사라졌기 때문', '항체 구조가 단순해졌기 때문', 2, '기억 세포 덕분에 잠복기 없이 대량의 항체가 만들어진다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (35, '항상성과 몸의 조절', '어려움', '백신의 원리로 옳은 것은?', '이미 만들어진 항체를 직접 주입한다', '병원체를 직접 죽이는 약을 넣는다', '면역 반응을 억제해 증상을 없앤다', '약화시킨 병원체를 넣어 기억 세포를 만들게 한다', 4, '백신은 1차 면역 반응을 일으켜 기억 세포를 남긴다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (36, '항상성과 몸의 조절', '어려움', '세포성 면역과 체액성 면역을 비교한 것으로 옳은 것은?', '체액성 면역은 항체가, 세포성 면역은 세포독성 T림프구가 주로 작용한다', '체액성 면역에는 림프구가 관여하지 않는다', '세포성 면역은 B림프구가 담당한다', '둘 다 항체가 직접 작용한다', 1, '체액성 면역은 형질 세포의 항체, 세포성 면역은 T림프구가 감염 세포를 직접 파괴한다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (37, '유전', '쉬움', 'DNA를 이루는 기본 단위는?', '뉴클레오타이드', '포도당', '지방산', '아미노산', 1, '인산 + 당 + 염기가 결합한 것이 뉴클레오타이드다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (38, '유전', '쉬움', '사람의 체세포 1개에 들어 있는 염색체 수는?', '92개', '23개', '44개', '46개', 4, '상염색체 44개 + 성염색체 2개 = 46개.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (39, '유전', '쉬움', '사람의 남자를 결정하는 성염색체 구성은?', 'XO', 'XY', 'XX', 'YY', 2, '여자는 XX, 남자는 XY다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (40, '유전', '쉬움', '감수 분열 결과 만들어지는 딸세포의 염색체 수는 모세포의 몇 배인가?', '1/2배', '2배', '같다', '1/4배', 1, '2회 분열로 염색체 수가 절반이 된다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (41, '유전', '쉬움', '모양과 크기가 같아 쌍을 이루는 염색체를 무엇이라 하는가?', '상동 염색체', '염색 분체', '반성 염색체', '성염색체', 1, '어머니와 아버지에게서 하나씩 받은 짝이다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (42, '유전', '쉬움', '대립유전자 A와 a를 모두 가진 개체의 유전자형을 무엇이라 하는가?', '열성 순종', '우성 순종', '동형 접합성', '이형 접합성', 4, '서로 다른 대립유전자를 가지면 이형 접합성이다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (43, '유전', '중간', 'Aa × Aa 교배에서 자손의 표현형 비로 옳은 것은? (A가 a에 대해 완전 우성)', '모두 우성', '우성 : 열성 = 3 : 1', '우성 : 열성 = 1 : 1', '우성 : 열성 = 1 : 3', 2, 'AA : Aa : aa = 1 : 2 : 1 이므로 표현형은 3 : 1.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (44, '유전', '중간', '체세포 분열과 감수 분열의 차이로 옳은 것은?', '감수 분열은 1회만 분열한다', '체세포 분열로 생식세포가 만들어진다', '체세포 분열에서 염색체 수가 절반이 된다', '감수 분열에서만 상동 염색체가 접합하여 2가 염색체를 만든다', 4, '2가 염색체 형성은 감수 1분열의 특징이다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (45, '유전', '중간', 'ABO식 혈액형에서 O형인 사람의 유전자형은?', 'AO', 'OO', 'BO', 'AB', 2, 'O는 A와 B에 대해 열성이라 OO여야 O형이 된다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (46, '유전', '중간', '다인자 유전에 해당하는 형질은?', '귓불 모양', 'ABO식 혈액형', '적록 색맹', '사람의 키', 4, '여러 유전자가 함께 작용해 연속적인 변이가 나타난다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (47, '유전', '중간', '반성유전에 해당하는 형질은?', 'ABO식 혈액형', '키', '미맹', '적록 색맹', 4, '적록 색맹 유전자는 X 염색체에 있다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (48, '유전', '중간', '상염색체 열성 유전병의 특징으로 옳은 것은?', '부모가 모두 정상이어도 자녀에게 나타날 수 있다', '남자에게만 나타난다', '여자에게만 나타난다', '반드시 부모 중 한 명에게 나타난다', 1, '부모가 모두 보인자(이형 접합성)이면 자녀에게 나타날 수 있다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (49, '유전', '어려움', '정상인 부모 사이에서 유전병인 아들이 태어났다. 가능한 유전 방식은?', '상염색체 열성 또는 반성 열성', 'Y 염색체 유전', '상염색체 우성', '반성 우성', 1, '정상 부모에게서 나타났으므로 열성이다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (50, '유전', '어려움', '적록 색맹인 어머니와 정상인 아버지 사이에서 태어난 아들이 적록 색맹일 확률은?', '25%', '0%', '100%', '50%', 3, '어머니가 X''X''이므로 아들은 모두 X''Y가 되어 색맹이다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (51, '유전', '어려움', 'AaBb × AaBb 교배에서 A_B_ 표현형이 나올 확률은? (두 유전자는 독립)', '1/4', '9/16', '3/16', '1/16', 2, 'A_가 3/4, B_가 3/4이므로 3/4 × 3/4 = 9/16.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (52, '유전', '어려움', '어떤 유전병이 아버지와 그 아들에게만 나타나고 어머니와 딸에게는 전혀 나타나지 않았다. 이 형질의 유전 방식으로 가장 알맞은 것은?', '상염색체 열성', '상염색체 우성', '반성 열성', 'Y 염색체 유전', 4, 'Y 염색체는 아버지에게서 아들에게만 그대로 전달되므로 딸에게는 나타나지 않는다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (53, '유전', '어려움', '두 유전자가 같은 염색체에 연관되어 있고 교차가 일어나지 않을 때, 만들어지는 생식세포의 종류는 몇 가지인가?', '4가지', '2가지', '8가지', '1가지', 2, '연관되어 함께 이동하므로 조합이 2가지로 줄어든다.');
INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)
VALUES (54, '유전', '어려움', 'A형인 아버지와 B형인 어머니 사이에서 태어날 수 없는 혈액형은?', 'AB형', '없다 (네 혈액형 모두 가능하다)', 'O형', 'A형', 2, '아버지가 AO, 어머니가 BO이면 AB·A·B·O가 모두 나올 수 있다.');
