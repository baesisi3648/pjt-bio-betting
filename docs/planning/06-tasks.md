# 06. 태스크 — 와일드 더비

- 생성: 2026-08-01 · Domain-Guarded 모드
- 입력: `specs/screens/*.yaml`, `specs/domain/resources.yaml`, `specs/shared/*.yaml`, `docs/planning/01~08`
- 실행 환경: 일반 터미널 (cmux 아님) → `담당`으로 라우팅

## Interface Contract Validation 결과

| 항목 | 값 |
|---|---|
| 화면 | 6개 (S1~S6) |
| 리소스 | 10개 정의 / 8개 참조 |
| 필드 커버리지 | **100%** (미정의 참조 0) |
| Must 커버리지 | **16/16** (누락 0) |
| 판정 | ✅ 통과 |

## 태스크 요약

| Phase | 내용 | 태스크 수 |
|---|---|---|
| P0 | 셋업 — 시트·프로젝트 골격 | 4 |
| P1 | 기반 — 저장·캐시·잠금·검사틀 | 5 |
| P2 | **게임 규칙 코어** (여기가 제일 위험) | 8 |
| P3 | 통신 계층 — GameGateway | 4 |
| P4 | 선생님 화면 S1·S2·S3 | 6 |
| P5 | 모둠 화면 S4·S5·S6 | 6 |
| P6 | 통합·배포·리허설 | 5 |
| | **합계** | **38** |

---

## P0. 셋업

### P0-T0.1 · 스프레드시트와 탭 만들기
- **담당**: backend-specialist
- **의존**: 없음
- **하는 일**: 구글 스프레드시트 `와일드더비` 생성 후 탭 6개(`문제`/`힌트문구`/`동물`/`설정`/`게임`/`기록`)와 머리글 행 작성
- **참조**: `docs/planning/04-database.md`
- **acceptance**:
  - Given 빈 스프레드시트 / When 셋업 실행 / Then 탭 6개가 04-database의 열 구성 그대로 생성됨
  - Given `동물` 탭 / When 열어봄 / Then A~H 8행이 기본 동물로 채워져 있음
  - Given `설정` 탭 / When 열어봄 / Then 시드코인 15, 문제시간 90, 토론시간 180, 베팅시간 60이 들어 있음
- **비고**: 시드코인 기본값은 **15** (PDF의 5 아님 — 리뷰 C6)

### P0-T0.2 · 힌트문구 기본 세트 채우기 (M14)
- **담당**: backend-specialist
- **의존**: P0-T0.1
- **하는 일**: `힌트문구` 탭에 난이도×종류 8줄 기본값 입력
- **acceptance**:
  - Given `힌트문구` 탭 / When 읽음 / Then 어려움 3종·중간 2종·쉬움 3종이 자리표시 `{X}{Y}{Z}{N}`을 포함해 존재

### P0-T0.3 · 샘플 문제 18문항 (유전 단원)
- **담당**: docs-specialist
- **의존**: P0-T0.1
- **하는 일**: 개발·테스트용 4지선다 18문항(난이도별 6개) 작성
- **acceptance**:
  - Given `문제` 탭 / When 유전 단원 필터 / Then 쉬움·중간·어려움 각 6문항, 정답이 1~4 범위
- **비고**: 실제 수업 문제는 선생님이 나중에 교체. 여기선 개발용

### P0-T0.4 · Apps Script 파일 골격 + Config.gs
- **담당**: backend-specialist
- **의존**: P0-T0.1
- **하는 일**: `Code.gs`/`Game.gs`/`Sheet.gs`/`Config.gs`/`Test.gs` + `Teacher.html`/`Team.html`/`Shared.html` 빈 파일 생성, Config에 상수·탭이름 정의
- **참조**: `docs/planning/07-coding-convention.md §1`
- **acceptance**:
  - Given 앱스 스크립트 편집기 / When 파일 목록 확인 / Then 8개 파일 존재
  - Given `Config.gs` / When 읽음 / Then 탭 이름이 문자열 상수로만 정의되어 있고 다른 파일에 하드코딩된 탭 이름이 없음

