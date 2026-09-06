/**
 * admin/main.ts — 애니멀 더비 문제 관리자 (MIGRATION §7 5단계 · RENEWAL §3-3).
 *
 * 앱스 스크립트판에서 이 일을 하던 것은 **스프레드시트 그 자체**였습니다. 선생님이
 * '문제' 탭에 줄을 넣고, 메뉴의 '시트 상태 확인'(`validateSheets`)이 난이도별 개수와
 * 동물 8줄을 검사했습니다. 문제은행이 D1 으로 들어오면서 그 탭도 그 메뉴도 사라졌고,
 * 이 화면이 그 둘을 대신합니다. 2단계에서 '단원'이 **문제 세트**가 되고,
 * JSON 가져오기·내보내기가 붙었습니다.
 *
 * ── 이 파일이 지키는 것 ──
 *
 * 1. **비밀번호는 매 요청 헤더에 싣는다.** 세션도 쿠키도 토큰도 없습니다 (§10 — 사용자 결정).
 *    저장은 `shared/pw.ts` 의 `pwStore` 하나가 맡습니다 — 교사 화면(판 만들기 ·
 *    열쇠 되찾기)이 **같은 열쇠**를 쓰기 때문에, 같은 출처에서 한 번만 넣으면 둘 다 통합니다.
 *
 * 2. **별도 진입점입니다.** 수업용 교사 번들(`teacher.html`)에 이 코드가 실리지 않게
 *    `admin.html` 을 Vite input 으로 따로 두었습니다 (vite.config.ts).
 *
 * 3. **난이도·범위·동물 코드·세트 목록을 여기에 박아 두지 않는다.** 전부 서버가 응답에
 *    실어 줍니다. 화면에 박으면 `src/game/config.ts` 를 고친 날 화면만 옛 값을 안내합니다 —
 *    '설정의 trackCells 를 12로 바꿔도 조용히 10칸'이었던 그 함정과 같은 종류입니다 (§5).
 *
 * 4. **저장 응답을 그대로 그린다.** 저장 뒤에 다시 GET 하지 않습니다. 쓰기 라우트가
 *    읽기와 같은 모양을 돌려주므로(`admin.ts`), "저장은 됐는데 화면은 옛날"이 없습니다.
 *
 * 5. **내보내기는 `<a href>` 가 아니라 `fetch` 다.** 그 파일에는 정답과 해설이 전부
 *    들어 있어서 라우트가 관리자 비밀번호를 요구하고, 링크에는 헤더를 실을 수 없습니다.
 *    받아서 Blob 으로 만들고 클릭으로 저장합니다 (게이트 EXP2).
 */

import { HEADER_UNSAFE_MSG, api, headerSafe, isOk } from '../shared/gateway.ts';
import { pwStore } from '../shared/pw.ts';
import { $, confirmBox, esc, toast } from '../shared/ui.ts';
import type { Envelope } from '../../do/room.ts';

// ────────────────────────────────────────────────────────────
// 서버가 주는 모양
// ────────────────────────────────────────────────────────────

interface AdminQuestion {
  id: number; setName: string; level: string; text: string;
  choices: string[]; answer: number; explanation: string;
}
interface AdminAnimal { code: string; name: string; emoji: string }
interface AdminSetting { key: string; value: string }
interface Range { min: number; max: number; label: string }

interface SetHealth {
  setName: string; counts: Record<string, number>; total: number;
  blocking: string[]; warnings: string[];
}
interface AnimalsData { animals: AdminAnimal[]; codes: string[]; blocking: string[] }
interface Summary {
  sets: SetHealth[]; levels: string[]; minPerLevel: number; animals: AnimalsData;
}
interface SettingsData { settings: AdminSetting[]; ranges: Record<string, Range>; warnings: string[] }

/** 가져오기 미리보기 (RENEWAL §3-2). `errors[].index` 는 0부터 — 화면에서 +1 한다 */
interface ImportSummary {
  title: string; total: number; byDifficulty: Record<string, number>;
  errors: { index: number; reason: string }[]; existingSet: boolean;
}

/** 파일에 적히는 난이도 → 화면에 쓸 한국어. 순서는 서버의 LEVELS 를 그대로 쓴다 */
const DIFF_ORDER = ['easy', 'medium', 'hard'];

