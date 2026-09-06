/**
 * admin.ts — 문제은행 관리 라우트 (MIGRATION §7 5단계 · RENEWAL §3).
 *
 * 앱스 스크립트판에서 이 일을 하던 것은 **스프레드시트 그 자체**였다.
 * 선생님이 '문제' 탭에 줄을 넣고, 메뉴의 '시트 상태 확인'(`validateSheets`)이
 * 난이도별 개수와 동물 8줄을 검사했다. 문제은행이 D1 으로 들어오면서 그 탭도,
 * 그 메뉴도 사라졌다 — 그 둘을 대신하는 것이 이 파일과 `src/client/admin/` 이다.
 *
 * ── 이 파일이 지키는 것 ──
 *
 * 1. **비밀번호 확인은 여기 없다.** `router.ts` 의 `adminDenied` 가 `/api/admin/` 으로
 *    시작하는 **모든** 경로 앞에 서 있다. 확인을 여기 두면 라우트를 하나 더 더하는 날
 *    그 하나만 빠뜨리게 된다. 확인은 **매 호출** 일어난다 — 세션도 쿠키도 토큰도 없다
 *    (MIGRATION §10 — 사용자 결정).
 *
 * 2. **여기 나가는 응답에는 정답과 해설이 들어 있다.** 그래서 이 모양을 다른 라우트가
 *    재사용하면 안 된다. `GET /api/units`·`/api/sets`·`/api/prepare` 는 지금처럼
 *    개수·경고만 내보낸다 (게이트 `LEAK-ADMIN`).
 *    ⚠️ **JSON 내보내기가 관리자 경로에 있는 이유도 이것이다.** 그 파일에는 정답과 해설이
 *    전부 들어 있다 — `<a href>` 로 받을 수 있게 열어 두면 주소 하나로 문제은행이 샌다
 *    (게이트 `EXP2`). 화면은 헤더를 실을 수 있는 `fetch` 로 받아 Blob 으로 저장한다.
 *
 * 3. **검사를 여기서 새로 짜지 않는다.** 동물 8줄은 `bank.ts` 의 `checkAnimals`,
 *    설정 범위는 `room.ts` 의 `normalizeSettings`, JSON 형식은 `portable.ts` —
 *    판을 만들 때 쓰는 바로 그 함수들이다. 비슷한 걸 하나 더 쓰면 관리 화면은 초록불인데
 *    판은 안 만들어지는 상태가 생긴다 (MIGRATION §5 '사본' 함정).
 *
 * 4. **판을 건드리지 않는다.** 문항은 판을 만들 때 내용까지 굳는다 (§4-6).
 *    여기서 고친 것은 **다음에 만드는 판**부터 적용된다. 이미 도는 판을 따라가서
 *    고치는 코드를 넣지 마세요 — 라운드 중간에 문제가 바뀌면 이미 답한 모둠과
 *    아직 안 답한 모둠이 다른 문제를 푼 것이 된다. 화면 상단 안내문이 이걸 말한다.
 */

import { ANIMAL_CODES, LEVELS, LIMITS, SETTING_RANGE } from '../game/config.ts';
import type { Settings } from '../game/config.ts';
import { ALL_SETS, checkAnimals } from './bank.ts';
import { exportFileName, parseImport, toPortable } from './portable.ts';
import { err, normalizeSettings, ok } from '../do/room.ts';
import type { Envelope } from '../do/room.ts';
import type {
  AdminAnimal, AdminSetting, ApiRequest, ImportMode, Ports, QuestionDraft, RawResponse
} from './ports.ts';

/**
 * 관리 라우트가 돌려주는 것 — 보통은 봉투, 내보내기 하나만 **파일**이다.
 * `router.ts` 가 이걸 받아 HTTP 로 옮긴다 (ports.ts RawResponse 주석).
 */
export type AdminResult = Envelope<unknown> | { raw: RawResponse };

export function isRaw(r: AdminResult): r is { raw: RawResponse } {
  return (r as { raw?: RawResponse }).raw !== undefined;
}

// ────────────────────────────────────────────────────────────
// 입력 검사 — 어기면 **무엇이 틀렸는지** 한국어로 돌려준다
//
// ⚠️ 'BAD_REQUEST' 만 주고 끝내지 마세요. 이 화면을 쓰는 사람은 개발자가 아니고,
//    "요청 형식이 올바르지 않아요"(config.ts MESSAGES) 만 보면 무엇을 고쳐야 할지 모릅니다.
// ────────────────────────────────────────────────────────────

