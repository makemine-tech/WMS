/* 피킹이지 송장 자동수집 (main/ez_collect.js) — 폴더 고르기·중복 막기 계산 */
const test = require('node:test');
const assert = require('node:assert');
const C = require('../../main/ez_collect.js');

const f = (name, size, mt) => ({ name, size, lastModified: mt });
const NOW = 1_800_000_000_000;

test('오늘 폴더 이름은 YYYY-MM-DD', () => {
  assert.strictEqual(C.dayFolder(new Date(2026, 9, 28, 9, 5)), '2026-10-28');
  assert.strictEqual(C.dayFolder(new Date(2026, 0, 3)), '2026-01-03');
});

test('처음 수집은 pdf 전부, 만든 순서대로', () => {
  const r = C.pickFiles([f('b_20017_2.pdf', 10, NOW - 90000), f('a_20017_1.pdf', 10, NOW - 99000), f('메모.txt', 1, NOW - 99000)], {}, NOW);
  assert.deepStrictEqual(r.take.map(x => x.name), ['a_20017_1.pdf', 'b_20017_2.pdf']);
  assert.strictEqual(r.other.length, 1);
});

/* 대표님 조건 2: 오전에 가져간 파일이 폴더에 남아 있어도 오후 수집 때 다시 들어가면 안 됨 */
test('이미 수집한 파일(이름·크기·시각 같음)은 다시 안 가져옴', () => {
  const am = [f('a.pdf', 10, NOW - 9e6), f('b.pdf', 20, NOW - 9e6)];
  const log = C.logAdd({}, '2026-10-28', am, NOW - 8e6);
  const r = C.pickFiles(am.concat([f('c.pdf', 30, NOW - 60000)]), C.logFor(log, '2026-10-28'), NOW);
  assert.deepStrictEqual(r.take.map(x => x.name), ['c.pdf']);
  assert.strictEqual(r.dup.length, 2);
});

test('이름이 같아도 크기가 다르면 새 파일로 봄', () => {
  const log = C.logAdd({}, 'd', [f('a.pdf', 10, NOW - 9e6)], NOW);
  const r = C.pickFiles([f('a.pdf', 11, NOW - 9e6)], C.logFor(log, 'd'), NOW);
  assert.strictEqual(r.take.length, 1);
});

test('방금 만들어지는 중인 파일(15초 이내)은 다음 수집으로 미룸', () => {
  const r = C.pickFiles([f('a.pdf', 10, NOW - 5000), f('b.pdf', 10, NOW - 60000)], {}, NOW);
  assert.deepStrictEqual(r.take.map(x => x.name), ['b.pdf']);
  assert.strictEqual(r.busy.length, 1);
});

test('수집 기록은 날짜별로 따로', () => {
  let log = C.logAdd({}, '2026-10-27', [f('a.pdf', 1, 1)], 5);
  log = C.logAdd(log, '2026-10-28', [f('b.pdf', 1, 1)], 6);
  assert.strictEqual(Object.keys(C.logFor(log, '2026-10-27')).length, 1);
  assert.strictEqual(Object.keys(C.logFor(log, '2026-10-28')).length, 1);
  assert.deepStrictEqual(C.logDays(log), ['2026-10-27', '2026-10-28']);
});

/* 대표님 조건 4: 초기화 때는 수집했던 파일만 지움 — 수집 뒤 새로 쌓인 송장은 남김 */
test('초기화 때 지울 파일 = 수집 기록에 있는 것만', () => {
  const log = C.logAdd({}, 'd', [f('a.pdf', 10, 1)], 5);
  const del = C.toDelete([f('a.pdf', 10, 1), f('new.pdf', 10, 2)], C.logFor(log, 'd'));
  assert.deepStrictEqual(del.map(x => x.name), ['a.pdf']);
});
