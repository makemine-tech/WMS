/* 곡물도감 합포 분할 계산 (main/ez_split_calc.js) */
const test = require('node:test');
const assert = require('node:assert');
const Z = require('../../main/ez_split_calc.js');

/* picking_ez.html 의 prodKeyOf + boxKeyOf 를 그대로 옮긴 것 — 우리 키가 피킹이지 기록 키와 같아야 함 */
function pickingBoxKey(items){
  const s = items.map(it => (it.loc || '—') + '|' + (it.prd || '—') + '|' + (it.qty || 1)).sort().join(';;');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return 'b' + h.toString(36) + s.length.toString(36);
}

/* 이지어드민 줄 만들기 */
let SEQ = 1000;
function row(pack, name, qty, extra){
  return Object.assign({ recv: '수령자', seq: String(pack), pack_seq: String(pack), product_seq: String(SEQ++),
    product_id: 'P' + name.length, name: name, options: '', qty: String(qty), divided: false }, extra || {});
}
const S15 = '서리태 가득콩물 15입 [곡물도감]★', S30 = '서리태 가득콩물 30입 [곡물도감]★★',
      S45 = '서리태 가득콩물 45입 [곡물도감]★★★', S60 = '서리태 가득콩물 60입 [곡물도감]★★★★',
      M15 = '말차 가득콩물 15입 [곡물도감]★', GR = 'Granola 오리지널', N1 = 'N1 스타터팩 두유 6종';

/* ── Task 2: 이름·구분·키·주문 묶기 ── */
test('normName: ★와 앞뒤 공백 제거', () => {
  assert.strictEqual(Z.normName('카무트귀리두유 30입 [곡물도감] ★★ '), '카무트귀리두유 30입 [곡물도감]');
});
test('classify: 본품 칸·서리태60·소형·오리진케어·모르는 상품', () => {
  assert.deepStrictEqual(Z.classify('서리태 가득콩물 45입 [곡물도감]'), { kind: 'main', kan: 3, seori60: false });
  assert.deepStrictEqual(Z.classify('서리태 가득콩물 60입 [곡물도감]'), { kind: 'main', kan: 4, seori60: true });
  assert.strictEqual(Z.classify('N1 스타터팩 두유 6종').kind, 'small');
  assert.strictEqual(Z.classify('C 그래놀라 4종x2개 8개 PACK').kind, 'small');
  assert.strictEqual(Z.classify('Granola 카카오').kind, 'small');
  assert.strictEqual(Z.classify('1병_당쉼 검은콩').kind, 'ori');
  assert.strictEqual(Z.classify('오리진케어 OTG 레몬').kind, 'ori');
  assert.strictEqual(Z.classify('새 상품').kind, 'unknown');
});
test('boxKeyOf 가 피킹이지 키와 같음', () => {
  const items = [{ prd: '서리태 가득콩물 30입 [곡물도감]', qty: 1 }, { prd: 'Granola 오리지널', qty: 40 }];
  assert.strictEqual(Z.boxKeyOf(items), pickingBoxKey(items));
});
test('buildOrders: 묶음번호로 묶음, 같은 상품코드 두 줄은 따로 유지', () => {
  const a = row(1, S15, 1), b = row(1, M15, 1), c = row(2, S30, 1), d = row(2, S30, 1, { product_id: c.product_id });
  const orders = Z.buildOrders([a, b, c, d]);
  assert.strictEqual(orders.length, 2);
  assert.strictEqual(orders[0].lines.length, 2);
  assert.strictEqual(orders[1].lines.length, 2);
  assert.strictEqual(orders[0].lines[0].prd, '서리태 가득콩물 15입 [곡물도감]');
  assert.strictEqual(orders[0].lines[0].qty, 1);
  assert.ok(Z.canSplit(orders[0]));
});
test('buildOrders: 수량 0 줄은 뺌', () => {
  const o = Z.buildOrders([row(3, S15, 1), row(3, M15, 0)])[0];
  assert.strictEqual(o.lines.length, 1);
});
test('buildOrders: 이미 나뉨·오리진케어·모르는 상품·옵션은 flags, 나누지 않음', () => {
  const [d, o, u, p] = Z.buildOrders([
    row(4, S15, 1, { divided: true }),
    row(5, S15, 1), row(5, '1병_당쉼 검은콩', 1),
    row(6, '새 상품', 1),
    row(7, S15, 1, { options: '빨강' })]);
  assert.deepStrictEqual(d.flags, ['divided']);
  assert.deepStrictEqual(o.flags, ['ori']);
  assert.deepStrictEqual(u.flags, ['unknown']);
  assert.deepStrictEqual(p.flags, ['option']);
  [d, o, u, p].forEach(x => assert.strictEqual(Z.canSplit(x), false));
});

module.exports = { row, S15, S30, S45, S60, M15, GR, N1 };
