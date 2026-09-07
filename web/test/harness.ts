/**
 * harness.ts — 게이트가 라우터를 **인메모리 포트**로 두드리는 그물.
 *
 * RoomPort 뒤에는 진짜 `Room` 이 있고, DbPort 뒤에는 진짜 `validateUnit` 이 있다.
 * workerd 도 D1 도 띄우지 않는다 — 그게 라우터가 `env` 대신 ports.ts 만 보게 만든
 * 이유다 (MIGRATION §9-3).
 *
 * ⚠️ 이 파일을 따로 뺀 이유: `test/gateway.ts` 와 `test/admin.ts` 가 **같은 가짜**를
 *    써야 하기 때문이다. 관리 라우트용으로 MemDb 를 하나 더 쓰면, 두 가짜가 갈라지는
 *    날 한쪽 게이트만 초록불이 된다 — 게이트가 사본을 검사하던 그 함정이다 (MIGRATION §5).
 *
 * ⚠️ 여기에 게이트를 쓰지 마세요. 이 파일은 import 되는 순간 아무것도 실행하지 않아야
 *    합니다 (게이트 파일을 import 하면 그쪽 게이트가 통째로 다시 돕니다).
 */

import { ANIMAL_CODES, LEVELS } from '../src/game/config.ts';
import type { Level } from '../src/game/config.ts';
import type { GameState, Rng } from '../src/game/types.ts';
import { Room } from '../src/do/room.ts';
import type { Envelope, GameEvent } from '../src/do/room.ts';
import { RoomOps } from '../src/do/ops.ts';
import type { ThrottleState } from '../src/do/ops.ts';
import { validateSet } from '../src/server/bank.ts';
import type { AnimalRow, QuestionRow, SettingRow } from '../src/server/bank.ts';
import { handle } from '../src/server/router.ts';
import type {
  AdminAnimal, AdminQuestion, AdminSetting, ApiResponse, DbPort, GameRow, ImportMode, Ports,
  PreparedSet, QuestionDraft, RecentGame, RoomPort, SetInfo
} from '../src/server/ports.ts';

export const ORIGIN = 'https://derby.example.workers.dev';

// ────────────────────────────────────────────────────────────
// 인메모리 D1 — 행 모양은 migrations/0001_init.sql 그대로
// ────────────────────────────────────────────────────────────

/**
 * 문제 세트 두 개.
 *
 * ⚠️ 개수가 `LIMITS.minQuestionsPerLevel`(10) 에 맞춰져 있다. 6이던 시절의 값(난이도별 6)을
 *    그대로 두면 **두 세트 다 경고가 나서**, "경고 없이 만들어지는 세트" 로 검사하는 게이트가
 *    전부 의미를 잃는다 (GW2 는 경고가 정확히 하나인 것을 본다).
 */
export const QUESTIONS: QuestionRow[] = [];
{
  let id = 1;
  // '유전' 은 난이도별 10문항 — 경고 없이 판이 만들어지는 세트
  for (const lv of LEVELS) {
    for (let i = 1; i <= 10; i++) {
      QUESTIONS.push({
        id: id++, set_name: '유전', level: lv, text: `유전 ${lv} 문제 ${i}`,
        choice1: 'ㄱ', choice2: 'ㄴ', choice3: 'ㄷ', choice4: 'ㄹ',
        answer: (i % 4) + 1, explanation: '해설'
      });
    }
  }
  // '항상성' 은 어려움이 3문항뿐 — 경고가 나되 판은 만들어져야 하는 세트
  for (const lv of LEVELS) {
    for (let i = 1; i <= (lv === '어려움' ? 3 : 10); i++) {
      QUESTIONS.push({
        id: id++, set_name: '항상성', level: lv, text: `항상성 ${lv} 문제 ${i}`,
        choice1: 'ㄱ', choice2: 'ㄴ', choice3: 'ㄷ', choice4: 'ㄹ',
        answer: (i % 4) + 1, explanation: '해설'
      });
    }
  }
}

