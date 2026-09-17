import type { Phase } from '../../game/config.ts';

export interface PhaseCue {
  kind: 'intro' | 'countdown';
  title: string;
  instruction: string;
  number?: number;
}

const INTRO_SECONDS = 3;
const COUNTDOWN_SECONDS = 10;

/** The race stage already has its own central round and 3-2-1 animation. */
export function phaseCue(
  phase: Phase, secondsLeft: number | null, elapsedSeconds: number | null, bonusCost: number
): PhaseCue | null {
  const labels: Partial<Record<Phase, { title: string; instruction: string }>> = {
    waiting: { title: '다음 라운드 준비', instruction: '잠시 후 경주가 시작됩니다!' },
    moving: { title: '경주 시간', instruction: '동물들의 경주를 함께 지켜보세요!' },
    quiz: { title: '문제 풀이 시간', instruction: '문제를 풀고 정답을 제출하세요!' },
    bonus: { title: '추가 단서 구입 시간', instruction: `${bonusCost}코인으로 비밀 상자를 하나 고르세요!` },
    discuss: { title: '모둠 토론 시간', instruction: '힌트를 모아 최종 순위를 함께 추리하세요!' },
    betting: { title: '베팅 시간', instruction: '예측한 동물에 코인을 걸고 확정하세요!' }
  };
  const label = labels[phase];
  if (!label) return null;
  // Waiting has no deadline; the race's last seconds should show animals, not another countdown.
  if (phase === 'waiting' || phase === 'moving') {
    return elapsedSeconds != null && elapsedSeconds >= 0 && elapsedSeconds < INTRO_SECONDS
      ? { kind: 'intro', ...label } : null;
  }
  if (secondsLeft != null && secondsLeft > 0 && secondsLeft <= COUNTDOWN_SECONDS) {
    return { kind: 'countdown', ...label, number: secondsLeft };
  }
  if (elapsedSeconds != null && elapsedSeconds >= 0 && elapsedSeconds < INTRO_SECONDS) {
    return { kind: 'intro', ...label };
  }
  return null;
}
