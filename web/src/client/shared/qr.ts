/**
 * qr.ts — QR 코드 생성. **외부 라이브러리를 쓰지 않는다.**
 *
 * apps-script/QR.gs 를 그대로 옮겼다. npm 의 `qrcode` 를 쓰지 않은 이유:
 *
 *   1. 그 패키지는 Node 용(pngjs·yargs·dijkstrajs)이라 브라우저 번들에 넣으면
 *      쓰지도 않는 것이 딸려 온다. 학교 폰으로 받는 파일이다.
 *   2. **이 구현은 이미 검증돼 있다.** apps-script 쪽 게이트 QR-1~QR-9 가 npm `qrcode` 와
 *      모듈을 한 칸씩 대조한다. 잘못된 QR 은 교실에서 조용히 실패하므로
 *      "그럴듯해 보인다"로 넘기면 안 된다.
 *   3. 여기 옮긴 사본이 원본과 갈라지지 않도록 `test/qr.ts` 가 같은 대조를 다시 한다.
 *      (뷰를 두 벌 만들었다가 정답이 샌 일이 있었다 — MIGRATION §5)
 *
 * 바이트 모드 · 오류정정 레벨 M · 버전 1~10.
 */

// ── GF(256) 산술 ─────────────────────────────────────────
const QR_EXP: number[] = new Array(512);
const QR_LOG: number[] = new Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    QR_EXP[i] = x; QR_LOG[x] = i;
    x <<= 1; if (x & 0x100) x ^= 0x11D;
  }
  for (let j = 255; j < 512; j++) QR_EXP[j] = QR_EXP[j - 255]!;
})();

function gfMul(a: number, b: number): number {
  return (a === 0 || b === 0) ? 0 : QR_EXP[QR_LOG[a]! + QR_LOG[b]!]!;
}

function rsGenPoly(n: number): number[] {
  let poly = [1];
  for (let i = 0; i < n; i++) {
    const next: number[] = [];
    for (let k = 0; k <= poly.length; k++) next[k] = 0;
    for (let j = 0; j < poly.length; j++) {
      next[j] = next[j]! ^ poly[j]!;
      next[j + 1] = next[j + 1]! ^ gfMul(poly[j]!, QR_EXP[i]!);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: number[], n: number): number[] {
  const gen = rsGenPoly(n), res = data.slice();
  for (let p = 0; p < n; p++) res.push(0);
  for (let i = 0; i < data.length; i++) {
    const coef = res[i]!;
    if (coef !== 0) for (let j = 0; j < gen.length; j++) res[i + j] = res[i + j]! ^ gfMul(gen[j]!, coef);
  }
  return res.slice(data.length);
}

// ── 버전 표 (오류정정 레벨 M) ─────────────────────────────
// [버전]: { ec: 블록당 EC 코드워드, groups: [[블록수, 블록당 데이터 코드워드], ...] }
interface VersionSpec { ec: number; groups: [number, number][] }

const QR_VERSIONS: Record<number, VersionSpec> = {
  1:  { ec: 10, groups: [[1, 16]] },
  2:  { ec: 16, groups: [[1, 28]] },
  3:  { ec: 26, groups: [[1, 44]] },
  4:  { ec: 18, groups: [[2, 32]] },
  5:  { ec: 24, groups: [[2, 43]] },
  6:  { ec: 16, groups: [[4, 27]] },
  7:  { ec: 18, groups: [[4, 31]] },
  8:  { ec: 22, groups: [[2, 38], [2, 39]] },
  9:  { ec: 22, groups: [[3, 36], [2, 37]] },
  10: { ec: 26, groups: [[4, 43], [1, 44]] }
};

const QR_ALIGN: Record<number, number[]> = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
};

const QR_VERSION_INFO: Record<number, number> = { 7: 0x07C94, 8: 0x085BC, 9: 0x09A99, 10: 0x0A4D3 };

function qrDataCapacity(version: number): number {
  const v = QR_VERSIONS[version]!;
  let n = 0;
  v.groups.forEach((g) => { n += g[0] * g[1]; });
  return n;
}

/** 바이트 수에 맞는 최소 버전. 안 들어가면 null */
export function qrPickVersion(byteLen: number): number | null {
  for (let v = 1; v <= 10; v++) {
    const countBits = v < 10 ? 8 : 16;
    const need = Math.ceil((4 + countBits + byteLen * 8) / 8);
    if (need <= qrDataCapacity(v)) return v;
  }
  return null;
}

// ── 데이터 → 코드워드 ─────────────────────────────────────
function qrToBytes(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) { out.push(0xC0 | (c >> 6), 0x80 | (c & 63)); }
    else { out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
  }
  return out;
}

