/* 피킹이지 🛟 백업함 (main/pk_backup.js) — 정리 대상 고르기 */
const test = require('node:test');
const assert = require('node:assert');
const B = require('../../main/pk_backup.js');

const DAY = 86400000, NOW = 1_800_000_000_000;

test('최근 KEEP 개만 남기고 오래된 순으로 지움', () => {
  const metas = Array.from({ length: B.KEEP + 3 }, (_, i) => ({ id: 'b' + i, ts: NOW - i * 1000 }));
  assert.deepStrictEqual(B.pruneIds(metas, NOW).sort(), ['b' + B.KEEP, 'b' + (B.KEEP + 1), 'b' + (B.KEEP + 2)].sort());
});

test('KEEP_DAYS 일 넘은 백업은 개수와 상관없이 지움', () => {
  const metas = [{ id: 'new', ts: NOW - DAY }, { id: 'old', ts: NOW - (B.KEEP_DAYS + 1) * DAY }];
  assert.deepStrictEqual(B.pruneIds(metas, NOW), ['old']);
});

test('캐시 키에서 등록 시각 읽기', () => {
  assert.strictEqual(B.jobKeyTs('J1761234567890_자동수집 2026-10-29'), 1761234567890);
  assert.strictEqual(B.jobKeyTs('엉뚱한키'), 0);
});

test('7일이 지나면 지움, 7일 안은 남김', () => {
  assert.strictEqual(B.KEEP_DAYS, 7);
  const metas = [{ id: 'a', ts: NOW - 6.9 * DAY }, { id: 'b', ts: NOW - 7.1 * DAY }];
  assert.deepStrictEqual(B.pruneIds(metas, NOW), ['b']);
});

test('합계 용량을 넘으면 오래된 것부터 지움, 가장 새것은 커도 남김', () => {
  const big = B.MAX_BYTES * 0.4;
  const metas = [0, 1, 2, 3].map(i => ({ id: 'b' + i, ts: NOW - i * 3600000, size: big }));
  assert.deepStrictEqual(B.pruneIds(metas, NOW).sort(), ['b2', 'b3']);
  assert.deepStrictEqual(B.pruneIds([{ id: 'huge', ts: NOW, size: B.MAX_BYTES * 2 }], NOW), []);
});
