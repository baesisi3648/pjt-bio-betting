/**
 * stage.ts — TV 경주 무대 (PixiJS). MIGRATION §11-2 장면 1.
 *
 * ⚠️ **이 파일은 교사 번들에만 들어가야 한다.** `teacher/main.ts` 가 `import()` 로
 *    늦게 부르는 것이 그 방법이다 (정적 import 로 바꾸면 PixiJS 가 학생 폰 번들에도
 *    실린다 — 폰은 이 무대를 절대 안 그리고, 교실 와이파이로 1MB 를 더 받게 된다).
 *    `npm run build` 뒤 `grep -l -i pixi dist/client/assets/*.js` 로 확인한다.
 *
 * ⚠️ **없어도 게임은 돈다.** 만들다 실패하면(WebGL 없음·오래된 TV 브라우저) null 을
 *    돌려주고, 부르는 쪽은 4a 의 CSS 트랙(`#track`)을 그대로 쓴다. `prefers-reduced-motion`
 *    이면 아예 만들지도 않는다 (§11-1 "연출은 거들 뿐"). 캔버스 안은 CSS 미디어쿼리가
 *    못 막으므로 부르는 쪽이 `reducedMotion()` 으로 물어보고 결정한다.
 *
 * ⚠️ **글자를 가리지 않는다** (§11-1, 8m 가독성). 먼지·속도선은 트랙 안에서만 놀고
 *    이름·칸수·배지 위로 올라가지 않는다. 파티클은 레인 컨테이너 안, 글자보다 아래다.
 *
 * ⚠️ **정산 전에는 등수를 그리지 않는다** (§4-1). 골인한 말에는 '골인'만 붙는다.
 *
 * 외부 자원 없음 — 말은 '동물' 설정의 이모지를 Pixi `Text` 로 그려 텍스처로 굽는다.
 * 이미지도 글꼴도 받아오지 않는다 (§11-1).
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
  /** 1920 폭 기준 레인 높이(px). 화면이 좁아지면 비례해서 준다 */
  laneH: 60
};