function qrBuildCodewords(bytes: number[], version: number): number[] {
  const bits: number[] = [];
  const push = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };

  push(4, 4);                                   // 바이트 모드
  push(bytes.length, version < 10 ? 8 : 16);    // 문자 수
  bytes.forEach((b) => push(b, 8));

  const cap = qrDataCapacity(version) * 8;
  for (let t = 0; t < 4 && bits.length < cap; t++) bits.push(0);   // 종료자
  while (bits.length % 8 !== 0) bits.push(0);

  const words: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]!;
    words.push(v);
  }
  const pads = [0xEC, 0x11];
  let p = 0;
  while (words.length < qrDataCapacity(version)) words.push(pads[p++ % 2]!);
  return words;
}

/** 블록으로 나누고 EC를 붙여 교차 배치한다 */
function qrInterleave(words: number[], version: number): number[] {
  const spec = QR_VERSIONS[version]!;
  const dataBlocks: number[][] = [], ecBlocks: number[][] = [];
  let pos = 0;

  spec.groups.forEach((g) => {
    for (let b = 0; b < g[0]; b++) {
      const block = words.slice(pos, pos + g[1]);
      pos += g[1];
      dataBlocks.push(block);
      ecBlocks.push(rsEncode(block, spec.ec));
    }
  });

  const out: number[] = [];
  let maxData = 0;
  dataBlocks.forEach((b) => { if (b.length > maxData) maxData = b.length; });
  for (let i = 0; i < maxData; i++)
    for (let k = 0; k < dataBlocks.length; k++)
      if (i < dataBlocks[k]!.length) out.push(dataBlocks[k]![i]!);
  for (let j = 0; j < spec.ec; j++)
    for (let m = 0; m < ecBlocks.length; m++) out.push(ecBlocks[m]![j]!);

  return out;
}

// ── 모듈 배치 ─────────────────────────────────────────────
type Grid = (number | null)[][];

function qrEmptyGrid(size: number): Grid {
  const g: Grid = [];
  for (let r = 0; r < size; r++) { g[r] = []; for (let c = 0; c < size; c++) g[r]![c] = null; }
  return g;
}

