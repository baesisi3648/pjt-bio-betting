#!/usr/bin/env bash
# deploy.sh — 로그인 뒤 배포 끝까지. MIGRATION.md §7 6단계를 한 번에.
#
#   cd web && npx wrangler login      # 먼저 (브라우저 인증)
#   ADMIN_PASSWORD='...' bash scripts/deploy.sh
#
# ⚠️ ADMIN_PASSWORD 는 영문·숫자·기호만. HTTP 헤더는 Latin-1 만 실린다 (§7 6단계).
# ⚠️ 여러 번 돌려도 안전하다 — D1 이 이미 있으면 만들지 않고, 시드는 INSERT OR IGNORE 다.
set -euo pipefail
cd "$(dirname "$0")/.."

DB=wilde-derby

if [ -z "${ADMIN_PASSWORD:-}" ]; then
  echo "ADMIN_PASSWORD 환경변수가 비어 있습니다. 예: ADMIN_PASSWORD='abc-123' bash scripts/deploy.sh" >&2
  exit 1
fi
if LC_ALL=C grep -q '[^ -~]' <<<"$ADMIN_PASSWORD"; then
  echo "ADMIN_PASSWORD 에 영문·숫자·기호가 아닌 글자가 있습니다 (한글·이모지는 HTTP 헤더에 실리지 않습니다)" >&2
  exit 1
fi

npx wrangler whoami >/dev/null 2>&1 || { echo "먼저 npx wrangler login 을 하세요" >&2; exit 1; }

# 1. D1 — 없으면 만들고, id 를 wrangler.jsonc 에 채운다
ID=$(npx wrangler d1 list --json 2>/dev/null | node -e '
  const rows = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const r = rows.find((x) => x.name === process.argv[1]);
  process.stdout.write(r ? r.uuid : "");' "$DB")
if [ -z "$ID" ]; then
  echo "▶ D1 $DB 만들기"
  npx wrangler d1 create "$DB" >/dev/null
  ID=$(npx wrangler d1 list --json | node -e '
    const rows = JSON.parse(require("fs").readFileSync(0, "utf8"));
    process.stdout.write(rows.find((x) => x.name === process.argv[1]).uuid);' "$DB")
fi
echo "▶ D1 database_id = $ID"
node -e '
  const fs = require("fs");
  let s = fs.readFileSync("wrangler.jsonc", "utf8");
  s = s.replace(/"database_id":\s*"[^"]*"/, `"database_id": "${process.argv[1]}"`);
  fs.writeFileSync("wrangler.jsonc", s);' "$ID"

# 2. 스키마 + 시드
echo "▶ 마이그레이션 (원격)"
npx wrangler d1 migrations apply "$DB" --remote

# 3. 관리자 비밀번호
echo "▶ ADMIN_PASSWORD secret"
printf '%s' "$ADMIN_PASSWORD" | npx wrangler secret put ADMIN_PASSWORD

# 4. 빌드 + 배포
echo "▶ 빌드"
npm run build >/dev/null
echo "▶ 배포"
npx wrangler deploy

echo
echo "끝. 이제 MIGRATION.md §7 6단계의 '선생님 폰으로 확인할 것' 10가지를 보세요."
