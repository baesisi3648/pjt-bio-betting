/**
 * qr.ts — 화면이 그리는 QR 이 **실제로 읽히는지** 확인한다.
 *
 * `src/client/shared/qr.ts` 는 `apps-script/QR.gs` 를 옮긴 **사본**이다.
 * 사본은 갈라진다 — 뷰를 두 벌 만들었다가 정답이 새던 것과 같은 함정이다 (MIGRATION §5).
 * 그래서 앱스 스크립트 쪽 `test/run-qr-gates.js` 가 하던 검사를 여기서 다시 한다.
 *
 * ⚠️ 판정 기준은 **디코더가 읽어서 원문이 나오는가**다. 라이브러리 행렬과 한 칸까지
 *    같은지는 참고일 뿐이다 — 마스크는 벌점이 같을 때 어느 쪽을 골라도 유효한 QR 이라,
 *    구현마다 다르게 고를 수 있다. 거기에 게이트를 걸면 진짜가 아닌 것을 지키게 된다.
 *
 * ⚠️ "그럴듯해 보인다"로 넘기면 안 된다. 잘못된 QR 은 교실에서 조용히 실패한다 —
 *    선생님은 폰 카메라가 안 읽히는 이유를 알 방법이 없다.
 *
 * qrcode·jsqr 는 검사용 devDependency 다. **번들에는 들어가지 않는다** (§11-1 외부 자원 금지).
 *
 *   node test/qr.ts
 */

import { qrMatrix, qrPickVersion, qrSvg } from '../src/client/shared/qr.ts';

interface QrLib {
  create(segs: { data: string; mode: string }[], opts: { errorCorrectionLevel: string }):
    { version: number; modules: { size: number; data: Uint8Array | number[] } };
}
type JsQr = (data: Uint8ClampedArray, w: number, h: number) => { data: string } | null;

// TS 가 이 패키지들의 타입을 모른다(알 필요도 없다 — 검사용이다).
// 지정자를 변수에 담으면 타입 검사는 통과하고 실행은 그대로 된다
const load = async <T>(spec: string): Promise<T> => {
  const m = await import(spec) as unknown as { default?: T };
  return (m.default ?? m) as T;
};
const QRCode = await load<QrLib>('qrcode');
const jsQR = await load<JsQr>('jsqr');

let pass = 0, fail = 0;

function gate(id: string, title: string, fn: () => { ok: boolean; detail: string }) {
  let ok = false, detail = '';
  try { const r = fn(); ok = r.ok; detail = r.detail; }
  catch (e) { ok = false; detail = 'ERROR ' + (e as Error).message; }
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(7)} ${title}\n          ${detail}`);
}

/** 내 QR 을 진짜 디코더로 읽어본다 — 교실에서 중요한 건 이것뿐이다 */
function decodes(text: string): { ok: boolean; detail: string } {
  const m = qrMatrix(text);
  if (!m) return { ok: false, detail: '인코더가 null 반환' };
  const size = m.length, quiet = 4, scale = 4;
  const w = (size + quiet * 2) * scale;
  const buf = new Uint8ClampedArray(w * w * 4).fill(255);
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    if (!m[r]![c]) continue;
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

/** 참고용: 라이브러리 행렬과 크기·버전이 맞는가 (마스크 선택 차이는 정상) */
function sameSizeAsLib(text: string): { ok: boolean; detail: string } {
  const mine = qrMatrix(text);
  const ref = QRCode.create([{ data: text, mode: 'byte' }], { errorCorrectionLevel: 'M' });
  if (!mine) return { ok: false, detail: '인코더가 null 반환' };
  let diff = 0;
  const n = ref.modules.size, d = ref.modules.data as number[];
  if (mine.length === n) {
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if ((mine[r]![c] ? 1 : 0) !== (d[r * n + c] ? 1 : 0)) diff++;
    }
  }
  return {
    ok: mine.length === n,
    detail: `버전 v${ref.version} ${n}×${n} 일치 — 다른 칸 ${diff}개 (마스크 선택 차이는 정상)`
  };
}

console.log('\n=== QR 게이트 (src/client/shared/qr.ts) ===\n');

// 실제로 QR 에 들어갈 만한 주소들
const STUDENT_URL = 'https://wilde-derby.example.workers.dev/';

gate('QR-1', '실제 학생 주소', () => decodes(STUDENT_URL));
gate('QR-2', '로컬 개발 주소', () => decodes('http://localhost:8787/'));
gate('QR-3', '짧은 문자열 (v1)', () => decodes('TEST'));
gate('QR-4', '숫자와 기호', () => decodes('2H4K-1234-5678/?role=teacher'));
gate('QR-5', '한글 (UTF-8 다바이트)', () => decodes('와일드 더비 판 코드 2H4K'));
gate('QR-6', '경계 근처 긴 문자열', () => decodes('A'.repeat(100)));

gate('QR-7', '여러 길이 무작위 100회 — 전부 디코드되는가', () => {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_/:.?=&';
  let bad = 0;
  for (let i = 0; i < 100; i++) {
    const len = 4 + Math.floor(Math.random() * 90);
    let s = '';
    for (let k = 0; k < len; k++) s += abc[Math.floor(Math.random() * abc.length)];
    if (!decodes(s).ok) bad++;
  }
  return { ok: bad === 0, detail: `100회 중 실패 ${bad}회` };
});

gate('QR-8', '라이브러리와 같은 버전·크기를 고른다', () => sameSizeAsLib(STUDENT_URL));

gate('QR-9', '길이에 따라 버전이 올라가고, 못 담으면 null', () => {
  const v1 = qrPickVersion(10), v10 = qrPickVersion(200), over = qrPickVersion(100000);
  return {
    ok: v1 === 1 && v10 !== null && v10 > 1 && over === null,
    detail: `10바이트→v${v1}, 200바이트→v${v10}, 10만바이트→${over}`
  };
});

gate('QR-10', 'SVG 에 외부 자원이 없다', () => {
  const svg = qrSvg(STUDENT_URL, 6);
  // ⚠️ 학교망에서 막히면 QR 이 통째로 안 보인다. 이미지·글꼴·CDN 참조가 있으면 안 된다
  //    (xmlns 의 w3.org 는 이름공간 식별자라 네트워크를 타지 않는다)
  const bad = /https?:\/\/(?!www\.w3\.org)/.test(svg) || /<image|url\(|@font-face/.test(svg);
  return { ok: !bad && svg.startsWith('<svg'), detail: `${svg.length}자, 외부 참조 ${bad ? '있음' : '없음'}` };
});

console.log('\n====================================================');
console.log(`QR 게이트 — 통과 ${pass} / 실패 ${fail}`);
console.log('====================================================\n');
if (fail) process.exit(1);