export const ANIMAL_NAMES = ['치타', '사자', '호랑이', '늑대', '얼룩말', '타조', '개구리', '거북이'];
export const ANIMALS: AnimalRow[] = ANIMAL_CODES.map((c, i) => ({ code: c, name: ANIMAL_NAMES[i]!, emoji: '🐎' }));

// ⚠️ migrations/0002 + 0005 + 0008 의 값과 **같아야 한다.** 시드와 가짜가 갈라지면
//    게이트가 딴 판(옛 시간·옛 트랙·옛 코인)을 검사하고, 배포판만 조용히 다르게 돈다
export const SETTINGS: SettingRow[] = [
  // 0008_coins30.sql — 20 → 30 (라운드당 3코인 × 10라운드)
  { key: 'initialCoins', value: '30' }, { key: 'maxBetPerRound', value: '3' },
  { key: 'seedCoins', value: '15' }, { key: 'moveSeconds', value: '15' },
  { key: 'quizSeconds', value: '40' }, { key: 'discussSeconds', value: '90' },
  { key: 'betSeconds', value: '45' }, { key: 'trackCells', value: '20' },
  // migrations/0004_auto_skip.sql 과 같은 값. 시드와 가짜가 갈라지면 게이트가 딴 판을 검사한다
  { key: 'autoSkipSeconds', value: '5' }
];

/**
 * 인메모리 '게임' 표 한 줄 — D1 의 `games` 와 같은 칸을 든다.
 * ⚠️ `finishedAt` 을 빠뜨리면 정리 게이트(CLEAN1~3)가 검사할 것이 없어진다 (migrations/0007)
 */
interface MemGameRow {
  code: string; className: string; unit: string; createdAt: number;
  isOver: boolean; finishedAt: number | null;
}

export class MemDb implements DbPort {
  questions = QUESTIONS.map((q) => ({ ...q }));
  animals = ANIMALS.map((a) => ({ ...a }));
  settings = SETTINGS.map((s) => ({ ...s }));
  games: MemGameRow[] = [];
  /** '최근 판 목록이 터져도 단원 목록은 살아야 한다' 를 검사하기 위한 스위치 */
  recentThrows = false;

