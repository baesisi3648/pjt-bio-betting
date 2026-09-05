/**
 * db.ts — D1 접근. **Worker 에서 D1 을 만지는 곳은 이 파일뿐이다.**
 *
 * 앱스 스크립트판의 '문제'·'동물'·'설정' 탭(판 사이에서 공유되는 데이터)과
 * '게임' 탭의 목록 기능(이어하기)이 여기로 왔다. 판의 **상태**는 D1 에 없다 —
 * 그건 Durable Object 에 있다 (MIGRATION §6 대응표).
 *
 * ⚠️ 판단은 여기 없다. 검사(validateSheets 자리)는 bank.ts 에 있고 이 파일은
 *    행을 읽어 거기 먹이기만 한다 — 그래야 게이트가 workerd 없이 그 검사를 돌린다.
 */

import { validateUnit } from './bank.ts';
import type { AnimalRow, QuestionRow, SettingRow } from './bank.ts';
import type {
  AdminAnimal, AdminQuestion, AdminSetting, DbPort, PreparedUnit, QuestionDraft, RecentGame
} from './ports.ts';

/** D1 행 → 관리 화면이 쓰는 모양. 열 이름(choice1~4)을 아는 곳은 이 파일뿐이다 */
function toAdminQuestion(r: QuestionRow): AdminQuestion {
  return {
    id: Number(r.id), unit: String(r.unit), level: String(r.level), text: String(r.text),
    choices: [r.choice1, r.choice2, r.choice3, r.choice4].map((c) => String(c ?? '')),
    answer: Number(r.answer), explanation: String(r.explanation ?? '')
  };
}

const Q_COLS = 'id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation';

interface GameRow { code: string; class_name: string; unit: string; created_at: number; is_over: number }

export class D1Db implements DbPort {
  private db: D1Database;
  constructor(db: D1Database) { this.db = db; }

  /** 문제은행에 들어온 순서를 지킨다 — 교사 화면 드롭다운이 매번 뒤바뀌지 않게 */
  async listUnits(): Promise<string[]> {
    const r = await this.db
      .prepare('SELECT unit FROM questions GROUP BY unit ORDER BY MIN(id)')
      .all<{ unit: string }>();
    return (r.results || []).map((x) => String(x.unit));
  }

  async recentGames(limit: number): Promise<RecentGame[]> {
    const r = await this.db
      .prepare('SELECT code, class_name, unit, created_at, is_over FROM games ORDER BY created_at DESC LIMIT ?1')
      .bind(Math.max(1, Math.floor(limit) || 10))
      .all<GameRow>();
    // ⚠️ 여기서 고르는 열이 곧 "인증 없이 나가는 것"이다. 라운드 진행 상황이나
    //    상태 JSON 을 여기 얹지 마세요 — 이 목록은 아무나 볼 수 있습니다
    return (r.results || []).map((x) => ({
      code: String(x.code),
      className: String(x.class_name),
      unit: String(x.unit),
      createdAt: Number(x.created_at),      // ms 숫자. Date 객체 금지 (MIGRATION §5)
      isOver: !!Number(x.is_over)
    }));
  }

  async hasGame(code: string): Promise<boolean> {
    const r = await this.db.prepare('SELECT 1 AS hit FROM games WHERE code = ?1').bind(code).first<{ hit: number }>();
    return !!r;
  }

  async addGame(row: { code: string; className: string; unit: string; createdAt: number }): Promise<void> {
    await this.db
      .prepare('INSERT INTO games (code, class_name, unit, created_at, is_over) VALUES (?1, ?2, ?3, ?4, 0)')
      .bind(row.code, row.className, row.unit, row.createdAt)
      .run();
  }

  async markOver(code: string): Promise<void> {
    await this.db.prepare('UPDATE games SET is_over = 1 WHERE code = ?1').bind(code).run();
  }

  async prepareUnit(unit: string): Promise<PreparedUnit> {
    const [q, a, s] = await Promise.all([
      this.db.prepare(`SELECT ${Q_COLS} FROM questions WHERE unit = ?1 ORDER BY id`).bind(unit).all<QuestionRow>(),
      this.db.prepare('SELECT code, name, emoji FROM animals ORDER BY code').all<AnimalRow>(),
      this.db.prepare('SELECT key, value FROM settings').all<SettingRow>()
    ]);
    return validateUnit(unit, q.results || [], a.results || [], s.results || []);
  }