// ────────────────────────────────────────────────────────────
// 이 화면이 기억하는 것
// ────────────────────────────────────────────────────────────

let PW = '';
let SUMMARY: Summary | null = null;
let QUESTIONS: AdminQuestion[] = [];
let SETS: string[] = [];
/** 지금 폼에 올라와 있는 문항. null 이면 '새 문제' */
let editing: AdminQuestion | null = null;
let ANIMALS: AnimalsData | null = null;
let SETTINGS: SettingsData | null = null;
/** 파일에서 읽어 미리보기까지 끝난 JSON. '적용' 버튼 셋이 이걸 쓴다 */
let pending: { json: unknown; summary: ImportSummary; setName: string } | null = null;

// ────────────────────────────────────────────────────────────
// 서버 부르기 — 비밀번호는 **매 호출** 헤더로
// ────────────────────────────────────────────────────────────

async function call(path: string, method = 'GET', body?: unknown): Promise<Envelope<unknown>> {
  return api(path, { method, body, headers: { 'X-Admin-Password': PW } });
}

/**
 * 봉투를 풀어 데이터를 준다. 거절이면 문장을 띄우고 null.
 *
 * ⚠️ 비밀번호가 틀리면(`ADMIN_DENIED`) 비밀번호 화면으로 되돌린다. 그러지 않으면
 *    선생님은 "저장이 안 된다"만 반복해서 보게 되고, 이유가 비밀번호라는 걸 모른다.
 *    (같은 이유로 `ADMIN_DISABLED` 는 배포 설정을 짚어 준다 — 고칠 사람이 볼 문장이다)
 */
function unwrap(env: Envelope<unknown>): Record<string, unknown> | null {
  if (isOk(env)) return env.data as Record<string, unknown>;
  if (env.error === 'ADMIN_DENIED') { logout(env.message || '관리자 비밀번호가 달라요'); return null; }
  if (env.error === 'ADMIN_DISABLED') { logout(disabledText()); return null; }
  toast(env.message || '문제가 생겼어요');
  return null;
}

function disabledText(): string {
  return '관리자 기능이 꺼져 있어요.\n배포 설정을 확인해주세요 — ADMIN_PASSWORD 가 없습니다.\n' +
    'npx wrangler secret put ADMIN_PASSWORD\n(로컬에서 확인 중이면 web/.dev.vars 에 넣습니다)';
}

// ────────────────────────────────────────────────────────────
// 들어가기 · 나가기
// ────────────────────────────────────────────────────────────

function logout(msg?: string): void {
  PW = '';
  pwStore(null);
  SUMMARY = null;
  $('app').classList.add('hidden');
  $('login').classList.remove('hidden');
  const box = $('login-msg');
  box.textContent = msg || '';
  box.classList.toggle('hidden', !msg);
  ($('pw') as HTMLInputElement).value = '';
}

async function login(pw: string): Promise<void> {
  if (!pw) { toast('비밀번호를 넣어주세요'); return; }
  if (!headerSafe(pw)) {
    const box = $('login-msg');
    // 검사와 문장은 shared/gateway.ts 에 — 교사 화면 '이어하기'와 같은 것을 쓴다
    box.textContent = HEADER_UNSAFE_MSG;
    box.classList.remove('hidden');
    pwStore(null);
    return;
  }
  PW = pw;
  // 비밀번호가 맞는지는 **서버에 물어봐야만** 안다. 화면에는 비교할 것이 없다
  const env = await call('/api/admin/summary').catch(() => null);
  if (!env) { PW = ''; toast('서버에 닿지 못했어요'); return; }
  if (!isOk(env)) {
    PW = '';
    const box = $('login-msg');
    box.textContent = env.error === 'ADMIN_DISABLED' ? disabledText() : (env.message || '들어가지 못했어요');
    box.classList.remove('hidden');
    return;
  }
  pwStore(pw);
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
  paintSummary(env.data as Summary);
  await Promise.all([loadQuestions(), loadAnimals(), loadSettings()]);
}

// ────────────────────────────────────────────────────────────
// 건강 표 — apps-script 의 '시트 상태 확인' (validateSheets)
// ────────────────────────────────────────────────────────────

