# 와일드 더비 — 실시간 웹앱 이전 지침서

> 이 문서 하나로 이전을 끝낼 수 있게 썼습니다. **먼저 전부 읽고 시작하세요.**
> 특히 §4(불변식)를 모르면 통과하는 코드를 쓰고도 게임을 망가뜨립니다.

읽는 순서: §1 물건 이해 → §4 불변식 → §6 목표 구조 → §10 결정된 것 → §7 작업 단계 → (4단계 전에) §11 연출

---

## 1. 이게 무슨 물건인가

고2 생명과학 **수업 한 차시**에서 쓰는 베팅형 보드게임입니다. 웹 서비스가 아닙니다.
선생님 한 명이 자기 반들에서만 씁니다.

**한 판의 흐름**

1. 선생님이 교사 화면에서 판을 만든다 → **판 코드 4자리**가 나온다 (칠판에 적는다)
2. 모둠(5~6개)이 폰으로 접속 → 판 코드 + 모둠 번호 + **모둠 암호 4자리**
3. 라운드가 5~6번 돈다. 한 라운드는 약 7분:

```
경주 20초 → 문제 풀이 90초 → 모둠 토론 180초 → 베팅 60초
```

> 앱스 스크립트판에는 '경주' 단계가 **없습니다** — 말이 1초 만에 옮겨지고 바로 문제가
> 시작됩니다. 새 구현에서는 `moving` 단계를 진짜로 넣습니다 (§8-3, §11). 사용자 결정.

4. 문제를 맞히면 **순위 힌트**를 받는다 ("치타는 1·2·3등 안에 반드시 듭니다")
5. 힌트를 모아 1·2·3등을 추리하고 동물에 코인을 건다 (라운드당 최대 3개)
6. 마지막에 정산 — 1등 100% / 2등 70% / 3등 50% 배당

**이 수업의 실체는 토론 180초입니다.** 그동안 학생 화면은 힌트 탭이 열리고 베팅이
잠깁니다. 조작할 게 없어야 서로 이야기하기 때문입니다. 문제 풀이는 힌트를 얻는
수단일 뿐입니다. 어떤 설계 판단이 애매하면 **"모둠이 이야기하게 되는가"**로 결정하세요.

배경 문서: `docs/planning/10-desire-map.md`(왜 이렇게 됐는지), `01-prd.md`, `02-trd.md`

---

## 2. 왜 옮기는가 (정직하게)

**속도 때문이 아닙니다.** `02-trd.md` §2가 실시간을 미룬 근거는 지금도 맞습니다 —
"모둠이 폰에서 베팅을 누르고 고개 들어 TV를 보는 데 이미 2초가 걸리므로,
1~2초와 0.1초는 교실에서 구분되지 않는다."

실제 이유:

| | |
|---|---|
| 배당판이 폴링에 묶여 있다 | 돈이 어디로 몰리는지 **살아 움직여야** 판이 산다. 2초마다 툭툭 바뀌면 죽은 표다 |
| 앱스 스크립트 실행 한도 | 6모둠 × 2초 폴링이 계속 갉아먹는다 |
| 배포·디버깅 | 지금은 `clasp push` 후 편집기에서 확인. 정상적인 개발 흐름이 아니다 |
| 구글 계정 의존 | 문제은행이 시트에 있어 계정에 묶인다 |

⚠️ **`02-trd.md`는 이 이전과 어긋납니다.** §3이 React·npm 빌드를 "의도적으로 안 쓰는 것"
으로, `.stargate/state.json`의 `wont`가 "실시간 푸시"를 못박아 뒀습니다.
**그 문서를 근거로 이 이전에 반대하지 마세요.** 사용자가 방향을 바꿨습니다.
당시 판단은 "지금 Firebase를 붙일 이유가 없다"였지 "영원히 안 간다"가 아니었습니다.

---

## 3. 지금 어디까지 왔나

```
apps-script/     ← 지금 실제로 배포돼 수업에 쓰이는 것. 절대 건드리지 마세요
web/             ← 새 구현. 규칙만 옮겨진 상태
```

**끝난 것**

- `web/src/game/rules.ts` — 규칙 전부 (`apps-script/Game.gs` 이식). 순수 함수
- `web/src/game/config.ts`, `types.ts` — 상수와 상태 타입 (+ `moveSeconds`, `MESSAGES`)
- `web/src/game/views.ts` — 뷰 **한 벌** (`teamView`·`teacherView`·`lobby`·`handout`·`reveal`·`finalize`)
- `web/src/do/room.ts` — 방 코어. 런타임 비의존, 인증·단계 기계·이벤트 로그·`restore`
- `web/src/do/GameRoom.ts` — Durable Object 어댑터 (hibernation WebSocket · `alarm()` · `/op`)
- `web/src/server/` — 공개 HTTP API. 라우터는 `env` 를 모르고 포트만 안다 (§8-1b)
- `web/src/do/ops.ts` — 이름표(dispatch) + 암호 연속 실패 잠금. Worker 와 소켓이 같은 걸 쓴다
- `web/migrations/` — D1 스키마 + 시드(54문항·동물 8·설정 8). `scripts/import-questions.ts` 가 만든다
- `web/src/client/` — 교사·학생 화면. 프레임워크 없음, Vite 번들, 소켓 푸시 + 재연결
- `web/src/server/admin.ts` + `src/client/admin.html`·`admin/` — 문제은행 관리 화면과 그 API.
  시트의 '문제'·'동물'·'설정' 탭과 `validateSheets` 메뉴를 대신합니다 (5단계)
- `web/test/harness.ts` — 게이트가 쓰는 인메모리 포트 한 벌 (`gateway.ts`·`admin.ts` 가 같이 씀)
- `web/test/gates.ts` 17 · `parity.ts` 14 · `room.ts` 32 · `gateway.ts` 23 · `admin.ts` 8 · `qr.ts` 10 · `race.ts` 9

**남은 것** — §7에 단계별로 있습니다. 배포(6단계)

**검사 현황**

```bash
npm test              # web/ — 타입 검사 3벌 + 게이트 17 + 대조 14 + 방 32 + 게이트웨이 23 + 관리 8 + QR 10 + 경주 9
npm run dev           # web/ — vite build 후 wrangler dev (먼저 d1 migrations apply --local)
cd .. && npm test     # apps-script/ — 62개 (이전 중에도 계속 통과해야 함)
```

---

## 4. 절대 깨면 안 되는 것