  /** D1Db.listSets 와 **같은 계약** — 문제은행에 들어온 순서, 난이도별 개수 */
  async listSets(): Promise<SetInfo[]> {
    const order: string[] = [];
    const acc = new Map<string, SetInfo>();
    for (const q of this.questions) {
      let hit = acc.get(q.set_name);
      if (!hit) {
        hit = { name: q.set_name, total: 0, byLevel: {} };
        for (const lv of LEVELS) hit.byLevel[lv] = 0;
        acc.set(q.set_name, hit);
        order.push(q.set_name);
      }
      hit.total++;
      hit.byLevel[q.level] = (hit.byLevel[q.level] ?? 0) + 1;
    }
    return order.map((n) => acc.get(n)!);
  }
  async recentGames(limit: number): Promise<RecentGame[]> {
    if (this.recentThrows) throw new Error('게임 표를 읽지 못했어요');
    return this.games.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, limit)
      .map((g) => ({ code: g.code, className: g.className, unit: g.unit, createdAt: g.createdAt, isOver: g.isOver }));
  }
  /** ⚠️ `setName` 이 null 이면 전체 은행 — D1Db.prepareSet 이 WHERE 절을 빼는 자리다 */
  async prepareSet(setName: string | null): Promise<PreparedSet> {
    // ⚠️ 진짜 검사 함수를 부른다. 여기에 비슷한 걸 하나 더 쓰면 게이트가 사본을 검사한다 (§5)
    return validateSet(
      setName,
      setName === null ? this.questions : this.questions.filter((q) => q.set_name === setName),
      this.animals, this.settings
    );
  }
  async hasGame(code: string): Promise<boolean> { return this.games.some((g) => g.code === code); }
  async addGame(row: { code: string; className: string; unit: string; createdAt: number }): Promise<void> {
    this.games.push({ ...row, isOver: false, finishedAt: null });
  }
  /** ⚠️ D1Db 와 같은 계약 — 정산 표시와 정산 **시각**을 같이 쓴다 (migrations/0007) */
  async markOver(code: string, finishedAt: number): Promise<void> {
    const g = this.games.find((x) => x.code === code);
    if (g) { g.isOver = true; g.finishedAt = finishedAt; }
  }
  async allGames(): Promise<GameRow[]> {
    return this.games.map((g) => ({
      code: g.code, createdAt: g.createdAt, isOver: g.isOver, finishedAt: g.finishedAt
    }));
  }
  async deleteGame(code: string): Promise<void> {
    const i = this.games.findIndex((g) => g.code === code);
    if (i >= 0) this.games.splice(i, 1);
  }

  // ── 관리 화면 (5단계). D1Db 와 **같은 계약**을 지킨다 ──

  private toAdmin(r: QuestionRow): AdminQuestion {
    return {
      id: r.id, setName: r.set_name, level: r.level, text: r.text,
      choices: [r.choice1, r.choice2, r.choice3, r.choice4],
      answer: r.answer, explanation: r.explanation ?? ''
    };
  }
  /** ⚠️ D1 은 INTEGER PRIMARY KEY 가 다음 번호를 준다. 지운 번호를 다시 쓰지 않는 성질만 같다 */
  private nextId(): number {
    return this.questions.reduce((m, x) => Math.max(m, x.id), 0) + 1;
  }
  private toRow(id: number, q: QuestionDraft): QuestionRow {
    return {
      id, set_name: q.setName, level: q.level, text: q.text,
      choice1: q.choices[0]!, choice2: q.choices[1]!, choice3: q.choices[2]!, choice4: q.choices[3]!,
      answer: q.answer, explanation: q.explanation
    };
  }
  async adminQuestions(setName: string | null): Promise<AdminQuestion[]> {
    return this.questions.filter((q) => !setName || q.set_name === setName).map((q) => this.toAdmin(q));
  }
  async adminAddQuestion(q: QuestionDraft): Promise<AdminQuestion> {
    const row = this.toRow(this.nextId(), q);
    this.questions.push(row);
    return this.toAdmin(row);
  }
  async adminUpdateQuestion(id: number, q: QuestionDraft): Promise<boolean> {
    const row = this.questions.find((x) => x.id === id);
    if (!row) return false;
    Object.assign(row, {
      set_name: q.setName, level: q.level, text: q.text,
      choice1: q.choices[0], choice2: q.choices[1], choice3: q.choices[2], choice4: q.choices[3],
      answer: q.answer, explanation: q.explanation
    });
    return true;
  }
  async adminDeleteQuestion(id: number): Promise<boolean> {
    const i = this.questions.findIndex((x) => x.id === id);
    if (i < 0) return false;
    this.questions.splice(i, 1);
    return true;
  }
  async adminRenameSet(from: string, to: string): Promise<number> {
    let n = 0;
    for (const q of this.questions) if (q.set_name === from) { q.set_name = to; n++; }
    return n;
  }
  async adminDeleteSet(name: string): Promise<number> {
    const before = this.questions.length;
    this.questions = this.questions.filter((q) => q.set_name !== name);
    return before - this.questions.length;
  }
  /**
   * ⚠️ D1Db 는 이것을 **한 번의 batch** 로 한다 (지우기와 넣기 사이에 실패하면 문제은행이
   *    빈 채로 남는다). 인메모리에서는 실패할 지점이 없으므로 같은 **순서**만 지킨다 —
   *    지우고 나서 넣는다. 순서가 다르면 replaceSet 이 방금 넣은 것을 도로 지운다
   */
  async adminImport(setName: string, mode: ImportMode, rows: QuestionDraft[]): Promise<number> {
    if (mode === 'replaceAll') this.questions = [];
    else if (mode === 'replaceSet') this.questions = this.questions.filter((q) => q.set_name !== setName);
    for (const q of rows) this.questions.push(this.toRow(this.nextId(), { ...q, setName }));
    return rows.length;
  }
  async adminAnimals(): Promise<AdminAnimal[]> {
    return this.animals.slice()
      .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
      .map((a) => ({ code: a.code, name: a.name, emoji: a.emoji ?? '' }));
  }
  async adminSaveAnimals(rows: AdminAnimal[]): Promise<void> {
    // A~H 가 아닌 줄을 지운다 — D1Db 와 같다. 안 지우면 9줄짜리 표를 화면에서 못 고친다
    const codes = rows.map((r) => r.code);
    this.animals = this.animals.filter((a) => codes.indexOf(a.code) >= 0);
    for (const r of rows) {
      const hit = this.animals.find((a) => a.code === r.code);
      if (hit) { hit.name = r.name; hit.emoji = r.emoji; }
      else this.animals.push({ code: r.code, name: r.name, emoji: r.emoji });
    }
  }
  async adminSettings(): Promise<AdminSetting[]> {
    return this.settings.slice().sort((a, b) => (a.key < b.key ? -1 : 1)).map((s) => ({ key: s.key, value: s.value }));
  }
  async adminSaveSettings(rows: AdminSetting[]): Promise<void> {
    for (const r of rows) {
      const hit = this.settings.find((s) => s.key === r.key);
      if (hit) hit.value = r.value;
      else this.settings.push({ key: r.key, value: r.value });
    }
  }
}

