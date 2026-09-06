/**
 * audio.ts — BGM·효과음. **교사 화면(TV)만** 쓴다 (RENEWAL §4-4).
 *
 * ⚠️ **`team/` 에서 이 파일을 import 하지 마세요.** 폰은 조용해야 한다 —
 *    6모둠 폰이 동시에 울리면 교실이 시끄럽고, 학생은 소리로 남의 진행을 엿듣게 된다.
 *    폰의 피드백은 지금처럼 진동뿐이다 (§4-4 표 마지막 줄). 지금은 `teacher/main.ts`
 *    하나만 이 파일을 부르므로 Vite 가 이걸 교사 청크에 넣는다 — 폰 번들에서 부르는
 *    순간 mp3 를 받아오는 코드가 학생 번들로 넘어간다.
 *
 * ⚠️ **소리는 `prefers-reduced-motion` 과 무관하다** (§4-4). 움직임을 줄여 달라는 요청은
 *    화면 이야기지 소리 이야기가 아니다. 소리를 끄는 것은 사용자의 🔇 뿐이다.
 *
 * ⚠️ **외부 자원 없음** (MIGRATION §11-1). mp3 는 `src/client/public/audio/` 에 있고
 *    같은 출처에서 나간다. CDN 주소를 넣지 마세요 — 학교망에서 막히면 조용해질 뿐
 *    아니라, 매 라운드 실패하는 요청이 쌓인다.
 *
 * 원본은 생명 마블(`~/Projects/bio_marble/js/audio.js`)이다. 그대로 가져온 것:
 * cloneNode 로 겹쳐 재생, localStorage 저장, BGM 0.4 / 효과음 0.7 기본값
 * (선생님이 두 게임을 번갈아 쓰기 때문에 감각이 같아야 한다 — §4-4).
 *
 * 브라우저는 **사용자 동작 전에는 소리를 못 낸다.** 그래서 첫 클릭에 BGM 을 켜고,
 * 그때도 막히면 조용히 실패한 뒤 **다음 클릭에 다시 시도**한다 (§4-4 마지막 줄).
 * 실패를 토스트로 알리지 않는다 — 선생님이 고칠 수 있는 것이 아니고, 수업 중에
 * "소리를 못 켰습니다" 가 뜨면 그것 자체가 방해다.
 */

const BGM_SRC = '/audio/bgm.mp3';
/** 패널에 적히는 곡 이름 (생명 마블과 같은 곡) */
const BGM_NAME = '수련의 숲';

/**
 * 한 번씩 튕기는 효과음. 겹쳐 나야 하므로 재생할 때마다 cloneNode 한다.
 * ⚠️ `correct.mp3` · `wrong.mp3` 는 복사돼 있지만 여기 없다 — **교사 화면은 어느 모둠이
 *    맞혔는지 모른다** (RENEWAL §4-2 구획 4 "정답 여부 없음"). 소리로 그걸 흘리면
 *    화면에서 감춘 것이 스피커로 새어 나간다.
 */
const SFX = {
  dice: '/audio/dice-roll.mp3',
  coin: '/audio/coin.mp3',
  goldenKey: '/audio/golden-key.mp3',
  zooBuild: '/audio/zoo-build.mp3'
} as const;

export type SfxName = keyof typeof SFX;

/** 마감 10초 전에 반복되는 초침. 따로 두는 이유는 loop 이라 clone 이 아니라 하나여야 해서다 */
const TICK_SRC = '/audio/timer-tick.mp3';

const LS = {
  bgm: 'animal-derby.bgm-volume',
  sfx: 'animal-derby.sfx-volume',
  muted: 'animal-derby.muted'
} as const;

/**
 * 단계별 BGM 볼륨 배수 (§4-4 표).
 *
 * ⚠️ **절대값이 아니라 배수다.** 슬라이더가 정본이고 단계가 그 위에서 오르내린다 —
 *    절대값을 박아 두면 선생님이 볼륨을 줄여도 경주 때마다 0.6 으로 되돌아간다
 *    (MIGRATION §5 '설정값을 화면이 다시 정하지 말 것'과 같은 함정).
 *    기본 0.4 × 1.5 = 0.6(경주) · × 0.5 = 0.2(토론) 로 표의 숫자와 맞는다.
 */
