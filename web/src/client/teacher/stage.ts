/**
 * stage.ts — TV 경주 무대 (PixiJS). MIGRATION §11-2 장면 1 · RENEWAL §4-2 구획 2.
 *
 * ⚠️ **이 파일은 교사 번들에만 들어가야 한다.** `teacher/main.ts` 가 `import()` 로
 *    늦게 부르는 것이 그 방법이다 (정적 import 로 바꾸면 PixiJS 가 학생 폰 번들에도
 *    실린다 — 폰은 이 무대를 절대 안 그리고, 교실 와이파이로 1MB 를 더 받게 된다).
 *    `npm run build` 뒤 `grep -l -i pixi dist/client/assets/*.js` 로 확인한다.
 *
 * ⚠️ **없어도 게임은 돈다.** 만들다 실패하면(WebGL 없음·오래된 TV 브라우저) null 을
 *    돌려주고, 부르는 쪽은 CSS 트랙(`#track`)을 그대로 쓴다. `prefers-reduced-motion`
 *    이면 아예 만들지도 않는다 (§11-1 "연출은 거들 뿐"). 캔버스 안은 CSS 미디어쿼리가
 *    못 막으므로 부르는 쪽이 `reducedMotion()` 으로 물어보고 결정한다.
 *
 * ⚠️ **글자를 가리지 않는다** (§11-1, 8m 가독성). 먼지·속도선은 잔디 안에서만 놀고
 *    이름·칸수·배지 위로 올라가지 않는다. 파티클은 레인 컨테이너 안, 말보다 아래다.
 *
 * ⚠️ **정산 전에는 등수를 그리지 않는다** (§4-1). 골인한 말에는 '🏁 골인'만 붙는다.
 *
 * ── 4단계에서 방향을 뒤집었다 (RENEWAL §1 결정표 · §4-2) ──
 *
 * ⚠️ **진행 방향은 왼쪽 → 오른쪽이다.** START 가 왼쪽, GOAL 이 오른쪽.
 *    3단계까지는 반대였다. 그때 오른쪽에서 출발시킨 이유는 "동물 이모지가 대부분 왼쪽을
 *    보고 있어서" 였는데, 4단계에서 **이모지를 좌우 반전**(`scale.x = -1`)하기로 정해
 *    그 이유가 사라졌다. 읽는 방향(좌→우)과 달리는 방향이 같은 쪽이 8m 밖에서 낫다.
 *    세 렌더러(**이 무대 · `teacher.css` 의 CSS 폴백 트랙 · `team/mini.ts` 의 폰 미니
 *    트랙**)가 **반드시 같은 방향**이어야 한다 — 하나만 되돌리면 reduced-motion 이나
 *    WebGL 없는 TV 에서 폰과 반대로 달린다 (§11-2 가 막으려던 바로 그 그림).
 *
 * 레인 배치: **왼쪽(출발선 쪽)에 번호 배지 + 이름, 오른쪽(GOAL 옆)에 `n/20`.**
 * 이름이 출발선 옆이고 칸수가 결승선 옆인 짝은 방향을 뒤집기 전과 같다.
 *
 * 외부 자원 없음 — 말은 '동물' 설정의 이모지를 Pixi `Text` 로 그려 텍스처로 굽는다.
 * 잔디·울타리·체크무늬 결승선도 전부 사각형이다. 이미지도 글꼴도 받아오지 않는다 (§11-1).
 */

import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { AnimalCode } from '../../game/config.ts';
import type { TeacherView } from '../../game/views.ts';
import { COUNTDOWN_END, RUN_END, beforeOf, raceFrame, raceSeed } from '../shared/race.ts';
import { C, FONT, silkOf } from '../shared/theme.ts';

/**
 * 손으로 맞춘 값들. **오래된 교실 TV** 를 염두에 두고 조절하는 자리다.
 * 프레임이 밀리면 `dustPerSecond` · `maxParticles` 를 먼저 줄인다 (눈에 제일 덜 띈다).
 */