// ────────────────────────────────────────────────────────────
// 인메모리 판 — GameRoom 이 하는 일을 가짜 시계로 한다
// ────────────────────────────────────────────────────────────

export class MemRoom implements RoomPort {
  room: Room;
  ops: RoomOps;
  alarmAt: number | null = null;
  events: GameEvent[] = [];
  snapshots: GameState[] = [];
  private clock: { now: number };

  constructor(clock: { now: number }, rng?: Rng) {
    this.clock = clock;
    this.room = new Room({
      now: () => this.clock.now,
      setAlarm: (at) => { this.alarmAt = at; },
      persist: (s) => { this.snapshots.push(JSON.parse(JSON.stringify(s))); },
      appendEvent: (ev) => { this.events.push(ev); },
      changed: () => { /* 소켓 푸시는 GameRoom 의 몫 */ },
      rng
    });
    // ⚠️ GameRoom 과 **같은 RoomOps** 를 쓴다. Worker 쪽에 따로 잠금을 두면
    //    소켓으로 들어온 시도는 세지 않게 되고, 잠금이 반쪽이 된다
    this.ops = new RoomOps(this.room, {
      now: () => this.clock.now,
      persistThrottle: () => { /* 인메모리 */ }
    });
  }

  /** CLEAN4 용 — 이 판의 `wipe()` 만 던지게 만든다 (DO 가 응답하지 않는 날) */
  wipeThrows = false;

  async op(name: string, args: unknown[]): Promise<Envelope<unknown>> { return this.ops.op(name, args); }
  async hostKey(): Promise<string | null> {
    const s = this.room.raw();
    return s ? s.hostKey : null;
  }
  /**
   * GameRoom.wipe 와 **같은 계약** — 상태·이벤트·알람을 통째로 버린다.
   * ⚠️ `hydrate(null)` 이 정본이다. 여기서 이벤트만 비우고 상태를 남기면 게이트는
   *    초록불인데 진짜 DO 는 지운 판을 계속 살아 있는 것처럼 답한다 (MIGRATION §5)
   */
  async wipe(): Promise<void> {
    if (this.wipeThrows) throw new Error('DO 가 응답하지 않아요');
    this.room.hydrate(null);
    this.alarmAt = null;
    this.events = [];
    this.snapshots = [];
  }
  throttle(): ThrottleState { return this.ops.throttleState(); }
}