/** 검사 결과 — 문자열이면 거절 사유다 */
type Checked<T> = T | string;

function bad<T>(v: Checked<T>): v is string { return typeof v === 'string'; }

function draftOf(body: Record<string, unknown>): Checked<QuestionDraft> {
  // 옛 이름(`unit`)도 받는다 — 이 화면과 함께 배포되지만, 손으로 API 를 두드리는
  // 스크립트가 남아 있을 수 있고 거절할 이유가 없다
  const setName = String(body.setName ?? body.unit ?? '').trim();
  if (!setName) return '문제 세트를 골라주세요';

  const level = String(body.level ?? '').trim();
  if ((LEVELS as readonly string[]).indexOf(level) < 0) {
    return `난이도는 ${LEVELS.join(' · ')} 중 하나여야 해요 ('${level}' 은(는) 아니에요)`;
  }

  const text = String(body.text ?? '').trim();
  if (!text) return '문제를 넣어주세요';

  const raw = Array.isArray(body.choices) ? body.choices : null;
  if (!raw) return '보기 4개를 보내주세요';
  if (raw.length !== 4) return `보기는 4개여야 해요 (지금 ${raw.length}개)`;
  const choices = raw.map((c) => String(c ?? '').trim());
  const emptyAt = choices.findIndex((c) => !c);
  if (emptyAt >= 0) return `${emptyAt + 1}번 보기가 비어 있어요`;

  const answer = Number(body.answer);
  if (!(isFinite(answer) && Math.floor(answer) === answer && answer >= 1 && answer <= 4)) {
    return `정답은 1~4 중 하나여야 해요 ('${String(body.answer)}' 은(는) 아니에요)`;
  }

  // 해설은 비어도 된다 — 앱스 스크립트판 '문제' 탭도 마지막 칸이 비어 있는 줄을 허용했다
  return { setName, level, text, choices, answer, explanation: String(body.explanation ?? '').trim() };
}

/**
 * 동물 8줄. **추가·삭제가 아니라 이름·이모지 교체다.**
 * ⚠️ 코드 A~H 는 게임 코드가 쓰는 이름이라 바꿀 수 없다 (migrations/0001_init.sql).
 *    바꿀 수 있게 하면 저장은 되는데 판이 안 만들어지는, 되돌리기 어려운 상태가 된다.
 */
function animalsOf(body: Record<string, unknown>): Checked<AdminAnimal[]> {
  const raw = Array.isArray(body.animals) ? body.animals : null;
  if (!raw) return '동물 8줄을 보내주세요';
  if (raw.length !== ANIMAL_CODES.length) {
    return `동물은 정확히 ${ANIMAL_CODES.length}줄이어야 해요 (지금 ${raw.length}줄). 경주가 8마리로 짜여 있어요.`;
  }

  const out: AdminAnimal[] = [];
  for (let i = 0; i < ANIMAL_CODES.length; i++) {
    const r = (raw[i] ?? {}) as Record<string, unknown>;
    const code = String(r.code ?? '').trim().toUpperCase();
    if (code !== ANIMAL_CODES[i]) {
      return `${i + 1}번째 줄의 코드는 ${ANIMAL_CODES[i]} 여야 해요 ('${code}' 은(는) 아니에요). ` +
             '코드 A~H 는 게임이 쓰는 이름이라 바꿀 수 없고, 이름과 이모지만 바꿉니다.';
    }
    const name = String(r.name ?? '').trim();
    if (!name) return `${code} 의 이름이 비어 있어요`;
    out.push({ code, name, emoji: String(r.emoji ?? '').trim() });
  }
  return out;
}

/**
 * 설정. **범위 밖 값은 저장하지 않고 거절한다.**
 *
 * ⚠️ 판을 만들 때(`normalizeSettings`)와 일부러 다르게 굴린다. 거기서는 되돌리고 알리는데,
 *    수업이 그 값 하나 때문에 멈추면 안 되기 때문이다. 관리 화면에서는 반대다 —
 *    틀린 값을 표에 남겨 둘 이유가 없고, 남기면 매번 판을 만들 때마다 같은 경고가 뜬다.
 *    검사 자체는 **같은 함수**로 한다 (규칙이 두 벌이 되면 언젠가 갈라진다).
 */
