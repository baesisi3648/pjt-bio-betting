import assert from 'node:assert/strict';
import { phaseCue } from '../src/client/teacher/phase-cue.ts';
import type { Phase } from '../src/game/config.ts';

const expected: [Phase, string][] = [
  ['quiz', '문제 풀이 시간'],
  ['bonus', '추가 단서 구입 시간'],
  ['discuss', '모둠 토론 시간'],
  ['betting', '베팅 시간']
];
for (const [phase, title] of expected) {
  const intro = phaseCue(phase, 40, 0, 5);
  assert.equal(intro?.kind, 'intro');
  assert.equal(intro.title, title);
  assert.ok(intro.instruction.length > 0);
  assert.equal(phaseCue(phase, 37, 2.99, 5)?.kind, 'intro');
  assert.equal(phaseCue(phase, 37, 3, 5), null);
  for (let n = 10; n >= 1; n--) {
    const countdown = phaseCue(phase, n, 30, 5);
    assert.equal(countdown?.kind, 'countdown');
    assert.equal(countdown.number, n);
  }
  assert.equal(phaseCue(phase, 0, 40, 5), null);
}
assert.match(phaseCue('bonus', 40, 0, 7)!.instruction, /7코인/);
assert.equal(phaseCue('quiz', 5, 30, 5)?.number, 5); // server shortened the phase
for (const phase of ['waiting', 'moving'] as Phase[]) {
  assert.equal(phaseCue(phase, null, 0, 5)?.kind, 'intro');
  assert.equal(phaseCue(phase, 10, 3, 5), null);
}
for (const phase of ['paused', 'done'] as Phase[]) {
  assert.equal(phaseCue(phase, 5, 0, 5), null);
}
console.log('TV 단계 안내: 시작 3초, 마지막 10~1초, 자동 단축·경주 중복 제외 확인');