async function refreshSummary(): Promise<void> {
  const d = unwrap(await call('/api/admin/summary'));
  if (d) paintSummary(d as unknown as Summary);
}

function paintSummary(s: Summary): void {
  SUMMARY = s;

  const head = ['<tr><th>문제 세트</th>' + s.levels.map((lv) => `<th>${esc(lv)}</th>`).join('') +
                '<th>합계</th></tr>'];
  const rows = s.sets.map((u) => {
    const cells = s.levels.map((lv) => {
      const n = u.counts[lv] ?? 0;
      // ⚠️ 색만으로 알리지 않는다 — 모자란 칸에는 ⚠️ 를 같이 단다 (05 §2)
      const low = n < s.minPerLevel;
      return `<td class="n ${low ? 'low' : 'full'}">${n}${low ? ' ⚠️' : ''}</td>`;
    }).join('');
    return `<tr><td><b>${esc(u.setName)}</b></td>${cells}<td class="n">${u.total}</td></tr>`;
  });

  let h = s.sets.length
    ? `<table class="health">${head.join('')}${rows.join('')}</table>` +
      `<div class="hint">난이도마다 <b>${s.minPerLevel}문항</b> 이상이면 ` +
      `${s.minPerLevel}라운드 동안 같은 문제가 안 나옵니다. 모자라면 앞 라운드 문제를 다시 냅니다.</div>`
    : '<div class="empty">문제가 하나도 없습니다. 아래 ‘＋ 새 문제’ 로 넣거나, ' +
      '‘📥 JSON 가져오기’ 로 파일을 넣으세요.</div>';

  for (const u of s.sets) {
    for (const m of u.blocking) h += `<div class="msg stop">⛔ ${esc(m)}</div>`;
    for (const m of u.warnings) h += `<div class="msg warn">⚠️ ${esc(m)}</div>`;
  }
  // 동물은 판 만들기를 **차단**한다. 세트 줄에 섞지 않고 따로 크게 보여준다
  for (const m of s.animals.blocking) {
    h += `<div class="msg stop">⛔ ${esc(m)} — 방을 만들 수 없습니다. ‘동물’ 탭에서 고쳐주세요.</div>`;
  }

  $('health').innerHTML = h;
}

// ────────────────────────────────────────────────────────────
// 문제 탭
// ────────────────────────────────────────────────────────────

/** 지금 고른 세트. 빈 문자열이면 '— 전체 —' */
function selectedSet(): string {
  return ($('q-set') as HTMLSelectElement).value;
}

async function loadQuestions(setName?: string): Promise<void> {
  const u = setName !== undefined ? setName : selectedSet();
  const d = unwrap(await call('/api/admin/questions' + (u ? `?set=${encodeURIComponent(u)}` : '')));
  if (!d) return;
  QUESTIONS = d.questions as AdminQuestion[];
  SETS = d.sets as string[];
  paintSetSelect(u);
  paintList();
}

function paintSetSelect(current: string): void {
  const sel = $('q-set') as HTMLSelectElement;
  sel.innerHTML = '<option value="">— 전체 —</option>' +
    SETS.map((u) => `<option${u === current ? ' selected' : ''}>${esc(u)}</option>`).join('');
  sel.value = current;
  // 세트를 안 골랐으면 이름 바꾸기·삭제는 뜻이 없다 (무엇을 바꿀지 모른다)
  const one = !!sel.value;
  ($('btn-rename') as HTMLButtonElement).disabled = !one;
  ($('btn-delset') as HTMLButtonElement).disabled = !one;
  closeRename();
}

function paintList(): void {
  const levelClass = (lv: string) => 'l' + Math.max(0, (SUMMARY?.levels || []).indexOf(lv));
  $('q-list').innerHTML = QUESTIONS.length
    ? QUESTIONS.map((q) =>
        `<tr data-id="${q.id}"${editing && editing.id === q.id ? ' class="on"' : ''}>` +
        `<td>${q.id}</td>` +
        `<td><span class="lv ${levelClass(q.level)}">${esc(q.level)}</span></td>` +
        `<td>${esc(q.text)}${selectedSet() ? '' : ` <span class="rng">(${esc(q.setName)})</span>`}</td>` +
        `<td class="ans">${q.answer}. ${esc(q.choices[q.answer - 1] ?? '')}</td></tr>`).join('')
    : '<tr><td colspan="4" class="empty">이 세트에는 아직 문제가 없습니다.</td></tr>';
}

