/* 전담비서 생존 감시 (functions-settle/secretary_watch.js) */
const test = require('node:test');
const assert = require('node:assert');
const { watchDecision } = require('../../functions-settle/secretary_watch.js');
const NOW = 100000000;
const MIN = 60000;

test('등록된 PC 가 없으면 아무것도 안 남김', () => {
  assert.deepStrictEqual(watchDecision(null, null, NOW), { state: 'none', note: '' });
});
test('켜진 상태가 이어지면 기록 없음', () => {
  assert.deepStrictEqual(watchDecision({ id: 'a', ts: NOW - MIN }, { state: 'on' }, NOW), { state: 'on', note: '' });
  assert.strictEqual(watchDecision({ id: 'a', ts: NOW - MIN }, null, NOW).note, '');
});
test('끊기면 한 번만 기록', () => {
  assert.match(watchDecision({ id: 'a', ts: NOW - 3 * MIN - 1 }, { state: 'on' }, NOW).note, /끊겼/);
  assert.strictEqual(watchDecision({ id: 'a', ts: NOW - 60 * MIN }, { state: 'off' }, NOW).note, '');
});
test('돌아오면 기록', () => {
  assert.match(watchDecision({ id: 'a', ts: NOW }, { state: 'off' }, NOW).note, /돌아왔/);
});
