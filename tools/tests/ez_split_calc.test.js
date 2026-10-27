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

/* ── Task 3: 양 끝·박스 크기 ── */
const one = rows => Z.buildOrders(rows)[0];
const shape = invs => invs.map(i => i.lines.map(l => l.prd.split(' ')[0] + (l.prd.match(/\d+입/) || [''])[0] + '×' + l.qty).sort().join('+'));

test('서리태30×2 + 그래놀라40: 전부 분리 2장(소형은 앞 송장), 전부 합포도 2장(4칸 꽉 참)', () => {
  const o = one([row(10, S30, 2), row(10, GR, 40)]);
  assert.deepStrictEqual(shape(Z.splitMax(o)), ['Granola×40+서리태30입×1', '서리태30입×1']);
  assert.deepStrictEqual(shape(Z.splitMin(o)), ['서리태30입×2', 'Granola×40']);
});
test('서리태15 + 말차15 + 그래놀라40: 전부 합포 1장, 3칸, 기록 없으면 45', () => {
  const o = one([row(11, S15, 1), row(11, M15, 1), row(11, GR, 40)]);
  const inv = Z.splitMin(o);
  assert.strictEqual(inv.length, 1);
  assert.strictEqual(Z.kanOf(inv[0]), 3);
  assert.strictEqual(Z.boxSize(inv[0], {}), '45');
});
test('서리태60 + 그래놀라: 양 끝 모두 서리태60 따로·소형 따로', () => {
  const o = one([row(12, S60, 1), row(12, GR, 10)]);
  assert.deepStrictEqual(shape(Z.splitMax(o)), ['서리태60입×1', 'Granola×10']);
  assert.deepStrictEqual(shape(Z.splitMin(o)), ['서리태60입×1', 'Granola×10']);
});
test('소형만 = 1장, 15박스', () => {
  const inv = Z.splitMax(one([row(13, GR, 12)]));
  assert.strictEqual(inv.length, 1);
  assert.strictEqual(Z.boxSize(inv[0], {}), '15');
});
test('서리태15×5 전부 합포 = 4칸 + 1칸 2장', () => {
  assert.deepStrictEqual(shape(Z.splitMin(one([row(14, S15, 5)]))), ['서리태15입×4', '서리태15입×1']);
});
test('boxSize: 피킹이지 기록이 있으면 기록값', () => {
  const inv = Z.splitMin(one([row(15, S15, 1), row(15, M15, 1), row(15, N1, 1)]))[0];
  assert.strictEqual(Z.boxSize(inv, {}), '45');
  const key = Z.boxKeyOf(inv.lines);
  assert.strictEqual(Z.boxSize(inv, { [key]: '30' }), '30');
});

/* ── Task 4: 막대·숫자 ── */
const FEE = require('../../main/p9_fee.js');
const SHIP = { '15': 3000, '30': 3500, '45': 4000, '60': 4500 };
const ctxOf = () => ({ boxes: {}, fee: FEE, settings: { ship: SHIP, sec: { single: 20, mix2: 60, mix3: 90 } }, times: {} });
function sampleOrders(){
  return Z.buildOrders([
    row(21, S15, 1), row(21, M15, 1), row(21, GR, 20),
    row(22, S30, 2), row(22, N1, 1),
    row(23, S15, 3),
    row(24, S60, 1), row(24, GR, 10),
    row(25, S45, 1),
    row(26, '1병_당쉼 검은콩', 2), row(26, S15, 1)]);
}
const sum = (os, f) => os.filter(Z.canSplit).reduce((a, o) => a + f(o).length, 0) + os.filter(o => !Z.canSplit(o)).length;