function qrPlaceFunctionPatterns(g: Grid, version: number): void {
  const size = g.length;

  const finder = (r0: number, c0: number) => {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const r1 = r0 + r, c1 = c0 + c;
      if (r1 < 0 || c1 < 0 || r1 >= size || c1 >= size) continue;
      const on = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                 (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                 (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      g[r1]![c1] = on ? 1 : 0;
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) {          // 타이밍 패턴
    g[6]![i] = (i % 2 === 0) ? 1 : 0;
    g[i]![6] = (i % 2 === 0) ? 1 : 0;
  }

  const pos = QR_ALIGN[version]!;                // 정렬 패턴
  for (let a = 0; a < pos.length; a++) for (let b = 0; b < pos.length; b++) {
    const pr = pos[a]!, pc = pos[b]!;
    if ((pr <= 8 && pc <= 8) || (pr <= 8 && pc >= size - 9) || (pr >= size - 9 && pc <= 8)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++)
      g[pr + dr]![pc + dc] = (Math.max(Math.abs(dr), Math.abs(dc)) !== 1) ? 1 : 0;
  }

  g[size - 8]![8] = 1;                           // 항상 검은 모듈

  for (let k = 0; k <= 8; k++) {                 // 형식 정보 자리 확보
    if (g[8]![k] === null) g[8]![k] = 0;
    if (g[k]![8] === null) g[k]![8] = 0;
  }
  for (let m = 0; m < 8; m++) {
    if (g[8]![size - 1 - m] === null) g[8]![size - 1 - m] = 0;
    if (g[size - 1 - m]![8] === null) g[size - 1 - m]![8] = 0;
  }

  if (version >= 7) {                            // 버전 정보 자리 확보
    for (let r2 = 0; r2 < 6; r2++) for (let c2 = 0; c2 < 3; c2++) {
      g[r2]![size - 11 + c2] = 0;
      g[size - 11 + c2]![r2] = 0;
    }
  }
}

function qrIsFunction(version: number, size: number, r: number, c: number): boolean {
  if (r === 6 || c === 6) return true;                                  // 타이밍
  if (r < 9 && c < 9) return true;                                      // 좌상 파인더+형식
  if (r < 9 && c >= size - 8) return true;                              // 우상
  if (r >= size - 8 && c < 9) return true;                              // 좌하
  if (version >= 7 && ((r < 6 && c >= size - 11) || (c < 6 && r >= size - 11))) return true;

  const pos = QR_ALIGN[version]!;
  for (let a = 0; a < pos.length; a++) for (let b = 0; b < pos.length; b++) {
    const pr = pos[a]!, pc = pos[b]!;
    if ((pr <= 8 && pc <= 8) || (pr <= 8 && pc >= size - 9) || (pr >= size - 9 && pc <= 8)) continue;
    if (Math.abs(r - pr) <= 2 && Math.abs(c - pc) <= 2) return true;
  }
  return false;
}

function qrPlaceData(g: Grid, codewords: number[], version: number): void {
  const size = g.length;
  let bitIdx = 0, up = true;
  const bitAt = (i: number) => {
    const byteI = i >> 3;
    return byteI < codewords.length ? (codewords[byteI]! >> (7 - (i & 7))) & 1 : 0;
  };
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;                       // 세로 타이밍 열 건너뛰기
    for (let v = 0; v < size; v++) {
      const r = up ? size - 1 - v : v;
      for (let k = 0; k < 2; k++) {
        const c = right - k;
        if (qrIsFunction(version, size, r, c)) continue;
        g[r]![c] = bitAt(bitIdx++);
      }
    }
    up = !up;
  }
}

const QR_MASKS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => ((((r * c) % 2) + ((r * c) % 3)) % 2) === 0,
  (r, c) => ((((r + c) % 2) + ((r * c) % 3)) % 2) === 0
];

function qrFormatBits(mask: number): number {
  const d = (0 << 3) | mask;            // 레벨 M = 00
  let v = d << 10;
  for (let i = 14; i >= 10; i--) if ((v >> i) & 1) v ^= 0x537 << (i - 10);
  return ((d << 10) | v) ^ 0x5412;
}

function qrPlaceFormat(g: Grid, mask: number): void {
  const size = g.length, bits = qrFormatBits(mask);
  for (let i = 0; i < 15; i++) {
    const b = (bits >> (14 - i)) & 1;   // MSB부터 배치한다 (LSB부터 넣으면 스캐너가 못 읽는다)
    if (i < 6) g[8]![i] = b;
    else if (i === 6) g[8]![7] = b;
    else if (i === 7) g[8]![8] = b;
    else if (i === 8) g[7]![8] = b;
    else g[14 - i]![8] = b;

    if (i < 7) g[size - 1 - i]![8] = b;   // 열 8에는 7비트만 (size-8 은 항상 검은 모듈)
    else g[8]![size - 15 + i] = b;
  }
  g[size - 8]![8] = 1;
}

function qrPlaceVersion(g: Grid, version: number): void {
  if (version < 7) return;
  const size = g.length, bits = QR_VERSION_INFO[version]!;
  for (let i = 0; i < 18; i++) {
    const b = (bits >> i) & 1;
    const r = Math.floor(i / 3), c = i % 3;
    g[r]![size - 11 + c] = b;
    g[size - 11 + c]![r] = b;
  }
}