여기를 어기면 **테스트는 통과하는데 수업이 망가집니다.** 각 항목에 지키는 게이트를 적었습니다.

### 4-1. 정답은 정산 전에 어떤 응답에도 담기지 않는다

화면에서 숨기는 게 아니라 **보내지 않습니다.** 개발자 도구로 훔쳐보는 걸 막기 위함입니다.

- `state.truth`(정답 순위)와 `state.moves`(이동 계획)는 `isOver`가 참이기 전까지 나가면 안 됩니다
- `state.lastRound`도 마찬가지 — 마지막 라운드를 알면 언제 골인하는지 역산됩니다
- 교사가 '정답 공개'를 누르면 그때 **따로** 부릅니다 (`gwReveal`). 상시 응답에 싣지 마세요
- 지키는 게이트: `H4`, `H4b`, `H4e`, `SEC6`, `SEC7`, `H4c`, `H4d`

### 4-2. 순위를 먼저 정하고 이동을 역산한다

PDF 원본은 순위를 정해놓고 이동은 따로 랜덤으로 굴렸습니다. 그러면 "A가 1등"이라는
힌트를 뿌려놓고 A가 5등으로 들어오는 판이 나옵니다. **힌트가 거짓말이 되면 게임이
성립하지 않습니다.** `planRace()`가 이미 옳게 돼 있으니 건드리지 마세요.

- 지키는 게이트: `H1`, `H1b`, `H2`, `D1`

### 4-3. 모든 힌트는 참이어야 한다

`buildHints()`(학생이 읽는 문장)와 `buildHintPredicates()`(논리식)는 **한 줄씩 짝이
맞습니다.** 문장을 고치면 논리식도 같이 고쳐야 합니다. 안 그러면 게이트가 거짓말을
검증하게 됩니다.

- 지키는 게이트: `H2`, `H2b`, `H3-a`, `H3-b`

### 4-4. 판 코드는 비밀이 아니다

칠판에 적히고 QR로 배포됩니다. 교사 권한을 판 코드로 확인하면 안 됩니다.

| 무엇 | 어떻게 지키나 |
|---|---|
| 교사 화면 · 진행 · 정산 · 정답 · 모든 암호 | **교사 열쇠**(12자리). 판 만들 때 발급, 브라우저에 저장 |
| 모둠 행동 (답 제출 · 베팅 · 상태 조회) | **모둠 암호**(4자리). **매 호출마다** 확인 |

모둠 암호를 접속할 때만 확인하면 아무것도 못 지킵니다 — 모둠 번호는 1~6이라 찍으면 됩니다.

- 지키는 게이트: `SEC1`~`SEC11`

### 4-5. 같은 모둠에 같은 힌트를 두 번 주지 않는다

`hintGiven[모둠번호] = ['어려움#0', '어려움#3', ...]`로 관리합니다.
**저장소에서 상태를 복구할 때 이것도 같이 복구해야 합니다.** 앱스 스크립트판에서
정확히 이걸 빠뜨려 버그가 났습니다.

- 지키는 게이트: `D6`, `D6b`

### 4-6. 문항은 판 만들 때 다 배정하고 내용까지 굳힌다

라운드마다 그때그때 뽑으면 복구할 때 다른 문제가 나옵니다.
`questionPlan`(라운드→난이도→id)과 `questionById`(id→내용) 둘 다 상태에 넣으세요.

- 지키는 게이트: `D5`, `D5b`, `PERF1`, `PERF2`

### 4-7. 코인이 증발하면 안 된다

동시에 6모둠이 베팅합니다. 상태를 바꾸는 모든 경로가 직렬화돼야 합니다.
**Durable Object는 판마다 단일 스레드라 이게 공짜입니다** — 그래서 DO를 골랐습니다.
다만 `await` 사이에 다른 요청이 끼어들 수 있으니, 읽고→고치고→쓰기 사이에 `await`를
넣지 마세요.

- 지키는 게이트: `H5`, `RACE1`, `D2`, `D2b`

### 4-8. 규칙을 다시 유도하지 마라

`rules.ts`는 이미 옮겨졌고 원본과 **문자 하나까지 같음이 증명**돼 있습니다
(`parity.ts` — 같은 시드로 200판 비교, 힌트 논리식은 40320개 순열 전체 비교).
규칙이 이상해 보여도 고치기 전에 사용자에게 물으세요.

---

## 5. 오늘 실제로 밟은 함정들

새 구현에서 되풀이하기 쉬운 것들입니다.

| 함정 | 무슨 일이 났나 |
|---|---|
| **응답에 Date 객체** | 앱스 스크립트가 응답 전체를 실패시켜 화면이 통째로 비었다. JSON 직렬화 경계를 항상 의식할 것 |
| **읽기 경로에서 상태 쓰기** | 단계가 끝나는 순간 폴링이 낡은 상태를 덮어써서, 마감 직전 정답이 '미제출'로 바뀌었다 |
| **게이트가 사본을 검사** | 진짜 함수와 사본이 갈라져, 정답이 새는데 초록불이 켜졌다. 뷰 함수를 두 벌 만들지 말 것 |
| **설정값 미검증** | '90초' 같은 값이 NaN이 되어 타이머가 멎고, 시드 0이 배당률을 NaN으로 만들었다 |
| **`trackCells` 전역 참조** | '설정'의 트랙칸수를 12로 바꿔도 조용히 10칸이었다. **설정값을 전역 기본값으로 읽지 말고 인자로 넘길 것** (`rules.ts`는 이미 그렇게 고침) |
| **자동 changelog** | `.claude/changelog/`는 훅이 파일명 기반으로 쌓는 기계 문구다. 여기서 정보를 얻으려 하지 말 것 — git log를 볼 것 |

---

## 6. 목표 구조

### 대응표

| 앱스 스크립트 | 새 구현 |
|---|---|
| `doGet(?role=teacher)` | Worker 라우트 — 교사/학생 페이지 |
| `google.script.run` 8~16개 함수 | WebSocket 메시지 + HTTP 라우트 |
| `CacheService` (6시간) | Durable Object 메모리 |
| `LockService` | **불필요** — DO가 판마다 단일 스레드 |
| `게임` 시트 (상태 JSON 1행) | DO Storage |
| `기록` 시트 (이벤트 로그) | DO Storage (복구용 — DO는 안 날아가지만 감사 로그로 유지) |
| `문제`·`동물`·`설정`·`힌트문구` 시트 | **D1** (판 간 공유 데이터) |
| 2초 폴링 | WebSocket 푸시 |
| `autoAdvance` (읽을 때 게으르게) | **DO `alarm()`** — 아래 참조 |