// ────────────────────────────────────────────────────────────
// 그물 — 라우터를 HTTP 처럼 두드린다
// ────────────────────────────────────────────────────────────

export interface CallOpts { body?: unknown; headers?: Record<string, string> }

export class Net {
  clock = { now: 1_767_225_600_000 };      // 2026-01-01
  db = new MemDb();
  rooms = new Map<string, MemRoom>();
  adminPassword: string | undefined = 'sEcRet-비밀번호-1234';
  codeRng: Rng | undefined = undefined;
  /** 이 그물을 통과한 모든 응답 — GW4·LEAK 가 통째로 훑는다 */
  log: { path: string; res: ApiResponse }[] = [];

  ports(): Ports {
    return {
      room: (code) => this.roomOf(code),
      db: this.db,
      adminPassword: this.adminPassword,
      now: () => this.clock.now,
      rng: this.codeRng
    };
  }

  roomOf(code: string): MemRoom {
    let r = this.rooms.get(code);
    // ⚠️ 방 **객체**를 만드는 것과 판을 만드는 것은 다르다. 여기서 만들어진 방은
    //    상태가 없어서 lobby 도 getState 도 GAME_NOT_FOUND 를 낸다 (게이트 SEC13)
    if (!r) { r = new MemRoom(this.clock); this.rooms.set(code, r); }
    return r;
  }

  async call(method: string, path: string, opt: CallOpts = {}): Promise<ApiResponse> {
    const url = new URL(path, ORIGIN);
    const query: Record<string, string> = {};
    url.searchParams.forEach((v, k) => { query[k] = v; });
    const headers: Record<string, string> = {};
    for (const k of Object.keys(opt.headers || {})) headers[k.toLowerCase()] = opt.headers![k]!;
    // ⚠️ 진짜 Worker 가 하듯 본문을 JSON 으로 굽고 다시 읽는다.
    //    Date 나 undefined 를 섞어 보내는 테스트가 있으면 여기서 티가 난다
    const body = opt.body === undefined ? undefined : JSON.parse(JSON.stringify(opt.body));

    const res = await handle(
      { method, path: url.pathname, query, headers, body, origin: ORIGIN }, this.ports()
    );
    this.log.push({ path: `${method} ${path}`, res });
    return res;
  }

  // ── 가짜 알람 (DO 알람 대신 테스트가 직접 때린다) ──
  advanceTo(code: string, target: number) {
    const r = this.roomOf(code);
    let guard = 0;
    while (r.alarmAt !== null && r.alarmAt <= target) {
      if (guard++ > 200) throw new Error('알람이 끝없이 다시 걸린다');
      const at = r.alarmAt;
      r.alarmAt = null;
      this.clock.now = Math.max(this.clock.now, at);
      r.room.onAlarm();
    }
    this.clock.now = Math.max(this.clock.now, target);
  }
  tick(ms: number) { this.clock.now += ms; }
  endPhase(code: string) {
    const end = this.state(code).phaseEndsAt;
    if (end) this.advanceTo(code, end);
  }

  /** 서버만 아는 것(정답·마지막 라운드·문항). 화면은 절대 이렇게 못 본다 */
  state(code: string): GameState { return this.roomOf(code).room.raw()!; }
}

export interface Opened { code: string; hostKey: string; pins: Record<number, string>; warnings: string[] }

export function dataOf(res: ApiResponse): Record<string, unknown> {
  return (res.body.ok ? res.body.data : {}) as Record<string, unknown>;
}
export function errOf(res: ApiResponse): string {
  return res.body.ok ? 'ok' : res.body.error;
}