function settingsOf(body: Record<string, unknown>): Checked<AdminSetting[]> {
  const raw = body.settings;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '설정 값을 보내주세요';
  const src = raw as Record<string, unknown>;

  const keys = Object.keys(src);
  if (!keys.length) return '설정 값을 보내주세요';
  for (const k of keys) {
    // key 는 config.ts 의 Settings 열쇠와 같아야 한다. 다른 이름은 조용히 무시되므로
    // (0001_init.sql 주석) 저장하기 전에 막는다 — 저장되면 "고쳤는데 안 바뀐다"가 된다
    if (!SETTING_RANGE[k]) return `'${k}' 은(는) 모르는 설정 항목이에요`;
  }
  for (const k of keys) {
    const v = src[k];
    if (v === undefined || v === null || String(v).trim() === '') {
      return `${SETTING_RANGE[k]!.label} 값을 넣어주세요`;
    }
  }

  const issues: string[] = [];
  normalizeSettings(src as Partial<Settings>, issues);
  if (issues.length) {
    // 경고 문장은 그대로 둔다 — 판 만들 때 뜨는 문장과 같아야 선생님이 같은 것으로 읽는다.
    // 다만 여기서는 저장하지 않았다는 것을 한 줄 덧붙인다
    return issues.join('\n') + '\n(범위 밖 값은 저장하지 않았어요. 고쳐서 다시 저장해주세요)';
  }
  return keys.map((k) => ({ key: k, value: String(Number(src[k])) }));
}

const MODES: ImportMode[] = ['append', 'replaceSet', 'replaceAll'];

// ────────────────────────────────────────────────────────────
// 라우트
// ────────────────────────────────────────────────────────────

const QUESTIONS = /^\/api\/admin\/questions(?:\/(\d+))?$/;
/**
 * ⚠️ 세트 이름은 한국어이고 주소에서는 퍼센트 인코딩돼 온다 (`/api/admin/sets/%EC%9C%A0…`).
 *    `[^/]+` 로 받아 `decodeURIComponent` 한다 — `\w` 같은 것으로 받으면 한글 세트 이름만
 *    조용히 404 가 된다.
 */
const SETS = /^\/api\/admin\/sets\/([^/]+)$/;