### DO 알람이 바꾸는 것

앱스 스크립트에는 타이머가 없어서, 단계 전환을 "누가 상태를 읽을 때 시간이 지났으면
그때 넘긴다"로 처리했습니다. 이게 §5의 경합 버그를 낳았습니다.

**DO는 `storage.setAlarm()`으로 진짜 예약 실행이 됩니다.** 단계가 끝나는 시각에 알람을
걸어두면 전환이 하나의 사건이 되고, 경합 자체가 사라집니다. 이게 이전의 진짜 이득
중 하나입니다.

### 배치

```
web/
  src/
    game/          ← 완료. 순수 규칙. 여기에 I/O 를 넣지 마세요
    do/            ← GameRoom Durable Object (상태·알람·WebSocket)
    server/        ← Worker 라우트, 인증, D1 접근
    client/        ← 교사·학생 화면
  test/
```

**`src/game/`에는 저장소도 시각도 통신도 들어가면 안 됩니다.** 이 분리가 이번 이식을
가능하게 한 이유이고, 다음 이전도 가능하게 합니다.

### 화면

`apps-script/Teacher.html`(586줄)·`Team.html`(351줄)·`Shared.html`(145줄)은
**프레임워크 없는 순수 HTML/CSS/JS**입니다. 서버 호출부만 바꾸면 거의 그대로 삽니다.

특히 최근에 손본 연출은 그대로 가져오세요 — 트랙 애니메이션, 배당판(판돈 막대 + ▲▼),
베팅 칩 쌓기, `prefers-reduced-motion`. 주석에 "되돌리면 안 되는 이유"가 적혀 있습니다.
예: 레인 DOM은 판이 바뀔 때만 짓습니다 — 매번 `innerHTML`로 갈면 말이 순간이동합니다.

**프레임워크는 쓰지 않습니다** (사용자 결정, 2026-09-05). 대신:

- **TV 경주 트랙만 PixiJS 무대**(Canvas/WebGL)로 새로 그립니다. 카메라·먼지·슬로우·사진판정이
  CSS 로는 안 되기 때문입니다. PixiJS 는 npm 으로 받아 **번들에 넣습니다** — CDN 금지
  (학교망). 배당판·모둠 현황·폰 화면은 기존 HTML 구조를 유지하고 연출만 강화합니다 (§11)
- 클라이언트 빌드는 **Vite** 하나. Worker 는 wrangler 가 번들합니다. 결과물은 Worker 의
  정적 자산(`assets`)으로 같은 출처에서 서빙합니다
- 화면이 "역동적"이어야 한다는 요구는 §11 에 장면 단위로 적었습니다. 기술이 아니라
  **어느 순간을 어떻게 극화하는가**가 답입니다

---

## 7. 작업 단계

각 단계는 **중간에 멈춰도 손해가 없게** 잘려 있습니다. 완료 판정을 못 채우면 다음으로
가지 마세요.

### 1단계 — 규칙 이식 ✅ 완료

### 2단계 — 저장·동시성 (Durable Object) ✅ 완료

`src/do/room.ts`(코어) + `src/do/GameRoom.ts`(어댑터) + `test/room.ts` 32개.
아래는 당시의 요구였고 전부 반영됐습니다. 원본과 다르게 한 점은 `room.ts` 머리 주석에 있습니다.

- `GameRoom` DO: 판 코드 하나 = 인스턴스 하나
- 상태 모양은 `src/game/types.ts`의 `GameState` 그대로
- 단계 전환을 `alarm()`으로. 전이 규칙은 §8-3 **새 구현** 그림 (`moving` 포함)
- 이벤트 로그는 감사·복구용으로 유지 (형식은 §8-4)
- ⚠️ 힌트 복구(`hintGiven`)를 빠뜨리지 마세요 — §4-5

**완료 판정**: 판 생성 → 6모둠 접속 → 6라운드 진행 → 정산까지 도는 통합 테스트가
`test/`에 있고 통과. 앱스 스크립트판 게이트 `SIM1`~`H9c`, `H5`, `BUG1`, `RACE1`, `D6b`에
대응하는 것이 전부 있을 것.

### 3단계 — 게이트웨이와 인증 ✅ 완료

`src/server/`(ports·router·bank·db·index) + `src/do/ops.ts`(이름표 + 암호 잠금) +
`migrations/`(D1 스키마·시드) + `scripts/import-questions.ts` + `test/gateway.ts` 23개.
라우트 표는 **§8-1b**. 아래는 당시의 요구였고 전부 반영됐습니다.

- §8-1의 16개 함수를 WebSocket 메시지 / HTTP 라우트로 옮긴다
- 교사 열쇠 · 모둠 암호 (§4-4). **모둠 암호는 매 호출 확인**
- ⚠️ **DO 의 `POST /op` 는 공개 경로가 아닙니다.** 2단계 스텁 Worker 는 `/room/:code/op` 를 그대로
  DO 로 넘기는데, 그러면 누구나 `create` 를 부를 수 있습니다. 3단계에서 Worker 가 **자기 라우트**를
  두고 DO 는 내부에서만(`stub.fetch` 또는 RPC) 부르게 하세요. 판 생성은 Worker 만 합니다
  (문제은행·코드 중복 확인이 거기 있습니다). 소켓으로 오는 `create` 는 이미 거부됩니다
- 교사 열쇠 회수 경로: **관리자 비밀번호**로 조회합니다 (사용자 결정, §10).
  배포 시 `ADMIN_PASSWORD` 를 wrangler secret 으로 넣습니다. 교사 화면 '이어하기'에서
  판 코드 + 관리자 비밀번호 → 열쇠. 비교는 상수 시간으로. 5단계 문제은행 관리도 같은
  비밀번호를 씁니다 — 계정 시스템은 만들지 않습니다
- '최근 판' 목록(이어하기)은 시트가 없으니 **D1 `games` 표**에 판 생성 시 한 줄 넣어 만듭니다
  (코드·반 이름·단원·생성 시각). 상태 자체는 DO 에 있고, 이 표는 목록용입니다

**완료 판정**: `SEC1`~`SEC11`에 대응하는 게이트가 전부 통과. 그리고 **수정 전 코드에
돌려 실제로 실패하는지 확인**할 것 — 통과만으로는 게이트가 진짜인지 모릅니다.