/**
 * 판 하나를 만든다 — 게이트 대부분이 여기서 시작한다.
 *
 * ⚠️ 관리자 비밀번호를 싣는다. 판 만들기도 `adminDenied` 를 지나기 때문이다
 *    (2026-09-05 사용자 결정 — router.ts `createRoute` 주석). 그물의 값을 그대로 쓰므로
 *    게이트가 `net.adminPassword` 를 바꾸면 여기도 따라간다.
 *
 * ⚠️ `net.adminPassword = undefined` 로 만든 **뒤에** 부르면 `ADMIN_DISABLED` 로 던진다.
 *    미설정 배포를 검사하는 게이트는 판을 **먼저** 만들고 나서 꺼야 한다 (SEC12).
 */
export async function open(
  net: Net, setName: string | null = '유전', teamCount = 6, roomTitle = '2학년 3반', fraudEnabled?: boolean
): Promise<Opened> {
  const res = await net.call('POST', '/api/game', {
    headers: admin(net.adminPassword ?? ''),
    // 본문의 정본은 `roomTitle`·`setName` 이다. 옛 이름(`className`·`unit`)도 받는지는
    // GW-TITLE 이 따로 본다.
    // ⚠️ setName 이 null 이면 **아예 안 보낸다** — 안 보내는 것이 '전체 은행'이다 (SET2)
    body: {
      roomTitle, teamCount,
      ...(setName === null ? {} : { setName }),
      ...(fraudEnabled === undefined ? {} : { fraudEnabled })
    }
  });
  if (!res.body.ok) throw new Error('판 생성 실패: ' + res.body.error + ' ' + res.body.message);
  const d = dataOf(res);
  return {
    code: String(d.code), hostKey: String(d.hostKey),
    pins: d.pins as Record<number, string>, warnings: d.warnings as string[]
  };
}

export const host = (k: string) => ({ 'X-Host-Key': k });
export const pin = (p: string) => ({ 'X-Team-Pin': p });
/** 관리자 비밀번호 헤더. ⚠️ 물음표 뒤로는 보내지 않는다 — 주소는 기록에 남는다 (§8-1b) */
export const admin = (p: string) => ({ 'X-Admin-Password': p });

/** 응답에 들어 있는 모든 열쇠 이름 (중첩 포함). 문자열 포함 검사보다 정확하다 */
export function allKeys(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) { for (const x of v) allKeys(x, out); return out; }
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v as object)) { out.add(k); allKeys((v as Record<string, unknown>)[k], out); }
  }
  return out;
}

export function answerOf(net: Net, code: string, round: number, level: Level): number {
  const st = net.state(code);
  const id = st.questionPlan[round]![level]!;
  return st.questionById[id]!.answer;
}

// ────────────────────────────────────────────────────────────
// 게이트 실행기
// ────────────────────────────────────────────────────────────

export interface GateResult { ok: boolean; detail: string }

/**
 * 게이트 묶음 하나. 파일마다 자기 것을 만든다 —
 * 모듈 전역 카운터를 쓰면 두 게이트 파일이 한 프로세스에서 돌 때 숫자가 섞인다.
 */
export function createGates(title: string) {
  let pass = 0, fail = 0;
  console.log(`\n=== ${title} ===\n`);

  const gate = async (id: string, name: string, fn: () => Promise<GateResult>) => {
    let ok = false, detail = '';
    try { const r = await fn(); ok = r.ok; detail = r.detail; }
    catch (e) { ok = false; detail = 'ERROR ' + (e as Error).message + '\n          ' + ((e as Error).stack || '').split('\n')[1]; }
    ok ? pass++ : fail++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(11)} ${name}\n              ${detail}`);
  };

  /** ⚠️ 실패가 있으면 exit(1) 한다. 안 그러면 npm test 가 초록불로 끝난다 */
  const done = (label: string) => {
    console.log('\n====================================================');
    console.log(`${label} — 통과 ${pass} / 실패 ${fail}`);
    console.log('====================================================\n');
    if (fail) process.exit(1);
  };

  return { gate, done };
}