---

## P1. 기반 — 저장·캐시·잠금

### P1-R1-T1 · 시트 읽기 (문제·힌트문구·동물·설정) (M4, M14)
- **담당**: backend-specialist
- **의존**: P0-T0.4
- **하는 일**: `Sheet.gs`에 4개 마스터 탭 읽기 함수. 잘못된 행은 건너뛰고 목록으로 보고
- **acceptance**:
  - Given 난이도가 `상`인 행 / When 문제 읽기 / Then 그 행은 무시되고 무시 사유가 반환값에 담김
  - Given 정답이 5인 행 / When 문제 읽기 / Then 그 행 무시
  - Given `동물` 탭 7행 / When 동물 읽기 / Then `SHEET_INVALID` 오류 + 몇 행인지 안내

### P1-R1-T2 · 시트 구성 검사기
- **담당**: backend-specialist
- **의존**: P1-R1-T1
- **하는 일**: 판 만들기 전 실행하는 검사 — 동물 8행, 자리표시 온전성, 단원별 문항 수
- **참조**: `specs/screens/teacher-setup.yaml` validations
- **acceptance**:
  - Given `힌트문구`에서 `{X}` 삭제 / When 검사 / Then 차단 + 몇 번째 줄인지 반환
  - Given 어려움 2문항 단원 / When 검사 / Then 경고(차단 아님) + `have=2, need=6` 반환

### P1-R2-T1 · 캐시 계층 (CacheService)
- **담당**: backend-specialist
- **의존**: P0-T0.4
- **하는 일**: 게임 상태 JSON을 캐시에서 읽고 쓰는 래퍼. 없으면 시트에서 복원
- **참조**: `docs/planning/02-trd.md §5`
- **acceptance**:
  - Given 캐시에 상태 있음 / When 조회 / Then 시트를 건드리지 않고 0.1초 안에 반환
  - Given 캐시 비어 있음 / When 조회 / Then 시트에서 읽어 캐시에 채우고 반환
  - Given 상태 JSON / When 저장 / Then 크기가 15KB 이하

### P1-R2-T2 · 잠금 래퍼 (withLock)
- **담당**: backend-specialist
- **의존**: P0-T0.4
- **하는 일**: 상태 변경 함수를 감싸는 `withLock`. 10초 대기 후 실패
- **acceptance**:
  - Given 잠금이 이미 잡혀 있음 / When 10초 초과 / Then `LOCK_TIMEOUT` + "잠시 후 다시 눌러주세요"
  - Given 잠금 안에서 예외 발생 / When 종료 / Then finally에서 반드시 해제됨

### P1-R2-T3 · 사건 기록 + 복구 (M16)
- **담당**: backend-specialist
- **의존**: P1-R2-T1, P1-R2-T2
- **하는 일**: `기록` 탭 즉시 append + 캐시 소실 시 스냅샷+사건 재생 복구
- **참조**: `docs/planning/02-trd.md §5`, 리뷰 C3
- **acceptance**:
  - Given 베팅 확정 / When 처리 완료 / Then `기록` 탭에 즉시 한 줄 추가됨 (라운드 끝을 안 기다림)
  - Given 라운드 중간에 캐시 강제 삭제 / When 상태 조회 / Then 그 라운드 답과 베팅이 **전부 복구됨** (손실 0)
  - Given 사건 12건 append / When 소요 시간 측정 / Then 총 5초 이내
- **⚠️ 위험**: 이게 안 되면 수업 중 "우리 코인 어디 갔어요" 사고

---

## P2. 게임 규칙 코어 ⚠️ 최대 위험 구간

> `Game.gs`는 **순수 함수만**. 시트·캐시·시각을 건드리지 않는다. 상태를 받아 새 상태를 돌려준다.
> 이 Phase의 G-검사를 통과하기 전에는 다음 Phase로 넘어가지 않는다.