/** 폼을 연다. q 가 null 이면 새 문제 */
function openForm(q: AdminQuestion | null): void {
  editing = q;
  const levels = SUMMARY?.levels || [];

  $('q-form-title').textContent = q ? `${q.id}번 문제 고치기` : '새 문제';
  ($('btn-del') as HTMLButtonElement).classList.toggle('hidden', !q);

  const setSel = $('f-set') as HTMLSelectElement;
  const cur = q ? q.setName : selectedSet();
  setSel.innerHTML = SETS.map((u) => `<option${u === cur ? ' selected' : ''}>${esc(u)}</option>`).join('') +
    '<option value="__new__">＋ 새 세트…</option>';
  // 세트가 하나도 없으면 처음부터 '새 세트' 칸을 연다
  const newSet = $('f-newset') as HTMLInputElement;
  newSet.value = '';
  if (!SETS.length) { setSel.value = '__new__'; newSet.classList.remove('hidden'); }
  else { setSel.value = cur || SETS[0]!; newSet.classList.add('hidden'); }

  const lvSel = $('f-level') as HTMLSelectElement;
  lvSel.innerHTML = levels.map((lv) => `<option${q && q.level === lv ? ' selected' : ''}>${esc(lv)}</option>`).join('');

  ($('f-text') as HTMLTextAreaElement).value = q ? q.text : '';
  ($('f-expl') as HTMLTextAreaElement).value = q ? q.explanation : '';

  // 보기 4개 + 정답 라디오. 정답을 라디오로 둔 이유: 숫자를 손으로 적으면 5나 0이 들어오고,
  // 그때 서버는 거절하지만 선생님은 왜 거절인지 화면에서 알 수 없다
  $('f-choices').innerHTML = [1, 2, 3, 4].map((n) =>
    `<div class="choice"><input type="radio" name="ans" id="f-a${n}" value="${n}"` +
    `${(q ? q.answer : 1) === n ? ' checked' : ''}>` +
    `<span class="no">${n}.</span>` +
    `<input id="f-c${n}" value="${esc(q ? (q.choices[n - 1] ?? '') : '')}" placeholder="보기 ${n}"></div>`).join('');

  $('q-form').classList.remove('hidden');
  paintList();
  ($('f-text') as HTMLTextAreaElement).focus();
}

function closeForm(): void {
  editing = null;
  $('q-form').classList.add('hidden');
  paintList();
}

function formBody(): Record<string, unknown> {
  const setSel = $('f-set') as HTMLSelectElement;
  const setName = setSel.value === '__new__'
    ? ($('f-newset') as HTMLInputElement).value.trim()
    : setSel.value;
  const checked = document.querySelector<HTMLInputElement>('input[name="ans"]:checked');
  return {
    setName,
    level: ($('f-level') as HTMLSelectElement).value,
    text: ($('f-text') as HTMLTextAreaElement).value,
    choices: [1, 2, 3, 4].map((n) => ($(`f-c${n}`) as HTMLInputElement).value),
    answer: checked ? Number(checked.value) : 0,
    explanation: ($('f-expl') as HTMLTextAreaElement).value
  };
}

async function saveQuestion(): Promise<void> {
  const body = formBody();
  const env = editing
    ? await call(`/api/admin/questions/${editing.id}`, 'PUT', body)
    : await call('/api/admin/questions', 'POST', body);
  const d = unwrap(env);
  if (!d) return;

  toast(editing ? '고쳤습니다' : '넣었습니다');
  const saved = d.question as AdminQuestion;
  closeForm();
  // 새 세트로 넣었으면 그 세트를 보여준다 — 안 그러면 방금 넣은 문제가 안 보인다
  await loadQuestions(selectedSet() && saved.setName !== selectedSet() ? saved.setName : selectedSet());
  await refreshSummary();
}