test('invCost: 서리태15+말차15 한 장 = 포장비 1000, 소분 0, 30박스, 믹스2 60초', () => {
  const c = Z.invCost({ lines: [{ seq: 'a', prd: '서리태 가득콩물 15입 [곡물도감]', qty: 1 }, { seq: 'b', prd: '말차 가득콩물 15입 [곡물도감]', qty: 1 }] }, ctxOf());
  assert.deepStrictEqual(c, { size: '30', sec: 60, ship: 3500, fee: 1000, pre: 0 });
});
test('막대 0 = 전부 분리 송장 수, 끝 = 전부 합포 이하', () => {
  const os = sampleOrders(), ctx = ctxOf(), steps = Z.buildSteps(os, ctx);
  assert.strictEqual(Z.planAt(os, steps, 0, ctx).totals.count, sum(os, Z.splitMax));
  assert.ok(Z.planAt(os, steps, steps.length, ctx).totals.count <= sum(os, Z.splitMin));
});
test('같은 입력이면 합치기 순서가 항상 같음', () => {
  const ctx = ctxOf(), os = sampleOrders();
  assert.strictEqual(JSON.stringify(Z.buildSteps(os, ctx)), JSON.stringify(Z.buildSteps(os, ctx)));
});
test('막대를 오른쪽으로 갈수록 택배비가 줄거나 같음', () => {
  const os = sampleOrders(), ctx = ctxOf(), steps = Z.buildSteps(os, ctx);
  let prev = Infinity;
  for (let n = 0; n <= steps.length; n++){ const s = Z.planAt(os, steps, n, ctx).totals.ship; assert.ok(s <= prev, 'n=' + n); prev = s; }
});
test('나눌 수 없는 주문(오리진케어 섞임)은 원래대로 1장', () => {
  const os = sampleOrders(), ctx = ctxOf(), steps = Z.buildSteps(os, ctx);
  assert.strictEqual(Z.planAt(os, steps, steps.length, ctx).byPack['26'].length, 1);
  assert.ok(steps.every(s => s.pack !== '26'));
});

/* ── Task 5: 기존대로·채우기 자료 ── */
const keyOf = pairs => Z.boxKeyOf(pairs.map(p => ({ prd: p[0], qty: p[1] })));
test('기존대로: 기록된 조각으로만 나누기, 송장 수 최소', () => {
  const o = one([row(31, S30, 1), row(31, GR, 40)]);
  const boxes = { [keyOf([['서리태 가득콩물 30입 [곡물도감]', 1]])]: '30', [keyOf([['Granola 오리지널', 40]])]: '15' };
  assert.deepStrictEqual(shape(Z.existing(o, boxes)), ['서리태30입×1', 'Granola×40']);
  boxes[keyOf([['서리태 가득콩물 30입 [곡물도감]', 1], ['Granola 오리지널', 40]])] = '45';
  assert.deepStrictEqual(shape(Z.existing(o, boxes)), ['Granola×40+서리태30입×1']);
});
test('기존대로: 기록이 없으면 null, 경고 new (나누기는 막지 않음)', () => {
  const o = one([row(32, S15, 1), row(32, M15, 1)]);
  assert.strictEqual(Z.existing(o, {}), null);
  assert.deepStrictEqual(o.warn, ['new']);
  assert.ok(Z.canSplit(o));
});
test('기존대로: 본품 단위 10개 넘으면 null, 경고 toomany', () => {
  const o = one([row(33, S15, 11)]);
  assert.strictEqual(Z.existing(o, {}), null);
  assert.deepStrictEqual(o.warn, ['toomany']);
});
test('planExisting: 기록 없는 주문은 전부 합포 결과', () => {
  const os = Z.buildOrders([row(34, S15, 5)]);
  const r = Z.planExisting(os, ctxOf());
  assert.strictEqual(r.byPack['34'].length, 2);
  assert.strictEqual(r.totals.count, 2);
});
test('fillPayload: 서리태30×2 를 두 장으로 → 박스 1·2 에 1개씩, 한 장짜리 주문은 뺌', () => {
  const os = Z.buildOrders([row(35, S30, 2), row(36, S15, 1)]);
  const byPack = { '35': Z.splitMax(os[0]), '36': Z.splitMax(os[1]) };
  const p = Z.fillPayload(os, byPack);
  assert.strictEqual(p.length, 1);
  assert.strictEqual(p[0].pack_seq, '35');
  assert.deepStrictEqual(p[0].lines[0].boxes, [{ no: 1, qty: 1 }, { no: 2, qty: 1 }]);
  assert.strictEqual(p[0].lines[0].qty, 2);
  assert.strictEqual(p[0].lines[0].product_id, os[0].lines[0].pid);
});

