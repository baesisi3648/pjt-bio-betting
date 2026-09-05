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
import type { DbPort, PreparedUnit, RecentGame } from './ports.ts';

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
      this.db.prepare(
        'SELECT id, unit, level, text, choice1, choice2, choice3, choice4, answer, explanation' +
        ' FROM questions WHERE unit = ?1 ORDER BY id'
      ).bind(unit).all<QuestionRow>(),
      this.db.prepare('SELECT code, name, emoji FROM animals ORDER BY code').all<AnimalRow>(),
      this.db.prepare('SELECT key, value FROM settings').all<SettingRow>()
    ]);
    return validateUnit(unit, q.results || [], a.results || [], s.results || []);
  }
}
