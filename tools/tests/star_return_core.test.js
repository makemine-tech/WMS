/* 반품입고 공통 판정 (main/star_return_core.js) — 브라우저 전역을 흉내 내 화물·스타 두 화면으로 불러 시험 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '../../main/star_return_core.js'), 'utf8');
function load(search) {
  const ctx = { location: { search }, NOTES: {}, base: null, byName: () => 'x', toast: () => {}, window: {}, Object, String, Math, Date };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return ctx;
}
const items = () => [{ bopt: 'B1', ordlist: 'O1', name: '상품1', nicn: '880001', qty: 2, got: 0 }, { bopt: 'B2', ordlist: 'O1', name: '상품2', nicn: '880002', qty: 1, got: 0 }];
const rec = (o) => Object.assign({ rno: '1', trace: 'ok', orig: '9', look: 'ok', vendor: 'A', courier: '한진', orders: [{ code: 'O1', cust: '1', ret: '-' }], items: items(), extras: [] }, o);

test('화물: 스캔이 없어도 막지 않고 주문 상품 전부를 반영', () => {
  const C = load('?db=cargo');
  const r = rec();
  const j = C.judge(r);
  assert.strictEqual(j.block.length, 0);
  assert.ok(j.info.some((t) => /스캔 없음/.test(t)));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(C.ebutLines(r))), [{ bopt: 'B1', ordlist: 'O1', qty: 2, q: '1' }, { bopt: 'B2', ordlist: 'O1', qty: 1, q: '1' }]);
  assert.strictEqual(JSON.stringify(C.gotItems(r).map((x) => x.got)), '[2,1]');
});

test('화물: 스캔한 상품이 있으면 그것만 반영', () => {
  const C = load('?db=cargo');
  const r = rec();
  r.items[1].got = 1;
  assert.deepStrictEqual(JSON.parse(JSON.stringify(C.ebutLines(r))), [{ bopt: 'B2', ordlist: 'O1', qty: 1, q: '1' }]);
});

test('화물: 직접 입력(아무 이름)은 막지 않고 메모에 이름이 들어감', () => {
  const C = load('?db=cargo');
  const r = rec({ extras: [{ code: '', name: '파란 상자 아무거나', n: 2, man: true }] });
  const j = C.judge(r);
  assert.strictEqual(j.block.length, 0);
  assert.ok(j.info.some((t) => /파란 상자 아무거나 2개/.test(t)));
  assert.strictEqual(C.extrasHold(r), false);
  assert.strictEqual(C.ebutLines(r).length, 2);
});

test('스타: 예전처럼 스캔이 있어야 하고 주문 외 상품은 사람이 봄', () => {
  const C = load('');
  const r = rec({ orders: [{ code: 'O1', cust: '446', ret: '-' }], extras: [{ code: '123', n: 1 }] });
  assert.strictEqual(JSON.stringify(C.judge(r).block), JSON.stringify(['반품 상품 스캔 없음']));
  assert.strictEqual(C.ebutLines(r).length, 0);
  assert.strictEqual(C.extrasHold(r), true);
});
