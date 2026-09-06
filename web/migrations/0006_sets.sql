-- 0006_sets.sql — '단원' 을 **문제 세트**로 (RENEWAL §3-1, 리뉴얼 2단계).
--
-- 바뀌는 것은 **이름뿐이고 값은 그대로**다. 예전 단원 이름('유전'·'항상성'…)이 곧
-- 세트 이름이 된다. 그래서 UPDATE 가 한 줄도 없다 — 데이터를 옮기면 되돌릴 수 없고,
-- 되돌릴 수 없는 것을 이름 하나 때문에 할 이유가 없다.
--
-- ⚠️ `ALTER TABLE … RENAME COLUMN` 은 SQLite 3.25+ 기능이고 D1 은 그보다 새 엔진이다.
--    새 표를 만들어 복사하는 방식(예전 SQLite 관습)을 쓰지 마세요 — 그러면 questions.id 가
--    다시 매겨질 수 있고, 이미 만들어져 도는 판의 상태에는 옛 id 가 굳어 있다 (MIGRATION §4-6).
--
-- ⚠️ 인덱스는 RENAME COLUMN 이 **자동으로 따라온다** (정의 안의 열 이름이 같이 바뀐다).
--    그래도 `questions_unit` 이라는 이름만 남으면, 나중에 열 목록을 보고 "이 인덱스는
--    unit 이라는 없는 열을 건다" 고 읽게 된다. 이름까지 맞춰 둔다.
--
--   npx wrangler d1 migrations apply wilde-derby --local
--   npx wrangler d1 migrations apply wilde-derby --remote   (push 하면 자동으로 돈다)

ALTER TABLE questions RENAME COLUMN unit TO set_name;

DROP INDEX IF EXISTS questions_unit;
CREATE INDEX IF NOT EXISTS questions_set ON questions (set_name, level);

-- '이어하기' 목록의 그 판이 어느 세트로 만들어졌는지. 세트를 안 고르고(전체 은행) 만든
-- 판에는 '(전체)' 가 들어간다 (src/server/bank.ts ALL_SETS).
-- ⚠️ 이 표는 **인증 없이** 나간다 (GET /api/units). 비밀이 될 열을 여기 붙이지 마세요
ALTER TABLE games RENAME COLUMN unit TO set_name;