export const TUNING = {
  /** 말 한 마리가 1초에 남기는 먼지 개수 (질주 중, 실제로 움직이는 말만) */
  dustPerSecond: 14,
  /** 화면 전체 파티클 상한. 넘으면 오래된 것부터 재활용한다 — 새로 만들지 않는다 */
  maxParticles: 160,
  /** 선두가 바뀔 때 카메라가 흔들리는 세기(px)와 시간(ms) */
  shakePx: 7,
  shakeMs: 260,
  /** 골인 플래시가 남아 있는 시간(ms) */
  flashMs: 900,
  /**
   * 1920 폭 기준 레인 높이(px). 화면이 좁아지면 비례해서 준다.
   * 3단계의 60 → **90** (RENEWAL §4-2 "레인 높이 ≈ 90px"). 8줄 × 90 = 720px 이라
   * 1080p TV 에서 트랙 하나가 화면의 3분의 2를 쓴다 — 그게 이 화면의 주인공이다.
   */
  laneH: 90,
  /**
   * 원근. 위 레인이 살짝 좁다 (92% → 100%).
   * ⚠️ **더 세게 주지 말 것.** 이건 그림이 아니라 위치를 읽는 표다 —
   *    위아래 레인 높이가 눈에 띄게 다르면 "어느 말이 앞서나"보다 "왜 저 줄만 작지"가
   *    먼저 보인다 (§4-2 "위치 가독성이 우선").
   */
  perspective: 0.92
};

interface Lane {
  root: Container;
  covered: Sprite;
  halo: Sprite;
  horse: Sprite;
  posText: Text;
  nameText: Text;
  flash: Sprite;
  code: AnimalCode;
  index: number;
  /** 이 레인의 높이와 세로 중앙 (원근 때문에 줄마다 다르다) */
  h: number; mid: number;
  /**
   * 트랙 안쪽 좌표계. `x0` 은 **출발선(왼쪽)**, `x1` 은 **결승선(오른쪽)** 이라
   * `w = x1 - x0` 는 양수다. `x0 + w * pct` 라는 식은 방향을 뒤집기 전과 같고,
   * 방향은 x0·x1 을 어디로 잡느냐로만 정해진다.
   */
  x0: number; x1: number; w: number;
  finished: boolean;
  dustDebt: number;
}

interface Particle {
  s: Sprite;
  vx: number; vy: number;
  life: number; max: number;
  alive: boolean;
}

export interface RaceStage {
  /** 정지 화면 — waiting·quiz·discuss·betting. 무대는 늘 트랙을 보여준다 */
  still(v: TeacherView): void;
  /** moving 한 프레임. t 는 0~1 단계 진행률(서버 시각 기준), dt 는 지난 프레임과의 간격(ms) */
  frame(v: TeacherView, t: number, dt: number): void;
  /** 카드 폭이 바뀌었다 */
  resize(): void;
  destroy(): void;
}

const GAP = 14;