function qrPenalty(g: Grid): number {
  const size = g.length;
  let score = 0, r: number, c: number, i: number;

  for (r = 0; r < size; r++) {                       // 규칙 1 — 같은 색 연속
    let run = 1;
    for (c = 1; c < size; c++) {
      if (g[r]![c] === g[r]![c - 1]) { run++; }
      else { if (run >= 5) score += 3 + (run - 5); run = 1; }
    }
    if (run >= 5) score += 3 + (run - 5);
  }
  for (c = 0; c < size; c++) {
    let run2 = 1;
    for (r = 1; r < size; r++) {
      if (g[r]![c] === g[r - 1]![c]) { run2++; }
      else { if (run2 >= 5) score += 3 + (run2 - 5); run2 = 1; }
    }
    if (run2 >= 5) score += 3 + (run2 - 5);
  }

  for (r = 0; r < size - 1; r++) for (c = 0; c < size - 1; c++) {   // 규칙 2 — 2×2 덩어리
    const v = g[r]![c];
    if (v === g[r]![c + 1] && v === g[r + 1]![c] && v === g[r + 1]![c + 1]) score += 3;
  }

  const pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];    // 규칙 3 — 파인더 닮은꼴
  const pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const matches = (arr: (number | null)[], pat: number[]) => {
    for (let k = 0; k < pat.length; k++) if (arr[k] !== pat[k]) return false;
    return true;
  };
  for (r = 0; r < size; r++) for (c = 0; c <= size - 11; c++) {
    const row = g[r]!.slice(c, c + 11);
    if (matches(row, pat1) || matches(row, pat2)) score += 40;
  }
  for (c = 0; c < size; c++) for (r = 0; r <= size - 11; r++) {
    const col: (number | null)[] = [];
    for (i = 0; i < 11; i++) col.push(g[r + i]![c]!);
    if (matches(col, pat1) || matches(col, pat2)) score += 40;
  }

  let dark = 0;                                      // 규칙 4 — 흑백 비율
  for (r = 0; r < size; r++) for (c = 0; c < size; c++) if (g[r]![c]) dark++;
  const pct = dark * 100 / (size * size);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;

  return score;
}

/** 문자열 → QR 모듈 배열 (0/1). 실패하면 null */
export function qrMatrix(text: string): number[][] | null {
  const bytes = qrToBytes(text);
  const version = qrPickVersion(bytes.length);
  if (!version) return null;

  const words = qrInterleave(qrBuildCodewords(bytes, version), version);
  const size = version * 4 + 17;

  let best: Grid | null = null, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const g = qrEmptyGrid(size);
    qrPlaceFunctionPatterns(g, version);
    qrPlaceVersion(g, version);

    const fn: boolean[][] = [];
    for (let r = 0; r < size; r++) {
      fn[r] = [];
      for (let c = 0; c < size; c++) fn[r]![c] = qrIsFunction(version, size, r, c);
    }

    qrPlaceData(g, words, version);
    for (let r2 = 0; r2 < size; r2++) for (let c2 = 0; c2 < size; c2++)
      if (!fn[r2]![c2] && QR_MASKS[mask]!(r2, c2)) g[r2]![c2] = (g[r2]![c2] as number) ^ 1;

    qrPlaceFormat(g, mask);

    const s = qrPenalty(g);
    if (s < bestScore) { bestScore = s; best = g; }
  }
  return best as number[][] | null;
}

/**
 * 문자열 → SVG. 화면에 그대로 넣으면 된다.
 * ⚠️ 벡터로 만드는 이유: 배포 안내를 **인쇄**하기 때문이다. 비트맵이면 종이에서 뭉개진다.
 */
export function qrSvg(text: string, pixel?: number): string {
  const m = qrMatrix(text);
  if (!m) return '';
  const quiet = 4, size = m.length, total = size + quiet * 2;
  const px = pixel || 6;

  const rects: string[] = [];
  for (let r = 0; r < size; r++) {
    let c = 0;
    while (c < size) {
      if (m[r]![c]) {
        const start = c;
        while (c < size && m[r]![c]) c++;
        rects.push(`<rect x="${start + quiet}" y="${r + quiet}" width="${c - start}" height="1"/>`);
      } else c++;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}"` +
         ` width="${total * px}" height="${total * px}" shape-rendering="crispEdges">` +
         `<rect width="${total}" height="${total}" fill="#fff"/>` +
         `<g fill="#000">${rects.join('')}</g></svg>`;
}
