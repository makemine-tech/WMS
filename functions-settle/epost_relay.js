/* 우체국 조회 상시 컴퓨터 우회 판단 (2026-11-01) — Firebase 없이 시험할 수 있게 저장소는 받아서 씀
   서버(서울)→우체국 연결이 가끔 막힘(2026-10-24·11-01 UND_ERR_CONNECT_TIMEOUT, 일반 인터넷에선 정상)
   → 막히면 상시 컴퓨터 헤드비서 탭이 대신 조회. 막힘 표시 동안은 직접 조회를 건너뛰어 기다리지 않음 */
const DOWN_MS = 5 * 60000;    /* 이 시간 뒤 다시 직접 조회 */
const ALIVE_MS = 3 * 60000;   /* 헤드비서 신호 1분 간격 */

function createRelay(d) {
  let downUntil = 0;
  async function viaRunner(no) {
    const runner = await d.getRunner();
    if (!runner || d.now() - runner.ts > ALIVE_MS) throw new Error('상시 컴퓨터 꺼짐');
    const res = await d.ask(no);
    if (!res) throw new Error('상시 컴퓨터 응답 없음');
    if (res.err) throw new Error('상시 컴퓨터 조회 실패: ' + res.err);
    /* 내용 없이 넘기면 「반품원등기번호 없음 = 반송」으로 잘못 판단함 */
    if (!/등기번호/.test(res.text || '')) throw new Error('상시 컴퓨터 응답 내용 이상');
    return res.text;
  }
  return {
    async load() { downUntil = (await d.getDown()) || 0; },
    async fetch(no, direct) {
      if (d.now() < downUntil) {
        try { return await viaRunner(no); } catch (e) { return direct(no); }
      }
      try { return await direct(no); } catch (first) {
        downUntil = d.now() + DOWN_MS;
        await d.setDown(downUntil);
        try { return await viaRunner(no); } catch (e) {
          throw new Error('우체국 서버 연결 실패 · ' + e.message);
        }
      }
    }
  };
}

module.exports = { createRelay };