export async function createStage(host: HTMLElement): Promise<RaceStage | null> {
  const app = new Application();
  try {
    await app.init({
      background: C.card,
      antialias: true,
      resolution: 1,          // TV 는 1배. 2배로 굽면 오래된 노트북에서 프레임이 반토막 난다
      autoDensity: false,
      autoStart: false,       // 그리는 시점은 부르는 쪽이 정한다 (서버 시각으로 도는 rAF 하나)
      width: Math.max(320, host.clientWidth || 960),
      height: 200,
      preference: 'webgl'
    });
  } catch {
    // WebGL 이 없는 기기·브라우저. 여기서 죽으면 안 된다 — CSS 트랙으로 돌아간다
    try { app.destroy(true); } catch { /* 초기화도 안 됐다 */ }
    return null;
  }

  host.appendChild(app.canvas);
  app.canvas.style.display = 'block';
  app.canvas.style.width = '100%';

  const world = new Container();      // 카메라 흔들림은 이 컨테이너를 민다
  const overlay = new Container();    // 카운트다운 — 흔들림에 안 딸려간다
  app.stage.addChild(world);
  app.stage.addChild(overlay);

  /** 잔디·울타리·관중석·START·GOAL. 레인이 바뀔 때만 다시 그린다 */
  const field = new Graphics();
  world.addChild(field);
  const fieldText = new Container();
  world.addChild(fieldText);

  // 먼지 한 알. 원 하나를 텍스처로 구워 전부 돌려 쓴다 (매 프레임 Graphics 를 새로 만들면 죽는다)
  const dot = new Graphics().circle(8, 8, 8).fill(0xffffff);
  const dotTex = app.renderer.generateTexture(dot);
  dot.destroy();

  // 카운트다운 숫자 뒤에 까는 어두운 판. ⚠️ 레인 이름·칸수(양 끝)는 덮지 않는 폭으로 잡는다
  const scrim = new Sprite(Texture.WHITE);
  scrim.tint = 0x000000;
  scrim.alpha = 0;
  scrim.anchor.set(0.5);
  overlay.addChild(scrim);

  const bigText = new Text({
    text: '', style: { fontFamily: FONT, fontSize: 120, fontWeight: '900', fill: C.text, align: 'center' }
  });
  bigText.anchor.set(0.5);
  bigText.visible = false;
  overlay.addChild(bigText);

  const subText = new Text({
    text: '', style: { fontFamily: FONT, fontSize: 34, fontWeight: '700', fill: C.gold, align: 'center' }
  });
  subText.anchor.set(0.5);
  subText.visible = false;
  overlay.addChild(subText);

  const emojiTex = new Map<string, Texture>();
  function textureFor(emoji: string): Texture {
    const got = emojiTex.get(emoji);
    if (got) return got;
    // 이모지를 글자로 그려 텍스처로 굽는다 — 외부 이미지를 받아오지 않기 위해서다 (§11-1)
    const t = new Text({ text: emoji || '🐎', style: { fontFamily: FONT, fontSize: 72 } });
    const tex = app.renderer.generateTexture(t);
    t.destroy();
    emojiTex.set(emoji, tex);
    return tex;
  }

  let lanes: Lane[] = [];
  let laneKey = '';
  let scale = 1;
  let laneH = TUNING.laneH;
  let width = 0;
  let leader: AnimalCode | null = null;
  let shakeLeft = 0;
  const particles: Particle[] = [];

  // ── 레이아웃 ─────────────────────────────────────────────

  function measure(): void {
    width = Math.max(320, host.clientWidth || 960);
    scale = Math.max(0.42, Math.min(1.15, width / 1900));
    laneH = Math.round(TUNING.laneH * scale);
  }

  /**
   * 레인을 짓는다. **동물 목록·폭이 바뀔 때만** 짓는다.
   * ⚠️ 매 프레임 다시 지으면 말이 순간이동하고 파티클이 끊긴다 — CSS 트랙에 적힌 것과 같은 이유다
   */
  function build(v: TeacherView): void {
    const codes = Object.keys(v.animals) as AnimalCode[];
    // 한 화면 모드(teacher.css)에서는 호스트가 높이를 정해 준다 — main.ts applyFit 이 dataset.fit 을
    // 켠다. 그 밖에서는 0 이다. ⚠️ 표시 없이 clientHeight 를 읽으면 안 된다: 보통 모드에서는
    //    호스트 높이가 곧 지난번 캔버스 높이라, 지을 때마다 반올림만큼 레인이 조금씩 낮아진다
    const hostH = host.dataset.fit ? host.clientHeight : 0;
    const key = codes.join(',') + '|' + Math.round(width) + '|' + v.trackCells + '|' + hostH;
    if (key === laneKey) return;
    laneKey = key;

    // ⚠️ 파티클을 먼저 떼어 낸다. 파티클 스프라이트는 레인 컨테이너에 얹혀 있어서,
    //    떼지 않고 레인을 destroy({children:true}) 하면 **재활용 풀에 죽은 스프라이트가
    //    남는다.** 다음 프레임에 그걸 만지는 순간 `Cannot read properties of null` 로
    //    무대가 통째로 멈춘다 (ResizeObserver 가 처음 붙을 때 바로 재현된다)
    for (const p of particles) {
      p.alive = false;
      p.s.visible = false;
      if (p.s.parent) p.s.parent.removeChild(p.s);
    }
    for (const l of lanes) l.root.destroy({ children: true });
    lanes = [];
    field.clear();
    fieldText.removeChildren();
    // ⚠️ world.removeChildren() 을 부르면 field 까지 떨어져 나간다 — 레인만 지운다

    // 화면 순서: [배지·이름 tagW] GAP [잔디 courseW] GAP [칸수 posW]
    const tagW = Math.round(310 * scale);
    const posW = Math.round(116 * scale);
    const courseX = tagW + GAP;
    const courseW = Math.max(160, width - tagW - posW - GAP * 2);
    const cells = Math.max(1, v.trackCells);

    // 세로: [관중석] [울타리] [레인 …] [울타리]
    const standsH = Math.round(30 * scale);
    const fenceH = Math.max(4, Math.round(9 * scale));
    const top0 = standsH + fenceH;
    // 한 화면 모드 — 레인 8줄이 호스트 높이 안에 들어가게 줄인다 (레인 밖 여백 = 관중석·울타리 둘·4px).
    // 하한 28px 은 안전장치일 뿐이다. 그 근처까지 내려가면 main.ts 가 이 모드를 풀었어야 한다
    if (hostH > 0) {
      const spare = hostH - (top0 + fenceH + Math.round(4 * scale));
      laneH = Math.max(28, Math.min(laneH, Math.floor(spare / Math.max(1, codes.length))));
    }

    // 원근 — 위 레인이 92%, 아래가 100%. 아주 약하게만 (TUNING.perspective 주석 참조)
    const n = codes.length;
    const hs = codes.map((_, i) =>
      Math.round(laneH * (n > 1 ? TUNING.perspective + (1 - TUNING.perspective) * (i / (n - 1)) : 1)));
    const tops: number[] = [];
    let acc = top0;
    for (const h of hs) { tops.push(acc); acc += h; }
    const grassBottom = acc;
    const totalH = grassBottom + fenceH + Math.round(4 * scale);

    // ── 잔디밭 ──
    const startW = Math.max(3, Math.round(7 * scale));    // START 기준선(흰 기둥)
    const finishW = Math.round(34 * scale);               // GOAL 체크무늬 폭
    const cellW = (courseW - startW - finishW) / cells;

    // 관중석 — 어두운 띠 하나. 관중을 그리면 말이 안 보인다 (§4-2 "암시만")
    field.rect(courseX, 0, courseW, standsH).fill(C.stands);
    field.rect(courseX, standsH - Math.max(1, scale), courseW, Math.max(1, scale)).fill(0x2b3947);

    // 잔디 — **한 칸 걸러 한 칸**이 두 톤이다. 이 줄무늬가 곧 20칸의 눈금이다
    field.rect(courseX, top0, courseW, grassBottom - top0).fill(C.grass);
    for (let k = 0; k < cells; k++) {
      if (k % 2 === 0) continue;
      field.rect(courseX + startW + cellW * k, top0, cellW, grassBottom - top0).fill(C.grassAlt);
    }
    // 5칸마다 흰 표시 — 8m 밖에서 칸을 셀 때 눈이 짚는 자리 (경마장의 펄롱 표시)
    for (let k = 5; k < cells; k += 5) {
      field.rect(courseX + startW + cellW * k - Math.max(1, scale), top0,
        Math.max(2, 2 * scale), grassBottom - top0).fill({ color: C.chalk, alpha: 0.42 });
    }

    // 흰 레인 경계선 — 잔디 위에서 줄을 가르는 유일한 흰색
    const lineH = Math.max(1, Math.round(2 * scale));
    for (let i = 0; i <= n; i++) {
      const y = i === n ? grassBottom - lineH : (tops[i] as number);
      field.rect(courseX, y, courseW, lineH).fill({ color: C.chalk, alpha: i === 0 || i === n ? 0.85 : 0.45 });
    }

    // START 기둥(왼쪽) — 흰 기준선. 여기가 0칸이다
    field.rect(courseX, top0, startW, grassBottom - top0).fill(C.chalk);

    // GOAL 체크무늬(오른쪽) — 외부 이미지 없이 사각형으로 짠다
    const fx = courseX + courseW - finishW;
    field.rect(fx, top0, finishW, grassBottom - top0).fill(C.laneDark);
    const q = Math.round(11 * scale) || 4;
    for (let r = 0; r * q < grassBottom - top0; r++) {
      for (let c2 = 0; c2 * q < finishW; c2++) {
        if ((r + c2) % 2) continue;
        field.rect(fx + c2 * q, top0 + r * q,
          Math.min(q, finishW - c2 * q), Math.min(q, grassBottom - top0 - r * q)).fill(0xeaf0f5);
      }
    }
    // 빨간 골인선은 **말이 오는 쪽(왼쪽)** 모서리에 둔다 — 말이 먼저 닿는 선이다
    const goalW = Math.max(2, 3 * scale);
    field.rect(fx, top0, goalW, grassBottom - top0).fill(C.goal);

    // 위·아래 울타리 — 가로대 두 줄 + 기둥
    for (const y of [standsH, grassBottom]) {
      field.rect(courseX, y, courseW, Math.max(1, Math.round(2 * scale))).fill(C.rail);
      field.rect(courseX, y + fenceH - Math.max(1, Math.round(2 * scale)), courseW,
        Math.max(1, Math.round(2 * scale))).fill({ color: C.rail, alpha: 0.7 });
      for (let x = courseX; x < courseX + courseW; x += Math.round(64 * scale)) {
        field.rect(x, y, Math.max(1, Math.round(2 * scale)), fenceH).fill({ color: C.rail, alpha: 0.8 });
      }
    }

    // START · GOAL 글자와 깃발은 관중석 띠 안에. 잔디 위에 얹으면 말을 가린다
    const label = (text: string, x: number, anchorX: number): void => {
      const t = new Text({
        text,
        style: { fontFamily: FONT, fontSize: Math.round(19 * scale), fontWeight: '900', fill: C.rail }
      });
      t.anchor.set(anchorX, 0.5);
      t.x = x; t.y = standsH / 2;
      fieldText.addChild(t);
    };
    label('START', courseX + Math.round(10 * scale), 0);
    label('🏁 GOAL', courseX + courseW - Math.round(10 * scale), 1);

    // ── 레인 ──
    codes.forEach((code, i) => {
      const h = hs[i] as number;
      const root = new Container();
      root.y = tops[i] as number;

      const pad = Math.round(8 * scale);
      // 말이 지나는 구간: START 기둥 바로 오른쪽 → 체크무늬 안쪽.
      // 20칸을 다 간 말은 체크무늬 위(= GOAL 뒤)에 선다 (§4-2 "GOAL 뒤에 서 있고")
      const xStart = courseX + startW + pad;
      const xGoal = courseX + courseW - Math.round(finishW * 0.35);

      // 지나온 거리 — 출발선(왼쪽)에서 말까지. 잔디가 밟혀 색이 바랜 자국이다.
      // ⚠️ 흰색을 옅게 쓴다. 파란 막대를 얹으면 잔디 위에서 "물이 찼다"로 읽힌다
      const covered = new Sprite(Texture.WHITE);
      covered.tint = 0xffffff;
      covered.alpha = 0.16;
      covered.x = xStart;
      covered.y = lineH + 1;
      covered.height = Math.max(2, h - lineH * 2 - 2);
      covered.width = 0;
      root.addChild(covered);

      // 골인한 말 뒤의 금색 후광. **등수가 아니다** — "이 말은 끝났다"뿐이다 (§4-1)
      const halo = new Sprite(dotTex);
      halo.anchor.set(0.5);
      halo.tint = C.gold;
      halo.alpha = 0;
      halo.y = h / 2;
      root.addChild(halo);

      const horse = new Sprite(textureFor(v.emojis[code] || '🐎'));
      horse.anchor.set(0.5);
      // 이모지 1.6배 (3단계는 laneH*0.62 = 37px, 지금은 90*0.66 = 59px).
      // ⚠️ **좌우 반전**해서 오른쪽(GOAL)을 보게 한다 — 대부분의 동물 이모지가 왼쪽을
      //    보고 그려져 있어서, 반전하지 않으면 뒷걸음질치는 그림이 된다 (RENEWAL §1)
      const k = (h * 0.66) / horse.texture.height;
      horse.scale.set(-k, k);
      horse.y = h / 2;
      root.addChild(horse);

      // 골인 플래시 — 레인 위에 얹는 금색 판. 평소엔 alpha 0 이라 아무것도 안 가린다
      const flash = new Sprite(Texture.WHITE);
      flash.tint = C.gold;
      flash.x = courseX; flash.y = 0;
      flash.width = courseW; flash.height = h;
      flash.alpha = 0;
      root.addChild(flash);

      // 레인 배지 — **색 + 숫자**. 색만으로 뜻을 전하지 않는다 (05 §2).
      // ⚠️ 화면 **왼쪽 끝**이다 (출발선 쪽)
      const badge = Math.round(44 * scale);
      const silk = new Graphics()
        .roundRect(0, Math.round((h - badge) / 2), badge, badge, 10 * scale)
        .fill(silkOf(i));
      root.addChild(silk);
      const silkNo = new Text({
        text: String(i + 1),
        style: { fontFamily: FONT, fontSize: Math.round(25 * scale), fontWeight: '900', fill: C.bg }
      });
      silkNo.anchor.set(0.5);
      silkNo.x = badge / 2;
      silkNo.y = h / 2;
      root.addChild(silkNo);

      // 이름은 배지 오른쪽에 왼쪽 정렬 — 8줄의 이름 머리가 한 줄로 맞는다
      const nameText = new Text({
        text: v.animals[code] || '',
        style: { fontFamily: FONT, fontSize: Math.round(30 * scale), fontWeight: '700', fill: C.text }
      });
      nameText.anchor.set(0, 0.5);
      nameText.x = badge + Math.round(12 * scale);
      nameText.y = h / 2;
      root.addChild(nameText);

      // 칸수는 화면 **오른쪽 끝**(GOAL 옆). 왼쪽 정렬이라 체크무늬에서 떨어져 앉는다
      const posText = new Text({
        text: '',
        style: { fontFamily: FONT, fontSize: Math.round(23 * scale), fontWeight: '800', fill: 0x8fa3b5 }
      });
      posText.anchor.set(0, 0.5);
      posText.x = courseX + courseW + GAP;
      posText.y = h / 2;
      root.addChild(posText);

      world.addChild(root);
      lanes.push({
        root, covered, halo, horse, posText, nameText, flash, code, index: i,
        h, mid: h / 2,
        x0: xStart, x1: xGoal, w: xGoal - xStart,
        finished: false, dustDebt: 0
      });
      halo.scale.set((h * 0.9) / 16);
    });

    app.renderer.resize(width, totalH);
    app.canvas.style.height = totalH + 'px';
    bigText.x = width / 2; bigText.y = totalH / 2 - 20 * scale;
    subText.x = width / 2; subText.y = totalH / 2 + 62 * scale;
    scrim.x = width / 2; scrim.y = totalH / 2;
    scrim.width = Math.min(width * 0.42, 620 * scale);
    scrim.height = Math.round(250 * scale);
    bigText.style.fontSize = Math.round(120 * scale);
    subText.style.fontSize = Math.round(34 * scale);
  }

  // ── 파티클 ───────────────────────────────────────────────

  function spawn(lane: Lane, x: number, y: number, kind: 'dust' | 'speed'): void {
    let p = particles.find((q) => !q.alive && !q.s.destroyed);
    if (!p) {
      if (particles.length >= TUNING.maxParticles) {
        // 상한을 넘었다 — 제일 오래된 것을 뺏어 쓴다. 새로 만들면 메모리가 계속 는다
        p = particles.reduce((a, b) => (a.life / a.max > b.life / b.max ? a : b));
      } else {
        const s = new Sprite(dotTex);
        s.anchor.set(0.5);
        p = { s, vx: 0, vy: 0, life: 0, max: 1, alive: false };
        particles.push(p);
      }
    }
    const s = p.s;
    if (s.parent !== lane.root) lane.root.addChild(s);
    // ⚠️ 파티클은 말·글자보다 아래에 둔다 (레인 자식 0번이 covered 라 바로 그 위).
    //    위로 올리면 이름·칸수를 가려 8m 가독성이 무너진다 (§11-1)
    lane.root.setChildIndex(s, Math.min(1, lane.root.children.length - 1));
    s.x = x; s.y = y;
    s.visible = true;
    // ⚠️ vx 는 **음수**다. 말이 오른쪽으로 달리므로 먼지·속도선은 왼쪽(뒤)으로 흩어진다.
    //    부호를 되돌리면 먼지가 말보다 앞서 날아가 "브레이크를 밟는" 그림이 된다
    if (kind === 'dust') {
      s.tint = 0xc9d8b8;                                 // 잔디 위의 흙먼지
      s.scale.set((3 + Math.random() * 4) * scale / 8);
      p.vx = -(20 + Math.random() * 50) * scale;
      p.vy = (Math.random() - 0.5) * 40 * scale;
      p.max = 420 + Math.random() * 260;
    } else {
      s.tint = 0xffffff;
      s.scale.set(1.4 * scale / 8, 0.5 * scale / 8);
      p.vx = -(220 + Math.random() * 140) * scale;
      p.vy = 0;
      p.max = 200 + Math.random() * 120;
    }
    p.life = 0;
    p.alive = true;
  }

  function stepParticles(dt: number): void {
    for (const p of particles) {
      if (!p.alive) continue;
      p.life += dt;
      if (p.life >= p.max) { p.alive = false; p.s.visible = false; continue; }
      p.s.x += p.vx * dt / 1000;
      p.s.y += p.vy * dt / 1000;
      p.s.alpha = 1 - p.life / p.max;
    }
  }

  function clearParticles(): void {
    for (const p of particles) { p.alive = false; p.s.visible = false; }
  }

  // ── 그리기 ───────────────────────────────────────────────

  function place(l: Lane, cellPos: number, cells: number, moving: boolean, bob: number): void {
    const pct = Math.max(0, Math.min(1, cellPos / Math.max(1, cells)));
    // x0 = 출발선(왼쪽), w > 0 이므로 pct 가 클수록 말이 오른쪽으로 간다
    l.horse.x = l.x0 + l.w * pct;
    l.horse.y = l.mid + bob;
    // 지나온 자국은 출발선(l.x0)에 왼쪽 끝을 붙인 채 말 쪽으로 자란다
    l.covered.width = Math.max(0, l.horse.x - l.x0);
    const fin = cellPos >= cells - 1e-9;
    // ⚠️ 등수가 아니다 — 골인 여부만 (§4-1). 정산 전에 순위를 그리면 게임이 끝난다
    l.posText.text = fin ? '🏁 골인' : `${Math.floor(cellPos)}/${cells}`;
    l.posText.style.fill = fin ? C.gold : 0x8fa3b5;
    l.nameText.style.fill = fin ? C.gold : C.text;
    l.covered.tint = fin ? C.gold : 0xffffff;
    l.covered.alpha = fin ? 0.3 : 0.16;
    l.halo.alpha = fin ? 0.28 : 0;
    l.halo.x = l.horse.x;
    if (fin && !l.finished && moving) {
      l.finished = true;
      l.flash.alpha = 0.5;             // 골인 순간 번쩍 (등수는 안 보여준다 — §4-1)
    }
    if (!fin) l.finished = false;
  }

  function still(v: TeacherView): void {
    measure();
    build(v);
    clearParticles();
    bigText.visible = false;
    subText.visible = false;
    scrim.alpha = 0;
    world.x = 0; world.y = 0;
    for (const l of lanes) {
      l.flash.alpha = 0;
      l.finished = (v.positions[l.code] || 0) >= v.trackCells;
      place(l, v.positions[l.code] || 0, v.trackCells, false, 0);
    }
    app.render();
  }

  function frame(v: TeacherView, t: number, dt: number): void {
    measure();
    build(v);

    const cells = v.trackCells;
    const after = v.positions;
    const before = beforeOf(after, v.raceMoves || {});
    const pos = raceFrame(raceSeed(v.code, v.round), before, after, cells, t);

    // 출발 3초 — 라운드 번호가 크게, 그다음 3·2·1, 마지막에 게이트가 열린다
    if (t < COUNTDOWN_END) {
      const u = t / COUNTDOWN_END;                 // 0~1
      bigText.visible = true;
      subText.visible = true;
      if (u < 0.34) {
        bigText.text = `${v.round}라운드`;
        subText.text = '';
      } else {
        const n = Math.max(1, Math.ceil((1 - u) / ((1 - 0.34) / 3)));
        bigText.text = String(n);
        subText.text = '출발 준비';
      }
      bigText.alpha = 1;
      scrim.alpha = 0.55;
    } else if (t < COUNTDOWN_END + 0.05) {
      bigText.visible = true; subText.visible = false;
      bigText.text = '출발!';
      bigText.alpha = 1 - (t - COUNTDOWN_END) / 0.05;
      scrim.alpha = 0.55 * bigText.alpha;
    } else {
      bigText.visible = false;
      subText.visible = false;
      scrim.alpha = 0;
    }

    const running = t >= COUNTDOWN_END && t < RUN_END;

    for (const l of lanes) {
      const p = pos[l.code] ?? 0;
      const delta = (after[l.code] || 0) - (before[l.code] || 0);
      // 제자리 말도 몸은 들썩인다 — **위치는 그대로** (raceFrame RACE-ZERO)
      const bob = running ? Math.sin((t * 1000 + l.index * 90) / 34) * (delta > 0 ? 5 : 2) * scale : 0;
      const wasX = l.horse.x;
      place(l, p, cells, true, bob);
      l.horse.rotation = running && delta > 0 ? Math.sin((t * 1000 + l.index * 90) / 34) * 0.09 : 0;

      if (running && delta > 0 && dt > 0) {
        const speedPx = Math.abs(l.horse.x - wasX) / (dt / 1000);
        l.dustDebt += TUNING.dustPerSecond * (dt / 1000);
        while (l.dustDebt >= 1) {
          l.dustDebt -= 1;
          spawn(l, l.horse.x - 14 * scale, l.mid + 14 * scale, 'dust');   // 말 뒤 = 왼쪽
        }
        // 속도선은 **빨리 갈 때만**. 늘 나오면 누가 앞서는지 안 보인다
        if (speedPx > 90 * scale && Math.random() < 0.5) {
          spawn(l, l.horse.x - 30 * scale, l.mid - 8 * scale, 'speed');
        }
      }
      if (l.flash.alpha > 0) l.flash.alpha = Math.max(0, l.flash.alpha - dt / TUNING.flashMs);
    }

    // 선두 교체 — 짧게 흔든다. 8m 밖에서도 "뭔가 일어났다"가 전달되는 유일한 신호다
    if (running) {
      let top: AnimalCode | null = null, best = -1;
      for (const l of lanes) {
        const p = pos[l.code] ?? 0;
        if (p > best + 1e-9) { best = p; top = l.code; }
      }
      if (top && leader && top !== leader) shakeLeft = TUNING.shakeMs;
      leader = top;
    } else if (t < COUNTDOWN_END) {
      leader = null;
    }

    if (shakeLeft > 0) {
      shakeLeft = Math.max(0, shakeLeft - dt);
      const k = (shakeLeft / TUNING.shakeMs) * TUNING.shakePx * scale;
      world.x = (Math.random() - 0.5) * 2 * k;
      world.y = (Math.random() - 0.5) * 2 * k;
    } else { world.x = 0; world.y = 0; }

    stepParticles(dt);
    app.render();
  }

  function resize(): void {
    measure();
    laneKey = '';           // 폭이 바뀌면 레인을 다시 짓는다 (칸 눈금·결승선이 폭에 묶여 있다)
  }

  function destroy(): void {
    try { app.destroy(true, { children: true }); } catch { /* 이미 죽었다 */ }
  }

  measure();
  return { still, frame, resize, destroy };
}
