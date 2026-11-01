/* 주문 매칭 도움 (main/secretary_match.js) */
const test = require('node:test');
const assert = require('node:assert');
const M = require('../../main/secretary_match.js');
const kinds = (n, o) => M.warnings(n, o).map((w) => w.kind);

test('대표님 예: 상품명 2개, 옵션 3개면 옵션 우선 안내', () => {
  const w = M.warnings('[추가10%적립] 아크네스 데일리 딥 클렌저 120g, 2개', '수량: 3개');
  assert.strictEqual(w[0].kind, 'option');
  assert.match(w[0].text, /옵션 3개 우선/);
});

test('대표님 예: 롤온+쿨온 이름에 옵션 핫 롤온 2개', () => {
  assert.ok(kinds('멘소래담 마사지 롤온 로션 50ml + 쿨 롤온 로션 50ml', '선택: 핫 롤온 로션 2개').includes('set'));
  assert.ok(kinds('멘소래담 마사지 롤온 로션 50ml + 쿨 롤온 로션 50ml', '선택: 핫 롤온 로션 2개').includes('option'));
});

test('실제 기록 유형: 1+1, 2Pack, 개수, 세트, 증정', () => {
  assert.ok(kinds('아크네스 포밍워시 180ml 2개', '수량: 1+1').includes('pack'));
  assert.ok(kinds('[2Pack] 약산성 모공 클리어 젤 클렌저 125ml', '').includes('pack'));
  assert.ok(kinds('멘소래담 스프레이 쿨 파스 180ml, 3개', '').includes('count'));
  assert.ok(kinds('하다라보 고쿠쥰 리프팅 3종 세트, 로션 + 밀크 + 크림', '').includes('set'));
  assert.ok(kinds('[증정/크림20ml] 아크네스 세범 밸런싱 스킨', '').includes('gift'));
});

test('평범한 상품은 주의 없음', () => {
  assert.deepStrictEqual(M.warnings('아크네스 퍼펙트 솔루션 스팟 패치 120매', ''), []);
});

const MASTERS = [
  { code: '1', name: '[A45아크네스]아크네스 데일리 딥 클렌저 120g' },
  { code: '2', name: '[A03아크네스] 데일리 딥 클렌저 100g' },
  { code: '3', name: '[M01멘소래담] 마사지 롤온 로션 50ml' },
  { code: '4', name: '[M29멘소래담] 쿨 스프레이 180ml' },
  { code: '5', name: '(사은품) 플루이드 20ml' },
];

test('후보: 상품명과 가까운 상품이 앞, 용량까지 맞으면 더 앞', () => {
  const c = M.candidates('[추가10%적립] 아크네스 데일리 딥 클렌저 120g, 2개', '', MASTERS);
  assert.strictEqual(c[0].code, '1');
  assert.strictEqual(c[1].code, '2');
  assert.ok(!c.some((x) => x.code === '4'));
});

test('후보: 작업자 검색은 모든 낱말이 맞아야 나오고 띄어쓰기 무관', () => {
  assert.deepStrictEqual(M.candidates('', '', MASTERS, '딥클렌저 100g').map((x) => x.code), ['2']);
  assert.deepStrictEqual(M.candidates('', '', MASTERS, '없는상품'), []);
});

test('후보를 못 찾아도 오류 없이 빈 목록', () => {
  assert.deepStrictEqual(M.candidates('완전히 다른 물건', '', MASTERS), []);
  assert.deepStrictEqual(M.candidates('아크네스', '', null), []);
});

test('itemKey: 같은 줄은 같은 키, 다르면 다른 키, Firebase 키에 쓸 수 있음', () => {
  assert.strictEqual(M.itemKey('a', 'b', 1), M.itemKey('a', 'b', 1));
  assert.notStrictEqual(M.itemKey('a', 'b', 1), M.itemKey('a', 'b', 2));
  assert.doesNotMatch(M.itemKey('[1+1] 상품.이름/$#', '옵션', 3), /[.$#[\]/]/);
});

test('draftReady: 상품과 정수 수량이 있어야 함', () => {
  const plain = { name: '스팟 패치 120매', opt: '' };
  assert.strictEqual(M.draftReady(plain, null), false);
  assert.strictEqual(M.draftReady(plain, { picks: [] }), false);
  assert.strictEqual(M.draftReady(plain, { picks: [{ code: '1', qty: 0 }] }), false);
  assert.strictEqual(M.draftReady(plain, { picks: [{ code: '1', qty: 1.5 }] }), false);
  assert.strictEqual(M.draftReady(plain, { picks: [{ code: '1', qty: 2 }] }), true);
});

test('marks: 2Pack·1+1·용량·개수를 강조, 글자는 그대로', () => {
  const hits = (s) => M.marks(s).filter((x) => x.hit).map((x) => x.t);
  assert.deepStrictEqual(hits('[2Pack] 약산성 클렌저 125ml, 3개'), ['2Pack', '125ml', '3개']);
  assert.deepStrictEqual(hits('수량: 1+1+1'), ['1+1+1']);
  assert.deepStrictEqual(hits('포밍워시 180ml x2개'), ['180ml', 'x2개']);
  assert.deepStrictEqual(hits('스팟 패치 240매'), ['240매']);
  assert.deepStrictEqual(hits('옵션 없음'), []);
  for (const s of ['[2Pack] 클렌저 125ml, 3개', '수량: 1+1', '', null]) {
    assert.strictEqual(M.marks(s).map((x) => x.t).join(''), String(s == null ? '' : s));
  }
});