function deleteQuestion(): void {
  if (!editing) return;
  const q = editing;
  // ⚠️ 브라우저의 confirm() 을 쓰지 않는다 (shared/ui.ts 주석)
  confirmBox(`${q.id}번 문제를 지울까요?\n\n${q.text}\n\n이미 만든 방은 그대로입니다.`, async () => {
    const d = unwrap(await call(`/api/admin/questions/${q.id}`, 'DELETE'));
    if (!d) return;
    toast('지웠습니다');
    closeForm();
    await loadQuestions();
    await refreshSummary();
  });
}

// ────────────────────────────────────────────────────────────
// 세트 이름 바꾸기 · 삭제
// ────────────────────────────────────────────────────────────

function closeRename(): void {
  $('rename-row').classList.add('hidden');
}

function openRename(): void {
  const cur = selectedSet();
  if (!cur) return;
  const box = $('f-setname') as HTMLInputElement;
  box.value = cur;
  $('rename-row').classList.remove('hidden');
  box.focus();
  box.select();
}

async function renameSet(): Promise<void> {
  const from = selectedSet();
  const to = ($('f-setname') as HTMLInputElement).value.trim();
  if (!from || !to) { toast('새 세트 이름을 넣어주세요'); return; }
  const d = unwrap(await call('/api/admin/sets/' + encodeURIComponent(from), 'PUT', { name: to }));
  if (!d) return;
  toast(`'${to}' 로 바꿨습니다 (${d.affected}문항)`);
  closeRename();
  closeForm();
  await loadQuestions(to);
  await refreshSummary();
}

function deleteSet(): void {
  const name = selectedSet();
  if (!name) return;
  const n = SUMMARY?.sets.find((x) => x.setName === name)?.total ?? 0;
  confirmBox(
    `'${name}' 세트를 통째로 지울까요?\n\n문항 ${n}개가 사라집니다. 되돌릴 수 없습니다.\n` +
    '지우기 전에 ‘📤 JSON 내보내기’ 로 받아 두면 다시 넣을 수 있습니다.\n\n이미 만든 방은 그대로입니다.',
    async () => {
      const d = unwrap(await call('/api/admin/sets/' + encodeURIComponent(name), 'DELETE'));
      if (!d) return;
      toast(`'${name}' 을(를) 지웠습니다 (${d.affected}문항)`);
      closeForm();
      await loadQuestions('');
      await refreshSummary();
    }
  );
}

// ────────────────────────────────────────────────────────────
// JSON 내보내기
//
// ⚠️ `<a href="/api/admin/export">` 로는 못 받는다. 그 파일에는 정답과 해설이 전부
//    들어 있어서 라우트가 관리자 비밀번호를 요구하고, 링크에는 헤더를 실을 수 없다.
//    (물음표 뒤로 비밀번호를 받게 고치지 마세요 — 주소는 기록·어깨너머로 남습니다)
// ────────────────────────────────────────────────────────────

/** `content-disposition: attachment; filename*=UTF-8''…` 에서 이름을 꺼낸다 */
function fileNameOf(cd: string | null, fallback: string): string {
  if (!cd) return fallback;
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  if (!m) return fallback;
  try { return decodeURIComponent(m[1]!.trim()); } catch { return fallback; }
}

