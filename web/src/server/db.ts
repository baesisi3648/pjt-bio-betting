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

import { LEVELS } from '../game/config.ts';
import { validateSet } from './bank.ts';
import type { AnimalRow, QuestionRow, SettingRow } from './bank.ts';
import type {
  AdminAnimal, AdminQuestion, AdminSetting, DbPort, GameRow, ImportMode, PreparedSet,
  QuestionDraft, RecentGame, SetInfo
} from './ports.ts';

/** D1 행 → 관리 화면이 쓰는 모양. 열 이름(choice1~4)을 아는 곳은 이 파일뿐이다 */
function toAdminQuestion(r: QuestionRow): AdminQuestion {
  return {
    id: Number(r.id), setName: String(r.set_name), level: String(r.level), text: String(r.text),
    choices: [r.choice1, r.choice2, r.choice3, r.choice4].map((c) => String(c ?? '')),
    answer: Number(r.answer), explanation: String(r.explanation ?? '')
  };
}

const Q_COLS = 'id, set_name, level, text, choice1, choice2, choice3, choice4, answer, explanation';

/** D1 의 `games` 한 줄. 열 이름(snake_case)을 아는 곳은 이 파일뿐이다 */
interface GameSqlRow {
  code: string; class_name: string; set_name: string; created_at: number; is_over: number;
  /** migrations/0007. 정산 전이거나 0007 이전에 정산된 판이면 null */
  finished_at: number | null;
}

export class D1Db implements DbPort {
  private db: D1Database;
  constructor(db: D1Database) { this.db = db; }

  /**
   * 세트 목록 + 난이도별 개수.
   *
   * ⚠️ 한 번의 왕복으로 끝낸다. 세트 이름을 먼저 읽고 세트마다 개수를 다시 세면
   *    세트가 열 개일 때 열한 번의 D1 왕복이 되고, 그 표는 관리 화면이 저장할 때마다
   *    다시 그려진다.
   *
   * ⚠️ 정렬은 **문제은행에 들어온 순서**(MIN(id))다. 이름순으로 바꾸면 교사 화면
   *    드롭다운의 순서가 문항 하나 고칠 때마다 뒤바뀐다.
   */
  async listSets(): Promise<SetInfo[]> {
    const r = await this.db.prepare(
      'SELECT set_name, level, COUNT(*) AS n, MIN(id) AS first_id FROM questions' +
      ' GROUP BY set_name, level ORDER BY MIN(id)'
    ).all<{ set_name: string; level: string; n: number; first_id: number }>();

    const order: string[] = [];
    const acc = new Map<string, SetInfo>();
    for (const x of r.results || []) {
      const name = String(x.set_name);
      let hit = acc.get(name);
      if (!hit) {
        hit = { name, total: 0, byLevel: {} };
        for (const lv of LEVELS) hit.byLevel[lv] = 0;
        acc.set(name, hit);
        order.push(name);
      }
      const n = Number(x.n);
      hit.total += n;
      // ⚠️ 난이도가 LEVELS 밖인 행(옛 '중간' 같은 것)도 total 에는 센다.
      //    개수만 맞고 칸이 없으면 "합계는 30인데 칸의 합은 27" 이 되어 눈에 띈다
      hit.byLevel[String(x.level)] = (hit.byLevel[String(x.level)] ?? 0) + n;
    }
    return order.map((n) => acc.get(n)!);
  }

