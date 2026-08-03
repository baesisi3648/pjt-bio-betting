# 07. 코드 규칙

- 상위 문서: 02-trd
- 대전제: **선생님이 직접 열어서 고칠 수 있어야 한다.** 빌드 과정 없음, 외부 라이브러리 없음, 복사해 넣으면 도는 상태.

---

## 1. 파일과 역할

| 파일 | 역할 | 넣으면 안 되는 것 |
|---|---|---|
| `Config.gs` | 상수만 (시드 코인, 배율, 타이머 초, 트랙 칸수, 탭 이름) | 로직 |
| `Sheet.gs` | 시트 읽기·쓰기, 캐시, 잠금 | 게임 규칙 |
| `Game.gs` | 게임 규칙 전부 (순위·이동·힌트·배당률·베팅검증·정산) | 시트 접근, 화면 관련 |
| `Code.gs` | `doGet` 라우팅, `GameGateway` 7개 함수 | 규칙 계산 |
| `Teacher.html` | 교사 화면 | 게임 규칙 |
| `Team.html` | 모둠 화면 | 게임 규칙 |
| `Shared.html` | 공통 CSS + 폴링 함수 | |

**핵심 규칙: `Game.gs`는 순수 함수만 담는다.** 시트도, 캐시도, 시각도 건드리지 않는다. 상태를 받아 새 상태를 돌려준다. 이래야 테스트할 수 있고, 나중에 통신 방식을 바꿔도 규칙은 그대로 산다.

```js
// ⭕ 좋음 — Game.gs
function applyBet(state, teamNo, bets, now) { ... return newState }

// ❌ 나쁨 — Game.gs 안에서 시트를 읽음
function applyBet(teamNo, bets) {
  var sheet = SpreadsheetApp.getActive()...   // 여기 있으면 안 됨
}
```

---

## 2. 이름 짓기

| 대상 | 방식 | 예 |
|---|---|---|
| 함수 | 동사부터, 카멜 | `createGame`, `applyBet`, `computeOdds` |
| 변수 | 카멜 | `teamNo`, `phaseEndsAt` |
| 상수 | 대문자+밑줄 | `SEED_COINS`, `MAX_BET_PER_ROUND` |
| 시트 탭 이름 | `Config.gs`에 상수로 | `SHEET_QUESTIONS = '문제'` |
| 화면 함수 | `render`로 시작 | `renderTrack`, `renderOdds` |
| 서버 부르는 함수 | `call`로 시작 | `callGetState`, `callPlaceBet` |

시트 탭 이름을 코드 여기저기에 문자열로 박지 않는다. `Config.gs` 한 곳에서만 바꾸면 되게.

---

## 3. 서버 함수 모양

```js
// 모두 이 모양으로 돌려준다 — 화면에서 처리가 한 가지로 통일됨
{ ok: true,  data: {...} }
{ ok: false, error: 'BET_CLOSED', message: '베팅 시간이 지났어요' }
```

- `error`는 코드가 판단하는 값, `message`는 학생이 읽는 한국어
- **`message`는 반드시 "무엇을 하라"까지 적는다**
  - ❌ `'오류'` ⭕ `'베팅 시간이 지났어요. 다음 라운드를 기다려주세요'`

**오류 코드 목록**

| 코드 | 뜻 |
|---|---|
| `GAME_NOT_FOUND` | 판 코드가 없음 |
| `GAME_ENDED` | 이미 끝난 판 |
| `WRONG_PIN` | 암호 틀림 (잠금 없음, 1초 지연만) |
| `QUIZ_CLOSED` / `BET_CLOSED` | 시간 지남 |
| `PAUSED` | 선생님이 일시정지 중 |
| `ALREADY_ANSWERED` / `ALREADY_BET` | 이번 라운드에 이미 함 |
| `TOO_MANY_COINS` | 3코인 초과 |
| `NOT_ENOUGH_COINS` | 보유 코인 부족 |
| `LOCK_TIMEOUT` | 잠금 대기 초과 — 다시 눌러 달라고 안내 |
| `SHEET_INVALID` | 시트 구성이 잘못됨 (동물 8줄 아님 등) |

---

## 4. 절대 지킬 것 — 비밀 유지

```js
// 모둠에게 내려보내기 전 반드시 이 함수를 통과시킨다
function toTeamView(state, teamNo) {
  // truth, moves, lastRound, 다른 모둠 hints/pin/answered 를 제거
}
```