interface Lane {
  root: Container;
  covered: Sprite;
  horse: Sprite;
  posText: Text;
  nameText: Text;
  flash: Sprite;
  code: AnimalCode;
  index: number;
  /** 트랙 안쪽 좌표계 */
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
   * 레인을 짓는다. **동물 목록이 바뀔 때만** 짓는다.
   * ⚠️ 매 프레임 다시 지으면 말이 순간이동하고 파티클이 끊긴다 — CSS 트랙에 적힌 것과 같은 이유다
   */
  function build(v: TeacherView): void {
    const codes = Object.keys(v.animals) as AnimalCode[];
    const key = codes.join(',') + '|' + Math.round(width);
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
    world.removeChildren();

    const tagW = Math.round(300 * scale);
    const posW = Math.round(96 * scale);
    const courseX = tagW;
    const courseW = Math.max(120, width - tagW - posW - GAP);
    const courseH = Math.round(laneH * 0.82);
    const finishW = Math.round(34 * scale);
    const pad = Math.round(30 * scale);          // 출발선·결승선 안쪽 여백 (말이 잘리지 않게)

    codes.forEach((code, i) => {
      const root = new Container();
      root.y = i * laneH;

      const bg = new Graphics();
      const top = Math.round((laneH - courseH) / 2);
      bg.roundRect(courseX, top, courseW, courseH, 10 * scale).fill(C.lane);
      // 칸 눈금 — 몇 칸 갔는지 눈으로 셀 수 있어야 한다 (05 §4-1)
      for (let k = 1; k < v.trackCells; k++) {
        const x = courseX + pad + (courseW - pad - finishW) * (k / v.trackCells);
        bg.rect(x, top, Math.max(1, scale), courseH).fill({ color: C.grid, alpha: 0.9 });
      }
      // 결승선 체크무늬 — 외부 이미지 없이 사각형으로 짠다
      const fx = courseX + courseW - finishW;
      bg.rect(fx, top, finishW, courseH).fill(C.laneDark);
      const cell = Math.round(9 * scale) || 4;
      for (let r = 0; r * cell < courseH; r++) {
        for (let q = 0; q * cell < finishW; q++) {
          if ((r + q) % 2) continue;
          bg.rect(fx + q * cell, top + r * cell,
            Math.min(cell, finishW - q * cell), Math.min(cell, courseH - r * cell)).fill(0xeaf0f5);
        }
      }
      bg.rect(fx, top, Math.max(2, 3 * scale), courseH).fill(C.goal);
      root.addChild(bg);

      // 지나온 거리.
      // ⚠️ 출발선(x0)에서 시작한다. 트랙 왼쪽 끝(courseX)에서 그리면 아직 한 칸도 못 간
      //    말에게도 파란 막대가 붙어서, 8m 밖에서는 "이미 출발했다"로 읽힌다
      const covered = new Sprite(Texture.WHITE);
      covered.tint = C.run;
      covered.alpha = 0.3;
      covered.x = courseX + pad;
      covered.y = top + 2;
      covered.height = courseH - 4;
      covered.width = 0;
      root.addChild(covered);

      // 레인 배지 — **색 + 숫자**. 색만으로 뜻을 전하지 않는다 (05 §2)
      const badge = Math.round(38 * scale);
      const silk = new Graphics()
        .roundRect(0, Math.round((laneH - badge) / 2), badge, badge, 9 * scale)
        .fill(silkOf(i));
      root.addChild(silk);
      const silkNo = new Text({
        text: String(i + 1),
        style: { fontFamily: FONT, fontSize: Math.round(22 * scale), fontWeight: '900', fill: C.bg }
      });
      silkNo.anchor.set(0.5);
      silkNo.x = badge / 2;
      silkNo.y = laneH / 2;
      root.addChild(silkNo);

      const nameText = new Text({
        text: v.animals[code] || '',
        style: { fontFamily: FONT, fontSize: Math.round(26 * scale), fontWeight: '700', fill: C.text }
      });
      nameText.anchor.set(0, 0.5);
      nameText.x = badge + Math.round(11 * scale);
      nameText.y = laneH / 2;
      root.addChild(nameText);

      const posText = new Text({
        text: '',
        style: { fontFamily: FONT, fontSize: Math.round(20 * scale), fontWeight: '800', fill: 0x6e8398 }
      });
      posText.anchor.set(1, 0.5);
      posText.x = width;
      posText.y = laneH / 2;
      root.addChild(posText);

      const horse = new Sprite(textureFor(v.emojis[code] || '🐎'));
      horse.anchor.set(0.5);
      horse.scale.set((laneH * 0.62) / horse.texture.height);
      horse.y = laneH / 2;
      root.addChild(horse);

      // 골인 플래시 — 레인 위에 얹는 흰 판. 평소엔 alpha 0 이라 글자를 가리지 않는다
      const flash = new Sprite(Texture.WHITE);
      flash.tint = C.gold;
      flash.x = courseX; flash.y = top;
      flash.width = courseW; flash.height = courseH;
      flash.alpha = 0;
      root.addChild(flash);

      world.addChild(root);
      lanes.push({
        root, covered, horse, posText, nameText, flash, code, index: i,
        x0: courseX + pad, x1: courseX + courseW - finishW, w: 0,
        finished: false, dustDebt: 0
      });
    });

    for (const l of lanes) l.w = l.x1 - l.x0;

    const h = codes.length * laneH + Math.round(8 * scale);
    app.renderer.resize(width, h);
    app.canvas.style.height = h + 'px';
    bigText.x = width / 2; bigText.y = h / 2 - 20 * scale;
    subText.x = width / 2; subText.y = h / 2 + 60 * scale;
    scrim.x = width / 2; scrim.y = h / 2;
    scrim.width = Math.min(width * 0.42, 620 * scale);
    scrim.height = Math.round(240 * scale);
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
    // ⚠️ 파티클은 글자보다 아래에 둔다 — 이름·칸수를 가리면 8m 가독성이 무너진다 (§11-1)
    lane.root.setChildIndex(s, Math.min(2, lane.root.children.length - 1));
    s.x = x; s.y = y;
    s.visible = true;
    if (kind === 'dust') {
      s.tint = 0x8fa3b5;
      s.scale.set((3 + Math.random() * 4) * scale / 8);
      p.vx = -(20 + Math.random() * 50) * scale;
      p.vy = (Math.random() - 0.5) * 40 * scale;
      p.max = 420 + Math.random() * 260;
    } else {
      s.tint = C.run;
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
    l.horse.x = l.x0 + l.w * pct;
    l.horse.y = laneH / 2 + bob;
    l.covered.width = Math.max(0, l.horse.x - l.covered.x);
    const fin = cellPos >= cells - 1e-9;
    l.posText.text = fin ? '골인' : `${Math.floor(cellPos)}/${cells}`;
    l.posText.style.fill = fin ? C.gold : 0x6e8398;
    l.nameText.style.fill = fin ? C.gold : C.text;
    l.covered.tint = fin ? C.gold : C.run;
    if (fin && !l.finished && moving) {
      l.finished = true;
      l.flash.alpha = 0.55;            // 골인 순간 번쩍 (등수는 안 보여준다 — §4-1)
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
      l.finished = v.positions[l.code] >= v.trackCells;
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
      const bob = running ? Math.sin((t * 1000 + l.index * 90) / 34) * (delta > 0 ? 4 : 1.6) * scale : 0;
      const wasX = l.horse.x;
      place(l, p, cells, true, bob);
      l.horse.rotation = running && delta > 0 ? Math.sin((t * 1000 + l.index * 90) / 34) * 0.09 : 0;

      if (running && delta > 0 && dt > 0) {
        const speedPx = Math.abs(l.horse.x - wasX) / (dt / 1000);
        l.dustDebt += TUNING.dustPerSecond * (dt / 1000);
        while (l.dustDebt >= 1) {
          l.dustDebt -= 1;
          spawn(l, l.horse.x - 12 * scale, laneH / 2 + 10 * scale, 'dust');
        }
        // 속도선은 **빨리 갈 때만**. 늘 나오면 누가 앞서는지 안 보인다
        if (speedPx > 90 * scale && Math.random() < 0.5) {
          spawn(l, l.horse.x - 26 * scale, laneH / 2 - 6 * scale, 'speed');
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
