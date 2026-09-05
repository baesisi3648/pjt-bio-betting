/**
 * import-questions.ts — 앱스 스크립트의 문제은행·동물·설정 기본값을 **읽어서**
 * D1 시드 마이그레이션(`migrations/0002_seed.sql`)을 만든다.
 *
 *   node scripts/import-questions.ts
 *
 * ⚠️ `apps-script/` 는 **읽기만** 한다. 그쪽은 배포돼 수업에 쓰이고 있다 (MIGRATION §9-1).
 *
 * 왜 손으로 SQL 을 안 쓰고 스크립트를 두는가:
 *   54문항을 손으로 옮기면 오타가 나고, 앱스 스크립트판에서 문제를 고쳤을 때
 *   두 벌이 조용히 갈라진다. 여기서는 다시 돌리면 되고, git diff 로 뭐가 달라졌는지 보인다.
 *   (5단계에서 문제은행 관리 화면이 생기면 이 스크립트는 '처음 한 번' 용으로 남는다)
 *
 * ⚠️ 결과 파일은 **커밋 대상**이다. 배포하는 사람이 이 스크립트를 돌릴 수 있다고
 *    가정하면 안 된다 — `wrangler d1 migrations apply` 만으로 끝나야 한다.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..');
const APPS = join(WEB, '..', 'apps-script');

// ────────────────────────────────────────────────────────────
// .gs 안의 배열 리터럴 하나를 떼어 온다
// ────────────────────────────────────────────────────────────

/**
 * `marker` 다음에 나오는 첫 `[` 부터 짝이 맞는 `]` 까지.
 *
 * ⚠️ 정규식으로 `\[([\s\S]*)\]` 를 잡으면 안 된다 — 배열 안에 `[` 가 또 있고,
 *    파일 뒤쪽의 다른 배열까지 삼킨다. 그래서 괄호를 세면서 읽는다.
 *    문자열 안의 괄호·따옴표는 건너뛴다.
 */
function sliceArray(src: string, marker: string): string {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`'${marker}' 를 찾지 못했습니다`);
  const open = src.indexOf('[', at);
  if (open < 0) throw new Error(`'${marker}' 뒤에 배열이 없습니다`);

  let depth = 0, quote = '';
  for (let i = open; i < src.length; i++) {
    const c = src[i]!;
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '"') { quote = c; continue; }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  throw new Error(`'${marker}' 배열이 닫히지 않았습니다`);
}

/** 리터럴만 든 배열이므로 그대로 평가한다 (전역 없는 컨텍스트) */
function evalArray<T>(literal: string): T[] {
  return runInNewContext(`(${literal})`, Object.create(null), { timeout: 5_000 }) as T[];
}

// ────────────────────────────────────────────────────────────
// SQL
// ────────────────────────────────────────────────────────────

function q(v: unknown): string {
  return `'${String(v ?? '').replace(/'/g, "''")}'`;
}

// ────────────────────────────────────────────────────────────
// 읽기
// ────────────────────────────────────────────────────────────

type BankRow = [string, string, string, string, string, string, string, number, string];

const questionsGs = readFileSync(join(APPS, 'Questions.gs'), 'utf8');
const setupGs = readFileSync(join(APPS, 'Setup.gs'), 'utf8');

const bank = evalArray<BankRow>(sliceArray(questionsGs, 'var QUESTION_BANK'));
const animals = evalArray<[string, string, string]>(sliceArray(setupGs, 'fillOnce(sheets, SHEETS.ANIMALS,'));
const rawSettings = evalArray<[string, string | number, string]>(sliceArray(setupGs, 'fillOnce(sheets, SHEETS.SETTINGS,'));

// ── 설정: 한국어 항목 이름 → Settings 열쇠 ──
//
// ⚠️ D1 의 `settings.key` 는 src/game/config.ts 의 Settings 열쇠와 같아야 한다.
//    앱스 스크립트는 시트에 한국어를 쓰고 Sheet.gs 안에서 map 으로 바꿨는데,
//    그 map 이 코드 두 곳에 흩어져 있어 항목 하나를 더할 때마다 빠뜨렸다.
//    여기서는 D1 에 열쇠를 그대로 넣고, 사람이 읽을 이름은 label 열에 둔다.
const KEY_OF: Record<string, string> = {
  '초기코인': 'initialCoins',
  '라운드당최대베팅': 'maxBetPerRound',
  '시드코인': 'seedCoins',
  '문제시간초': 'quizSeconds',
  '토론시간초': 'discussSeconds',
  '베팅시간초': 'betSeconds',
  '트랙칸수': 'trackCells'
  // '학생주소' 는 옮기지 않는다 — 새 구현은 요청이 들어온 주소(origin)를 그대로 쓴다.
  // 시트판이 그 항목을 둔 이유는 getUrl() 이 /dev 주소를 주는 앱스 스크립트 사정이었다
};