const SCENE_GAIN: Record<string, number> = { moving: 1.5, discuss: 0.5 };

let bgmEl: HTMLAudioElement | null = null;
let tickEl: HTMLAudioElement | null = null;
const pool = new Map<SfxName, HTMLAudioElement>();

let bgmVol = 0.4;
let sfxVol = 0.7;
let muted = false;
/** BGM 이 실제로 흐르고 있는가. 자동 재생이 막히면 false 로 되돌아가 다음 클릭에 다시 시도한다 */
let playing = false;
let scene = 1;
let ticking = false;
let ready = false;

/* 상태를 밖으로 내보내는 함수는 두지 않는다. 화면은 이 모듈에 **명령만** 하고
   (unlock · scene · sfx · tick) 상태는 여기서만 산다. 헤드리스로 확인할 때는
   `window.Audio` 를 감싸 만들어진 element 의 src·volume·loop 을 읽으면 된다 —
   확인용 통로를 배포 코드에 남기면 그게 다음 사람의 API 가 된다. */

function store(): void {
  try {
    localStorage.setItem(LS.bgm, String(bgmVol));
    localStorage.setItem(LS.sfx, String(sfxVol));
    localStorage.setItem(LS.muted, String(muted));
  } catch { /* 막힌 브라우저 — 이번 수업 동안만 기억한다 */ }
}

function load(): void {
  try {
    const b = localStorage.getItem(LS.bgm);
    const s = localStorage.getItem(LS.sfx);
    if (b !== null && isFinite(Number(b))) bgmVol = clamp(Number(b));
    if (s !== null && isFinite(Number(s))) sfxVol = clamp(Number(s));
    muted = localStorage.getItem(LS.muted) === 'true';
  } catch { /* 막힌 브라우저 */ }
}

function clamp(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }

/**
 * 준비. **소리를 내지는 않는다** — 사용자 동작 전이라 어차피 막힌다.
 * mp3 는 여기서 미리 받아 둔다. 라운드 시작 버튼을 누른 뒤에 받기 시작하면
 * 카운트다운이 끝나도록 주사위 소리가 안 난다 (교실 와이파이는 느리다).
 */
export function audioInit(): void {
  if (ready) return;
  ready = true;
  load();

  bgmEl = new Audio(BGM_SRC);
  bgmEl.loop = true;
  bgmEl.preload = 'auto';
  bgmEl.volume = 0;              // 실제 볼륨은 켜는 순간 applyVolume() 이 넣는다

  tickEl = new Audio(TICK_SRC);
  tickEl.loop = true;
  tickEl.preload = 'auto';
  tickEl.volume = 0;

  for (const k of Object.keys(SFX) as SfxName[]) {
    const a = new Audio(SFX[k]);
    a.preload = 'auto';
    pool.set(k, a);
  }
}

function applyVolume(): void {
  if (bgmEl) bgmEl.volume = muted ? 0 : clamp(bgmVol * scene);
  // 초침은 효과음이지만 계속 울리므로 조금 낮춘다 (생명 마블과 같은 0.8 배)
  if (tickEl) tickEl.volume = muted ? 0 : clamp(sfxVol * 0.8);
}

/**
 * 첫 사용자 동작 뒤에 BGM 을 켠다. 여러 번 불러도 안전하다.
 *
 * ⚠️ 이 함수는 **클릭 처리 안에서** 불려야 한다. setTimeout 으로 미루면 브라우저가
 *    "사용자 동작"으로 안 쳐서 그대로 막힌다.
 */
export function audioUnlock(): void {
  audioInit();
  if (muted || playing || !bgmEl) return;
  applyVolume();
  const p = bgmEl.play();
  if (p && typeof p.then === 'function') {
    playing = true;
    p.catch(() => { playing = false; });   // 막혔다 — 다음 클릭에 다시 시도한다
  } else {
    playing = true;
  }
}

/**
 * 단계가 바뀌었다. 경주는 크게, 토론은 작게 (§4-4).
 * ⚠️ 토론이 조용해야 한다는 건 이 게임의 설계 그 자체다 (MIGRATION §1) — 배수를 올리지 말 것.
 */
export function audioScene(phase: string): void {
  const g = SCENE_GAIN[phase] ?? 1;
  if (g === scene) return;
  scene = g;
  applyVolume();
}

