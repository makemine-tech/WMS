/* 이지어드민 비서 읽기 전용 미리 보기 (main/secretary_ez.js) — 실제 계산 모듈로 시험 */
const test = require('node:test');
const assert = require('node:assert');
const Z = require('../../main/ez_split_calc.js');
const FEE = require('../../main/p9_fee.js');
const { preview, searchSettled, MAX_ORDERS, RECHECK_MS } = require('../../main/secretary_ez.js');

const NAME = '서리태 가득콩물 15입';
function row(pack, qty, extra) {
  return Object.assign({ recv: '홍길동', seq: '1', pack_seq: String(pack), product_seq: String(pack) + '1', product_id: 'P1', name: NAME, options: '', qty, divided: false }, extra);
}
const go = (rows, total, boxes) => preview({ rows, total: total === undefined ? rows.length : total }, boxes || {}, Z, FEE);

test('검색 결과가 비면 기다렸다 다시 읽어 늦게 뜬 주문을 놓치지 않음', async () => {
  const slept = [];
  const r = await searchSettled(async () => ({ rows: [], total: 0 }), async () => ({ rows: [row(1, 1)], total: 1 }), async (ms) => { slept.push(ms); });
  assert.deepStrictEqual(slept, [RECHECK_MS]);
  assert.strictEqual(r.rows.length, 1);
});

test('검색 결과가 있으면 다시 읽지 않음', async () => {
  let reads = 0;
  const r = await searchSettled(async () => ({ rows: [row(1, 1)], total: 1 }), async () => { reads++; return { rows: [], total: 0 }; }, async () => {});
  assert.strictEqual(reads, 0);
  assert.strictEqual(r.rows.length, 1);
});

test('주문이 없으면 0건으로 정상', () => {
  const p = go([]);
  assert.strictEqual(p.orders, 0);
  assert.strictEqual(p.invoices, 0);
  assert.deepStrictEqual(p.blockers, []);
});

test('한 건도 빠짐없이 읽혔는지 확인: 줄 수가 다르면 막음', () => {
  const p = go([row(1, 1)], 2);
  assert.strictEqual(p.blockers.length >= 1, true);
  assert.match(p.blockers.join(), /2줄.*1줄/);
});

test('수령자 정보를 결과에 담지 않음', () => {
  const p = go([row(1, 1), row(2, 3, { name: '모르는 상품' })]);
  assert.strictEqual(JSON.stringify(p).includes('홍길동'), false);
});

test('모르는 상품은 막음', () => {
  const p = go([row(1, 1, { name: '모르는 상품' })]);
  assert.strictEqual(p.flags.unknown, 1);
  assert.match(p.blockers.join(), /모르는 상품 1건/);
  assert.deepStrictEqual(p.unknownProds, [{ prd: '모르는 상품', orders: 1 }]);
});

test('옵션·이미 나뉜 주문은 그대로 두고 건수만 알림', () => {
  const p = go([row(1, 1, { options: '빨강' }), row(2, 1, { divided: true })]);
  assert.strictEqual(p.flags.option, 1);
  assert.strictEqual(p.flags.divided, 1);
  assert.strictEqual(p.splitPacks, 0);
});

test('피킹이지 기록이 없는 구성은 처음 보는 구성으로 막음', () => {
  const p = go([row(1, 1), row(2, 1)]);
  assert.strictEqual(p.newComps.length, 1);
  assert.strictEqual(p.newComps[0].orders, 2);
  assert.match(p.newComps[0].comp, /서리태/);
  assert.match(p.blockers.join(), /처음 보는 구성 2건/);
});

test('기록이 있는 구성은 막지 않고, 건수와 박스별 수를 냄', () => {
  const key = Z.boxKeyOf([{ prd: NAME, qty: 1 }]);
  const p = go([row(1, 1), row(2, 1)], 2, { [key]: '15박스' });
  assert.deepStrictEqual(p.blockers, []);
  assert.strictEqual(p.orders, 2);
  assert.strictEqual(p.invoices, 2);
  assert.strictEqual(p.splitPacks, 0);
  assert.strictEqual(Array.isArray(p.sizes), true);
  assert.strictEqual(p.sizes.reduce((a, s) => a + s.single + s.multi, 0), 2);
});

test('건수 상한을 넘으면 막음', () => {
  assert.strictEqual(MAX_ORDERS, 3500);
  const rows = [];
  for (let i = 0; i < 3501; i++) rows.push(row(i, 1));
  assert.match(go(rows).blockers.join(), /3,?500/);
});
