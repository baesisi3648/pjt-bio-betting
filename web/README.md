# web — 실시간 웹앱 이전 작업

`apps-script/` 를 대신할 새 구현. **아직 수업에 쓰지 마세요** — 지금 돌아가는 것은
`apps-script/` 이고, 그쪽은 배포돼 있습니다.

## 왜 옮기나

앱스 스크립트판은 잘 돌아갑니다. TRD가 실시간을 미뤘던 근거("교실에서 1~2초와
0.1초는 구분되지 않는다")도 여전히 맞습니다. 그래서 이 이전의 목적은 **속도가 아닙니다.**

- 배당판이 폴링 2초에 묶여 있다 — 돈이 움직이는 게 실시간으로 보여야 판이 산다
- 6모둠 × 2초 폴링이 앱스 스크립트 실행 한도를 계속 갉아먹는다
- 배포·디버깅이 정상적인 개발 흐름이 된다 (지금은 clasp push 후 편집기에서 확인)
- 문제은행을 앱 안으로 들여 구글 계정 의존을 끊는다

## 스택

| | | 무엇을 대체하나 |
|---|---|---|
| Cloudflare Workers | 서버 | `doGet` · 게이트웨이 |
| Durable Objects | 판 하나당 하나 | `CacheService` + **`LockService`** |
| DO Storage | 영속 | `게임` 시트 + `기록` 시트 |
| D1 | 판 사이 공유 데이터 | `문제`·`동물`·`설정` 시트 + `게임` 목록 |
| WebSocket (hibernation) | 실시간 | 2초 폴링 |

**Durable Object 를 고른 이유**: 이 게임은 이미 "판 하나 = 상태 JSON 하나, 변경은
잠금 안에서 직렬화"로 설계돼 있습니다. DO 가 정확히 그 모양입니다 — 판마다 단일
스레드라 `withLock` 이 공짜로 사라집니다.

## 지금까지

- [x] **규칙 이식** — `src/game/rules.ts`. `Game.gs` 를 그대로 옮겼습니다
- [x] **게이트** — `test/gates.ts` 17개
- [x] ~~**이식 대조** — `test/parity.ts`~~ — **리뉴얼로 규칙이 갈라져 폐기(2026-09-06).** 20칸 10라운드·힌트 30개로 앱스 스크립트판과 대조할 것이 없어졌습니다 (`RENEWAL.md`)
- [x] **저장·동시성 (Durable Object)** — `src/do/room.ts`(방 코어)와 `src/do/GameRoom.ts`(DO 어댑터).
      뷰는 `src/game/views.ts` 한 벌뿐입니다. 통합 게이트 `test/room.ts` 32개
- [x] **게이트웨이 (교사 열쇠 · 모둠 암호 인증)** — `src/server/`. 라우트 표는 `MIGRATION.md` §8-1b.
      인증 자체는 `room.ts` 안에 그대로 있고, 여기서는 **옮기기만** 합니다
- [x] **D1 문제은행** — `migrations/0001_init.sql`(스키마) + `0002_seed.sql`(54문항·동물 8·설정 8).
      시드는 `scripts/import-questions.ts` 가 `apps-script/` 를 **읽어서** 만듭니다 (`npm run seed`)
- [x] **화면 — 기능 이식 (4a)** — `src/client/`. `apps-script/Teacher.html`·`Team.html`·`Shared.html`
      을 옮기고 폴링을 WebSocket 구독으로 바꿨습니다. 프레임워크 없음, 번들은 Vite,
      **외부 자원 0개**(QR 도 번들 안의 구현입니다 — `src/client/shared/qr.ts`, 게이트 `test/qr.ts`)
- [x] **화면** — `src/client/`. 프레임워크 없이 Vite 번들, 소켓 푸시 + 재연결. 경주 무대는 PixiJS
      (`teacher/stage.ts`, 동적 import 로 교사 번들에만), 폰 미니 트랙은 Canvas 2D. 두 화면이
      `shared/race.ts` 안무 하나를 같이 써서 같은 경주를 본다. 라이브 배당판·정산 드럼롤·칩 날리기 (MIGRATION §11)
- [x] **문제은행 관리 화면** — `src/server/admin.ts` + `src/client/admin.html`·`admin/` (`/admin`).
      시트의 '문제'·'동물'·'설정' 탭과 메뉴의 '시트 상태 확인'(`validateSheets`)을 대신합니다.
      인증은 관리자 비밀번호 하나 (`ADMIN_PASSWORD`), **매 호출 확인**. 게이트 `test/admin.ts`
- [x] **리뉴얼 1단계 — 규칙 엔진** (`RENEWAL.md` §5-1). 20칸 **10라운드** 경주 생성기
      (선두 2회 이상 교체 · 1위는 4라운드 이후에 첫 선두), 라운드×난이도로 짝지은 **힌트 30개**,
      **사기 라운드**(2~4 중 하나의 힌트 3개가 거짓), 골인 동물 베팅 금지(`BET_FINISHED`),
      난이도 '중간'→'보통', 시간 기본값 15/40/90/45초. `migrations/0005_renewal_levels.sql`
- [x] **리뉴얼 2단계 — 문제은행** (`RENEWAL.md` §3). '단원' → **문제 세트**
      (`migrations/0006_sets.sql` 이 `questions.unit`·`games.unit` 을 `set_name` 으로 RENAME —
      값은 그대로라 예전 단원 이름이 곧 세트 이름), **JSON 가져오기/내보내기**(§3-2 자체 형식,
      미리보기 → 추가·같은 이름 교체·전체 교체), 세트 이름 바꾸기·삭제,
      **세트 없이 = 전체 은행**으로 방 만들기, 문항 부족 기준 6 → **10**(라운드가 10개다).
      관리 화면은 `/admin` 그대로, 라우트 표는 아래 §3. 게이트 `test/admin.ts` 17개
- [ ] 리뉴얼 3~5단계 — 첫 화면·진행 화면·소리·마무리
- [x] **리뉴얼 3단계 — 애니멀 더비 브랜딩, 교사 첫 화면(방 제목·문제 세트·사기 스위치), 학생 접속·공지·골인 잠금**
- [x] **리뉴얼 4단계 — 5구획 진행 화면, 좌→우 20칸 잔디 무대·반전 이모지, 8카드·모둠 카드·라운드 진행표, BGM·효과음**
- [x] **리뉴얼 5단계 — 첫 판 가이드(/guide) 새 규칙으로**
- [ ] 배포

## 돌려보기

```bash
npm test         # 타입 검사 3벌 + 규칙 27 + 방 코어 46 + 게이트웨이 26 + 관리 17 + QR 10 + 경주 9 = 135
npm run room     # 방 코어만
npm run gateway  # 게이트웨이(HTTP 라우트 · 인증)만
npm run admin    # 문제은행 관리 라우트만
npm run qr       # 화면이 그리는 QR 이 실제로 디코드되는지만
npm run build    # 화면을 dist/client 로 (Vite)
npm run seed     # apps-script/ 를 읽어 migrations/0002_seed.sql 을 다시 만든다
```

**배포** — `main` 에 push 하면 Cloudflare Workers Builds 가 자동으로 빌드·마이그레이션·배포합니다
(`MIGRATION.md` §7 6단계). 로컬에서 직접 올리려면 `npm run build && npx wrangler deploy`.

**실제로 띄워보기** (로컬)

```bash
npx wrangler d1 migrations apply wilde-derby --local    # 0006 이 unit → set_name 을 바꿉니다
npm run dev                    # = npm run build && wrangler dev
                               #   ⚠️ dist/client 이 없으면 wrangler 가 뜨지 않는다
open http://localhost:8787/            # 학생 화면
open http://localhost:8787/teacher     # 교사 화면
open http://localhost:8787/admin       # 문제은행 관리 (관리자 비밀번호)
curl localhost:8787/api/version
curl -X POST -H 'content-type: application/json' \
     -H 'X-Admin-Password: <ADMIN_PASSWORD>' \
     -d '{"roomTitle":"2학년 3반","setName":"유전","teamCount":6}' \
     localhost:8787/api/game
# setName 을 빼거나 "" 로 보내면 **전체 은행**으로 만들어집니다 (RENEWAL §1)

curl localhost:8787/api/sets                                    # 세트 목록 (인증 없음, 개수만)
curl -H 'X-Admin-Password: <PW>' 'localhost:8787/api/admin/export?set=유전' -OJ   # JSON 내보내기
```

⚠️ **JSON 내보내기는 `<a href>` 로 열 수 없습니다.** 그 파일에는 정답과 해설이 전부 들어
있어서 관리자 비밀번호를 요구하고, 링크에는 헤더를 실을 수 없습니다. 관리 화면은 `fetch` 로
받아 `Blob` 으로 저장합니다 (게이트 `EXP2`).

관리자 비밀번호(`ADMIN_PASSWORD`)를 넣어야 열리는 경로:
`POST /api/game`(**판 만들기**), `POST /api/admin/host-key`(교사 열쇠 되찾기),
`/api/admin/*`(문제은행 · **판 지우기**). 전부 헤더 `X-Admin-Password` 를 **매 호출**
확인합니다 — 세션도 쿠키도 토큰도 없습니다.

**판은 영원히 남지 않습니다** (2026-09-07): 정산한 판은 정산 30일 뒤, 정산 안 하고 버려진
판은 생성 90일 뒤에 D1 줄과 Durable Object 상태(모둠 암호·정답·코인)가 **함께** 지워집니다.
매일 KST 03:00 에 도는 cron 이 하고, 교사 화면 '최근 판'의 🗑 로 지금 지울 수도 있습니다
(기간은 `src/server/cleanup.ts` 의 `RETENTION` 한 곳 · 자세히는 `MIGRATION.md` §7 '판 보존 기간').

**안 넣고 배포하면 맞는 값을 줘도 거부합니다** — secret 하나 빠뜨린 배포에서 판 코드만
아는 학생이 정답과 모든 모둠 암호를 가져가면 안 되기 때문입니다. 그런 배포에서는
**판도 하나도 안 만들어집니다**(`ADMIN_DISABLED`). 이것도 의도입니다: 그렇게 만들어진 판은
교사 열쇠를 잃어버려도 회수할 길이 없어서, 수업 중에 그걸 알게 되는 것보다 낫습니다.

판 만들기에 비밀번호를 요구하게 된 것은 2026-09-05 사용자 결정입니다 — 그전에는 인증이
없어서 주소만 알면 학생이 빈 판을 만들어 '최근 판' 목록을 어지럽힐 수 있었습니다
(MIGRATION.md §8-1b ※).

⚠️ **비밀번호는 영문·숫자·기호로 하세요.** HTTP 헤더 값은 Latin-1 바이트만 실을 수 있어서,
한글이나 이모지가 든 비밀번호는 **브라우저가 요청을 만들다가 던집니다**(서버까지 가지도 않습니다).
세 자리(관리 화면 · 교사 '새 판 만들기' · '이어하기')가 모두 보내기 전에 걸러 이유를 말합니다.

```bash
npx wrangler secret put ADMIN_PASSWORD          # 배포용
echo 'ADMIN_PASSWORD="..."' >> .dev.vars         # 로컬용 (.gitignore 됨)
```

빌드 단계가 없습니다. Node 24 가 `.ts` 를 그대로 실행합니다.
그래서 **생성자 매개변수 속성(`constructor(private deps)`)을 쓸 수 없습니다** —
Node 의 strip-only 모드가 그 문법만은 못 지웁니다.

타입 검사는 `tsconfig` 가 둘입니다. `@cloudflare/workers-types` 와 `@types/node` 가
같은 이름(`fetch`·`Request`·`WebSocket` …)을 다르게 선언해 한 프로그램에 못 섞기 때문입니다.

| | 무엇을 보나 | 타입 |
|---|---|---|
| `tsconfig.json` | `src/**` (단 `src/client` 제외) | Workers |
| `tsconfig.test.json` | `test/**` · `scripts/**` | Node |
| `tsconfig.client.json` | `src/client/**` | DOM |

⚠️ `lib` 에 적는 `dom` 은 **소문자여야 합니다.** TypeScript 7 은 `"DOM"` 을 못 알아보고
조용히 빼버려서 `document`·`window` 가 전부 "Cannot find name" 이 됩니다.

`src/do/room.ts` 는 Workers API 를 하나도 쓰지 않습니다 — 시계·저장·알람·통신을
전부 주입받기 때문입니다. 그래서 `test/room.ts` 가 workerd 없이 한 판을 통째로 돌립니다.

`src/server/router.ts` 도 마찬가지입니다. `env` 대신 `ports.ts` 의 인터페이스
(`RoomPort`·`DbPort`)를 받아서, `test/gateway.ts` 가 **진짜 `Room` 과 진짜 검사 함수**를
인메모리로 꽂아 SEC 게이트를 HTTP 라우트 수준에서 돌립니다.
`src/server/index.ts` 는 `Request` ↔ `ApiRequest` 를 옮기는 일만 합니다 —
거기에 판단을 넣으면 그 판단은 게이트가 못 도는 곳으로 갑니다.

## 옮기면서 고친 것

**`trackCells` 를 인자로 받습니다.** 앱스 스크립트판은 `planRace` 와
`positionsAtRound` 가 `DEFAULTS.trackCells` 를 직접 봐서, '설정' 탭의 트랙칸수를
12로 바꿔도 조용히 10칸이었습니다. 설정이 거짓말을 하고 있었습니다.
게이트 `TRACK` 이 이걸 지킵니다.

**`autoAdvance` 가 없습니다.** 앱스 스크립트에는 타이머가 없어서 "누가 상태를 읽을 때
시간이 지났으면 그때 넘긴다"로 단계를 바꿨고, 그게 마감 직전 정답을 '미제출'로
덮어쓰는 경합을 낳았습니다. 여기서는 단계 전환이 **`onAlarm()` 한 곳에서만** 일어나고
읽기 경로는 상태를 절대 쓰지 않습니다. 게이트 `RACE1`·`PERSIST` 가 지킵니다.

**`moving`(경주 20초) 단계가 생겼습니다.** 사용자 결정 (MIGRATION §8-3, §10).
그 단계에서만 뷰에 `raceMoves`(이번 라운드 이동량 8개)가 실립니다 — `moves` 전체를
보내면 `lastRound` 가 역산됩니다. 게이트 `MOVE1`·`H4f-raceMoves`.

**대기 중에는 아직 안 움직인 위치를 보냅니다.** `Code.gs` 는 언제나
`positionsAtRound(moves, state.round)` 를 보내서, 판을 만들자마자 1라운드 이동이
반영된 위치가 나갔습니다. 경주 단계가 생긴 지금은 그게 스포일러입니다.

**DO 의 `/op` 를 없앴습니다.** 2단계 스텁 Worker 는 `/room/:code/op` 를 그대로 DO 로
넘겼습니다. 그러면 주소만 아는 누구나 `create` 를 불러 아무 판이나 선점하고 교사 열쇠를
가집니다. 3단계에서는 Worker 가 **RPC 메서드**(`stub.op(name, args)`)로만 방을 부르고,
DO 의 `fetch()` 에는 WebSocket 업그레이드만 남았습니다. 게이트 `SEC13`.

**암호를 연속으로 틀리면 잠깁니다.** 앱스 스크립트판은 `WRONG_PIN` 에 1초 sleep 을 뒀는데,
DO 는 그것보다 훨씬 빨라서 4자리 암호(1만 가지)가 몇 분이면 뚫립니다. 자격 증명 하나
(모둠 하나)당 연속 5회 실패하면 30초간 `TOO_MANY_TRIES` 입니다 —
**모둠별로 나눈 이유**는 한 덩어리로 세면 학생 한 명이 반 전체를 세울 수 있기 때문입니다.
같은 이유로 **교사 열쇠는 잠그지 않습니다** — 12자리라 뚫릴 일이 없고, 잠그면 학생이
선생님 버튼을 얼릴 수 있습니다. 게이트 `SEC14`·`HOST-NOLOCK`.

**`withLock` 이 없습니다.** Durable Object 가 판마다 단일 스레드라 공짜입니다.
대신 `room.ts` 의 모든 메서드가 **동기 함수**입니다 — 읽고→고치고→쓰기 사이에
`await` 가 하나라도 들어가면 그 틈으로 다른 요청이 끼어들어 코인이 증발합니다.

## 화면 (4a)

프레임워크가 없습니다 (사용자 결정, `MIGRATION.md` §10). 순수 HTML/CSS + TypeScript 이고
Vite 는 번들과 정적 자산 빌드에만 씁니다.

```
src/client/
  index.html      학생 (S4 접속 · S5 게임 · S6 결과)   ← /
  teacher.html    교사 (S1 시작 · 배포 안내 · S2 진행 · S3 정산)   ← /teacher
  admin.html      문제은행 관리 (문제 · 동물 · 설정)   ← /admin
  shared/         base.css · ui(토스트·확인대화·배너) · socket · clock · gateway · qr · pw
  team/  teacher/  admin/   화면별 CSS 와 로직
```

**관리 화면은 별도 진입점입니다.** 수업용 교사 번들에 관리 코드가 실리면 안 되기 때문입니다
(PixiJS 를 학생 번들에서 떼어 둔 것과 같은 규칙). 교사 화면에는 링크 하나뿐입니다.
두 화면이 공유하는 것은 관리자 비밀번호 **저장소**뿐입니다 — `shared/pw.ts` 의 `pwStore`
하나가 `sessionStorage` 에 두고, 같은 출처라 한 번만 넣으면 `/teacher` 와 `/admin` 이
같이 열립니다 (`localStorage` 로 바꾸지 마세요 — 교실 공용 노트북에 영구히 남습니다).

```bash
npm run build && grep -l "api/admin/questions" dist/client/assets/*.js   # admin-*.js 만 나와야 합니다
```

**관리 화면은 상수를 박아 두지 않습니다.** 난이도·설정 범위·동물 코드·세트 목록은 전부 서버 응답에
실려 옵니다. 화면에 박으면 `src/game/config.ts` 를 고친 날 화면만 옛 값을 안내합니다 —
'설정의 트랙칸수를 12로 바꿔도 조용히 10칸'이었던 그 함정과 같은 종류입니다.

**폴링하지 않습니다.** 상태의 정본은 소켓 푸시(`{type:'state', data}`)이고, 1초마다 도는
것은 타이머 숫자 계산뿐입니다 — 그것도 서버 시각 기준입니다
(`serverNow` 로 offset 을 잡고 `phaseEndsAt - now()` 로 잽니다).

**끊기면 다시 붙습니다.** 지수 백오프 1→2→4→8→15초(지터 ±25%)로 재연결하고,
붙자마자 `getState` 로 상태를 통째로 다시 받습니다. 끊긴 동안 놓친 푸시를 따라잡는
방법은 그것뿐입니다. 잠깐(1.5초 미만) 끊긴 것에는 배너를 띄우지 않습니다 —
0.3초짜리 재연결에 빨간 띠가 번쩍이면 진짜 끊겼을 때와 구분이 안 됩니다.

**암호·열쇠는 매 메시지에 싣습니다.** 소켓이 붙어 있다는 사실로 권한을 가정하지 않습니다.
모둠 암호는 `localStorage` 에 저장하지 않습니다(판 코드와 모둠 번호만) — 원본과 같습니다.

**교사 진행 버튼은 소켓이 죽어도 눌립니다.** 원본에 없던 것입니다. `shared/gateway.ts` 의
`hostOp` 이 소켓 전송에 실패하면 같은 op 을 HTTP 라우트로 다시 보냅니다
(advance·pause·finalize·reveal·handout — **교사 op 만**).

**외부 자원이 0개입니다.** CDN·외부 글꼴·외부 이미지가 없습니다. 학교망에서 하나라도
막히면 수업이 멈춥니다. QR 도 `apps-script/QR.gs` 를 옮긴 번들 안의 구현을 씁니다.

```bash
npm run build && grep -r 'https\?://' dist/client   # w3.org 이름공간 말고는 안 나와야 합니다
```

**화면은 `src/game/` 의 타입만 `import type` 으로 씁니다.** 값으로 가져오면 `truth` 를
계산하는 규칙이 학생 폰에 실립니다. 비밀 유출은 아니지만 §4-1 의 정신에 어긋납니다.

## 규칙을 고칠 때

~~`test/parity.ts`~~ 는 **리뉴얼로 규칙이 갈라져 폐기했습니다(2026-09-06).**
앱스 스크립트판은 5~6라운드·10칸이고 여기는 10라운드·20칸이라 대조할 것이 없습니다.
그 안전망이 사라진 만큼 `test/gates.ts` 가 촘촘해야 합니다 — RENEWAL §2-1 의 조건 7가지를
`RACE-1`~`RACE-7` 로 **하나씩** 검사하고, 힌트는 문장에서 논리식을 되찾아 대조합니다.

게이트를 더하면 **일부러 깬 코드에 돌려 실제로 실패하는지 확인하세요.**
통과만으로는 그 게이트가 진짜 뭔가를 지키는지 모릅니다 (MIGRATION §9-3).