function decodeSeg(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/**
 * ⚠️ **비밀번호 확인은 이 함수 안에 없다.** router.ts 가 이 앞에서 한다.
 *    직접 부르는 코드를 만들지 마세요 — 인증 없는 문이 하나 더 생깁니다.
 */
export async function adminRoute(
  req: ApiRequest, ports: Ports, path: string, method: string, body: Record<string, unknown>
): Promise<AdminResult> {
  const db = ports.db;

  // ── 문항 ──
  const q = QUESTIONS.exec(path);
  if (q) {
    const id = q[1] ? Number(q[1]) : null;

    if (id === null && method === 'GET') {
      const setName = String(req.query.set ?? req.query.unit ?? '').trim();
      return ok({
        questions: await db.adminQuestions(setName || null),
        sets: (await db.listSets()).map((s) => s.name)
      });
    }
    if (id === null && method === 'POST') {
      const draft = draftOf(body);
      if (bad(draft)) return err('BAD_REQUEST', draft);
      return ok({ question: await db.adminAddQuestion(draft) });
    }
    if (id !== null && method === 'PUT') {
      const draft = draftOf(body);
      if (bad(draft)) return err('BAD_REQUEST', draft);
      const hit = await db.adminUpdateQuestion(id, draft);
      if (!hit) return err('NOT_FOUND', `${id}번 문항이 없어요. 목록을 새로 불러와주세요.`);
      return ok({ question: { id, ...draft } });
    }
    if (id !== null && method === 'DELETE') {
      const hit = await db.adminDeleteQuestion(id);
      if (!hit) return err('NOT_FOUND', `${id}번 문항이 없어요. 목록을 새로 불러와주세요.`);
      return ok({ id });
    }
    return err('NOT_FOUND');
  }

  // ── 세트 이름 바꾸기 · 통째로 지우기 ──
  const s = SETS.exec(path);
  if (s) {
    const name = decodeSeg(s[1]!);
    const sets = (await db.listSets()).map((x) => x.name);
    if (sets.indexOf(name) < 0) {
      return err('NOT_FOUND', `'${name}' 세트가 없어요. 목록을 새로 불러와주세요.`);
    }

    if (method === 'PUT') {
      const to = String(body.name ?? '').trim();
      if (!to) return err('BAD_REQUEST', '새 세트 이름을 넣어주세요');
      if (to === name) return ok(await setsData(ports, 0));
      // ⚠️ 이미 있는 이름으로 바꾸면 두 세트가 **합쳐진다.** 되돌릴 수 없으므로 막는다 —
      //    합치고 싶으면 문항을 옮기는 것이 아니라 내보내서 다시 가져오면 된다
      if (sets.indexOf(to) >= 0) {
        return err('BAD_REQUEST', `'${to}' 세트가 이미 있어요. 합치려면 내보낸 뒤 '기존 문제에 추가'로 넣어주세요.`);
      }
      return ok(await setsData(ports, await db.adminRenameSet(name, to)));
    }
    if (method === 'DELETE') {
      // ⚠️ 확인 대화는 화면의 몫이다. 여기서 한 번 더 묻는 방법이 없다 (HTTP 는 한 번의 왕복이다)
      return ok(await setsData(ports, await db.adminDeleteSet(name)));
    }
    return err('NOT_FOUND');
  }

  // ── JSON 내보내기 — 봉투가 아니라 **파일**이다 ──
  if (path === '/api/admin/export' && method === 'GET') {
    const setName = String(req.query.set ?? '').trim();
    const rows = await db.adminQuestions(setName || null);
    // 세트를 안 고르면 은행 전체가 한 파일로 나간다. 그 파일의 title 은 '(전체)' 이고,
    // ⚠️ 다시 가져오면 **세트 경계가 사라진다** (형식 §3-2 에 문항별 세트 칸이 없다).
    //    세트를 지키려면 세트마다 한 번씩 내보내야 한다 — 화면의 안내문이 이걸 말한다
    const title = setName || ALL_SETS;
    const name = exportFileName(title, ports.now());
    return {
      raw: {
        body: toPortable(title, rows),
        headers: {
          'content-type': 'application/json; charset=utf-8',
          // ⚠️ `filename=` 만 쓰면 한글 이름이 깨진다 (헤더는 Latin-1 이다).
          //    RFC 5987 의 `filename*=UTF-8''…` 로 보낸다
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
          'cache-control': 'no-store'
        }
      }
    };
  }

  // ── JSON 가져오기 ──
  if (path === '/api/admin/import/preview' && method === 'POST') {
    const asked = String(body.setName ?? '').trim();
    const parsed = parseImport(body.json, asked || null, (await db.listSets()).map((x) => x.name));
    if (typeof parsed === 'string') return err('BAD_REQUEST', parsed);
    return ok(parsed.summary);
  }

  if (path === '/api/admin/import' && method === 'POST') {
    const mode = String(body.mode ?? '') as ImportMode;
    if (MODES.indexOf(mode) < 0) {
      return err('BAD_REQUEST', `가져오기 방식은 ${MODES.join(' · ')} 중 하나여야 해요 ('${String(body.mode)}' 은(는) 아니에요)`);
    }
    const asked = String(body.setName ?? '').trim();
    const parsed = parseImport(body.json, asked || null, (await db.listSets()).map((x) => x.name));
    if (typeof parsed === 'string') return err('BAD_REQUEST', parsed);

    const setName = asked || parsed.summary.title;
    if (!setName) {
      return err('BAD_REQUEST', "세트 이름이 없어요. 파일에 \"title\" 을 넣거나 세트 이름을 적어주세요.");
    }
    if (!parsed.rows.length) {
      // ⚠️ 여기서 막지 않으면 replaceAll 이 **문제은행을 비우고 끝난다.**
      //    "0문항을 가져왔습니다" 를 보고 나서야 알게 되는 종류의 사고다
      return err('BAD_REQUEST',
        `넣을 수 있는 문항이 하나도 없어요 (${parsed.summary.errors.length}개 모두 형식 오류). 아무것도 바꾸지 않았습니다.`);
    }
    // setName 은 parseImport 가 asked||title 로 이미 채웠지만, asked 가 비고 title 만 있는
    // 경우를 위해 한 번 더 맞춘다 (rows 의 setName 이 정본이다)
    const rows = parsed.rows.map((r) => ({ ...r, setName }));
    const inserted = await db.adminImport(setName, mode, rows);

    return ok({
      setName,
      inserted,
      /** 형식 오류로 **건너뛴** 개수. 넣은 것 + 건너뛴 것 = 파일의 문항 수 */
      skipped: parsed.summary.errors.length,
      summary: parsed.summary
    });
  }

  // ── 동물 ──
  if (path === '/api/admin/animals') {
    if (method === 'GET') return ok(await animalsData(ports));
    if (method === 'PUT') {
      const rows = animalsOf(body);
      if (bad(rows)) return err('BAD_REQUEST', rows);
      await db.adminSaveAnimals(rows);
      return ok(await animalsData(ports));
    }
    return err('NOT_FOUND');
  }

  // ── 설정 ──
  if (path === '/api/admin/settings') {
    if (method === 'GET') return ok(await settingsData(ports));
    if (method === 'PUT') {
      const rows = settingsOf(body);
      if (bad(rows)) return err('BAD_REQUEST', rows);
      await db.adminSaveSettings(rows);
      return ok(await settingsData(ports));
    }
    return err('NOT_FOUND');
  }

  // ── 건강 표 (validateSheets 가 하던 일) ──
  if (path === '/api/admin/summary' && method === 'GET') return ok(await summaryData(ports));

  return err('NOT_FOUND');
}

// ────────────────────────────────────────────────────────────
// 응답 만들기 — 읽기와 쓰기가 **같은 모양**을 돌려준다.
// 저장 뒤에 화면이 다시 GET 하지 않아도 되고, 그래서 "저장은 됐는데 화면은 옛날"이 없다
// ────────────────────────────────────────────────────────────

/** 이름 바꾸기·지우기의 응답. `affected` 는 옮겨지거나 지워진 문항 수다 */
async function setsData(ports: Ports, affected: number): Promise<Record<string, unknown>> {
  return { sets: await ports.db.listSets(), affected };
}

async function animalsData(ports: Ports): Promise<Record<string, unknown>> {
  const animals = await ports.db.adminAnimals();
  return {
    animals,
    // 화면이 A~H 를 박아 두지 않게 서버가 준다 (§5 'trackCells 전역 참조' 와 같은 함정)
    codes: ANIMAL_CODES,
    blocking: checkAnimals(animals.map((a) => ({ code: a.code, name: a.name, emoji: a.emoji }))).blocking
  };
}

async function settingsData(ports: Ports): Promise<Record<string, unknown>> {
  const settings = await ports.db.adminSettings();
  const raw: Record<string, unknown> = {};
  for (const s of settings) raw[s.key] = s.value;
  const warnings: string[] = [];
  normalizeSettings(raw as Partial<Settings>, warnings);
  return {
    settings,
    // 범위와 한국어 이름도 서버가 준다 — 화면이 숫자를 박아 두면 SETTING_RANGE 를 고친 날
    // 화면만 옛 범위를 안내한다
    ranges: SETTING_RANGE,
    warnings
  };
}

/**
 * 세트별 × 난이도별 문항 수 + 차단·경고.
 * `apps-script/Setup.gs` 메뉴의 '시트 상태 확인'이 보여주던 것이다.
 */
async function summaryData(ports: Ports): Promise<Record<string, unknown>> {
  const db = ports.db;
  const sets = await db.listSets();
  const animals = await db.adminAnimals();
  const animalBlocking = checkAnimals(animals).blocking;

  const rows: unknown[] = [];
  for (const s of sets) {
    const prep = await db.prepareSet(s.name);
    const counts: Record<string, number> = {};
    for (const lv of LEVELS) counts[lv] = prep.questions.filter((x) => x.level === lv).length;
    rows.push({
      setName: s.name,
      counts,
      total: prep.questions.length,
      // ⚠️ 동물 차단은 세트마다 붙여 보내지 않는다. 같은 줄이 세트 수만큼 반복되면
      //    진짜 그 세트의 문제인 줄이 묻힌다 — 동물은 표 하나로 따로 보여준다
      blocking: prep.blocking.filter((m) => animalBlocking.indexOf(m) < 0),
      // ⚠️ **`warnings` 가 아니라 `skipped` 다.** 문항 수 부족은 이 표의 노란 칸이
      //    이미 말하고 있어서, 같은 말을 문장으로 또 쓰면 세트마다 세 줄씩 쌓인다.
      //    그러면 정작 읽어야 할 줄("12번 문항은 난이도가 이상해서 안 쓰입니다")이 묻힌다
      warnings: prep.skipped
    });
  }

  return {
    sets: rows,
    levels: LEVELS,
    /**
     * 난이도별 이 개수 미만이면 노란불.
     * 10 라운드 고정이라 10문항이 있어야 한 모둠이 같은 난이도만 골라도 문제가 안 겹친다
     * (config.ts LIMITS.minQuestionsPerLevel 주석).
     */
    minPerLevel: LIMITS.minQuestionsPerLevel,
    animals: { animals, codes: ANIMAL_CODES, blocking: animalBlocking }
  };
}
