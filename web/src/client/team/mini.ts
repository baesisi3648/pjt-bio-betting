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
 * ⚠️ **진행 방향은 왼쪽 → 오른쪽이다.** START 가 왼쪽, GOAL 이 오른쪽 (RENEWAL §1·§4-2).
 *    3단계까지는 반대였다 — 그때 이유는 "동물 이모지가 대부분 왼쪽을 본다" 였는데,
 *    4단계에서 **이모지를 좌우 반전**(`ctx.scale(-1,1)`)하기로 정해 그 이유가 사라졌다.
 *    TV 무대(`teacher/stage.ts`)·CSS 폴백 트랙(`teacher.css`)과 **같은 방향이어야 한다** —
 *    방향이 갈리면 §11-2 가 막으려던 바로 그 일, "폰과 TV 가 서로를 반박하는" 그림이 난다.
 *    되돌리려면 셋을 동시에 되돌릴 것.
 *
 * 레인 배치도 함께 뒤집었다 — 배지가 왼쪽(출발선 쪽), 칸수(n/20)가 오른쪽(GOAL 옆).
 * 세 렌더러가 같은 배치여야 학생이 폰과 TV 를 번갈아 봐도 같은 그림으로 읽는다.
 * ⚠️ 폰에는 **이름 대신 번호 배지**만 둔다 (RENEWAL §4-2). 8줄에 이름까지 넣으면
 *    390px 폭에서 트랙이 손톱만 해진다 — 번호는 TV 의 배지와 같은 번호·같은 색이다.
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
    // 화면 순서: [배지 TAG_W] [잔디 x0~x1] [칸수 POS_W].
    // x0 이 출발선 쪽(왼쪽), x1 이 결승선 쪽(오른쪽)이다
    const x0 = TAG_W + 4;
    const x1 = w - POS_W - 4;
    const EW = 15;      // 이모지 폭. 반전해서 그리므로 hx 에서 **왼쪽으로** EW 만큼 번진다

    g.clearRect(0, 0, w, h);
    codes.forEach((c, i) => {
      const y = i * LANE_H + 3;
      const mid = y + LANE_H / 2;

      // 레인 배지 — 색 + 숫자. 색만으로 뜻을 전하지 않는다 (05 §2). 출발선 쪽(왼쪽 끝)
      const bx = 2;
      g.fillStyle = hex(silkOf(i));
      g.beginPath();
      g.roundRect(bx, y + 2, TAG_W - 6, LANE_H - 6, 5);
      g.fill();
      g.fillStyle = '#0F1720';
      g.font = '700 11px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(i + 1), bx + (TAG_W - 6) / 2, mid);

      // 잔디 — **한 칸 걸러 한 칸**이 두 톤이다. TV 와 같은 색값(theme.ts C.grass·grassAlt).
      // 폰은 밝은 화면이라 잔디를 조금 밝게 쓰지만 두 톤의 대비는 같게 유지한다
      const cw = (x1 - x0) / cells;
      for (let k = 0; k < cells; k++) {
        g.fillStyle = k % 2 ? '#4A9450' : '#3E8144';
        g.fillRect(x0 + cw * k, y + 5, Math.ceil(cw) + 1, LANE_H - 12);
      }
      // 결승선 — **오른쪽 끝**. 빨간 선은 말이 오는 쪽(왼쪽) 모서리에 둔다
      g.fillStyle = '#16212C';
      g.fillRect(x1 - 7, y + 5, 7, LANE_H - 12);
      g.fillStyle = '#EAF0F5';
      for (let r = 0; r * 4 < LANE_H - 12; r++) {
        if (r % 2) g.fillRect(x1 - 7, y + 5 + r * 4, 3, Math.min(4, LANE_H - 12 - r * 4));
        else g.fillRect(x1 - 4, y + 5 + r * 4, 3, Math.min(4, LANE_H - 12 - r * 4));
      }
      g.fillStyle = '#EF5350';
      g.fillRect(x1 - 9, y + 5, 2, LANE_H - 12);

      const p = Math.max(0, Math.min(1, (pos[c] ?? 0) / cells));
      // p 가 커질수록 오른쪽으로. 반전해서 그리면 이모지가 왼쪽으로 번지므로
      // 여유(EW)는 출발선 쪽에 둔다 — hx 는 말의 **코끝**이다
      const hx = x0 + EW + (x1 - x0 - EW) * p;

      // 지나온 자국 — **출발선(왼쪽)에서 말까지**
      g.fillStyle = p >= 1 ? 'rgba(242,180,65,.45)' : 'rgba(255,255,255,.28)';
      g.fillRect(x0, y + 5, Math.max(0, hx - EW - x0), LANE_H - 12);

      // 말 — 제자리 말도 몸은 들썩인다. 위치는 raceFrame 이 정한다.
      // ⚠️ scale(-1,1) 로 **좌우 반전** — TV 의 말과 같은 쪽(오른쪽)을 본다
      const bob = bobT == null ? 0 : Math.sin((bobT * 1000 + i * 90) / 34) * 1.6;
      g.save();
      g.translate(hx, 0);
      g.scale(-1, 1);
      g.font = '15px system-ui, sans-serif';
      g.textAlign = 'left';
      g.fillText(v.emojis[c] || '🐎', 0, mid + bob);
      g.restore();

      // 현재 칸 — GOAL 옆(오른쪽 끝). ⚠️ 등수가 아니라 골인 여부만 (§4-1)
      g.fillStyle = p >= 1 ? '#B8860B' : '#5A6B7C';
      g.font = '700 10px system-ui, sans-serif';
      g.textAlign = 'left';
      g.fillText(p >= 1 ? '골인' : `${Math.floor(pos[c] ?? 0)}/${cells}`, x1 + 4, mid);
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
