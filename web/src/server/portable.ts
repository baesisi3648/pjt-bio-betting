/**
 * portable.ts — **애니멀 더비 JSON 형식** (RENEWAL §3-2) 읽고 쓰기.
 *
 * ```json
 * { "title": "세포와 물질대사 총정리",
 *   "questions": [ { "difficulty": "easy", "question": "…",
 *                    "choices": ["…","…","…","…"], "answer": 2, "explanation": "…" } ] }
 * ```
 *
 * ── 이 파일이 지키는 것 ──
 *
 * 1. **런타임을 모른다.** D1 도 fetch 도 모르고 순수 함수뿐이다. 그래서 게이트가
 *    workerd 없이 이 형식을 그대로 검사한다 — 라우트 뒤에 숨겨 두면 게이트가
 *    **사본**을 검사하게 된다 (MIGRATION §5).
 *
 * 2. **잘못된 문항은 건너뛰고 사유를 모은다.** 통째로 거절하면 선생님은 30문항짜리
 *    파일을 받고 "형식이 틀렸어요" 한 줄만 보게 된다 — 어느 줄인지 모르면 고칠 수 없다.
 *    파일 자체가 우리 형식이 아닐 때만(questions 가 배열이 아님) 통째로 거절한다.
 *
 * 3. **난이도 이름을 손으로 적지 않는다.** 화면·D1 은 한국어(config.ts LEVELS),
 *    파일은 영어다. 그 대응을 **자리(index)** 로 둔 이유: LEVELS 의 문자열이 또 바뀌어도
 *    ('중간' → '보통' 이 실제로 있었다) 이 표는 따라간다.
 */

import { LEVELS } from '../game/config.ts';
import type { AdminQuestion, QuestionDraft } from './ports.ts';

/** 파일에 적히는 난이도. **자리가 LEVELS 와 같아야 한다** (위 3번) */
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

/** 오직 객관식만 (RENEWAL §1 결정표). `type` 이 없으면 객관식으로 본다 */
const ONLY_TYPE = 'multiple_choice';

/** 파일의 난이도 → 화면·D1 의 난이도. 한국어('보통')로 적힌 것도 받아 준다 */
export function levelOf(difficulty: unknown): string | null {
  const d = String(difficulty ?? '').trim().toLowerCase();
  const i = (DIFFICULTIES as readonly string[]).indexOf(d);
  if (i >= 0) return LEVELS[i]!;
  // 한국어로 적어 온 파일 — 선생님이 손으로 만든 것이 대부분이라 받아 준다
  const k = (LEVELS as readonly string[]).indexOf(String(difficulty ?? '').trim());
  return k >= 0 ? LEVELS[k]! : null;
}

/** 화면·D1 의 난이도 → 파일의 난이도 */
export function difficultyOf(level: string): string {
  const i = (LEVELS as readonly string[]).indexOf(level);
  return i >= 0 ? DIFFICULTIES[i]! : String(level);
}

// ────────────────────────────────────────────────────────────
// 가져오기
// ────────────────────────────────────────────────────────────

/** `index` 는 `questions` 배열의 자리(0부터). 화면이 +1 해서 "3번째 문항" 으로 적는다 */
export interface ImportError { index: number; reason: string }

export interface ImportSummary {
  /** 파일의 `title` (없으면 빈 문자열). 실제로 어느 세트에 넣을지는 라우트가 정한다 */
  title: string;
  /** **유효한 것만** 센다 — 오류 문항은 들어가지 않으므로 여기에도 없다 */
  total: number;
  /** easy · medium · hard 각 개수 (유효한 것만) */
  byDifficulty: Record<string, number>;
  errors: ImportError[];
  /** 넣으려는 이름의 세트가 문제은행에 이미 있는가 ('같은 이름 세트 교체' 버튼의 근거) */
  existingSet: boolean;
}

export interface ParsedImport {
  summary: ImportSummary;
  /** 바로 넣을 수 있는 줄들. `setName` 은 호출자가 정한 이름으로 이미 채워져 있다 */
  rows: QuestionDraft[];
}

/** 문항 하나. 통과하면 draft, 아니면 거절 사유 한 줄 */
function itemOf(raw: unknown, setName: string): QuestionDraft | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '문항이 객체가 아니에요';
  const r = raw as Record<string, unknown>;

  // ⚠️ 형식을 가장 먼저 본다. OX 문항이 섞인 파일은 보기가 2개라 "보기는 4개여야 해요" 가
  //    먼저 뜨는데, 그 문장을 보면 보기를 두 개 더 적어야 하는 줄 안다. 진짜 이유를 먼저 말한다
  if (r.type !== undefined && r.type !== null && String(r.type).trim() !== '') {
    const t = String(r.type).trim();
    if (t !== ONLY_TYPE) return `객관식만 지원해요 ('${t}' 형식은 넣을 수 없어요)`;
  }

  const text = String(r.question ?? '').trim();
  if (!text) return '문제가 비어 있어요';

  const rawChoices = Array.isArray(r.choices) ? r.choices : null;
  if (!rawChoices) return '보기 4개를 넣어주세요';
  if (rawChoices.length !== 4) return `보기는 4개여야 해요 (지금 ${rawChoices.length}개)`;
  const choices = rawChoices.map((c) => String(c ?? '').trim());
  const empty = choices.map((c, i) => (c ? -1 : i + 1)).filter((n) => n > 0);
  if (empty.length === 1) return `${empty[0]}번 보기가 비어 있어요`;
  if (empty.length > 1) return `보기 ${empty.length}개가 비어 있어요 (${empty.join('·')}번)`;

  const answer = Number(r.answer);
  if (!(isFinite(answer) && Math.floor(answer) === answer && answer >= 1 && answer <= 4)) {
    return `정답은 1~4 중 하나여야 해요 ('${String(r.answer)}' 은(는) 아니에요)`;
  }

  const level = levelOf(r.difficulty);
  if (!level) {
    return `난이도는 ${DIFFICULTIES.join('·')} 중 하나여야 해요 ('${String(r.difficulty)}' 은(는) 아니에요)`;
  }

  // `id` 는 무시한다 (RENEWAL §3-2). 내보낼 때 붙이는 표시일 뿐이고, 그 번호를 그대로
  // 되받으면 이미 있는 문항을 덮어쓸지 말지를 판단해야 해서 규칙이 하나 더 늘어난다
  return { setName, level, text, choices, answer, explanation: String(r.explanation ?? '').trim() };
}

