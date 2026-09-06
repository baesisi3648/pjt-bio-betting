-- 0005_renewal_levels.sql — 리뉴얼 1단계(규칙 엔진)가 D1 에 요구하는 것 (RENEWAL §1·§3-1).
--
-- 두 가지다.
--
-- 1) 난이도 '중간' → '보통'.
--    `src/game/config.ts` 의 LEVELS 가 정본이고, D1 의 `questions.level` 에는 그 문자열이
--    **그대로** 들어 있다. 코드만 바꾸고 이 줄을 빠뜨리면 옛 문항 18개가 통째로
--    '난이도가 …가 아님' 으로 걸러져서(bank.ts toQuestion), 보통 난이도를 고른 모둠이
--    수업 중에 문제를 못 받는다.
--
-- 2) 시간·트랙 기본값 (라운드 190초 × 10라운드 ≈ 32분).
--    ⚠️ 여기는 INSERT 가 아니라 **UPDATE** 다. 0002 가 이미 여섯 키를 다 넣어 뒀고,
--    INSERT OR IGNORE 로는 이미 있는 행의 값을 못 바꾼다 — 조용히 아무 일도 안 일어나서
--    "마이그레이션은 돌았는데 수업은 옛 시간으로 도는" 상태가 된다.
--
-- ⚠️ 0002·0004 가 INSERT OR IGNORE 인 이유(선생님이 관리 화면에서 고친 값을 덮지 않는다)와
--    달리, 여기서는 **덮는 것이 목적**이다. 옛 기본값(90/180/60초·10칸)은 5~6라운드
--    시절의 값이라 10라운드로는 수업 한 차시에 안 끝난다.

UPDATE questions SET level = '보통' WHERE level = '중간';

UPDATE settings SET value = '15' WHERE key = 'moveSeconds';
UPDATE settings SET value = '40' WHERE key = 'quizSeconds';
UPDATE settings SET value = '90' WHERE key = 'discussSeconds';
UPDATE settings SET value = '45' WHERE key = 'betSeconds';
UPDATE settings SET value = '20' WHERE key = 'trackCells';