### 4단계 — 화면 (4a ✅ 완료 · 4b ✅ 완료)

`src/client/`(index.html 학생 · teacher.html 교사 · shared/ 소켓·시계·봉투·QR) + Vite 빌드 +
Worker `assets`. 4a·4b 모두 헤드리스 Chrome 두 탭으로 한 판을 끝까지 돌려 확인했습니다.

- 기존 HTML 이식, 폴링을 WebSocket 구독으로 교체
- 배당판이 실시간으로 움직이는 것이 이 이전의 눈에 보이는 성과입니다
- 연결이 끊기면 재연결 + 상태 재동기화. 교실 와이파이는 끊깁니다
- **§11 연출 설계를 구현합니다.** 경주 무대(PixiJS)·라이브 배당판·정산 드럼롤·폰 미니 경주.
  4단계는 둘로 자릅니다 — **4a** 기능 이식(연출 없이 WebSocket 으로 한 판 도는 것),
  **4b** 연출. 4a 없이 4b 를 시작하지 마세요

4b 에서 더해진 것 (전부 `src/client/` 안):

| 파일 | 하는 일 |
|---|---|
| `shared/race.ts` | 경주 **안무 순수 함수** (`raceFrame`·`racePhase`). **TV 와 폰이 이것 하나를 같이 쓴다** |
| `shared/rng.ts` | mulberry32 + FNV-1a. 시드는 `판코드:라운드` (§11-2) |
| `shared/theme.ts` | 캔버스가 쓰는 색값 한 벌 (CSS 변수를 캔버스가 못 읽는다) |
| `teacher/stage.ts` | PixiJS 경주 무대. **동적 `import()` 로만 부른다** — 학생 번들에 pixi 가 들어가면 안 된다 |
| `team/mini.ts` | 폰 미니 트랙 (Canvas 2D, pixi 없음) |
| `shared/clock.ts` `elapsed()` | 진행률을 **ms 로** 잰다. `progress()` 를 뒤집으면 초 단위로 튄다 |
| `test/race.ts` | 게이트 9개 — `RACE-END`·`START`·`MONO`·`BOUND`·`DET`·`ZERO`·`SHAKE`·`PHASE`·`SEED` |

**완료 판정**: 브라우저 2개(교사·모둠)로 한 판을 끝까지 돌려볼 것.
`prefers-reduced-motion`에서도 게임이 그대로 돌 것. TV 와 폰에서 **같은 경주**가 보일 것
(§11-2 시드).

⚠️ 회귀를 부르기 쉬운 두 곳:
- `stage.ts` 를 정적 import 로 바꾸면 **학생 폰 번들에 PixiJS 가 실린다.**
  `npm run build` 뒤 `grep -l -i pixi dist/client/assets/*.js` 가 `stage-*` 계열만 나와야 합니다
- `race.ts` 의 `SEGMENTS` 를 1 로 되돌리면 경주가 등속이 되어 순위 흔들림이 사라집니다
  (`RACE-SHAKE` 가 잡습니다)

### 5단계 — 문제은행 관리 화면 ✅ 완료

`src/server/admin.ts`(라우트) + `src/client/admin.html`·`admin/main.ts`·`admin/admin.css`(화면) +
`test/admin.ts` 게이트 8개. 라우트 표는 **§8-1b**. 아래는 당시의 요구였고 전부 반영됐습니다.

- ~~시트에서 한 번 가져오는 경로~~ — 3단계에서 끝났습니다. `scripts/import-questions.ts` 가
  `apps-script/` 를 읽어 `migrations/0002_seed.sql`(54문항 + 동물 8 + 설정 8)을 만듭니다
- 문제 CRUD, 단원별 보기, 난이도별 개수 검증 (`validateSheets`가 하던 일)
- 인증은 **관리자 비밀번호 하나** (사용자 결정, §10). 3단계와 같은 `ADMIN_PASSWORD`.
  브라우저는 `sessionStorage` 에 두고 **매 요청 헤더로** 싣습니다 — 서버는 매 호출 확인합니다.
  세션·쿠키·토큰을 만들지 않았습니다

더해진 것 / 알아둘 것:

| | |
|---|---|
| 별도 진입점 | `admin.html` 은 Vite input 이 따로다. **수업용 교사 번들에 관리 코드가 없다** — `npm run build` 뒤 `grep -l "api/admin/questions" dist/client/assets/*.js` 가 `admin-*` 만 내놔야 한다 |
| 화면에 상수를 박지 않는다 | 난이도·설정 범위·동물 코드는 전부 서버 응답에 실려 온다 (`levels`·`ranges`·`codes`). 화면에 박으면 `config.ts` 를 고친 날 화면만 옛 값을 안내한다 (§5 `trackCells` 함정) |
| 검사는 한 벌 | 동물 8줄은 `bank.ts` 의 `checkAnimals`, 설정 범위는 `room.ts` 의 `normalizeSettings` — **판을 만들 때 쓰는 그 함수**다 |
| 설정만 다르게 군다 | 판 만들 때는 범위 밖 값을 되돌리고 알리지만(수업이 멈추면 안 되니까), 관리 화면에서는 **저장하지 않고 거절**한다. 틀린 값을 표에 남길 이유가 없다 |
| 안내문 | "여기서 고친 것은 **새로 만드는 판**부터" 를 화면 상단에 고정했다. 없으면 "고쳤는데 왜 옛날 문제가 나오냐"가 반드시 나온다 (§4-6). 게이트 `ADM-GAME` |
| ⚠️ 비밀번호는 ASCII 만 | HTTP 헤더 값은 Latin-1 만 싣는다. **한글·이모지가 든 관리자 비밀번호는 브라우저가 보내지도 못한다** — 화면이 보내기 전에 걸러 이유를 말한다. 교사 화면 '이어하기'의 열쇠 되찾기도 같은 헤더를 쓰므로 같은 제약이 있다 (거기는 아직 안내가 없다) |

**완료 판정**: 시트 없이 판을 만들어 끝까지 돌 것. ✅
(로컬 D1 만으로 `/admin` 로그인 → 건강 표 → 문항 추가·수정·삭제 → 동물 이름 교체 →
설정 저장까지 헤드리스 Chrome 으로 확인했습니다)

### 6단계 — 배포 (사용자가 직접)

