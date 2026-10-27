/* 곡물도감·오리진케어 포장비 (main/p9_fee.js) — 정산 엔진과 합포 분할이 같이 쓰는 계산 */
const test = require('node:test');
const assert = require('node:assert');
const { gokFee, oriFee } = require('../../main/p9_fee.js');

/* [[상품명, 수량], ...] → 엔진 꼴 (0번 자리는 비움) */
function hr(pairs){ return [[''].concat(pairs.map(p => p[0])), [0].concat(pairs.map(p => p[1]))]; }
const gok = pairs => gokFee.apply(null, hr(pairs));
const ori = pairs => oriFee.apply(null, hr(pairs));

test('완제 박스 하나 = 300 완박스', () => {
  const r = gok([['서리태 가득콩물 15입 [곡물도감]', 1]]);
  assert.strictEqual(r.fee, 300); assert.strictEqual(r.kind, '완박스');
});
test('60입 단독 = 1500', () => {
  const r = gok([['서리태 가득콩물 60입 [곡물도감]', 1]]);
  assert.strictEqual(r.fee, 1500); assert.strictEqual(r.kind, '60입단독');
});
test('같은 상품 3박스까지 300, 4박스부터 1500', () => {
  assert.strictEqual(gok([['서리태 가득콩물 15입 [곡물도감]', 3]]).fee, 300);
  assert.strictEqual(gok([['서리태 가득콩물 15입 [곡물도감]', 4]]).fee, 1500);
});
test('믹스는 박스 수로: 2박스 1000, 3박스 1500', () => {
  assert.strictEqual(gok([['서리태 가득콩물 15입 [곡물도감]', 1], ['말차 가득콩물 15입 [곡물도감]', 1]]).fee, 1000);
  assert.strictEqual(gok([['서리태 가득콩물 30입 [곡물도감]', 1], ['말차 가득콩물 15입 [곡물도감]', 1]]).fee, 1500);
});
test('S팩 섞이면 1박스로 세고 소분 1', () => {
  const r = gok([['서리태 가득콩물 15입 [곡물도감]', 1], ['S 스타터팩 두유 6종', 1]]);
  assert.strictEqual(r.fee, 1000); assert.strictEqual(r.pre, 1);
});
test('그래놀라 20개 = 소분 2·박스 2', () => {
  const r = gok([['Granola 오리지널', 20]]);
  assert.strictEqual(r.pre, 2); assert.strictEqual(r.box, 2);
});
test('오리진케어: 1병 7개 1500, OTG 1000', () => {
  assert.strictEqual(ori([['1병_당쉼 검은콩', 7]]).fee, 1500);
  assert.strictEqual(ori([['오리진케어 OTG 레몬', 1]]).fee, 1000);
});