async function exportJson(): Promise<void> {
  const setName = selectedSet();
  const url = '/api/admin/export' + (setName ? `?set=${encodeURIComponent(setName)}` : '');

  let res: Response;
  try { res = await fetch(url, { headers: { 'X-Admin-Password': PW }, cache: 'no-store' }); }
  catch { toast('서버에 닿지 못했어요'); return; }

  // 거절이면 파일이 아니라 봉투가 온다 — 그 문장을 그대로 보여준다
  const cd = res.headers.get('content-disposition');
  if (!cd) {
    const env = await res.json().catch(() => null) as Envelope<unknown> | null;
    if (env) unwrap(env); else toast('내보내지 못했어요');
    return;
  }

  const text = await res.text();
  const name = fileNameOf(cd, `애니멀더비_${setName || '전체'}.json`);
  const blob = new Blob([text], { type: 'application/json' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // ⚠️ 안 풀면 이 탭이 살아 있는 동안 파일 내용이 메모리에 남는다.
  //    바로 풀면 사파리가 저장을 시작하기 전에 사라지므로 한 박자 뒤에 푼다
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
  toast(`${name} 로 저장했습니다`);
}

// ────────────────────────────────────────────────────────────
// JSON 가져오기 — 파일 → 미리보기 → 세 가지 방식 중 선택
// ────────────────────────────────────────────────────────────

function closeImport(): void {
  pending = null;
  $('imp-panel').classList.add('hidden');
  // ⚠️ 같은 파일을 두 번 고를 수 있게 값을 비운다. 안 비우면 change 가 안 나서
  //    "파일을 골랐는데 아무 일도 안 일어난다" 가 된다
  ($('f-file') as HTMLInputElement).value = '';
}

async function pickedFile(f: File): Promise<void> {
  let json: unknown;
  try { json = JSON.parse(await f.text()); }
  catch (e) {
    toast('JSON 파일을 읽지 못했어요 — ' + (e as Error).message);
    ($('f-file') as HTMLInputElement).value = '';
    return;
  }

  const d = unwrap(await call('/api/admin/import/preview', 'POST', { json }));
  if (!d) { ($('f-file') as HTMLInputElement).value = ''; return; }
  const s = d as unknown as ImportSummary;

  pending = { json, summary: s, setName: s.title };
  paintImport(f.name, s);
  $('imp-panel').classList.remove('hidden');
  $('imp-panel').scrollIntoView({ block: 'nearest' });
}

function paintImport(fileName: string, s: ImportSummary): void {
  const levels = SUMMARY?.levels || DIFF_ORDER;
  const counts = DIFF_ORDER.map((d, i) =>
    `<span class="pill l${i}">${esc(levels[i] ?? d)} ${s.byDifficulty[d] ?? 0}</span>`).join('');

  let h = `<div class="imp-head">📥 <b>${esc(fileName)}</b></div>`;
  h += `<div class="imp-title">세트 이름: <b>${esc(s.title || '(파일에 제목이 없습니다)')}</b>` +
       (s.existingSet ? ' <span class="tag">이미 있는 세트</span>' : '') + '</div>';
  h += `<div class="imp-count"><b>총 ${s.total}문항</b> ${counts}</div>`;

  if (s.errors.length) {
    // ⚠️ 몇 개인지만 말하고 끝내지 않는다. 어느 줄이 왜 틀렸는지 모르면 고칠 수 없다
    const lines = s.errors.slice(0, 12)
      .map((e) => `<li>${e.index + 1}번째 문항: ${esc(e.reason)}</li>`).join('');
    const more = s.errors.length > 12 ? `<li>… 그리고 ${s.errors.length - 12}개 더</li>` : '';
    h += `<div class="msg warn">⚠️ ${s.errors.length}개 문항은 <b>건너뜁니다</b> (형식 오류)<ul>${lines}${more}</ul></div>`;
  }
  if (!s.total) {
    h += '<div class="msg stop">⛔ 넣을 수 있는 문항이 하나도 없습니다. 파일을 고쳐서 다시 넣어주세요.</div>';
  }
  if (!s.existingSet) {
    h += '<div class="hint">‘같은 이름 세트 교체’ 는 같은 이름의 세트가 있을 때만 뜻이 있습니다 — ' +
         '지금은 새 세트가 만들어집니다.</div>';
  }

  $('imp-summary').innerHTML = h;
  const none = s.total === 0;
  for (const id of ['btn-imp-append', 'btn-imp-set', 'btn-imp-all']) {
    ($(id) as HTMLButtonElement).disabled = none;
  }
}

async function applyImport(mode: 'append' | 'replaceSet' | 'replaceAll'): Promise<void> {
  if (!pending) return;
  const body = { json: pending.json, mode, setName: pending.setName || undefined };
  const d = unwrap(await call('/api/admin/import', 'POST', body));
  if (!d) return;

  const skipped = Number(d.skipped) || 0;
  toast(`'${String(d.setName)}' 에 ${d.inserted}문항을 넣었습니다` +
        (skipped ? ` (형식 오류 ${skipped}개는 건너뜀)` : ''));
  closeImport();
  closeForm();
  await loadQuestions(String(d.setName));
  await refreshSummary();
}

// ────────────────────────────────────────────────────────────
// 동물 탭 — 추가·삭제가 아니라 **이름·이모지 교체**
// ────────────────────────────────────────────────────────────

async function loadAnimals(): Promise<void> {
  const d = unwrap(await call('/api/admin/animals'));
  if (d) paintAnimals(d as unknown as AnimalsData);
}

function paintAnimals(d: AnimalsData): void {
  ANIMALS = d;
  // 코드는 서버가 준 A~H 를 기준으로 줄을 만든다. 표에 빠진 코드가 있으면 빈 칸으로 뜬다 —
  // 그래야 망가진 표를 이 화면에서 채워 고칠 수 있다
  $('a-list').innerHTML = d.codes.map((c) => {
    const row = d.animals.find((a) => a.code === c);
    return `<tr><td class="code">${esc(c)}</td>` +
      `<td><input id="an-${esc(c)}" value="${esc(row ? row.name : '')}" placeholder="이름"></td>` +
      `<td><input id="ae-${esc(c)}" value="${esc(row ? row.emoji : '')}" placeholder="🐎"></td></tr>`;
  }).join('');

  $('a-warn').innerHTML = d.blocking.length
    ? d.blocking.map((m) => `<div class="msg stop">⛔ ${esc(m)} — 지금은 방을 만들 수 없습니다.</div>`).join('')
    : '';
}

async function saveAnimals(): Promise<void> {
  if (!ANIMALS) return;
  const animals = ANIMALS.codes.map((c) => ({
    code: c,
    name: ($(`an-${c}`) as HTMLInputElement).value,
    emoji: ($(`ae-${c}`) as HTMLInputElement).value
  }));
  const d = unwrap(await call('/api/admin/animals', 'PUT', { animals }));
  if (!d) return;
  toast('동물을 저장했습니다');
  paintAnimals(d as unknown as AnimalsData);
  await refreshSummary();
}

// ────────────────────────────────────────────────────────────
// 설정 탭 — 범위 밖은 저장되지 않는다
// ────────────────────────────────────────────────────────────

async function loadSettings(): Promise<void> {
  const d = unwrap(await call('/api/admin/settings'));
  if (d) paintSettings(d as unknown as SettingsData);
}

function paintSettings(d: SettingsData): void {
  SETTINGS = d;
  const value = (k: string) => (d.settings.find((s) => s.key === k)?.value ?? '');
  $('s-list').innerHTML = Object.keys(d.ranges).map((k) => {
    const r = d.ranges[k]!;
    return `<tr><td><b>${esc(r.label)}</b><div class="rng">${esc(k)}</div></td>` +
      `<td><input id="st-${esc(k)}" inputmode="numeric" value="${esc(value(k))}"></td>` +
      `<td class="rng">${r.min} ~ ${r.max}</td></tr>`;
  }).join('');

  $('s-warn').innerHTML = d.warnings.length
    ? d.warnings.map((m) => `<div class="msg warn">⚠️ ${esc(m)}</div>`).join('')
    : '';
}

async function saveSettings(): Promise<void> {
  if (!SETTINGS) return;
  const settings: Record<string, string> = {};
  for (const k of Object.keys(SETTINGS.ranges)) settings[k] = ($(`st-${k}`) as HTMLInputElement).value.trim();
  const env = await call('/api/admin/settings', 'PUT', { settings });
  // ⚠️ 범위 밖이면 서버가 저장하지 않고 무엇이 틀렸는지 알려준다. 그 문장을 표 아래에 남긴다 —
  //    토스트만 띄우면 3.5초 뒤에 사라져서 고칠 때는 이미 안 보인다
  if (!isOk(env) && env.error === 'BAD_REQUEST') {
    $('s-warn').innerHTML = `<div class="msg stop">⛔ ${esc(env.message || '저장하지 못했어요')}</div>`;
    toast('저장하지 못했어요');
    return;
  }
  const d = unwrap(env);
  if (!d) return;
  toast('설정을 저장했습니다');
  paintSettings(d as unknown as SettingsData);
  await refreshSummary();
}

// ────────────────────────────────────────────────────────────
// 붙이기
// ────────────────────────────────────────────────────────────

function tab(k: 'q' | 'a' | 's'): void {
  for (const x of ['q', 'a', 's'] as const) {
    $('tab-' + x).className = x === k ? 'on' : '';
    $('pane-' + x).classList.toggle('hidden', x !== k);
  }
}

($('btn-login') as HTMLButtonElement).onclick = () => { void login(($('pw') as HTMLInputElement).value); };
($('pw') as HTMLInputElement).onkeydown = (e) => {
  if (e.key === 'Enter') void login(($('pw') as HTMLInputElement).value);
};
($('btn-logout') as HTMLButtonElement).onclick = () => logout();

for (const k of ['q', 'a', 's'] as const) {
  ($('tab-' + k) as HTMLButtonElement).onclick = () => tab(k);
}

($('q-set') as HTMLSelectElement).onchange = () => { closeForm(); closeImport(); void loadQuestions(); };
($('btn-new') as HTMLButtonElement).onclick = () => openForm(null);
($('btn-cancel') as HTMLButtonElement).onclick = () => closeForm();
($('btn-save') as HTMLButtonElement).onclick = () => { void saveQuestion(); };
($('btn-del') as HTMLButtonElement).onclick = () => deleteQuestion();
($('btn-save-animals') as HTMLButtonElement).onclick = () => { void saveAnimals(); };
($('btn-save-settings') as HTMLButtonElement).onclick = () => { void saveSettings(); };

// ── 세트 ──
($('btn-rename') as HTMLButtonElement).onclick = () => openRename();
($('btn-rename-ok') as HTMLButtonElement).onclick = () => { void renameSet(); };
($('btn-rename-cancel') as HTMLButtonElement).onclick = () => closeRename();
($('f-setname') as HTMLInputElement).onkeydown = (e) => { if (e.key === 'Enter') void renameSet(); };
($('btn-delset') as HTMLButtonElement).onclick = () => deleteSet();

// ── 가져오기·내보내기 ──
($('btn-export') as HTMLButtonElement).onclick = () => { void exportJson(); };
($('btn-import') as HTMLButtonElement).onclick = () => ($('f-file') as HTMLInputElement).click();
($('f-file') as HTMLInputElement).onchange = (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) void pickedFile(f);
};
($('btn-imp-append') as HTMLButtonElement).onclick = () => { void applyImport('append'); };
($('btn-imp-set') as HTMLButtonElement).onclick = () => { void applyImport('replaceSet'); };
($('btn-imp-cancel') as HTMLButtonElement).onclick = () => closeImport();
($('btn-imp-all') as HTMLButtonElement).onclick = () => {
  if (!pending) return;
  // ⚠️ 문제은행 **전체**를 지우는 유일한 버튼이다. 확인 대화 없이 두면 안 된다
  const total = SUMMARY?.sets.reduce((n, s) => n + s.total, 0) ?? 0;
  confirmBox(
    `문제은행을 통째로 바꿀까요?\n\n지금 있는 ${total}문항이 모두 사라지고, ` +
    `이 파일의 ${pending.summary.total}문항만 남습니다.\n되돌릴 수 없습니다.\n\n` +
    '먼저 ‘📤 JSON 내보내기’ 로 지금 것을 받아 두세요.',
    () => { void applyImport('replaceAll'); }
  );
};

// 목록은 줄이 매번 다시 그려지므로 위임으로 받는다 (줄마다 핸들러를 달면 갈아 끼울 때 샌다)
$('q-list').addEventListener('click', (e) => {
  const tr = (e.target as HTMLElement).closest('tr');
  const id = tr?.getAttribute('data-id');
  if (!id) return;
  const q = QUESTIONS.find((x) => x.id === Number(id));
  if (q) openForm(q);
});

$('f-set').addEventListener('change', () => {
  const sel = $('f-set') as HTMLSelectElement;
  const box = $('f-newset') as HTMLInputElement;
  box.classList.toggle('hidden', sel.value !== '__new__');
  if (sel.value === '__new__') box.focus();
});

// 버전은 재배포 누락을 잡는 표시다 (apps-script 의 DEPLOY_VERSION 자리)
api('/api/version').then((env) => {
  if (isOk(env)) $('ver').textContent = String((env.data as { v: string }).v);
}).catch(() => { /* 버전을 못 읽어도 화면은 돈다 */ });

// 같은 탭에서 방금 넣은 비밀번호가 있으면 바로 들어간다.
// ⚠️ 여기서도 서버에 물어본다 — 저장된 값이 맞는다고 가정하지 않는다 (비밀번호는 바뀔 수 있다)
{
  const saved = pwStore();
  if (saved) void login(saved);
}
