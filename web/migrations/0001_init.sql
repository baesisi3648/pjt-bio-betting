-- 0001_init.sql — 판 **사이에서** 공유되는 데이터.
--
-- 앱스 스크립트판의 '문제'·'동물'·'설정' 탭과 '게임' 탭의 목록 기능이 여기로 왔다
-- (MIGRATION §6 대응표, §8-5).
--
-- ⚠️ 판 하나의 상태(GameState)는 여기 없다. 그건 Durable Object storage 에 있다.
--    여기에 상태를 두면 6모둠 동시 베팅이 다시 잠금 문제가 된다 (§4-7).
--
--   npx wrangler d1 migrations apply wilde-derby --local
--   npx wrangler d1 migrations apply wilde-derby --remote

CREATE TABLE IF NOT EXISTS questions (
  id          INTEGER PRIMARY KEY,
  unit        TEXT    NOT NULL,
  level       TEXT    NOT NULL,          -- 쉬움 | 중간 | 어려움
  text        TEXT    NOT NULL,
  choice1     TEXT    NOT NULL DEFAULT '',
  choice2     TEXT    NOT NULL DEFAULT '',
  choice3     TEXT    NOT NULL DEFAULT '',
  choice4     TEXT    NOT NULL DEFAULT '',
  answer      INTEGER NOT NULL,          -- 1~4
  explanation TEXT    NOT NULL DEFAULT ''
);

-- 판을 만들 때 단원 하나를 통째로 읽는다. 수업 중에는 한 번도 다시 읽지 않는다 (§4-6)
CREATE INDEX IF NOT EXISTS questions_unit ON questions (unit, level);

-- ⚠️ 정확히 8줄이어야 한다. 그렇지 않으면 판을 만들지 않는다 (src/server/db.ts prepareUnit).
--    코드 A~H 는 게임 코드가 쓰는 이름이라 바꾸면 안 된다 — 이름과 이모지만 바꾸세요
CREATE TABLE IF NOT EXISTS animals (
  code  TEXT PRIMARY KEY,                -- A~H
  name  TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT ''
);

-- key 는 src/game/config.ts 의 Settings 열쇠와 **같은 이름**이어야 한다.
-- 다른 이름을 넣으면 조용히 무시되고 기본값이 쓰인다
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT ''
);

-- '이어하기' 목록용. ⚠️ 이 표는 **인증 없이** 나간다 (GET /api/units).
--    비밀이 될 만한 열을 여기 붙이지 마세요 — 교사 열쇠도 모둠 암호도 여기 없습니다
CREATE TABLE IF NOT EXISTS games (
  code       TEXT    PRIMARY KEY,
  class_name TEXT    NOT NULL,
  unit       TEXT    NOT NULL,
  created_at INTEGER NOT NULL,           -- ms. ⚠️ 문자열 날짜 금지 (MIGRATION §5)
  is_over    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS games_created ON games (created_at DESC);