/**
 * 파일 전체를 읽는다.
 *
 * @param json  이미 `JSON.parse` 된 객체 (라우트가 본문으로 받는다)
 * @param setName 넣을 세트 이름. null 이면 파일의 `title` 을 쓴다
 * @param existingSets 지금 문제은행에 있는 세트 이름들 (`existingSet` 판단용)
 * @returns 파일 자체가 우리 형식이 아니면 **거절 사유 문자열**
 */
export function parseImport(
  json: unknown, setName: string | null, existingSets: string[]
): ParsedImport | string {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return 'JSON 객체가 아니에요. 애니멀 더비에서 내보낸 파일인지 확인해주세요.';
  }
  const src = json as Record<string, unknown>;
  const title = String(src.title ?? '').trim();

  if (!Array.isArray(src.questions)) {
    return "'questions' 가 배열이 아니에요. 애니멀 더비 JSON 형식이 아닙니다 " +
           '(관리 화면의 ‘JSON 내보내기’ 로 받은 파일과 같은 모양이어야 합니다).';
  }

  const target = (setName ?? title).trim();
  const rows: QuestionDraft[] = [];
  const errors: ImportError[] = [];
  const byDifficulty: Record<string, number> = {};
  for (const d of DIFFICULTIES) byDifficulty[d] = 0;

  src.questions.forEach((raw, i) => {
    const got = itemOf(raw, target);
    if (typeof got === 'string') { errors.push({ index: i, reason: got }); return; }
    rows.push(got);
    const d = difficultyOf(got.level);
    byDifficulty[d] = (byDifficulty[d] ?? 0) + 1;
  });

  return {
    summary: {
      title,
      total: rows.length,
      byDifficulty,
      errors,
      existingSet: !!target && existingSets.indexOf(target) >= 0
    },
    rows
  };
}

// ────────────────────────────────────────────────────────────
// 내보내기
// ────────────────────────────────────────────────────────────

/**
 * 문항들을 §3-2 형식의 **파일 내용**으로 굽는다.
 *
 * ⚠️ 들여쓰기를 넣는다(2칸). 이 파일은 선생님이 메모장으로 열어 고치는 것이기도 하다 —
 *    한 줄짜리 JSON 은 고칠 수가 없다. 30문항이 60KB 가 되어도 상관없는 크기다.
 *
 * ⚠️ `id` 는 여기서 붙이고 가져올 때는 무시한다 (§3-2). 사람이 "12번 문항이 이상하다" 고
 *    말할 수 있게 하는 표시일 뿐, D1 의 id 가 아니다.
 */
export function toPortable(title: string, questions: AdminQuestion[]): string {
  return JSON.stringify({
    title,
    questions: questions.map((q, i) => ({
      id: 'q' + String(i + 1).padStart(3, '0'),
      difficulty: difficultyOf(q.level),
      question: q.text,
      choices: q.choices,
      answer: q.answer,
      explanation: q.explanation
    }))
  }, null, 2);
}

/**
 * 저장될 파일 이름 — `애니멀더비_{세트}_{YYYY-MM-DD}.json`.
 *
 * ⚠️ 날짜는 **한국 시간**으로 찍는다. Worker 는 UTC 로 돌아서 그냥 찍으면 아침 8시에
 *    내보낸 파일에 어제 날짜가 붙는다 (08:00 KST = 전날 23:00 UTC). 선생님이 파일 이름으로
 *    "어제 만든 것" 과 헷갈리는 일을 막는 값이 이 9시간이다.
 *
 * ⚠️ 파일 이름에 못 쓰는 글자(`/ \ : * ? " < > |`)는 세트 이름에 들어 있을 수 있다.
 *    바꾸지 않으면 브라우저가 이름을 제멋대로 자른다
 */
export function exportFileName(title: string, nowMs: number): string {
  const KST = 9 * 60 * 60 * 1000;
  const day = new Date(nowMs + KST).toISOString().slice(0, 10);
  const safe = String(title || '전체').replace(/[\\/:*?"<>|]+/g, '_').trim() || '전체';
  return `애니멀더비_${safe}_${day}.json`;
}