/** 효과음 한 번. 겹쳐 나야 하므로 사본을 만들어 튕긴다 (원본 audio.js 와 같은 수법) */
export function sfx(name: SfxName): void {
  if (muted || !ready) return;
  const src = pool.get(name);
  if (!src) return;
  const clone = src.cloneNode() as HTMLAudioElement;
  clone.volume = clamp(sfxVol);
  const p = clone.play();
  if (p && typeof p.then === 'function') p.catch(() => { /* 아직 사용자 동작 전이다 */ });
}

/**
 * 마감 10초 전 초침. `on` 이 바뀔 때만 실제로 만진다 —
 * 매 초 `play()` 를 다시 부르면 소리가 처음으로 되감겨 딸꾹질한다.
 */
export function audioTick(on: boolean): void {
  if (!tickEl || on === ticking) return;
  ticking = on;
  if (on && !muted) {
    tickEl.currentTime = 0;
    applyVolume();
    const p = tickEl.play();
    if (p && typeof p.then === 'function') p.catch(() => { /* 사용자 동작 전 */ });
  } else {
    tickEl.pause();
  }
}

// ────────────────────────────────────────────────────────────
// 🎵 패널
// ────────────────────────────────────────────────────────────

let panel: HTMLElement | null = null;

/**
 * 🎵 버튼에 볼륨 패널을 붙인다. 패널 마크업은 **여기서 한 벌만** 만든다 —
 * teacher.html 에 복사해 두면 한쪽만 고쳐지는 날이 온다 (MIGRATION §5 '사본' 함정).
 *
 * ⚠️ 패널은 TV 화면 위에 뜬다. 열어 두면 경주를 가리므로 바깥을 누르면 닫힌다.
 */
export function audioPanel(btn: HTMLElement): void {
  audioInit();
  if (panel) return;

  const el = document.createElement('div');
  el.id = 'vol-panel';
  el.className = 'hidden';
  el.innerHTML =
    '<div class="vp-row"><button class="vp-mute" id="vp-mute" title="음소거">🔊</button>' +
    `<span class="vp-track">♪ ${BGM_NAME}</span></div>` +
    '<label class="vp-row"><span class="vp-lbl">BGM</span>' +
    '<input type="range" id="vp-bgm" min="0" max="1" step="0.05"></label>' +
    '<label class="vp-row"><span class="vp-lbl">효과음</span>' +
    '<input type="range" id="vp-sfx" min="0" max="1" step="0.05"></label>';
  document.body.appendChild(el);
  panel = el;

  const bgmIn = el.querySelector('#vp-bgm') as HTMLInputElement;
  const sfxIn = el.querySelector('#vp-sfx') as HTMLInputElement;
  const mute = el.querySelector('#vp-mute') as HTMLButtonElement;

  const paint = (): void => {
    bgmIn.value = String(bgmVol);
    sfxIn.value = String(sfxVol);
    mute.textContent = muted ? '🔇' : '🔊';
    // ⚠️ 아이콘만으로 뜻을 전하지 않는다 — 버튼에 상태 글자도 싣는다 (§11-1)
    mute.setAttribute('aria-label', muted ? '음소거 해제' : '음소거');
    btn.textContent = muted ? '🔇' : '🎵';
  };
  paint();

  bgmIn.addEventListener('input', () => {
    bgmVol = clamp(Number(bgmIn.value));
    applyVolume();
    store();
  });
  sfxIn.addEventListener('input', () => {
    sfxVol = clamp(Number(sfxIn.value));
    applyVolume();
    store();
  });
  mute.addEventListener('click', (e) => {
    e.stopPropagation();
    muted = !muted;
    applyVolume();
    if (muted) {
      if (bgmEl) bgmEl.pause();
      if (tickEl) tickEl.pause();
      playing = false;
      ticking = false;
    } else {
      audioUnlock();
    }
    store();
    paint();
  });

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    el.classList.toggle('hidden');
    paint();
  });
  el.addEventListener('click', (e) => e.stopPropagation());
  // 바깥을 누르면 닫는다 — 열어 둔 패널이 트랙을 가리면 8m 밖에서 경주가 안 보인다
  document.addEventListener('click', () => el.classList.add('hidden'));
}