- `GameGateway.getState`에서 `viewer`가 `team:*`이면 **무조건** `toTeamView`를 거친다
- 화면에서 CSS로 감추는 방식은 금지. 응답에 아예 안 담는다
- 이걸 어기면 개발자 도구로 정답이 보인다 → 게임이 끝장난다

---

## 5. 동시성

```js
function withLock(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok:false, error:'LOCK_TIMEOUT', message:'잠시 후 다시 눌러주세요' };
  try { return fn(); } finally { lock.releaseLock(); }
}
```

**상태를 바꾸는 모든 함수는 `withLock` 안에서 돈다.** 읽기만 하는 `getState`는 잠금 없이.

읽기-수정-쓰기는 반드시 잠금 안에서 한 덩어리로. 잠금 밖에서 읽고 안에서 쓰면 6모둠 동시 베팅에 코인이 어긋난다.

---

## 6. 시간

- 시간 판단은 **전부 서버**에서. `Date.now()`는 서버 코드에서만
- 폰에는 `secondsLeft`(남은 초)만 내려보낸다. 폰은 그걸로 화면만 그린다
- 폰 시계가 틀려도 게임이 안 어긋나게

---

## 7. 화면 코드

```js
// 폴링은 이 한 군데서만
var lastVersion = -1;
function poll() {
  callGetState(function(res) {
    if (!res.ok) { showConnectionWarning(); return; }
    if (res.data.stateVersion !== lastVersion) {
      lastVersion = res.data.stateVersion;
      render(res.data);          // 바뀔 때만 다시 그림
    }
    updateTimerOnly(res.data);   // 타이머는 매번
  });
}
setInterval(poll, 2000);
```

- `render()`는 화면 전체를 다시 그린다. 부분 갱신으로 복잡하게 만들지 않는다 (부품이 적어 성능 문제 없음)
- 버튼을 누르면 즉시 잠그고, 응답 오면 푼다
- 서버 응답 3회 연속 실패 → 화면 상단 경고 띠. 성공하면 자동으로 사라짐

---

## 8. 주석

한국어로 쓴다. **무엇을 하는지가 아니라 왜 그렇게 했는지**를 적는다.

```js
// ⭕ 좋음
// 순위를 먼저 정하고 이동을 역산한다.
// 랜덤 이동으로 하면 "A가 1등"이라는 힌트를 뿌려놓고 A가 5등으로 들어오는 판이 생긴다.

// ❌ 나쁨
// 이동 계산 함수
```

특히 아래 다섯 곳은 주석을 **반드시** 단다 — 나중에 무심코 되돌리면 게임이 망가지는 곳이다.
1. 이동 역산 (`Game.gs`)
2. `toTeamView` 비밀 제거
3. `withLock` 감싸기
4. 답 제출·베팅 확정의 **즉시 기록** (라운드 끝까지 미루면 캐시 소실 시 증발한다)
5. 접속 점유를 **일부러 두지 않았다**는 사실 (다시 넣으면 새로고침한 모둠이 이탈한다)

---

## 9. 손으로 하는 확인

앱스 스크립트에는 테스트 도구가 없다. 대신 `Test.gs`에 확인 함수를 만들고 편집기에서 직접 실행한다.

```js
function test_모두() {
  test_이동역산이_순위와_일치한다();
  test_힌트가_전부_참이다();
  test_힌트로_123등을_좁힐수있다();
  test_베팅3코인_초과가_막힌다();
  test_모둠응답에_정답순위가_없다();
  test_정산계산이_맞다();
  Logger.log('전부 통과');
}
```

**이 6개는 코드를 고칠 때마다 돌린다.** 특히 `test_이동역산이_순위와_일치한다`는 100판을 돌려 한 번도 안 어긋나는지 본다.

---

## 10. 안 하는 것

- npm, 빌드 도구, TypeScript
- CDN에서 불러오는 라이브러리 (학교망에서 막히면 수업이 멈춤)
- 파일 하나에 300줄 넘기기 — 넘으면 쪼갠다
- 화면 코드에서 게임 규칙 계산 (배당률·정산을 화면에서 계산하면 조작 가능)

---

## Loop Metadata

- 참조한 상위 문서: 02-trd, 04-database
- 영향 주는 하위 문서: 06-tasks, 08-test-plan
- 아직 안 정한 것: `Test.gs`를 배포본에 남길지 뺄지 (남겨도 학생에게 안 보이므로 일단 남김)
- 전제: 앱스 스크립트 V8 런타임
- 확인 기준: §9의 6개 확인 함수가 전부 통과
- 위험: 재배포를 잊으면 옛 코드가 돌아감 → 화면 하단에 배포 버전 표시를 넣어 눈으로 확인 가능하게
