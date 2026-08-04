/**
 * QR.gs — QR 코드 생성 (외부 라이브러리 없음)
 *
 * 학교망에서 CDN이 막히면 수업이 멈추므로 직접 만든다.
 * 바이트 모드 · 오류정정 레벨 M · 버전 1~10 지원.
 *
 * 정확성 검증: test/run-qr-gates.js 가 npm qrcode 라이브러리와
 * 모듈을 한 칸씩 대조한다. 잘못된 QR은 교실에서 조용히 실패하므로
 * "그럴듯해 보인다"로 넘기지 않는다.
 */

// ── GF(256) 산술 ─────────────────────────────────────────
var QR_EXP = new Array(512), QR_LOG = new Array(256);
(function () {
  var x = 1;
  for (var i = 0; i < 255; i++) {
    QR_EXP[i] = x; QR_LOG[x] = i;
    x <<= 1; if (x & 0x100) x ^= 0x11D;
  }
  for (var j = 255; j < 512; j++) QR_EXP[j] = QR_EXP[j - 255];
})();

function gfMul(a, b) { return (a === 0 || b === 0) ? 0 : QR_EXP[QR_LOG[a] + QR_LOG[b]]; }

function rsGenPoly(n) {
  var poly = [1];
  for (var i = 0; i < n; i++) {
    var next = [];
    for (var k = 0; k <= poly.length; k++) next[k] = 0;
    for (var j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], QR_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, n) {
  var gen = rsGenPoly(n), res = data.slice();
  for (var p = 0; p < n; p++) res.push(0);
  for (var i = 0; i < data.length; i++) {
    var coef = res[i];
    if (coef !== 0) for (var j = 0; j < gen.length; j++) res[i + j] ^= gfMul(gen[j], coef);
  }
  return res.slice(data.length);
}

// ── 버전 표 (오류정정 레벨 M) ─────────────────────────────
// [버전]: { ec: 블록당 EC 코드워드, groups: [[블록수, 블록당 데이터 코드워드], ...] }
var QR_VERSIONS = {
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

var QR_ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
};

var QR_VERSION_INFO = { 7: 0x07C94, 8: 0x085BC, 9: 0x09A99, 10: 0x0A4D3 };

function qrDataCapacity(version) {
  var v = QR_VERSIONS[version], n = 0;
  v.groups.forEach(function (g) { n += g[0] * g[1]; });
  return n;
}

/** 바이트 수에 맞는 최소 버전. 안 들어가면 null */
function qrPickVersion(byteLen) {
  for (var v = 1; v <= 10; v++) {
    var countBits = v < 10 ? 8 : 16;
    var need = Math.ceil((4 + countBits + byteLen * 8) / 8);
    if (need <= qrDataCapacity(v)) return v;
  }
  return null;
}

// ── 데이터 → 코드워드 ─────────────────────────────────────
function qrToBytes(text) {
  var out = [];
  for (var i = 0; i < text.length; i++) {
    var c = text.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) { out.push(0xC0 | (c >> 6), 0x80 | (c & 63)); }
    else { out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
  }
  return out;
}

function qrBuildCodewords(bytes, version) {
  var bits = [];
  function push(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); }

  push(4, 4);                                   // 바이트 모드
  push(bytes.length, version < 10 ? 8 : 16);    // 문자 수
  bytes.forEach(function (b) { push(b, 8); });

  var cap = qrDataCapacity(version) * 8;
  for (var t = 0; t < 4 && bits.length < cap; t++) bits.push(0);   // 종료자
  while (bits.length % 8 !== 0) bits.push(0);

  var words = [];
  for (var i = 0; i < bits.length; i += 8) {
    var v = 0;
    for (var j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    words.push(v);
  }
  var pads = [0xEC, 0x11], p = 0;
  while (words.length < qrDataCapacity(version)) words.push(pads[p++ % 2]);
  return words;
}

/** 블록으로 나누고 EC를 붙여 교차 배치한다 */
function qrInterleave(words, version) {
  var spec = QR_VERSIONS[version];
  var dataBlocks = [], ecBlocks = [], pos = 0;

  spec.groups.forEach(function (g) {
    for (var b = 0; b < g[0]; b++) {
      var block = words.slice(pos, pos + g[1]);
      pos += g[1];
      dataBlocks.push(block);
      ecBlocks.push(rsEncode(block, spec.ec));
    }
  });

  var out = [], maxData = 0;
  dataBlocks.forEach(function (b) { if (b.length > maxData) maxData = b.length; });
  for (var i = 0; i < maxData; i++)
    for (var k = 0; k < dataBlocks.length; k++)
      if (i < dataBlocks[k].length) out.push(dataBlocks[k][i]);
  for (var j = 0; j < spec.ec; j++)
    for (var m = 0; m < ecBlocks.length; m++) out.push(ecBlocks[m][j]);

  return out;
}

// ── 모듈 배치 ─────────────────────────────────────────────
function qrEmptyGrid(size) {
  var g = [];
  for (var r = 0; r < size; r++) { g[r] = []; for (var c = 0; c < size; c++) g[r][c] = null; }
  return g;
}

function qrPlaceFunctionPatterns(g, version) {
  var size = g.length;

  function finder(r0, c0) {
    for (var r = -1; r <= 7; r++) for (var c = -1; c <= 7; c++) {
      var r1 = r0 + r, c1 = c0 + c;
      if (r1 < 0 || c1 < 0 || r1 >= size || c1 >= size) continue;
      var on = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
               (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
               (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      g[r1][c1] = on ? 1 : 0;
    }
  }
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

  for (var i = 8; i < size - 8; i++) {          // 타이밍 패턴
    g[6][i] = (i % 2 === 0) ? 1 : 0;
    g[i][6] = (i % 2 === 0) ? 1 : 0;
  }

  var pos = QR_ALIGN[version];                   // 정렬 패턴
  for (var a = 0; a < pos.length; a++) for (var b = 0; b < pos.length; b++) {
    var pr = pos[a], pc = pos[b];
    if ((pr <= 8 && pc <= 8) || (pr <= 8 && pc >= size - 9) || (pr >= size - 9 && pc <= 8)) continue;
    for (var dr = -2; dr <= 2; dr++) for (var dc = -2; dc <= 2; dc++)
      g[pr + dr][pc + dc] = (Math.max(Math.abs(dr), Math.abs(dc)) !== 1) ? 1 : 0;
  }

  g[size - 8][8] = 1;                            // 항상 검은 모듈

  for (var k = 0; k <= 8; k++) {                 // 형식 정보 자리 확보
    if (g[8][k] === null) g[8][k] = 0;
    if (g[k][8] === null) g[k][8] = 0;
  }
  for (var m = 0; m < 8; m++) {
    if (g[8][size - 1 - m] === null) g[8][size - 1 - m] = 0;
    if (g[size - 1 - m][8] === null) g[size - 1 - m][8] = 0;
  }

  if (version >= 7) {                            // 버전 정보 자리 확보
    for (var r2 = 0; r2 < 6; r2++) for (var c2 = 0; c2 < 3; c2++) {
      g[r2][size - 11 + c2] = 0;
      g[size - 11 + c2][r2] = 0;
    }
  }
}

function qrIsFunction(version, size, r, c) {
  if (r === 6 || c === 6) return true;                                  // 타이밍
  if (r < 9 && c < 9) return true;                                      // 좌상 파인더+형식
  if (r < 9 && c >= size - 8) return true;                              // 우상
  if (r >= size - 8 && c < 9) return true;                              // 좌하
  if (version >= 7 && ((r < 6 && c >= size - 11) || (c < 6 && r >= size - 11))) return true;

  var pos = QR_ALIGN[version];
  for (var a = 0; a < pos.length; a++) for (var b = 0; b < pos.length; b++) {
    var pr = pos[a], pc = pos[b];
    if ((pr <= 8 && pc <= 8) || (pr <= 8 && pc >= size - 9) || (pr >= size - 9 && pc <= 8)) continue;
    if (Math.abs(r - pr) <= 2 && Math.abs(c - pc) <= 2) return true;
  }
  return false;
}

function qrPlaceData(g, codewords, version) {
  var size = g.length, bitIdx = 0, up = true;
  function bitAt(i) {
    var byteI = i >> 3;
    return byteI < codewords.length ? (codewords[byteI] >> (7 - (i & 7))) & 1 : 0;
  }
  for (var right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;                       // 세로 타이밍 열 건너뛰기
    for (var v = 0; v < size; v++) {
      var r = up ? size - 1 - v : v;
      for (var k = 0; k < 2; k++) {
        var c = right - k;
        if (qrIsFunction(version, size, r, c)) continue;
        g[r][c] = bitAt(bitIdx++);
      }
    }
    up = !up;
  }
}

var QR_MASKS = [
  function (r, c) { return (r + c) % 2 === 0; },
  function (r, c) { return r % 2 === 0; },
  function (r, c) { return c % 3 === 0; },
  function (r, c) { return (r + c) % 3 === 0; },
  function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
  function (r, c) { return ((r * c) % 2) + ((r * c) % 3) === 0; },
  function (r, c) { return ((((r * c) % 2) + ((r * c) % 3)) % 2) === 0; },
  function (r, c) { return ((((r + c) % 2) + ((r * c) % 3)) % 2) === 0; }
];

function qrFormatBits(mask) {
  var d = (0 << 3) | mask;              // 레벨 M = 00
  var v = d << 10;
  for (var i = 14; i >= 10; i--) if ((v >> i) & 1) v ^= 0x537 << (i - 10);
  return ((d << 10) | v) ^ 0x5412;
}

function qrPlaceFormat(g, mask) {
  var size = g.length, bits = qrFormatBits(mask);
  for (var i = 0; i < 15; i++) {
    var b = (bits >> (14 - i)) & 1;   // MSB부터 배치한다 (LSB부터 넣으면 스캐너가 못 읽는다)
    if (i < 6) g[8][i] = b;
    else if (i === 6) g[8][7] = b;
    else if (i === 7) g[8][8] = b;
    else if (i === 8) g[7][8] = b;
    else g[14 - i][8] = b;

    if (i < 7) g[size - 1 - i][8] = b;   // 열 8에는 7비트만 (size-8 은 항상 검은 모듈)
    else g[8][size - 15 + i] = b;
  }
  g[size - 8][8] = 1;
}

function qrPlaceVersion(g, version) {
  if (version < 7) return;
  var size = g.length, bits = QR_VERSION_INFO[version];
  for (var i = 0; i < 18; i++) {
    var b = (bits >> i) & 1;
    var r = Math.floor(i / 3), c = i % 3;
    g[r][size - 11 + c] = b;
    g[size - 11 + c][r] = b;
  }
}

function qrPenalty(g) {
  var size = g.length, score = 0, r, c, i;

  for (r = 0; r < size; r++) {                       // 규칙 1 — 같은 색 연속
    var run = 1;
    for (c = 1; c < size; c++) {
      if (g[r][c] === g[r][c - 1]) { run++; }
      else { if (run >= 5) score += 3 + (run - 5); run = 1; }
    }
    if (run >= 5) score += 3 + (run - 5);
  }
  for (c = 0; c < size; c++) {
    var run2 = 1;
    for (r = 1; r < size; r++) {
      if (g[r][c] === g[r - 1][c]) { run2++; }
      else { if (run2 >= 5) score += 3 + (run2 - 5); run2 = 1; }
    }
    if (run2 >= 5) score += 3 + (run2 - 5);
  }

  for (r = 0; r < size - 1; r++) for (c = 0; c < size - 1; c++) {   // 규칙 2 — 2×2 덩어리
    var v = g[r][c];
    if (v === g[r][c + 1] && v === g[r + 1][c] && v === g[r + 1][c + 1]) score += 3;
  }

  var pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];      // 규칙 3 — 파인더 닮은꼴
  var pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  function matches(arr, pat) {
    for (var k = 0; k < pat.length; k++) if (arr[k] !== pat[k]) return false;
    return true;
  }
  for (r = 0; r < size; r++) for (c = 0; c <= size - 11; c++) {
    var row = g[r].slice(c, c + 11);
    if (matches(row, pat1) || matches(row, pat2)) score += 40;
  }
  for (c = 0; c < size; c++) for (r = 0; r <= size - 11; r++) {
    var col = [];
    for (i = 0; i < 11; i++) col.push(g[r + i][c]);
    if (matches(col, pat1) || matches(col, pat2)) score += 40;
  }

  var dark = 0;                                       // 규칙 4 — 흑백 비율
  for (r = 0; r < size; r++) for (c = 0; c < size; c++) if (g[r][c]) dark++;
  var pct = dark * 100 / (size * size);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;

  return score;
}

/**
 * 문자열 → QR 모듈 배열 (0/1). 실패하면 null.
 */
function qrMatrix(text) {
  var bytes = qrToBytes(text);
  var version = qrPickVersion(bytes.length);
  if (!version) return null;

  var words = qrInterleave(qrBuildCodewords(bytes, version), version);
  var size = version * 4 + 17;

  var best = null, bestScore = Infinity;
  for (var mask = 0; mask < 8; mask++) {
    var g = qrEmptyGrid(size);
    qrPlaceFunctionPatterns(g, version);
    qrPlaceVersion(g, version);

    var fn = [];
    for (var r = 0; r < size; r++) { fn[r] = []; for (var c = 0; c < size; c++) fn[r][c] = qrIsFunction(version, size, r, c); }

    qrPlaceData(g, words, version);
    for (var r2 = 0; r2 < size; r2++) for (var c2 = 0; c2 < size; c2++)
      if (!fn[r2][c2] && QR_MASKS[mask](r2, c2)) g[r2][c2] ^= 1;

    qrPlaceFormat(g, mask);

    var s = qrPenalty(g);
    if (s < bestScore) { bestScore = s; best = g; }
  }
  return best;
}

/**
 * 문자열 → SVG. 화면에 그대로 넣으면 된다.
 * 인쇄해도 깨지지 않게 벡터로 만든다.
 */
function qrSvg(text, pixel) {
  var m = qrMatrix(text);
  if (!m) return '';
  var quiet = 4, size = m.length, total = size + quiet * 2;
  var px = pixel || 6;

  var rects = [];
  for (var r = 0; r < size; r++) {
    var c = 0;
    while (c < size) {
      if (m[r][c]) {
        var start = c;
        while (c < size && m[r][c]) c++;
        rects.push('<rect x="' + (start + quiet) + '" y="' + (r + quiet) + '" width="' + (c - start) + '" height="1"/>');
      } else c++;
    }
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total +
         '" width="' + (total * px) + '" height="' + (total * px) + '" shape-rendering="crispEdges">' +
         '<rect width="' + total + '" height="' + total + '" fill="#fff"/>' +
         '<g fill="#000">' + rects.join('') + '</g></svg>';
}

if (typeof module !== 'undefined') {
  module.exports = { qrMatrix: qrMatrix, qrSvg: qrSvg, qrPickVersion: qrPickVersion };
}
