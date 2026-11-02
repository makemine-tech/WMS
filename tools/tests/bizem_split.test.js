/* 비젬 양식 파일 나누기 (main/bizem_split.js) */
const test = require('node:test');
const assert = require('node:assert');
const { split, fileName, MENSO_SITES } = require('../../main/bizem_split.js');

const HEAD = ['주문번호', '주문자이름', '수취인', '주소', '상품수량'];
const row = (no, site, addr) => [no, site, '수취인' + no, addr === undefined ? '주소' + no : addr, 1];

test('맨소래담 판매처 3개는 맨소래담, 나머지는 박스앤캔, 줄 순서·칸 유지', () => {
  const r = split([HEAD, row(1, '맨소래담-무신사'), row(2, '쿠팡(박스앤캔)'), row(3, '지그재그_맨소래덤'), row(4, '멘소래담_에이블리'), row(5, '박스앤캔-에이블리')]);
  assert.deepStrictEqual(r.menso.map((x) => x[0]), [1, 3, 4]);
  assert.deepStrictEqual(r.boxncan.map((x) => x[0]), [2, 5]);
  assert.deepStrictEqual(r.head, HEAD);
  assert.deepStrictEqual(r.menso[0], row(1, '맨소래담-무신사'));
});

test('철자가 조금 달라도 맨소래담으로 넣지 않고 판매처별 건수로 드러남', () => {
  const r = split([HEAD, row(1, '멘소래담-무신사'), row(2, '맨소래담_무신사'), row(3, '맨소래담-무신사')]);
  assert.strictEqual(r.menso.length, 1);
  assert.strictEqual(r.boxncan.length, 2);
  assert.deepStrictEqual(r.sites.map((s) => [s.name, s.count, s.to]), [['맨소래담-무신사', 1, 'menso'], ['멘소래담-무신사', 1, 'boxncan'], ['맨소래담_무신사', 1, 'boxncan']]);
});

test('앞뒤 공백은 무시하고 판매처를 맞춤', () => {
  assert.strictEqual(split([HEAD, row(1, ' 맨소래담-무신사 ')]).menso.length, 1);
});

test('제목 줄이 맨 위가 아니어도 찾고, 빈 줄은 건너뜀', () => {
  const r = split([['비젬 양식'], [], HEAD, row(1, '맨소래담-무신사'), ['', '', '', '', ''], row(2, '오너클랜')]);
  assert.strictEqual(r.menso.length, 1);
  assert.strictEqual(r.boxncan.length, 1);
});

test('주문자이름 칸이 없으면 나누지 않고 알림', () => {
  assert.throws(() => split([['주문번호', '주소'], [1, 'x']]), /주문자이름/);
  assert.throws(() => split([]), /주문자이름/);
});

test('주소 없는 줄과 판매처 없는 줄을 세어 알림', () => {
  const r = split([HEAD, row(1, '맨소래담-무신사', ''), row(2, '', '주소'), row(3, '오너클랜', '  ')]);
  assert.deepStrictEqual(r.noAddress, { menso: 1, boxncan: 1 });
  assert.strictEqual(r.emptySite, 1);
  assert.strictEqual(r.boxncan.length, 2);
  assert.ok(r.sites.some((s) => s.name === '(비어 있음)'));
});

test('결과 합계가 원래 줄 수와 같음', () => {
  const rows = [HEAD];
  for (let i = 0; i < 300; i++) rows.push(row(i, i % 3 ? '오너클랜' : MENSO_SITES[i % 9 ? 0 : 1]));
  const r = split(rows);
  assert.strictEqual(r.menso.length + r.boxncan.length, 300);
  assert.strictEqual(r.sites.reduce((a, s) => a + s.count, 0), 300);
});

test('파일 이름: 종류와 날짜', () => {
  assert.strictEqual(fileName('menso', '2026-11-03'), '맨소래담_2026-11-03.xlsx');
  assert.strictEqual(fileName('boxncan', '2026-11-03'), '박스앤캔_2026-11-03.xlsx');
});