/* ── Task 6 에서 찾음: 이지어드민 N1 스타터팩 이름 뒤 「-약,21,…」는 송장 PDF 에 없음 ── */
test('normName: 끝의 「-구성」 꼬리 제거 (N1 스타터팩)', () => {
  assert.strictEqual(Z.normName('N1 스타터팩 두유 6종-약,21,말,비,카,맷'), 'N1 스타터팩 두유 6종');
  assert.strictEqual(Z.normName('C 그래놀라 4종x2개 8개 PACK'), 'C 그래놀라 4종x2개 8개 PACK');
});

/* ── 박스 크기별 · 단포/합포 요약 (대표님 2026-10-27: 구성 하나하나 말고 묶어서) ── 단포 = 상품 1개(1종 1개)짜리 송장 */
test('summary: 박스 크기별 단포·합포 장수', () => {
  const inv = pairs => ({ lines: pairs.map((p, i) => ({ seq: String(i), prd: p[0], qty: p[1] })) });
  const byPack = {
    a: [inv([['서리태 가득콩물 15입 [곡물도감]', 1]]), inv([['말차 가득콩물 15입 [곡물도감]', 1], ['Granola 오리지널', 10]])],
    b: [inv([['서리태 가득콩물 15입 [곡물도감]', 2]])],
    c: [inv([['서리태 가득콩물 60입 [곡물도감]', 1]]), inv([['Granola 오리지널', 10]])]
  };
  const s = Z.summary(byPack, {});
  assert.deepStrictEqual(s.bySize['15'], { single: 1, multi: 1 });   /* 서리태15 1개 = 단포, 그래놀라만 = 합포 */
  assert.deepStrictEqual(s.bySize['30'], { single: 0, multi: 2 });   /* 말차15+그래놀라, 서리태15×2 */
  assert.deepStrictEqual(s.bySize['60'], { single: 1, multi: 0 });
  assert.deepStrictEqual({ single: s.single, multi: s.multi, total: s.total }, { single: 2, multi: 3, total: 5 });
});

/* ── 일괄합포제외 뒤 결과 대조: 다시 읽은 줄에서 원래 묶음에 박스 1 몫만 남았는지 ── */
test('verifyAfter: 박스 1 몫만 남으면 반영됨, 원래 수량 그대로면 안 됨, 묶음이 없어지면 확인 필요', () => {
  const pay = [
    { pack_seq: '1', lines: [{ product_seq: 'a', product_id: 'x', qty: 2, boxes: [{ no: 1, qty: 1 }, { no: 2, qty: 1 }] },
                             { product_seq: 'b', product_id: 'y', qty: 1, boxes: [{ no: 3, qty: 1 }] }] },
    { pack_seq: '2', lines: [{ product_seq: 'c', product_id: 'x', qty: 1, boxes: [{ no: 1, qty: 1 }] },
                             { product_seq: 'd', product_id: 'y', qty: 1, boxes: [{ no: 2, qty: 1 }] }] },
    { pack_seq: '3', lines: [{ product_seq: 'e', product_id: 'x', qty: 1, boxes: [{ no: 1, qty: 1 }] },
                             { product_seq: 'f', product_id: 'y', qty: 1, boxes: [{ no: 2, qty: 1 }] }] }];
  const after = [
    { pack_seq: '1', product_seq: 'a', qty: '1' },                                    /* 반영됨: a 1개만 남고 b 는 빠짐 */
    { pack_seq: '2', product_seq: 'c', qty: '1' }, { pack_seq: '2', product_seq: 'd', qty: '1' }  /* 안 됨: d 가 그대로 */
  ];                                                                                   /* 묶음 3 은 없음 */
  const v = Z.verifyAfter(pay, after);
  assert.deepStrictEqual(v.ok, ['1']);
  assert.deepStrictEqual(v.notApplied, ['2']);
  assert.deepStrictEqual(v.gone, ['3']);
});
