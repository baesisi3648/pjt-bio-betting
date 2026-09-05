/**
 * pw.ts — 관리자 비밀번호를 이 브라우저에 두는 **한 곳**.
 *
 * 두 화면이 같은 비밀번호를 쓴다: `/admin`(문제은행 관리)과 `/teacher`(판 만들기 ·
 * 교사 열쇠 되찾기). 같은 출처라 저장소를 공유하므로, **같은 열쇠 이름**을 쓰면
 * 선생님은 수업 준비 중에 비밀번호를 한 번만 넣습니다.
 *
 * ⚠️ 이 함수를 화면마다 복사해 쓰지 마세요. 두 벌이 되면 한쪽만 `localStorage` 로
 *    바뀌거나 열쇠 이름이 갈라지는 날이 오고, 그때는 "관리 화면에서는 되는데 교사
 *    화면에서는 다시 물어본다"가 됩니다 (MIGRATION §5 '사본' 함정).
 *
 * ⚠️ **`sessionStorage` 입니다 (`localStorage` 아님).** 탭을 닫으면 잊어야 합니다 —
 *    교실 공용 노트북에 관리자 비밀번호를 영구히 남기지 않기 위해서입니다.
 *    저장이 막힌 브라우저에서도 그 세션 동안은 화면의 변수·입력란에 있으니 그대로 돕니다.
 *
 * ⚠️ 여기 저장된 값이 **맞는다고 가정하지 않습니다.** 비밀번호는 서버에서 바뀔 수 있고,
 *    화면에는 비교할 것이 없습니다. 저장은 서버가 통과시킨 뒤에만 하고, 서버가 거절하면
 *    지웁니다 (`ADMIN_DENIED`).
 */

/** 두 화면이 공유하는 열쇠 이름. 바꾸면 한 번 더 넣어야 할 뿐이지만, 둘이 같아야 합니다 */
const KEY = 'wd_admin_pw';

/**
 * 읽기: 인자 없이. 쓰기: 문자열. 지우기: `null`.
 * 돌려주는 것은 읽을 때 저장된 값, 쓸 때 방금 넣은 값(지우면 빈 문자열)입니다.
 */
export function pwStore(val?: string | null): string {
  try {
    if (val === undefined) return sessionStorage.getItem(KEY) || '';
    if (val === null) sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, val);
  } catch { /* 막힌 브라우저 */ }
  return val || '';
}