Cloudflare 계정이 필요합니다 (무료 플랜으로 충분). 코드는 전부 준비돼 있고, 아래는
**계정이 있는 사람만 할 수 있는 일**입니다.

```bash
cd web
npx wrangler login
npx wrangler d1 create wilde-derby
#   → 출력의 database_id 를 wrangler.jsonc 의 "database_id" 자리(지금은 0000…)에 붙여넣기
npx wrangler d1 migrations apply wilde-derby --remote   # 스키마 + 시드(54문항·동물 8·설정 8)
npx wrangler secret put ADMIN_PASSWORD                  # ⚠️ 영문·숫자·기호만 (아래 참조)
npm run build                                           # dist/client 가 없으면 deploy 가 안 뜬다
npx wrangler deploy
```

⚠️ **관리자 비밀번호에 한글·이모지를 넣지 마세요.** HTTP 헤더는 Latin-1 만 실을 수 있어
브라우저가 요청을 만들다 던집니다. 두 화면(관리·이어하기)이 보내기 전에 걸러 이유를
말하지만, 애초에 그런 비밀번호를 만들지 않는 것이 맞습니다.

**배포 뒤 선생님 폰으로 확인할 것** (순서대로):

1. 폰(학교 와이파이, LTE 끄고)에서 `https://<주소>/` 가 열리는가 — 학교망 차단이 가장 흔한 사고
2. 노트북에서 `/teacher` → 단원 3개가 드롭다운에 뜨는가 (안 뜨면 `migrations apply --remote` 누락)
3. 판 만들기 → 판 코드 + QR. **폰 카메라로 QR 을 비춰** 실제로 열리는가
4. 폰으로 접속 → 라운드 시작 → 경주 20초가 TV 와 폰에서 **같은 순서**로 보이는가
5. 문제 제출 → 힌트 → 베팅 → TV 배당판이 즉시 움직이는가
6. 폰 와이파이를 5초 껐다 켜기 → 배너가 뜨고 다시 붙어 상태가 맞는가
7. `/admin` → 관리자 비밀번호로 들어가지는가. `ADMIN_DISABLED` 가 뜨면 `secret put` 누락
8. `/admin` 에서 문항 하나를 고친 뒤 **새 판**에 그 문제가 나오는가 (도는 판은 안 바뀌는 게 정상)
9. 다른 기기에서 '판 코드로 이어하기' + 관리자 비밀번호로 열쇠가 회수되는가
10. 앱스 스크립트판은 **그대로 둡니다.** 한 학기 같이 쓰고 나서 버립니다

선택: 관리자 비밀번호 브루트포스는 서버에 카운터가 없습니다(Worker 는 아이소레이트가
여럿이라 정확히 셀 수 없음). 비밀번호를 길게 잡고, 원하면 Cloudflare 대시보드의
Rate Limiting 규칙으로 `/api/admin/*` 를 거세요.

---

## 8. 참조

### 8-1. 게이트웨이 계약 (현재 앱스 스크립트판)

⚠️ `docs/planning/02-trd.md` §4에는 8개로 적혀 있는데 **실제 코드는 16개입니다.**
문서가 낡았습니다. 아래가 진짜입니다 (`apps-script/Code.gs`).

**교사 열쇠 필요**

```
gwCreateGame(config)           → { code, hostKey, pins, teams, studentUrl, qr, warnings }
gwHandout(code, hostKey)       → { code, studentUrl, qr, pins, teams }
gwAdvanceRound(code, hostKey)  → teacherView
gwTogglePause(code, hostKey)   → teacherView
gwFinalize(code, hostKey)      → { finalOrder, animals, emojis, odds, settlement }
gwReveal(code, hostKey)        → { truth, animals, emojis }
gwGetState(code, 'teacher', hostKey)  → teacherView
```

**모둠 암호 필요**

```
gwGetState(code, 'team:N', null, pin)      → teamView
gwChooseLevel(code, teamNo, level, pin)    → { level, question }
gwSubmitAnswer(code, teamNo, level, choice, pin) → { correct, answer, explanation, newHint }
gwPlaceBet(code, teamNo, bets, pin)        → teamView
```

**인증 없음** (게임 비밀을 담지 않음)

```
gwJoinGame(code, teamNo, pin)  → teamView      (여기서 암호를 처음 맞춰본다)
gwLobby(code)                  → { className, teams: [{no, name}] }
gwListUnits()                  → { units, recent, recentError }
gwPrepare(unit)                → { blocking, warnings, units }
gwVersion() / gwDiagnose()
```

응답 봉투: `{ ok: true, data }` 또는 `{ ok: false, error, message }`.
`error`는 코드(`NOT_HOST`, `WRONG_PIN`, `BET_CLOSED` …), `message`는 학생이 읽을 한국어.

### 8-1b. 새 구현 — HTTP 라우트 (3단계에서 만든 것)

봉투는 위와 같습니다. **화면은 HTTP 상태가 아니라 `error` 코드로 분기합니다** —
상태 코드는 로그를 읽는 사람과 프록시를 위한 것입니다 (`src/server/router.ts` 의 `STATUS`).

인증은 헤더가 정본이고, POST 는 본문으로도 받습니다. ⚠️ 물음표 뒤(query)로는 받지 않습니다 —
주소는 로그·기록·어깨너머로 남습니다.

| 인증 | 헤더 | 본문 대체 |
|---|---|---|
| 교사 열쇠 | `X-Host-Key` | `hostKey` |
| 모둠 암호 | `X-Team-Pin` | `pin` |
| 관리자 | `X-Admin-Password` | (없음) |