  async recentGames(limit: number): Promise<RecentGame[]> {
    const r = await this.db
      .prepare('SELECT code, class_name, set_name, created_at, is_over FROM games ORDER BY created_at DESC LIMIT ?1')
      .bind(Math.max(1, Math.floor(limit) || 10))
      .all<GameSqlRow>();
    // ⚠️ 여기서 고르는 열이 곧 "인증 없이 나가는 것"이다. 라운드 진행 상황이나
    //    상태 JSON 을 여기 얹지 마세요 — 이 목록은 아무나 볼 수 있습니다
    //
    // ⚠️ 열쇠 이름은 아직 className·unit 이다 (ports.ts RecentGame 주석).
    //    교사 화면이 그 이름으로 읽고 있고, 그 화면은 3단계 몫이다
    return (r.results || []).map((x) => ({
      code: String(x.code),
      className: String(x.class_name),
      unit: String(x.set_name),
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
      .prepare('INSERT INTO games (code, class_name, set_name, created_at, is_over) VALUES (?1, ?2, ?3, ?4, 0)')
      .bind(row.code, row.className, row.unit, row.createdAt)
      .run();
  }

  /**
   * ⚠️ `finished_at` 을 **같이** 쓴다. 정산한 판은 정산 30일 뒤에 지워지므로
   *    (migrations/0007 · cleanup.ts), 이 한 줄을 빠뜨리면 그 판은 정산했는데도
   *    미정산 취급(90일)이 되어 두 달을 더 남는다.
   */
  async markOver(code: string, finishedAt: number): Promise<void> {
    await this.db.prepare('UPDATE games SET is_over = 1, finished_at = ?2 WHERE code = ?1')
      .bind(code, finishedAt).run();
  }

  /**
   * 정리용 — 표 전체를 시각과 상태만. ⚠️ 부르는 곳은 `cleanup.ts` 하나뿐이다.
   * 판이 수백 개가 되어도 세 개의 숫자 열이라 한 번의 왕복으로 끝난다
   */
  async allGames(): Promise<GameRow[]> {
    const r = await this.db
      .prepare('SELECT code, created_at, is_over, finished_at FROM games')
      .all<GameSqlRow>();
    return (r.results || []).map((x) => ({
      code: String(x.code),
      createdAt: Number(x.created_at),
      isOver: !!Number(x.is_over),
      // ⚠️ `Number(null)` 은 0 이다. 0 으로 바꾸면 "1970년에 정산된 판" 이 되어
      //    0007 이전 판이 전부 만료로 읽힌다 (cleanup.ts isExpired 주석)
      finishedAt: x.finished_at == null ? null : Number(x.finished_at)
    }));
  }

  /** ⚠️ 이 표만 지운다. 판의 **상태**는 DO 에 있고 그건 RoomPort.wipe 가 지운다 */
  async deleteGame(code: string): Promise<void> {
    await this.db.prepare('DELETE FROM games WHERE code = ?1').bind(code).run();
  }

  /** ⚠️ `setName` 이 null 이면 **전체 은행**이다 — WHERE 절 없이 통째로 읽는다 */
  async prepareSet(setName: string | null): Promise<PreparedSet> {
    const [q, a, s] = await Promise.all([
      setName === null
        ? this.db.prepare(`SELECT ${Q_COLS} FROM questions ORDER BY id`).all<QuestionRow>()
        : this.db.prepare(`SELECT ${Q_COLS} FROM questions WHERE set_name = ?1 ORDER BY id`)
            .bind(setName).all<QuestionRow>(),
      this.db.prepare('SELECT code, name, emoji FROM animals ORDER BY code').all<AnimalRow>(),
      this.db.prepare('SELECT key, value FROM settings').all<SettingRow>()
    ]);
    return validateSet(setName, q.results || [], a.results || [], s.results || []);
  }

  // ──────────────────────────────────────────────────────────
  // 관리 화면 — 여기 담긴 것은 전부 정답을 포함한다
  //
  // ⚠️ 부르는 곳은 src/server/admin.ts 하나뿐이고, 그 앞에 관리자 비밀번호 확인이 있다.
  //    다른 라우트에서 이 메서드를 부르지 마세요 — 그 순간 정답이 인증 밖으로 나갑니다.
  //
  // ⚠️ 여기서 고친 문항은 **다음에 만드는 판**부터 적용된다. 이미 만든 판은 문항 내용까지
  //    상태에 굳어 있다 (MIGRATION §4-6). 그래서 이 파일에는 판을 건드리는 코드가 없다.
  // ──────────────────────────────────────────────────────────

  async adminQuestions(setName: string | null): Promise<AdminQuestion[]> {
    const r = setName
      ? await this.db.prepare(`SELECT ${Q_COLS} FROM questions WHERE set_name = ?1 ORDER BY id`)
          .bind(setName).all<QuestionRow>()
      : await this.db.prepare(`SELECT ${Q_COLS} FROM questions ORDER BY set_name, id`).all<QuestionRow>();
    return (r.results || []).map(toAdminQuestion);
  }

  async adminAddQuestion(q: QuestionDraft): Promise<AdminQuestion> {
    // ⚠️ id 를 우리가 고르지 않는다. 손으로 세면 두 요청이 같은 번호를 잡는 날이 온다 —
    //    SQLite 의 INTEGER PRIMARY KEY 가 알아서 다음 번호를 주고, RETURNING 으로 받는다
    const row = await this.db.prepare(
      'INSERT INTO questions (set_name, level, text, choice1, choice2, choice3, choice4, answer, explanation)' +
      ' VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING ' + Q_COLS
    ).bind(
      q.setName, q.level, q.text, q.choices[0], q.choices[1], q.choices[2], q.choices[3], q.answer, q.explanation
    ).first<QuestionRow>();
    if (!row) throw new Error('문항을 넣지 못했어요');
    return toAdminQuestion(row);
  }

  async adminUpdateQuestion(id: number, q: QuestionDraft): Promise<boolean> {
    // RETURNING id 로 "그 행이 있었는가"를 한 번의 왕복으로 안다 (없으면 null)
    const row = await this.db.prepare(
      'UPDATE questions SET set_name = ?2, level = ?3, text = ?4, choice1 = ?5, choice2 = ?6,' +
      ' choice3 = ?7, choice4 = ?8, answer = ?9, explanation = ?10 WHERE id = ?1 RETURNING id'
    ).bind(
      id, q.setName, q.level, q.text, q.choices[0], q.choices[1], q.choices[2], q.choices[3], q.answer, q.explanation
    ).first<{ id: number }>();
    return !!row;
  }

  async adminDeleteQuestion(id: number): Promise<boolean> {
    const row = await this.db.prepare('DELETE FROM questions WHERE id = ?1 RETURNING id').bind(id).first<{ id: number }>();
    return !!row;
  }

  async adminRenameSet(from: string, to: string): Promise<number> {
    // ⚠️ 문항 id 는 그대로 둔다. 세트 이름은 표시용이고, 이미 만들어져 도는 판의 상태에는
    //    그때의 id 와 문항 내용이 굳어 있다 (§4-6) — 이름을 바꿔도 그 판은 아무 영향이 없다
    const r = await this.db.prepare('UPDATE questions SET set_name = ?2 WHERE set_name = ?1')
      .bind(from, to).run();
    return Number(r.meta?.changes ?? 0);
  }

  async adminDeleteSet(name: string): Promise<number> {
    const r = await this.db.prepare('DELETE FROM questions WHERE set_name = ?1').bind(name).run();
    return Number(r.meta?.changes ?? 0);
  }

  /**
   * JSON 가져오기 — **한 번의 batch 로 끝낸다.**
   *
   * ⚠️ 지우기와 넣기를 두 번 왕복으로 나누면, 그 사이에 실패했을 때 선생님의 문제은행이
   *    **빈 채로 남는다.** replaceAll 이 특히 그렇다 — 30문항을 넣으려다 은행을 통째로
   *    잃는 것이 이 스위치의 최악이고, batch 가 그걸 막는다 (D1 batch 는 암묵적 트랜잭션이다).
   */
  async adminImport(setName: string, mode: ImportMode, rows: QuestionDraft[]): Promise<number> {
    const stmts: D1PreparedStatement[] = [];
    if (mode === 'replaceAll') stmts.push(this.db.prepare('DELETE FROM questions'));
    else if (mode === 'replaceSet') stmts.push(this.db.prepare('DELETE FROM questions WHERE set_name = ?1').bind(setName));

    for (const q of rows) {
      stmts.push(this.db.prepare(
        'INSERT INTO questions (set_name, level, text, choice1, choice2, choice3, choice4, answer, explanation)' +
        ' VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)'
      ).bind(
        q.setName, q.level, q.text, q.choices[0], q.choices[1], q.choices[2], q.choices[3], q.answer, q.explanation
      ));
    }
    if (stmts.length) await this.db.batch(stmts);
    return rows.length;
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