### P2-R3-T1 · 검사 하네스 (Test.gs)
- **담당**: test-specialist
- **의존**: P0-T0.4
- **하는 일**: `test_모두()` 골격 + 판 100개를 돌리는 반복 검사 틀
- **참조**: `docs/planning/07-coding-convention.md §9`
- **acceptance**:
  - Given 편집기에서 `test_모두` 실행 / When 완료 / Then 통과/실패가 Logger에 항목별로 출력됨

### P2-R3-T2 · 정답 순위 확정 + 이동 역산 (M2) ⚠️
- **담당**: backend-specialist
- **의존**: P2-R3-T1
- **하는 일**: 1~8등 무작위 확정 → 마지막 라운드 5/6 선택 → 라운드별 이동량 역산 → 검산
- **참조**: `docs/planning/02-trd.md §6-1`, `01-prd.md §6-(1)`
- **acceptance** (= **G1**):
  - Given 판 100개 생성 후 끝까지 굴림 / When 최종 도착 순서 비교 / Then `truth`와 **100/100 일치**
  - Given 아무 판 / When 모든 라운드 이동값 검사 / Then 전부 0~3 범위
  - Given 아무 판 / When 3라운드까지 굴림 / Then 10칸 도달 동물 **0마리** (1차시에 골인 없음)
  - Given 역산 실패 / When 50회 재시도 후에도 실패 / Then 명시적 오류 (조용히 넘어가지 않음)
- **⚠️ PDF 원본이 여기서 깨져 있었다.** 랜덤 이동으로 되돌리면 힌트가 거짓말이 된다

### P2-R3-T3 · 힌트 생성 (M3)
- **담당**: backend-specialist
- **의존**: P2-R3-T2
- **하는 일**: `힌트문구` 틀에 A~H를 매핑해 난이도별 힌트 풀 생성. 모두 `truth` 기준 참
- **acceptance** (= **G2**):
  - Given 판 100개 / When 생성된 모든 힌트를 `truth`에 대조 / Then 거짓 힌트 **0개**
  - Given 난이도별 힌트 풀 / When 개수 확인 / Then **각 6개 이상** (같은 틀 다른 동물로 채움)
  - Given 어려움만 6번 고른 모둠 / When 6라운드 힌트 지급 / Then 같은 문장이 두 번 안 나옴

### P2-R3-T4 · 힌트 검산 (M3) ⚠️
- **담당**: test-specialist
- **의존**: P2-R3-T3
- **하는 일**: 8! 순열을 힌트로 걸러 1·2·3등이 좁혀지는지 확인. 안 되면 어려움 힌트 추가
- **acceptance** (= **G3**):
  - **G3-a**: Given 판 100개 / When 전체 힌트로 순열 필터 / Then 1·2·3등 유일 결정 **100/100**
  - **G3-b**: Given 어려움만 6번 고른 모둠 / When 그 6개 힌트로 필터 / Then 1·2·3등을 좁힐 수 있음 **100/100**
  - Given 8! 전수 검사 / When 시간 측정 / Then 1초 이내
- **비고**: G3-b가 실패하면 어려움을 고를 이유가 없어진다 (리뷰 C8)

### P2-R4-T1 · 배당률 계산
- **담당**: backend-specialist
- **의존**: P2-R3-T1
- **하는 일**: `(전체 pool) / (해당 동물 pool)`, 시드 15, 소수 둘째 자리
- **acceptance** (= **R6**):
  - Given pool이 손계산 가능한 상태 / When 배당률 계산 / Then 손계산 값과 소수 둘째 자리까지 일치
  - Given 아무도 안 건 동물 / When 최대 베팅 상황 / Then 배당률이 **16배 이하** (시드 15 효과)

### P2-R4-T2 · 베팅 검증
- **담당**: backend-specialist
- **의존**: P2-R4-T1
- **하는 일**: 라운드당 3코인·보유 코인·마감·중복 확정 검사
- **acceptance** (= **R1~R5**):
  - Given 라운드당 3코인 상태 / When 4코인 시도 / Then `TOO_MANY_COINS`
  - Given 코인 1개 / When 2코인 시도 / Then `NOT_ENOUGH_COINS`
  - Given 베팅 마감 후 / When 제출 / Then `BET_CLOSED`
  - Given 이미 확정 / When 재확정 / Then `ALREADY_BET`
  - Given 이미 답 제출 / When 재제출 / Then `ALREADY_ANSWERED`