| 경로 | 인증 | 입력 | 응답 `data` |
|---|---|---|---|
| `POST /api/game` | — ※ | `{className, unit, teamCount, teamNames?}` | `{code, hostKey, pins, teams, warnings, studentUrl}` |
| `POST /api/game/:code/handout` | 열쇠 | — | `handoutView` + `studentUrl` |
| `POST /api/game/:code/advance` | 열쇠 | — | `teacherView` |
| `POST /api/game/:code/pause` | 열쇠 | — | `teacherView` |
| `POST /api/game/:code/finalize` | 열쇠 | — | `finalizeView` (+ D1 `games.is_over=1`) |
| `POST /api/game/:code/reveal` | 열쇠 | — | `revealView` |
| `GET /api/game/:code/state?viewer=teacher` | 열쇠 | — | `teacherView` |
| `GET /api/game/:code/state?viewer=team:N` | 암호 | — | `teamView` |
| `POST /api/game/:code/join` | 암호 | `{teamNo, pin}` | `teamView` |
| `POST /api/game/:code/level` | 암호 | `{teamNo, level}` | `{level, question}` |
| `POST /api/game/:code/answer` | 암호 | `{teamNo, level, choice}` | `{correct, answer, explanation, newHint}` |
| `POST /api/game/:code/bet` | 암호 | `{teamNo, bets}` | `teamView` |
| `GET /api/game/:code/lobby` | 없음 | — | `{className, teams}` |
| `GET /api/units` | 없음 | — | `{units, recent, recentError}` |
| `GET /api/prepare?unit=X` | 없음 | — | `{blocking, warnings, units}` (`gwPrepare`) |
| `GET /api/version` | 없음 | — | `{v}` |
| `POST /api/admin/host-key` | 관리자 | `{code}` | `{code, hostKey}` |
| `GET /ws/:code` | (매 메시지) | 소켓 | `{type:'result'…}` · 푸시 `{type:'state', data}` |

**관리자 — 문제은행 (5단계).** 전부 `X-Admin-Password` 를 **매 호출** 요구합니다.
`ADMIN_PASSWORD` 가 없으면 전부 `ADMIN_DISABLED`, 틀리면 `ADMIN_DENIED` 입니다.

| 경로 | 입력 | 응답 `data` |
|---|---|---|
| `GET /api/admin/questions?unit=X` | `unit` 없으면 전부 | `{questions[], units[]}` |
| `POST /api/admin/questions` | `{unit, level, text, choices[4], answer, explanation}` | `{question}` |
| `PUT /api/admin/questions/:id` | 같음 | `{question}` · 없는 id → `NOT_FOUND` |
| `DELETE /api/admin/questions/:id` | — | `{id}` · 없는 id → `NOT_FOUND` |
| `GET /api/admin/animals` | — | `{animals[8], codes, blocking}` |
| `PUT /api/admin/animals` | `{animals[8]}` | 같음 (저장 후 상태) |
| `GET /api/admin/settings` | — | `{settings[], ranges, warnings}` |
| `PUT /api/admin/settings` | `{settings:{key:value}}` | 같음 · 범위 밖이면 `BAD_REQUEST` (**저장 안 함**) |
| `GET /api/admin/summary` | — | `{units:[{unit,counts,total,blocking,warnings}], levels, minPerLevel, animals}` |

⚠️ **문항 응답에는 정답과 해설이 들어 있습니다.** 이 모양을 다른 라우트에 재사용하지 마세요.
`GET /api/units`·`/api/prepare` 는 지금처럼 개수·경고만 내보냅니다 (게이트 `LEAK-ADMIN`).

⚠️ **확인은 `router.ts` 의 `adminDenied` 한 곳입니다.** `/api/admin/` 으로 시작하는 경로는
전부 그 문을 지납니다 — 라우트마다 따로 확인하면 새 라우트 하나에서 빠뜨리는 날이 옵니다.
`admin.ts` 안에는 비밀번호를 비교하는 코드가 없습니다.

⚠️ **비밀번호는 ASCII 여야 합니다.** HTTP 헤더 값은 Latin-1 바이트만 싣습니다 —
한글·이모지가 든 비밀번호는 브라우저가 요청을 만들다가 던집니다 (서버까지 가지도 않습니다).
관리 화면은 보내기 전에 걸러 이유를 말합니다.

※ 판 만들기에는 열쇠를 요구할 수 없습니다 — **열쇠를 발급하는 것이 이 호출**입니다.
앱스 스크립트판도 같았습니다(교사 화면을 여는 누구나 판을 만들 수 있었습니다).
가로막는 것은 열쇠가 아니라 **만들어도 아무 이득이 없다**는 사실입니다: 새 판은
자기 코드의 빈 판이고, 남의 판은 코드를 알아도 열쇠 없이는 아무것도 못 합니다.

⚠️ **`op` 는 어떤 공개 경로에도 없습니다.** Worker 는 GameRoom 의 **RPC 메서드**
(`stub.op(name, args)`)로만 방을 부릅니다. 2단계의 `/room/:code/op` 는 없앴습니다 —
그게 있으면 주소만 아는 누구나 `create` 로 아무 판이나 선점합니다 (게이트 `SEC13`).

⚠️ **암호 연속 실패 잠금** (`src/do/ops.ts`). 모둠 암호는 4자리(1만 가지)라 DO 를 계속
두드리면 6분이면 뚫립니다. **모둠 하나**당 연속 5회 실패하면 30초간 `TOO_MANY_TRIES` 입니다.
잠금은 **틀렸을 때만** 쌓이고 성공하면 지워지므로 제 암호를 쓰는 모둠은 이 코드를 만나지
않습니다. 잠긴 동안에는 맞는 암호도 막습니다 — "맞으면 통과"로 두면 잠금이 아무 일도 하지
않기 때문입니다 (게이트 `SEC14`). 감수하는 것: 다른 모둠 번호로 다섯 번 틀리면 그 모둠이
30초 멈춥니다. 4자리 암호를 지키는 값으로는 싸다고 봤습니다.

⚠️ **교사 열쇠는 잠그지 않습니다.** 12자리라 브루트포스가 안 되고, 잠그면 판 코드를 아는
학생 누구나 틀린 열쇠 다섯 번으로 **선생님의 진행·정산 버튼을 30초씩 얼릴 수** 있습니다
(게이트 `HOST-NOLOCK`). 검토에서 고친 것입니다.

### 8-2. 두 가지 뷰

- **`teamView`** — 자기 모둠 것만. 다른 모둠의 힌트·암호·코인 내역은 안 담김.
  `truth`·`moves`·`lastRound`는 `isOver`일 때만
- **`teacherView`** — 전체 현황. **`truth`는 `isOver`일 때만** (정산 전엔 `null`)

정확한 모양은 `web/src/game/views.ts`(타입까지)를 보세요. 원본은 `apps-script/Code.gs`.

새 구현이 두 뷰에 **덧붙인 것**:

- `phaseEndsAt`·`serverNow`·`phaseSeconds` — 화면이 타이머와 경주 진행률을 **서버 시각**으로
  계산하기 위한 것 (§11-2). `secondsLeft` 만으로는 늦게 들어온 폰이 다른 지점부터 봅니다
