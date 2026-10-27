/* 이지어드민 피킹 (main/picking_ez.html) — 송장 PDF 장들을 송장으로 묶는 부분 (parseEasyAdmin ~ buildInvoices)
   페이지 안의 진짜 코드를 잘라 와서 시험한다 */
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const fs = require('fs');

const html = fs.readFileSync(__dirname + '/../../main/picking_ez.html', 'utf8');
const start = html.indexOf('function parseEasyAdmin(raw)');
const end = html.indexOf('/* ─────────────── 로케이션 그룹');
const SRC = html.slice(start, end);
function load(){
  const ctx = { invoices: [], dupInvPages: [], cancelPages: [] };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return ctx;
}
const page = (idx, raw) => ({ idx, raw, coord: null });
const inv = (no, item) => '고객 주문처: Hmall 주문번호: 1 등기번호: ' + no + ' ▶1개▶' + item + ' 주문인: x';

/* 대표님 2026-10-27: 이지어드민 송장출력에 「주문이 삭제되었습니다」 빈 장이 섞여 앞 송장에 붙어 같이 인쇄되고 순번을 먹음 */
test('삭제된 주문 장은 앞 송장에 붙지 않고 빠짐', () => {
  const c = load();
  c.buildInvoices([
    page(0, inv('60820-3747-3310', '서리태 가득콩물 45입 [곡물도감]')),
    page(1, '[786 / 1210] 주문이 삭제되었습니다. [관리번호:10944430, 고객명:]'),
    page(2, inv('60820-3747-3311', '서리태 가득콩물 45입 [곡물도감]'))]);
  assert.strictEqual(c.invoices.length, 2);
  assert.strictEqual(JSON.stringify(c.invoices.map(i => i.pages)), '[[0],[2]]');
  assert.strictEqual(c.cancelPages.length, 1);
  assert.strictEqual(c.cancelPages[0].page, 2);
  assert.strictEqual(c.cancelPages[0].mng, '10944430');
});
test('등기번호 없는 보통 다음 장은 그대로 앞 송장에 붙음', () => {
  const c = load();
  c.buildInvoices([page(0, inv('60820-1', '말차 가득콩물 15입')), page(1, '▶1개▶그래놀라 이어지는 장')]);
  assert.strictEqual(JSON.stringify(c.invoices[0].pages), '[0,1]');
  assert.strictEqual(c.cancelPages.length, 0);
});
test('안내문에 삭제된 주문 장 수가 나옴', () => {
  const c = load();
  c.buildInvoices([page(0, inv('60820-1', '말차 가득콩물 15입')), page(1, '주문이 삭제되었습니다. [관리번호:10944430, 고객명:]')]);
  assert.match(c.dupNotice(), /삭제된 주문 1장/);
});