### P2-R4-T4 · 문제 선택기 (M4) — 감독 단계에서 추가
- **담당**: backend-specialist
- **의존**: P1-R1-T1, P2-R3-T1
- **하는 일**: 판 생성 시 라운드×난이도마다 문항을 미리 배정해 `questionPlan`에 저장
- **참조**: `docs/planning/04-database.md §6`, 갭 리포트 G-01
- **acceptance**:
  - Given 단원에 난이도별 6문항 / When 판 생성 / Then `questionPlan`에 6라운드 × 3난이도 = 18칸이 서로 다른 문항으로 채워짐
  - Given 난이도별 4문항뿐 / When 판 생성 / Then 부족분은 가장 먼저 쓴 문항부터 재사용 (`03-user-flow §6`의 약속 이행)
  - Given 같은 판 / When 캐시 삭제 후 복구 / Then **같은 라운드에 같은 문제**가 나옴 (미리 배정하는 이유)
  - Given 같은 난이도를 고른 두 모둠 / When 문제 확인 / Then 같은 문항 (선생님 결정 — 모둠별 다른 문제는 Won't)
- **비고**: 라운드마다 그때그때 뽑으면 캐시 복구 시 문제가 바뀐다. 반드시 판 생성 시 확정

### P2-R4-T3 · 정산 계산 (M13)
- **담당**: backend-specialist
- **의존**: P2-R4-T1
- **하는 일**: 최종 배당률 × 순위 배율(1.0/0.7/0.5/0)
- **참조**: `docs/planning/02-trd.md §6-5` — 최종 배당률만 사용 (선생님 결정)
- **acceptance** (= **R7**):
  - Given 2등 동물에 4코인, 최종 배당 2.14배 / When 정산 / Then `4 × 2.14 × 0.7 = 5.99 → 6코인`
  - Given 6등 동물에 2코인 / When 정산 / Then 0코인 (소멸)
  - Given 모든 모둠 / When 정산 / Then `최종 = 남은 보유 + 획득`
- **비고**: `bets`에 라운드 번호가 남아 있어야 함 (나중에 배당 방식 전환 대비)

---

## P3. 통신 계층 — GameGateway

### P3-R5-T1 · toTeamView (비밀 제거) ⚠️
- **담당**: backend-specialist
- **의존**: P2 전부
- **하는 일**: 모둠 응답에서 `truth`/`moves`/`lastRound`/타 모둠 힌트·암호·정답 제거
- **참조**: `specs/shared/types.yaml` invariants
- **acceptance** (= **G4**):
  - Given 아무 게임 상태 / When `toTeamView` 후 JSON 문자열화 / Then `truth`·`moves`·`lastRound` 문자열 **0회 등장**
  - Given 3모둠 시점 / When 응답 확인 / Then 다른 모둠 `hints`·`pin`이 없음
  - Given 채점 전 문제 / When 응답 확인 / Then `answer` 필드가 없음
  - Given `isOver == true` / When 응답 확인 / Then `truth`가 **이때만** 포함됨
- **⚠️ 이걸 어기면 개발자 도구로 정답이 보인다**

### P3-R5-T2 · createGame / joinGame (M1, M5)
- **담당**: backend-specialist
- **의존**: P1 전부, P2-R3-T4, P3-R5-T1
- **하는 일**: 판 코드(혼동문자 제외 4자리) 발급, 모둠 암호 발급, 초기 상태 저장 / 모둠 입장
- **acceptance**:
  - Given 반 이름·단원·모둠 6개 / When `createGame` / Then 판 코드 + 암호 6개 + 학생 주소 반환
  - Given 판 코드에 `0 O 1 I` / When 100회 생성 / Then 한 번도 안 나옴
  - Given 같은 모둠에 두 기기 / When 둘 다 `joinGame` / Then **둘 다 성공** (점유 없음 — 리뷰 C2)
  - Given 틀린 암호 / When `joinGame` / Then `WRONG_PIN`, 잠기지 않고 1초 지연

### P3-R5-T3 · getState (폴링) + 타이머
- **담당**: backend-specialist
- **의존**: P3-R5-T1
- **하는 일**: viewer별 상태 반환, 서버 시각 기준 `secondsLeft` 계산, 마감 도달 시 자동 다음 단계
- **acceptance**:
  - Given viewer=teacher / When 조회 / Then `truth` 포함
  - Given viewer=team:3 / When 조회 / Then `toTeamView` 통과본
  - Given 문제 90초 경과 / When 조회 / Then 자동으로 `discuss` 단계 + 미제출 모둠 오답 처리
  - Given 토론 180초 경과 / When 조회 / Then 자동으로 `betting` 단계
  - Given `discuss` 단계 / When 베팅 시도 / Then 거부됨 (토론 중엔 조작 없음)
  - Given 폰 7대 동시 폴링 / When 응답 시간 측정 / Then 평균 **0.3초 이하** (= C4)

### P3-R5-T4 · submitAnswer / placeBet / advanceRound / togglePause / finalize
- **담당**: backend-specialist
- **의존**: P3-R5-T3, P1-R2-T3
- **하는 일**: 나머지 5개 함수. 전부 `withLock` + 즉시 기록
- **acceptance**:
  - Given 6모둠 동시 베팅 확정 / When 완료 / Then 동물별 누적 코인 합계가 어긋나지 않음 (= **C1**)
  - Given 일시정지 중 / When 베팅 시도 / Then `PAUSED`
  - Given 일시정지 3분 후 재개 / When 타이머 확인 / Then 멈춘 지점 남은 시간부터 (= **B6**)
  - Given 상태 변경 함수 전부 / When 코드 검사 / Then 모두 `withLock` 안에 있음

---

## P4. 선생님 화면

### P4-S0-T1 · Shared.html — 공통 CSS + 폴러
- **담당**: frontend-specialist
- **의존**: P3 전부
- **하는 일**: 색·글자 변수, `poller`, `timer_display`, `locking_button`, `error_banner`, `confirm_dialog`
- **참조**: `specs/shared/components.yaml`, `docs/planning/05-design-system.md`
- **acceptance**:
  - Given 상태 미변경 / When 폴링 / Then `render`가 호출되지 않음 (`stateVersion` 비교)
  - Given 응답 3회 연속 실패 / When 확인 / Then 경고 띠 표시, 성공 시 자동 제거
  - Given 확인 대화 / When 코드 검사 / Then `alert`/`confirm` 미사용 (폴링을 막으므로)
  - Given 외부 요청 / When 코드 검사 / Then CDN·웹폰트 참조 0건

### P4-S1-T1 · S1 시작 화면 UI (M1, M4)
- **담당**: frontend-specialist
- **의존**: P4-S0-T1
- **하는 일**: 새 판 만들기 / 이어하기 탭, 폼, 최근 판 목록
- **참조**: `specs/screens/teacher-setup.yaml`
- **acceptance**:
  - Given 단원 드롭다운 / When 열기 / Then `문제` 탭 단원이 중복 없이 나옴
  - Given 모둠 수 6 선택 / When 확인 / Then 모둠 이름 입력칸 6개 생성
  - Given 판이 없음 / When 이어하기 탭 / Then "아직 만든 판이 없어요"

### P4-S1-T2 · S1 배포용 안내 패널 (판 코드·암호표) (M5)
- **담당**: frontend-specialist
- **의존**: P4-S1-T1
- **하는 일**: 판 코드 96px, 학생 주소 크게 표시, 암호표 인쇄
- **acceptance**:
  - Given 판 생성 직후 / When 화면 확인 / Then 판 코드가 96px로 표시
  - Given 학생 주소 / When 화면 확인 / Then 폰으로 보고 칠 수 있게 48px 이상
  - Given 인쇄 / When 미리보기 / Then 모둠별로 잘라 쓸 수 있게 점선 구분
  - Given 진행 화면으로 이동 / When 확인 / Then 암호표가 자동으로 닫힘 (TV 노출 방지)
- **비고**: QR은 만들지 않기로 확정 (감독 단계 결정 G-05). 어차피 판 코드 4자리는 손으로 입력해야 하므로 QR이 아끼는 건 주소 입력 한 번뿐

### P4-S1-V · S1 연결점 검증
- **담당**: test-specialist
- **의존**: P4-S1-T2
- **acceptance**: `teacher-setup.yaml` tests 5개 전부 통과

### P4-S2-T1 · S2 진행 화면 UI (M9, M10, M11, M12, M15)
- **담당**: frontend-specialist
- **의존**: P4-S0-T1
- **하는 일**: 트랙(화면 절반)·배당률 전광판·모둠 현황·제어 버튼·단계별 표시(waiting/moving/quiz/discuss/betting/paused/done)
- **참조**: `specs/screens/teacher-play.yaml`
- **acceptance**:
  - Given 베팅 발생 / When 2초 경과 / Then 전광판 값 변경 + 해당 줄 0.4초 강조
  - Given 골인한 동물 / When 정산 전 / Then 등수 배지가 **안 붙음** (골인 순서만)
  - Given 배당률 변동 / When 표 확인 / Then 동물 순서가 재정렬되지 않음
  - Given "정답 순위 보기" / When 클릭 / Then 확인 대화 1회, 취소 시 아무것도 안 보임
  - Given 8m 거리 / When 배당률 읽기 / Then 읽힘 (실제 교실에서 확인)

### P4-S2-V · S2 연결점 검증
- **담당**: test-specialist
- **의존**: P4-S2-T1
- **acceptance**: `teacher-play.yaml` tests 5개 전부 통과 (일시정지 포함)

### P4-S3-T1 · S3 정산 화면 (M13)
- **담당**: frontend-specialist
- **의존**: P4-S0-T1, P2-R4-T3
- **하는 일**: 3단계 순차 공개 + 접힌 모둠별 내역 + 문제 다시보기
- **참조**: `specs/screens/teacher-result.yaml`
- **acceptance**:
  - Given 화면 진입 / When 확인 / Then 1등만 보이고 모둠 내역은 접혀 있음
  - Given 클릭 / When 반복 / Then 1등→2등→3등→나머지 순으로 하나씩
  - Given 정산 시작 / When 2초 경과 / Then 모둠 폰이 S6으로 전환됨
  - Given 문제 다시보기 / When 열기 / Then 이번 판 출제 문항만 정답·해설 포함

---

## P5. 모둠 화면

### P5-S4-T1 · S4 접속 화면 (M5)
- **담당**: frontend-specialist
- **의존**: P4-S0-T1, P3-R5-T2
- **하는 일**: 3단계 입력(판코드→모둠→암호), localStorage 기억
- **참조**: `specs/screens/team-join.yaml`
- **acceptance**:
  - Given 판 코드 입력 / When 소문자 입력 / Then 대문자로 변환
  - Given 3라운드 진행 중 새로고침 / When 재입력 / Then 힌트·코인 그대로 (= **B1**)
  - Given 같은 모둠 두 기기 / When 둘 다 접속 / Then 둘 다 성공, 상태 동일 (= **B1-b**)
  - Given 틀린 암호 3회 / When 확인 / Then 잠기지 않고 매번 1초 지연

### P5-S5-T1 · S5 뼈대 + 문제 탭 (M6, M12, M15)
- **담당**: frontend-specialist
- **의존**: P5-S4-T1
- **하는 일**: 타이머 막대·"지금은 ▸ …"(상단)·모둠 바·탭 3개 + 문제 탭 6개 상태. 토론 단계에는 힌트 탭 자동 전환 + 베팅 잠금
- **참조**: `specs/screens/team-play.yaml`
- **acceptance**:
  - Given 어려움 선택 / When 확인 대화 / Then "이번 라운드에는 못 바꿔요" 표시
  - Given 정답 제출 / When 결과 / Then ⭕ + 힌트 탭 자동 전환 + 배지
  - Given 오답 제출 / When 결과 / Then ❌ + 정답·해설, 힌트 없음
  - Given "지금 뭘 할 때인지" / When 위치 확인 / Then **상단** 타이머 아래 (하단 아님)

### P5-S5-T2 · S5 힌트 탭 (게임의 심장) (M7)
- **담당**: frontend-specialist
- **의존**: P5-S5-T1
- **하는 일**: 누적 힌트 카드 목록
- **acceptance**:
  - Given 힌트 카드 / When 글자 크기 확인 / Then **20px, 줄간격 1.8** (다른 곳 16px보다 큼)
  - Given 힌트 6개 / When 화면 확인 / Then 스크롤 없이 들어옴 (360px 폭 기준)
  - Given 힌트 없음 / When 탭 열기 / Then "문제를 맞히면 힌트를 받아요"
- **비고**: 폰 1대를 4~5명이 같이 본다 (리뷰 C4)

### P5-S5-T3 · S5 베팅 탭 (M8)
- **담당**: frontend-specialist
- **의존**: P5-S5-T1
- **하는 일**: 동물 8행 + 배당률 + 스테퍼 + 확정
- **acceptance**:
  - Given 3코인 사용 / When 4번째 + / Then 버튼 흐려지고 서버 호출 안 감
  - Given 확정 / When 확인 대화 후 / Then 전체 회색 잠김 + "확정됨"
  - Given 스테퍼 / When 크기 측정 / Then 56×56px 이상

### P5-S5-V · S5 연결점 검증 ⚠️
- **담당**: test-specialist
- **의존**: P5-S5-T3
- **acceptance**:
  - `team-play.yaml` tests 5개 전부 통과
  - Given `getState` 응답 원문 / When 문자열 검사 / Then `truth`·`moves`·`lastRound` **0회 등장**

### P5-S6-T1 · S6 결과 화면 (M13)
- **담당**: frontend-specialist
- **의존**: P5-S5-T1, P4-S3-T1
- **하는 일**: 최종 순위·우리 내역·전체 등수
- **acceptance**:
  - Given 정산 전 / When 상태 조회 / Then `truth` 없음
  - Given `isOver == true` / When 확인 / Then `truth` 포함되고 1·2·3등 표시
  - Given 선생님 화면 값 / When 비교 / Then `gained`·`finalCoins`·`rank` 완전 일치

---

## P6. 통합·배포·리허설

### P6-T1 · 동시성 실측
- **담당**: test-specialist
- **의존**: P5 전부
- **하는 일**: 브라우저 창 6개 + TV 1개로 동시 조작
- **acceptance** (= **C1~C4**):
  - Given 6모둠 동시 베팅 확정 / When 코인 합계 확인 / Then 어긋나지 않음
  - Given 6모둠 동시 제출 + TV 폴링 / When 시간 측정 / Then 모든 요청 10초 이내
  - Given 폰 6 + TV 1 폴링 / When 평균 측정 / Then 0.3초 이하
  - Given 잠금 초과 / When 발생 / Then 화면에 안내 (조용히 실패 금지)

### P6-T2 · 끊김·복구 실측
- **담당**: test-specialist
- **의존**: P6-T1
- **acceptance** (= **B1~B6**): `08-test-plan.md §4` 7개 항목 전부 통과. 특히 **B4 손실 0**, **B5 2차시 이어하기**

### P6-T3 · 시트 오류 대응 확인
- **담당**: test-specialist
- **의존**: P6-T1
- **acceptance** (= **S1~S6**): `08-test-plan.md §5` 6개 항목 전부 통과

### P6-T4 · 웹앱 배포 + 학교망 확인
- **담당**: backend-specialist
- **의존**: P6-T1, P6-T2, P6-T3
- **하는 일**: 웹앱 배포(실행: 소유자 / 접근: 링크가 있는 모든 사용자), 화면 하단에 배포 버전 표시
- **참조**: `docs/planning/02-trd.md §9`
- **acceptance**:
  - Given 배포 완료 / When 교사·학생 주소 접속 / Then 둘 다 열림
  - Given **학교 와이파이의 폰** / When 학생 주소 접속 / Then 열림
  - Given 화면 하단 / When 확인 / Then 배포 버전이 표시됨 (재배포 누락 감지용)

### P6-T5 · 수업 리허설 (혼자 6모둠 돌려보기)
- **담당**: qa-manager
- **의존**: P6-T4
- **하는 일**: 1차시 3라운드 → 저장 → 2차시 3라운드 → 정산 전 과정을 혼자 돌려봄
- **acceptance**:
  - Given 전 과정 / When 완주 / Then 중단 없이 정산까지 도달
  - Given 1차시 종료 후 다음 날 / When 이어하기 / Then 전부 그대로
  - Given `08-test-plan §7` 수업 전 점검표 / When 실행 / Then 7개 항목 전부 확인됨

---

## 의존성 순서

```
P0 (셋업, 병렬 가능)
 └→ P1 (기반)  R1-T1 → R1-T2
              R2-T1 ┐
              R2-T2 ┴→ R2-T3
 └→ P2 (게임 규칙) ⚠️ G1~G3 통과 전 진행 금지
      R3-T1 → R3-T2 → R3-T3 → R3-T4
      R3-T1 → R4-T1 → R4-T2
                    → R4-T3
      R1-T1 + R3-T1 → R4-T4 (문제 선택기)
 └→ P3 (통신)  R5-T1 → R5-T2 → R5-T3 → R5-T4
 └→ P4 (교사)  S0-T1 → S1-T1 → S1-T2 → S1-V
                     → S2-T1 → S2-V
                     → S3-T1
 └→ P5 (모둠)  S4-T1 → S5-T1 → S5-T2 → S5-V
                             → S5-T3 ┘
                     → S6-T1
 └→ P6 (통합)  T1 ┬→ T2 ┐
                  ├→ T3 ┴→ T4 → T5
```

**병렬 가능**: P0 내부 / P1의 R1계열과 R2계열 / P2의 R3계열과 R4계열 / P4와 P5 (둘 다 P3 완료 후)

---

## 통과 기준 (이걸 못 넘으면 수업에 못 씀)

| 게이트 | 태스크 | 기준 |
|---|---|---|
| **G1** 도착 순서 = 정답 순위 | P2-R3-T2 | 100/100 |
| **G2** 모든 힌트가 참 | P2-R3-T3 | 거짓 0개 |
| **G3-a/b** 힌트로 좁혀짐 | P2-R3-T4 | 각 100/100 |
| **G4** 정답 유출 없음 | P3-R5-T1 | 0회 등장 |
| **B4** 캐시 소실 복구 | P1-R2-T3 | 손실 0 |
| **B5** 2차시 이어하기 | P6-T2 | 전부 그대로 |
| **C1** 동시 베팅 정합 | P6-T1 | 합계 일치 |

---

## Loop Metadata

- 참조한 상위 문서: 01-prd(Must 16), 02-trd, 04-database, 06-screens, 07-coding-convention, 08-test-plan, council-report
- 참조한 명세: `specs/screens/*.yaml`, `specs/domain/resources.yaml`, `specs/shared/*.yaml`
- ICV: 통과 (필드 커버리지 100%, Must 16/16)
- 아직 안 정한 것:
  - P4-S1-T2의 QR 코드 — 외부 라이브러리 금지 원칙과 충돌. 순수 JS 구현 vs 주소만 크게 표시 중 선택 필요
  - P6-T1의 동시성을 브라우저 창 6개로 완전히 재현할 수 있는지
- 전제: 개발은 선생님 + AI 1명. 병렬 표시는 순서 자유도를 뜻하지 동시 인력을 뜻하지 않음
- 위험:
  - P2가 이 프로젝트의 전부다. 여기 G1~G3가 안 되면 나머지를 아무리 잘 만들어도 게임이 안 됨
  - P6-T4의 학교망 확인이 실패하면 스택 자체를 다시 봐야 함