- `raceMoves` — `moving` 단계에서만. 이번 라운드 이동량 8개 (§8-3)
- `trackCells` — 두 뷰 모두. 화면이 10 으로 박아 두던 것을 막기 위해 (§5 함정). `roundStarted` 는
  교사 뷰에만 — 원본 `Code.gs` 에도 있었는데 2단계 이식에서 빠졌던 것
- 위치는 `roundStarted ? round : round-1` 라운드까지 반영 — 원본은 판 생성 직후부터
  1라운드 이동이 반영된 위치를 내보냈는데, 경주 단계가 생긴 지금은 스포일러라서 바꿨습니다

### 8-3. 단계 기계

앱스 스크립트판(현재):

```
waiting ──(교사가 라운드 시작)──> quiz(90초)
   ^                                 │ 시간 만료: 미제출을 timeout으로 기록
   │                                 v
   └──(베팅 마감, betLocked)──  betting(60초) <── discuss(180초)
```

새 구현 — **`moving` 단계를 넣습니다** (사용자 결정):

```
waiting ──(교사가 라운드 시작)──> moving(20초) ──> quiz(90초)
   ^                                                 │ 시간 만료: 미제출을 timeout 으로 기록
   │                                                 v
   └──(베팅 마감, betLocked)──  betting(60초) <── discuss(180초)
```

- `PHASES.MOVING`은 `config.ts`에 이미 있지만 앱스 스크립트판은 **어디서도 쓰지 않았습니다.**
  §1의 "경주 20초"는 화면 연출에 그친 것이었고, 이번에 서버 단계가 됩니다
- `moveSeconds`(기본 20, 범위 5~60)를 `DEFAULTS`·`SETTING_RANGE`에 추가합니다.
  `Settings` 타입이 바뀌므로 `rules.ts`의 시그니처는 건드리지 않되 컴파일이 되는지 확인
- ⚠️ **`moving` 동안 뷰에 넣는 것은 이번 라운드의 이동량만입니다** — `raceMoves[동물] = 0~3`.
  `state.moves` 전체(라운드×동물)를 보내면 미래가 새고 `lastRound`가 역산됩니다 (§4-1).
  이번 라운드의 이동량은 어차피 20초 뒤 위치로 드러나므로 비밀이 아닙니다.
  게이트로 지키세요 (`H4f`: moving 중 `teamView`에 `moves`·`truth`·`lastRound` 없음, `teacherView`에
  `moves` 없고 `truth`는 null, `raceMoves`는 두 뷰 모두 동물 8개 값만. `teacherView`의 `lastRound`는 원본대로 허용 — 열쇠로 보호됨)
- 일시정지: `pausedAt`을 찍고, 재개할 때 `phaseEndsAt`을 **멈춘 만큼 미룬다**. `moving` 중에도 같다
- 라운드 진행 여부는 **서버만 안다.** 화면이 "1라운드인가?"로 판단하면 무한 반복됩니다
  (`roundStarted` 플래그. 게이트 `BUG1`)
- 마지막 라운드(5 또는 6)는 판 생성 시 몰래 정해지고 학생에게 비공개

### 8-4. 이벤트 로그 형식

```
[번호, 판코드, 라운드, 모둠번호, 종류, JSON내용, 시각]
종류: 'answer' | 'bet' | 'round_start' | 'pause'
```

복구는 "스냅샷 + 그 뒤 이벤트 재생". 재생할 때 `hintGiven`도 복구해야 합니다 (§4-5).

### 8-5. 시트 구조 (D1로 옮길 것)

```
문제      단원 · 난이도 · 문제 · 보기1~4 · 정답(1~4) · 해설
동물      코드(A~H) · 이름 · 그림(이모지)      ← 정확히 8줄이어야 함
설정      항목 · 값 · 설명                     ← 범위 검증 필요 (SETTING_RANGE)
힌트문구  난이도 · 종류 · 문장틀                ← 참고용. 실제 힌트는 코드가 만든다
```

`apps-script/Questions.gs`에 생명과학 I 54문항(단원 3개 × 난이도별 6문항)이 있습니다.
그대로 가져오세요.

### 8-6. 게이트 전체 목록

`apps-script/` 62개 — 이전 중에도 계속 통과해야 합니다.

```
규칙   H1 H1b H2 H3-a H3-b H4 H4b H4e H9 D1 D2 D5 D5b D6 M6 M7 M9 CODE
통합   SIM1 SIM1b SIM2 SIM3 SIM4 H8 BUG1 D3 D6 D2b H5 H9b H1c H4c H4d H9c
보안   SEC1~SEC11
회귀   D6b RACE1 PERF1 PERF2 CFG1 CFG2 DATE WEBAPP
QR     QR-1~QR-9   ← 새 구현에선 라이브러리를 써도 됩니다
```

`web/` 113개 — `gates.ts` 17 + `parity.ts` 14 + `room.ts` 32 + `gateway.ts` 23 + `admin.ts` 8 + `qr.ts` 10 + `race.ts` 9.

관리 게이트 8개 (`test/admin.ts`):

```
ADM1 ADM2 ADM3 ADM4 ADM5 ADM6   비밀번호 · CRUD · 검사 · 동물 · 설정 · 건강 표
LEAK-ADMIN   관리자 라우트 밖 어떤 응답에도 answer·explanation 이 없다
ADM-GAME     고친 문항은 다음 판부터 — 이미 만든 판은 옛 문제 그대로 (§4-6)
```

---

## 9. 작업 규칙

1. **`apps-script/`를 건드리지 마세요.** 배포돼 있고 수업에 쓰입니다.
   거기 버그를 발견하면 고치지 말고 **사용자에게 보고**하세요
   (알려진 것: `trackCells` 설정이 무시됨 — §5)
2. **`npm test`가 양쪽 다 통과하는 상태로 커밋하세요** (`web/`과 루트)
3. **게이트를 추가하면 수정 전 코드에 돌려 실패하는지 확인하세요.**
   통과만으로는 그 게이트가 진짜 뭔가를 지키는지 모릅니다
4. **`parity.ts`가 깨지면 멈추고 사용자에게 물으세요.** 규칙이 갈라졌다는 뜻입니다
5. 주석은 **왜**를 적으세요. 이 코드베이스는 "되돌리면 무슨 일이 나는지"를 주석에
   적는 관습이 있습니다. 지키세요
6. 커밋 메시지는 한국어. 무엇을 고쳤는지가 아니라 **무슨 문제가 있었는지**를 적습니다
7. 막히면 물어보세요. 특히 §7의 ⚠️ 표시된 것들은 사용자 결정이 필요합니다

