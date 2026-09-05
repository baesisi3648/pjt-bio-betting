/**
 * mini.ts — 폰 미니 트랙 (Canvas 2D). MIGRATION §11-2 "폰에는 미니 트랙".
 *
 * ⚠️ **PixiJS 를 쓰지 않는다.** 폰 번들에 렌더링 라이브러리를 얹을 이유가 없다 —
 *    이 화면은 20초 동안 8줄짜리 작은 그림 하나를 그릴 뿐이고, 학생 폰은 교실
 *    와이파이로 번들을 받는다. Canvas 2D 로 충분하다.
 *
 * ⚠️ **TV 와 같은 `raceFrame` 을 쓴다.** 이게 이 파일의 존재 이유다 (§11-2).
 *    여기서 "폰은 작으니까 대충" 같은 근사를 넣는 순간, 학생은 폰에서 사자가 앞서는 걸
 *    보고 고개를 드는데 TV 에서는 치타가 앞서 있다. 두 화면이 서로를 반박한다.
 *
 * ⚠️ **여기에 버튼이 없다.** 이 20초는 고개를 들어 TV 를 보라는 시간이다 (§11-2, §1).
 *
 * ⚠️ `prefers-reduced-motion` 이면 그리지 않고 **최종 위치만 즉시** 보여준다.
 *    캔버스 안은 CSS 미디어쿼리가 못 막으므로 여기서 직접 물어본다 (§11-1).
 */

import type { AnimalCode } from '../../game/config.ts';
import type { TeamView } from '../../game/views.ts';
import { beforeOf, raceFrame, raceSeed } from '../shared/race.ts';
import { hex, silkOf } from '../shared/theme.ts';
import { reducedMotion } from '../shared/ui.ts';

const LANE_H = 22;      // 폰 8줄 = 176px. 힌트 탭으로 넘어갈 수 있게 화면 절반을 넘기지 않는다
const TAG_W = 26;       // 레인 번호 배지
const POS_W = 34;

interface Mini {
  frame(v: TeamView, t: number): void;
  still(v: TeamView): void;
  dispose(): void;
}

let current: Mini | null = null;

/**
 * `#mini-track` 에 캔버스를 붙인다. 탭이 다시 그려지면 요소가 새로 생기므로
 * 그때마다 다시 부른다 — 이전 것은 DOM 과 함께 사라진다.
 */
export function mountMini(host: HTMLElement): Mini | null {
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  if (!ctx) return null;      // 캔버스가 없는 브라우저 — 문구만 남고 게임은 그대로 돈다

  cv.style.width = '100%';
  cv.style.display = 'block';
  host.innerHTML = '';
  host.appendChild(cv);

  let dpr = 1;
  let w = 0, h = 0;

  function fit(rows: number): void {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = Math.max(200, host.clientWidth || 300);
    h = rows * LANE_H + 6;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.height = h + 'px';
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(v: TeamView, pos: Record<AnimalCode, number>, bobT: number | null): void {
    const codes = Object.keys(v.animals) as AnimalCode[];
    fit(codes.length);
    const g = ctx!;
    const cells = Math.max(1, v.trackCells);
    const x0 = TAG_W + 6;
    const x1 = w - POS_W - 4;

    g.clearRect(0, 0, w, h);
    codes.forEach((c, i) => {
      const y = i * LANE_H + 3;
      const mid = y + LANE_H / 2;

      // 레인 배지 — 색 + 숫자. 색만으로 뜻을 전하지 않는다 (05 §2)
      g.fillStyle = hex(silkOf(i));
      g.beginPath();
      g.roundRect(2, y + 2, TAG_W - 6, LANE_H - 6, 5);
      g.fill();
      g.fillStyle = '#0F1720';
      g.font = '700 11px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(i + 1), 2 + (TAG_W - 6) / 2, mid);

      // 트랙 + 칸 눈금
      g.fillStyle = '#D6DFE8';
      g.beginPath();
      g.roundRect(x0, y + 5, x1 - x0, LANE_H - 12, 4);
      g.fill();
      g.fillStyle = '#C0CDD9';
      for (let k = 1; k < cells; k++) {
        g.fillRect(x0 + (x1 - x0 - 10) * (k / cells), y + 5, 1, LANE_H - 12);
      }
      // 결승선
      g.fillStyle = '#EF5350';
      g.fillRect(x1 - 10, y + 5, 2, LANE_H - 12);

      const p = Math.max(0, Math.min(1, (pos[c] ?? 0) / cells));
      const hx = x0 + (x1 - x0 - 14) * p;

      // 지나온 거리
      g.fillStyle = p >= 1 ? 'rgba(242,180,65,.45)' : 'rgba(79,195,247,.45)';
      g.fillRect(x0, y + 5, Math.max(0, hx - x0), LANE_H - 12);

      // 말 — 제자리 말도 몸은 들썩인다. 위치는 raceFrame 이 정한다
      const bob = bobT == null ? 0 : Math.sin((bobT * 1000 + i * 90) / 34) * 1.6;
      g.font = '15px system-ui, sans-serif';
      g.textAlign = 'left';
      g.fillText(v.emojis[c] || '🐎', hx, mid + bob);

      // 현재 칸 — 숫자를 가리지 않는다
      g.fillStyle = p >= 1 ? '#B8860B' : '#5A6B7C';
      g.font = '700 10px system-ui, sans-serif';
      g.textAlign = 'right';
      g.fillText(p >= 1 ? '골인' : `${Math.floor(pos[c] ?? 0)}/${cells}`, w - 3, mid);
    });
  }

  const api: Mini = {
    still(v) { draw(v, v.positions, null); },
    frame(v, t) {
      const before = beforeOf(v.positions, v.raceMoves || {});
      draw(v, raceFrame(raceSeed(v.code, v.round), before, v.positions, v.trackCells, t), t);
    },
    dispose() { if (current === api) current = null; }
  };
  current = api;
  return api;
}

// ────────────────────────────────────────────────────────────
// 화면이 부르는 입구
// ────────────────────────────────────────────────────────────

let raf = 0;

/**
 * moving 동안 미니 트랙을 돌린다. `tOf()` 는 **서버 시각**으로 계산한 0~1 진행률을
 * 돌려줘야 한다 (`ServerClock`). null 이면 정지 화면(일시정지·단계 종료)이다.
 *
 * ⚠️ 폰 시계로 재면 늦게 들어온 폰이 다른 지점에서 경주를 본다 (§11-2).
 */
export function startMini(host: HTMLElement, view: () => TeamView | null, tOf: () => number | null): void {
  stopMini();
  const m = mountMini(host);
  if (!m) return;

  const v0 = view();
  if (!v0) return;

  // 움직임을 줄여 달라고 한 기기 — 경주를 돌리지 않고 도착 위치만 보여준다
  if (reducedMotion()) { m.still(v0); return; }

  const tick = (): void => {
    const v = view();
    if (!v) { raf = 0; return; }
    const t = tOf();
    if (t == null) m.still(v); else m.frame(v, t);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

export function stopMini(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (current) current.dispose();
}
