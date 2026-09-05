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
| WebSocket (hibernation) | 실시간 | 2초 폴링 |

**Durable Object 를 고른 이유**: 이 게임은 이미 "판 하나 = 상태 JSON 하나, 변경은
잠금 안에서 직렬화"로 설계돼 있습니다. DO 가 정확히 그 모양입니다 — 판마다 단일
스레드라 `withLock` 이 공짜로 사라집니다.

## 지금까지

- [x] **규칙 이식** — `src/game/rules.ts`. `Game.gs` 를 그대로 옮겼습니다
- [x] **게이트** — `test/gates.ts` 17개
- [x] **이식 대조** — `test/parity.ts`. 같은 시드로 두 구현을 돌려 결과가 같은지 봅니다
- [x] **저장·동시성 (Durable Object)** — `src/do/room.ts`(방 코어)와 `src/do/GameRoom.ts`(DO 어댑터).
      뷰는 `src/game/views.ts` 한 벌뿐입니다. 통합 게이트 `test/room.ts` 30개
- [ ] 게이트웨이 (교사 열쇠 · 모둠 암호 인증) — 인증 자체는 이미 `room.ts` 안에 있습니다.
      3단계는 Worker 라우트·관리자 비밀번호·D1 '최근 판' 목록을 붙이는 일입니다
- [ ] 화면 (Teacher/Team — 기존 HTML 을 WebSocket 으로)
- [ ] 문제은행 관리 화면 + 시트 가져오기
- [ ] 배포

## 돌려보기

```bash
npm test        # 타입 검사 + 규칙 게이트 17 + 이식 대조 14 + 방 코어 게이트 30
npm run room    # 방 코어만
```

빌드 단계가 없습니다. Node 24 가 `.ts` 를 그대로 실행합니다.
그래서 **생성자 매개변수 속성(`constructor(private deps)`)을 쓸 수 없습니다** —
Node 의 strip-only 모드가 그 문법만은 못 지웁니다.

타입 검사는 `tsconfig` 가 둘입니다. `@cloudflare/workers-types` 와 `@types/node` 가
같은 이름(`fetch`·`Request`·`WebSocket` …)을 다르게 선언해 한 프로그램에 못 섞기 때문입니다.

| | 무엇을 보나 | 타입 |
|---|---|---|
| `tsconfig.json` | `src/**` | Workers |
| `tsconfig.test.json` | `test/**` | Node |

`src/do/room.ts` 는 Workers API 를 하나도 쓰지 않습니다 — 시계·저장·알람·통신을
전부 주입받기 때문입니다. 그래서 `test/room.ts` 가 workerd 없이 한 판을 통째로 돌립니다.

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

**`withLock` 이 없습니다.** Durable Object 가 판마다 단일 스레드라 공짜입니다.
대신 `room.ts` 의 모든 메서드가 **동기 함수**입니다 — 읽고→고치고→쓰기 사이에
`await` 가 하나라도 들어가면 그 틈으로 다른 요청이 끼어들어 코인이 증발합니다.

## 규칙을 고칠 때

`test/parity.ts` 는 **일부러 깨집니다.** 규칙을 바꾸면 두 구현이 갈라지니까요.
그때는 앱스 스크립트판도 같이 고치거나, 이전이 끝나 앱스 스크립트판을 버릴 때
이 파일을 지우면 됩니다. 그전까지는 이게 안전망입니다.