  // ──────────────────────────────────────────────────────────
  // 관리 화면 (5단계) — 여기 담긴 것은 전부 정답을 포함한다
  //
  // ⚠️ 부르는 곳은 src/server/admin.ts 하나뿐이고, 그 앞에 관리자 비밀번호 확인이 있다.
  //    다른 라우트에서 이 메서드를 부르지 마세요 — 그 순간 정답이 인증 밖으로 나갑니다.
  //
  // ⚠️ 여기서 고친 문항은 **다음에 만드는 판**부터 적용된다. 이미 만든 판은 문항 내용까지
  //    상태에 굳어 있다 (MIGRATION §4-6). 그래서 이 파일에는 판을 건드리는 코드가 없다.
  // ──────────────────────────────────────────────────────────

  async adminQuestions(unit: string | null): Promise<AdminQuestion[]> {
    const r = unit
      ? await this.db.prepare(`SELECT ${Q_COLS} FROM questions WHERE unit = ?1 ORDER BY id`).bind(unit).all<QuestionRow>()
      : await this.db.prepare(`SELECT ${Q_COLS} FROM questions ORDER BY unit, id`).all<QuestionRow>();
    return (r.results || []).map(toAdminQuestion);
  }

  async adminAddQuestion(q: QuestionDraft): Promise<AdminQuestion> {
    // ⚠️ id 를 우리가 고르지 않는다. 손으로 세면 두 요청이 같은 번호를 잡는 날이 온다 —
    //    SQLite 의 INTEGER PRIMARY KEY 가 알아서 다음 번호를 주고, RETURNING 으로 받는다
    const row = await this.db.prepare(
      'INSERT INTO questions (unit, level, text, choice1, choice2, choice3, choice4, answer, explanation)' +
      ' VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING ' + Q_COLS
    ).bind(
      q.unit, q.level, q.text, q.choices[0], q.choices[1], q.choices[2], q.choices[3], q.answer, q.explanation
    ).first<QuestionRow>();
    if (!row) throw new Error('문항을 넣지 못했어요');
    return toAdminQuestion(row);
  }

  async adminUpdateQuestion(id: number, q: QuestionDraft): Promise<boolean> {
    // RETURNING id 로 "그 행이 있었는가"를 한 번의 왕복으로 안다 (없으면 null)
    const row = await this.db.prepare(
      'UPDATE questions SET unit = ?2, level = ?3, text = ?4, choice1 = ?5, choice2 = ?6,' +
      ' choice3 = ?7, choice4 = ?8, answer = ?9, explanation = ?10 WHERE id = ?1 RETURNING id'
    ).bind(
      id, q.unit, q.level, q.text, q.choices[0], q.choices[1], q.choices[2], q.choices[3], q.answer, q.explanation
    ).first<{ id: number }>();
    return !!row;
  }

  async adminDeleteQuestion(id: number): Promise<boolean> {
    const row = await this.db.prepare('DELETE FROM questions WHERE id = ?1 RETURNING id').bind(id).first<{ id: number }>();
    return !!row;
  }

  async adminAnimals(): Promise<AdminAnimal[]> {
    const r = await this.db.prepare('SELECT code, name, emoji FROM animals ORDER BY code').all<AnimalRow>();
    return (r.results || []).map((x) => ({
      code: String(x.code), name: String(x.name), emoji: String(x.emoji ?? '')
    }));
  }

  async adminSaveAnimals(rows: AdminAnimal[]): Promise<void> {
    const codes = rows.map((r) => r.code);
    // ⚠️ A~H 가 아닌 줄을 지운다. 지우지 않으면 9줄짜리 표를 관리 화면에서 **고칠 방법이 없다** —
    //    8줄을 저장해도 남은 한 줄 때문에 계속 차단이다 (bank.ts checkAnimals)
    const stmts = [
      this.db.prepare(
        `DELETE FROM animals WHERE code NOT IN (${codes.map((_, i) => '?' + (i + 1)).join(', ')})`
      ).bind(...codes),
      ...rows.map((r) => this.db.prepare(
        'INSERT INTO animals (code, name, emoji) VALUES (?1, ?2, ?3)' +
        ' ON CONFLICT(code) DO UPDATE SET name = excluded.name, emoji = excluded.emoji'
      ).bind(r.code, r.name, r.emoji))
    ];
    await this.db.batch(stmts);
  }

  async adminSettings(): Promise<AdminSetting[]> {
    const r = await this.db.prepare('SELECT key, value FROM settings ORDER BY key').all<SettingRow>();
    return (r.results || []).map((x) => ({ key: String(x.key), value: String(x.value) }));
  }

  async adminSaveSettings(rows: AdminSetting[]): Promise<void> {
    // label 열은 건드리지 않는다 — 시드가 넣어 둔 한국어 이름이고, 화면은 SETTING_RANGE 의
    // label 을 쓴다. 여기서 덮어쓰면 두 곳이 갈라진다
    await this.db.batch(rows.map((r) => this.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?1, ?2)' +
      ' ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).bind(r.key, r.value)));
  }
}
