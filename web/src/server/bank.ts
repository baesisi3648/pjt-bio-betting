/**
 * bank.ts — 문제은행 검사. **런타임에 의존하지 않는다** (D1 도 fetch 도 모른다).
 *
 * `apps-script/Sheet.gs` 의 `validateSheets` 가 하던 일을 그대로 옮겼다:
 *   동물이 8줄이 아니면 **차단**, 난이도별 6문항 미달이면 **경고**, 설정은 범위 검사.
 *
 * ⚠️ D1 안에 두지 않은 이유: 그러면 게이트가 이 검사를 돌리는 데 workerd 와 진짜 D1 이
 *    필요해지고, 결국 테스트가 **사본**을 검사하게 된다 — 정답이 새는데 초록불이
 *    켜졌던 그 함정이다 (MIGRATION §5). D1Db 는 행을 읽어 이 함수에 먹이기만 한다.
 *
 * ⚠️ 검사를 판 만들기 뒤로 미루지 마세요. 문항이 모자란 판은 수업 중 라운드가
 *    넘어가는 순간에야 티가 나고, 그때는 되돌릴 수 없습니다.
 */

import { ANIMAL_CODES, LEVELS, LIMITS } from '../game/config.ts';
import type { AnimalCode, Level, Settings } from '../game/config.ts';
import type { Question } from '../game/types.ts';
import { normalizeSettings } from '../do/room.ts';
import type { AnimalTable } from '../do/room.ts';
import type { PreparedUnit } from './ports.ts';

/** D1 `questions` 한 줄 (migrations/0001_init.sql) */
export interface QuestionRow {
  id: number; unit: string; level: string; text: string;
  choice1: string; choice2: string; choice3: string; choice4: string;
  answer: number; explanation: string | null;
}
/** D1 `animals` 한 줄 */
export interface AnimalRow { code: string; name: string; emoji: string | null }
/** D1 `settings` 한 줄 */
export interface SettingRow { key: string; value: string }

/**
 * 잘못 적힌 행은 **건너뛰고 사유를 알린다.** 통째로 실패시키면 문항 하나 때문에
 * 수업이 멈춘다 (apps-script 의 readQuestions 가 같은 판단을 한다).
 */
function toQuestion(r: QuestionRow, skipped: string[]): Question | null {
  const level = String(r.level || '').trim();
  const text = String(r.text || '').trim();
  if (!text) return null;
  if ((LEVELS as readonly string[]).indexOf(level) < 0) {
    skipped.push(`문항 ${r.id} — 난이도가 쉬움/중간/어려움이 아님 (${level})`);
    return null;
  }
  const answer = Number(r.answer);
  if (!(answer >= 1 && answer <= 4)) {
    skipped.push(`문항 ${r.id} — 정답이 1~4가 아님 (${String(r.answer)})`);
    return null;
  }
  return {
    id: Number(r.id), unit: String(r.unit), level: level as Level, text,
    choices: [r.choice1, r.choice2, r.choice3, r.choice4].map((c) => String(c ?? '')),
    answer, explanation: String(r.explanation ?? '')
  };
}

/**
 * 동물 표 검사 — 정확히 8줄이어야 한다 (MIGRATION §8-5).
 *
 * ⚠️ `validateUnit`(판 만들기)과 관리 화면의 건강 표(`/api/admin/summary`)가
 *    **이 함수 하나**를 같이 쓴다. 관리 쪽에 비슷한 검사를 하나 더 쓰면,
 *    판 만들기는 막는데 관리 화면은 초록불인 상태가 생긴다 — 정답이 새는데
 *    초록불이 켜졌던 그 함정과 같은 종류다 (MIGRATION §5).
 */
export function checkAnimals(animalRows: AnimalRow[]): { blocking: string[]; animals: AnimalTable } {
  const blocking: string[] = [];
  const rows = animalRows.filter((r) => String(r.name || '').trim());
  const names = {} as Record<AnimalCode, string>;
  const emojis = {} as Record<AnimalCode, string>;
  if (rows.length !== 8) {
    // ⚠️ 경고가 아니라 차단이다. 8마리가 아니면 경주 자체가 성립하지 않는다
    blocking.push(`'동물' 표가 ${rows.length}줄이에요. 정확히 8줄이어야 합니다.`);
  } else {
    ANIMAL_CODES.forEach((c, i) => {
      const r = rows[i]!;
      names[c] = String(r.name).trim();
      emojis[c] = String(r.emoji ?? '').trim();
    });
  }
  return { blocking, animals: { names, emojis } };
}

export function validateUnit(
  unit: string, questionRows: QuestionRow[], animalRows: AnimalRow[], settingRows: SettingRow[]
): PreparedUnit {
  const warnings: string[] = [];
  const settingWarnings: string[] = [];

  // ── 동물: 정확히 8줄이어야 한다 (MIGRATION §8-5) ──
  const checked = checkAnimals(animalRows);
  const blocking: string[] = checked.blocking.slice();
  const animals: AnimalTable = checked.animals;

  // ── 설정 ──
  const raw: Record<string, unknown> = {};
  for (const r of settingRows) raw[String(r.key)] = r.value;
  // 결과는 버리고 경고만 받는다. 진짜 정규화는 Room.create 안에서 일어난다 —
  // 두 벌로 정규화하면 언젠가 갈라지고, 그때 타이머가 다른 값으로 돈다
  normalizeSettings(raw as Partial<Settings>, settingWarnings);

  // ── 문항 ──
  const skipped: string[] = [];
  const questions: Question[] = [];
  for (const r of questionRows) {
    const q = toQuestion(r, skipped);
    if (q) questions.push(q);
  }
  if (questions.length === 0) blocking.push(`'${unit}' 단원에 문제가 하나도 없어요.`);

  for (const level of LEVELS) {
    const n = questions.filter((q) => q.level === level).length;
    if (n < LIMITS.minHintsPerLevel) {
      warnings.push(`'${unit}' 단원 — ${level} ${n}/${LIMITS.minHintsPerLevel}문항. 모자라면 앞 라운드 문제를 다시 냅니다.`);
    }
  }
  for (const m of skipped) warnings.push(m);

  return { blocking, warnings, settingWarnings, questions, animals, settings: raw as Partial<Settings> };
}
