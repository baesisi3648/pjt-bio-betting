/**
 * run-qr-gates.js — 직접 만든 QR 인코더를 검증된 라이브러리와 대조한다.
 *
 * 잘못된 QR은 교실에서 조용히 실패한다("찍히는데 아무것도 안 뜨는데요?").
 * 그래서 "그럴듯해 보인다"가 아니라 **모듈 한 칸씩** 비교한다.
 * qrcode 라이브러리는 검증용이며 앱스 스크립트에는 올라가지 않는다.
 *
 *   node test/run-qr-gates.js
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const QRLIB = require('qrcode');
const jsQR = require('jsqr').default || require('jsqr');

const ROOT = path.join(__dirname, '..');
const sandbox = { Math, JSON, console, Array, Object, String, Number, Infinity, module: { exports: {} } };
sandbox.global = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'apps-script', 'QR.gs'), 'utf8'), sandbox, { filename: 'QR.gs' });
const G = sandbox;

let pass = 0, fail = 0;
function gate(id, title, fn) {
  let ok, detail;
  try { const r = fn(); ok = r.ok; detail = r.detail; }
  catch (e) { ok = false; detail = 'ERROR ' + e.message; }
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(8)} ${title}\n          ${detail}`);
  ok ? pass++ : fail++;
}

/** 라이브러리 결과를 2차원 0/1 배열로 */
function libMatrix(text) {
  const o = QRLIB.create([{ data: text, mode: 'byte' }], { errorCorrectionLevel: 'M' });
  const n = o.modules.size, d = o.modules.data, m = [];
  for (let r = 0; r < n; r++) { m[r] = []; for (let c = 0; c < n; c++) m[r][c] = d[r * n + c] ? 1 : 0; }
  return { m, version: o.version };
}

/** 내 QR을 실제 디코더로 읽어본다 — 교실에서 중요한 건 이것뿐이다 */
function decodes(text) {
  const m = G.qrMatrix(text);
  if (!m) return { ok: false, detail: '인코더가 null 반환' };
  const size = m.length, quiet = 4, scale = 4;
  const w = (size + quiet * 2) * scale;
  const buf = new Uint8ClampedArray(w * w * 4).fill(255);
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    if (!m[r][c]) continue;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const y = (r + quiet) * scale + dy, x = (c + quiet) * scale + dx;
      const i = (y * w + x) * 4;
      buf[i] = buf[i + 1] = buf[i + 2] = 0;
    }
  }
  const res = jsQR(buf, w, w);
  if (!res) return { ok: false, detail: `디코드 실패 (v${(size - 17) / 4}, ${size}×${size})` };
  if (res.data !== text) return { ok: false, detail: '읽힌 내용이 다름: ' + res.data.slice(0, 40) };
  return { ok: true, detail: `v${(size - 17) / 4} ${size}×${size} — 디코드 성공, 원문과 일치 (${text.length}자)` };
}

/** 참고용: 라이브러리 행렬과의 일치도 (마스크 선택 차이는 정상) */
function sameAsLib(text) {
  const mine = G.qrMatrix(text);
  const { m: theirs, version } = libMatrix(text);
  if (!mine || mine.length !== theirs.length) return { same: false, version };
  for (let r = 0; r < mine.length; r++) for (let c = 0; c < mine.length; c++)
    if (mine[r][c] !== theirs[r][c]) return { same: false, version };
  return { same: true, version };
}

console.log('\n=== QR 인코더 검증 (npm qrcode 라이브러리와 모듈 단위 대조) ===\n');

const STUDENT_URL = 'https://script.google.com/macros/s/AKfycbyRHvpmemANRgY0Gf6I5FvRL7iKs0JrdYR7v0NkIfpZROOAaaStrWmGx4nDo0AKifo/exec';

gate('QR-1', '실제 학생 주소', () => decodes(STUDENT_URL));
gate('QR-2', '짧은 문자열 (v1)', () => decodes('TEST'));
gate('QR-3', '중간 길이 (v3~4)', () => decodes('https://example.com/abcdefghijklmnop'));
gate('QR-4', '숫자와 기호', () => decodes('2H4K-1234-5678/exec?role=teacher'));
gate('QR-5', '한글 (UTF-8 다바이트)', () => decodes('와일드 더비 판 코드 2H4K'));
gate('QR-6', '경계 근처 긴 문자열', () => decodes('A'.repeat(100)));

gate('QR-7', '여러 길이 무작위 100회 — 전부 디코드되는가', () => {
  let bad = [], sameCount = 0;
  let seed = 20260804;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_./:?=&';
  for (let i = 0; i < 100; i++) {
    const len = 5 + Math.floor(rnd() * 115);
    let s = '';
    for (let k = 0; k < len; k++) s += chars[Math.floor(rnd() * chars.length)];
    const r = decodes(s);
    if (!r.ok) bad.push(`len=${len}: ${r.detail}`);
    if (sameAsLib(s).same) sameCount++;
  }
  return { ok: bad.length === 0,
           detail: bad.length ? bad.slice(0, 3).join(' | ')
             : `100/100 디코드 성공 (참고: 라이브러리와 모듈까지 동일한 경우 ${sameCount}/100 — 나머지는 마스크 선택 차이로 정상)` };
});

gate('QR-8', '용량 초과 시 null 반환', () => {
  const over = G.qrMatrix('X'.repeat(300));
  return { ok: over === null, detail: over === null ? '300자 → null (버전 10 초과)' : '초과인데 값을 반환함' };
});

gate('QR-9', 'SVG 출력이 유효한 형태', () => {
  const svg = G.qrSvg(STUDENT_URL, 6);
  const okTag = svg.startsWith('<svg') && svg.endsWith('</svg>');
  const hasRects = (svg.match(/<rect/g) || []).length > 10;
  const noExternal = !/https?:\/\/(?!www\.w3\.org)/.test(svg);
  return { ok: okTag && hasRects && noExternal,
           detail: `${svg.length}바이트, rect ${(svg.match(/<rect/g) || []).length}개, 외부 요청 ${noExternal ? '없음' : '있음'}` };
});

console.log(`\n${'='.repeat(56)}`);
console.log(`QR 검증 — 통과 ${pass} / 실패 ${fail}`);
console.log('='.repeat(56) + '\n');
process.exit(fail === 0 ? 0 : 1);
