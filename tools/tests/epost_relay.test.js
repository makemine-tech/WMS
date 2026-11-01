/* 우체국 조회 상시 컴퓨터 우회 판단 (functions-settle/epost_relay.js) */
const test = require('node:test');
const assert = require('node:assert');
const { createRelay } = require('../../functions-settle/epost_relay');

const NOW = 1000000000;
function setup(o) {
  const calls = { ask: [], down: [] };
  const relay = createRelay({
    now: () => NOW,
    getDown: async () => o.down || 0,
    setDown: async (t) => calls.down.push(t),
    getRunner: async () => ('runner' in o ? o.runner : { ts: NOW - 30000 }),
    ask: async (no) => { calls.ask.push(no); return 'res' in o ? o.res : { text: '등기번호 반품원등기번호:6077', at: NOW }; }
  });
  return { relay, calls };
}
const fail = async () => { const e = new Error('fetch failed'); e.cause = { code: 'UND_ERR_CONNECT_TIMEOUT' }; throw e; };

test('서버 직접 조회가 되면 상시 컴퓨터를 부르지 않는다', async () => {
  const { relay, calls } = setup({});
  assert.strictEqual(await relay.fetch('1', async () => '직접'), '직접');
  assert.deepStrictEqual(calls.ask, []);
  assert.deepStrictEqual(calls.down, []);
});

test('직접 조회가 실패하면 막힘을 표시하고 상시 컴퓨터 결과를 쓴다', async () => {
  const { relay, calls } = setup({});
  assert.match(await relay.fetch('1', fail), /반품원등기번호/);
  assert.deepStrictEqual(calls.ask, ['1']);
  assert.strictEqual(calls.down.length, 1);
  assert.ok(calls.down[0] > NOW);
});

test('막힘 표시 중에는 직접 조회를 건너뛴다', async () => {
  const { relay } = setup({ down: NOW + 60000 });
  await relay.load();
  let direct = 0;
  await relay.fetch('1', async () => { direct++; return '직접'; });
  assert.strictEqual(direct, 0);
});

test('막힘 표시가 지났으면 다시 직접 조회한다', async () => {
  const { relay, calls } = setup({ down: NOW - 1 });
  await relay.load();
  assert.strictEqual(await relay.fetch('1', async () => '직접'), '직접');
  assert.deepStrictEqual(calls.ask, []);
});

test('막힘 표시 중 상시 컴퓨터가 실패하면 직접 조회로 돌아간다', async () => {
  const { relay } = setup({ down: NOW + 60000, res: null });
  await relay.load();
  assert.strictEqual(await relay.fetch('1', async () => '직접'), '직접');
});

test('상시 컴퓨터가 꺼져 있으면 기다리지 않고 이유를 알린다', async () => {
  for (const runner of [null, { ts: NOW - 10 * 60000 }]) {
    const { relay, calls } = setup({ runner });
    await assert.rejects(relay.fetch('1', fail), /상시 컴퓨터 꺼짐/);
    assert.deepStrictEqual(calls.ask, []);
  }
});

test('상시 컴퓨터 응답이 없으면 이유를 알린다', async () => {
  const { relay } = setup({ res: null });
  await assert.rejects(relay.fetch('1', fail), /상시 컴퓨터 응답 없음/);
});

test('상시 컴퓨터가 오류를 돌려주면 이유를 알린다', async () => {
  const { relay } = setup({ res: { err: 'http 500', at: NOW } });
  await assert.rejects(relay.fetch('1', fail), /http 500/);
});

test('배송조회 내용이 아닌 응답은 받지 않는다 (반송으로 잘못 판단 방지)', async () => {
  const { relay } = setup({ res: { text: '점검 중입니다', at: NOW } });
  await assert.rejects(relay.fetch('1', fail), /내용 이상/);
});