const settings: { key: string; value: string; label: string }[] = [];
for (const [label, value] of rawSettings) {
  const key = KEY_OF[String(label).trim()];
  if (!key) continue;
  settings.push({ key, value: String(value), label: String(label) });
}
// moveSeconds(경주 단계)는 앱스 스크립트판에 **없던 설정**이다 (MIGRATION §8-3, §10).
// 여기서 처음 생긴다 — 기본값은 config.ts 의 DEFAULTS.moveSeconds 와 같은 20 이다
settings.push({ key: 'moveSeconds', value: '20', label: '경주시간초' });

// ────────────────────────────────────────────────────────────
// 쓰기
// ────────────────────────────────────────────────────────────

const byUnit = new Map<string, number>();
for (const r of bank) byUnit.set(r[0], (byUnit.get(r[0]) || 0) + 1);

const lines: string[] = [
  '-- 0002_seed.sql — **생성된 파일입니다. 손으로 고치지 마세요.**',
  '--',
  '--   cd web && npm run seed        (scripts/import-questions.ts)',
  '--',
  `-- 출처: apps-script/Questions.gs 의 QUESTION_BANK ${bank.length}문항,`,
  '--       apps-script/Setup.gs 의 동물 8종·설정 기본값',
  '--',
  '-- INSERT OR IGNORE 인 이유: 선생님이 나중에 문항을 고쳤는데 이 시드가 다시 돌면',
  '-- 그 수정이 조용히 사라진다. 되살리려면 그 행을 지우고 다시 넣어야 한다.',
  '',
  '-- ── 동물 8종 (코드 A~H 는 게임 코드가 쓰는 이름이라 바꾸면 안 된다) ──'
];

for (const [code, name, emoji] of animals) {
  lines.push(`INSERT OR IGNORE INTO animals (code, name, emoji) VALUES (${q(code)}, ${q(name)}, ${q(emoji)});`);
}

lines.push('', '-- ── 설정 (key 는 src/game/config.ts 의 Settings 열쇠와 같아야 한다) ──');
for (const s of settings) {
  lines.push(`INSERT OR IGNORE INTO settings (key, value, label) VALUES (${q(s.key)}, ${q(s.value)}, ${q(s.label)});`);
}

lines.push('', `-- ── 문항 ${bank.length}개 ──`);
for (const [unit, count] of byUnit) lines.push(`--   ${unit} ${count}문항`);
lines.push('');

bank.forEach((r, i) => {
  const [unit, level, text, c1, c2, c3, c4, answer, explanation] = r;
  lines.push(
    'INSERT OR IGNORE INTO questions (id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)\n' +
    `VALUES (${i + 1}, ${q(unit)}, ${q(level)}, ${q(text)}, ${q(c1)}, ${q(c2)}, ${q(c3)}, ${q(c4)}, ${Number(answer)}, ${q(explanation)});`
  );
});

const out = join(WEB, 'migrations', '0002_seed.sql');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, lines.join('\n') + '\n', 'utf8');

// 난이도별 개수를 여기서 한 번 세어 준다 — 6문항 미달이면 판을 만들 때 경고가 뜬다
const tally: Record<string, Record<string, number>> = {};
for (const r of bank) {
  (tally[r[0]] ||= {})[r[1]] = ((tally[r[0]] ||= {})[r[1]] || 0) + 1;
}
console.log(`migrations/0002_seed.sql — 문항 ${bank.length} · 동물 ${animals.length} · 설정 ${settings.length}`);
for (const unit of Object.keys(tally)) {
  const t = tally[unit]!;
  console.log(`  ${unit}: ` + Object.keys(t).map((lv) => `${lv} ${t[lv]}`).join(', '));
}
if (animals.length !== 8) {
  console.error('⛔ 동물이 8종이 아닙니다. 이대로면 판을 만들 수 없습니다 (src/server/db.ts)');
  process.exit(1);
}