---

## 10. 결정된 것 (2026-09-05, 사용자)

2단계에 들어가기 전에 물었고, 답을 받았습니다. **다시 묻지 마세요.**

| 질문 | 결정 |
|---|---|
| 교사 열쇠 회수 경로 | **관리자 비밀번호**(`ADMIN_PASSWORD` secret)로 조회. 판 코드 + 비밀번호 → 열쇠 |
| 문제은행 관리 화면 인증 | **같은 관리자 비밀번호 하나.** 계정·로그인 시스템 없음. 서버는 매 호출 확인 |
| 화면 프레임워크 | **없음.** 경주 트랙만 **PixiJS 무대**, 나머지는 기존 HTML 유지 + 연출 강화. 빌드는 Vite |
| 경주 단계 | **서버에 `moving`(20초) 단계를 넣는다.** TV 와 폰이 같은 경주를 같은 시각에 본다 |

배경: 선생님 한 분이 자기 반에서 쓰는 앱입니다. 비밀번호 하나로 관리 권한을 여는 것이
계정 시스템보다 부품이 적고, "수업 중 고장을 혼자 고친다"는 제약에 맞습니다.

---

## 11. 연출 설계 — 사기경마처럼

사용자 요구: *"지금은 화면이 너무 심플하다. 더 지니어스 '사기경마'처럼 학생들이 흥미를
가질 만큼 역동적으로."* 이 프로젝트의 출발점 자체가 그 게임이었습니다 (`10-desire-map.md`).

역동성은 프레임워크가 아니라 **장면**이 만듭니다. 한 라운드에는 극화할 순간이 넷 있고,
나머지(토론 180초)는 **일부러 조용해야** 합니다 — §1 참조.

### 11-1. 원칙

- **연출은 거들 뿐.** `prefers-reduced-motion`이면 전부 꺼지고 결과만 즉시 보인다. 게임은 그대로 돈다
- **8m 가독성.** TV 화면의 연출이 글자를 가리면 실패. 숫자는 `tabular-nums`, 동물 순서 고정
- **색만으로 뜻을 전하지 않는다.** 레인 배지 번호·⭕❌ 를 유지
- **외부 자원 없음.** 글꼴·이미지·CDN 금지. PixiJS 는 번들. 말은 이모지를 텍스처로 굽는다
  ('동물' 설정의 이모지를 그대로 쓴다)
- **되돌리면 안 되는 이유**를 주석에 적는 관습을 지킨다. 기존 HTML 의 그런 주석은 살린다

### 11-2. 장면 1 — 경주 (moving, 20초, TV + 폰)

1. **출발 3초**: 라운드 번호가 화면 가운데 크게, 3·2·1 카운트다운, 게이트 열림
2. **질주 ~15초**: 말 8마리가 **서로 앞서고 뒤처지며** 달린다. 중간 순위가 계속 바뀌되,
   마지막 위치는 서버가 준 `raceMoves`(이번 라운드 이동량)에 정확히 맞아야 한다.
   먼지·속도선 파티클, 선두가 바뀔 때 짧은 카메라 흔들림, 골인하는 말이 있으면 슬로우 + 플래시
3. **정착 2초**: 최종 위치에 멈추고 순위 배지 대신 **골인 여부만** 표시 (정산 전 등수 비공개 — §4-1)

⚠️ **TV 와 폰이 같은 경주를 봐야 합니다.** 중간 순위 흔들림은 `판코드 + 라운드`로 시드를
만들어 결정적으로 생성하세요 (`rules.ts`의 시드 RNG 재사용). 각 화면이 따로 랜덤을 굴리면
폰에서는 사자가 앞서고 TV 에서는 치타가 앞서는 판이 나옵니다.

⚠️ **시간축은 서버 시각.** 애니메이션 진행률은 `(now - (phaseEndsAt - moveSeconds*1000)) / (moveSeconds*1000)`
로 계산해, 늦게 들어온 폰도 같은 지점부터 봅니다. 일시정지면 그 자리에서 멈춥니다.

폰에는 **미니 트랙**(같은 경주, 작은 크기)을 보여줍니다. 이 20초 동안 폰은 조작할 게 없습니다.

### 11-3. 장면 2 — 라이브 배당판 (betting, 60초, TV)

이 이전의 눈에 보이는 성과입니다. 폴링 2초가 아니라 **베팅이 확정되는 순간** 움직입니다.

- 코인이 걸리면 해당 동물 줄로 **칩이 날아와 쌓인다** (어느 모둠인지는 표시하지 않음 — 05 §4-3)
- 배당률은 **롤링 숫자**(odometer)로 바뀌고 ▲▼ 는 유지. 판돈 막대는 부드럽게
- 상단에 **"지금 걸린 코인 총합"** 큼직하게 카운트업
- 마감 10초 전: 타이머 붉게 + 펄스 (지금 있는 `urgent` 유지)
- **정렬하지 않는다.** 인기순으로 줄이 바뀌면 눈이 못 따라간다 (05 §4-2)

### 11-4. 장면 3 — 정산 (교사가 '정답 공개', TV)

지금은 표가 한 번에 뜹니다. 드럼롤로 바꿉니다.

1. 트랙이 어두워지고 스포트라이트가 **3등 → 2등 → 1등** 순서로 한 마리씩 비춘다 (각 2~3초)
2. 모둠별 코인이 **카운트업/다운**으로 바뀐다 (지금 폰에 있는 `coinPop` 감각을 TV 로)
3. 1위 모둠에 컨페티. 끝나면 지금의 결과표가 남는다 (인쇄·기록용)

`gwReveal` 한 번의 응답으로 클라이언트가 연출합니다. 서버는 연출을 모릅니다.

### 11-5. 장면 4 — 폰의 베팅 확정 (betting, 폰)

- 지금 있는 칩 쌓기·진동 유지. 확정 순간 **칩이 화면 위로 날아가며** 사라지고 "TV 를 보세요"
- 이 연출이 시선을 TV 로 올려 보낸다. 05 §1 의 "고개 들어 TV 를 본다"가 바로 이것

### 11-6. 하지 않는 것

- 소리 없음 (교실. 나중에 교사 토글로 검토)
- 토론 단계에 아무 연출도 넣지 않는다. 힌트 탭이 열리고 조용하다
- 실시간 "어느 모둠이 어디에 걸었나" 노출 없음 — 토론을 망친다
- 프레임워크 도입 없음
