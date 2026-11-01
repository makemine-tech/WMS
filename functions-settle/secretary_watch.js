/* 전담비서 생존 감시 판단 (2026-11-01)
   헤드비서 탭이 꺼져도 서버가 5분마다 보고, 꺼짐·복귀가 바뀔 때만 특이사항을 남긴다. */
const ALIVE_MS = 3 * 60 * 1000;

function watchDecision(runner, watch, now) {
  if (!runner || !runner.id) return { state: 'none', note: '' };
  const state = runner.ts && now - runner.ts <= ALIVE_MS ? 'on' : 'off';
  const prev = watch && watch.state;
  if (state === 'off' && prev !== 'off') return { state, note: '상시 컴퓨터 신호가 끊겼습니다' };
  if (state === 'on' && prev === 'off') return { state, note: '상시 컴퓨터 신호가 돌아왔습니다' };
  return { state, note: '' };
}

module.exports = { watchDecision };
