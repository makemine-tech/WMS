/* 픽셀 사무실 움직임 (main/secretary_office.js) — 가짜 캔버스에 그려진 위치로 시험 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const TOP = '#f0b83f';   /* 이지어드민 비서 윗옷 색 */
const SEAT = 16 + 106 - 8;   /* 방 왼쪽 16 + 자리 106 - 윗옷 왼쪽 여백 8 */

function setup() {
  let cb = null, rects = [], now = 0;
  const g = { imageSmoothingEnabled: false, globalAlpha: 1, set fillStyle(v) { this._c = v; }, get fillStyle() { return this._c; },
    fillRect(x, y, w, h) { rects.push({ x, y, w, h, c: this._c }); }, fillText() {} };
  const cv = { width: 0, height: 0, getContext: () => g };
  const sc = { querySelector: () => cv, querySelectorAll: () => [], appendChild() {} };
  const el = () => ({ style: {}, className: '', textContent: '', appendChild() {}, remove() {} });
  const win = { matchMedia: () => ({ matches: false }), requestAnimationFrame: (f) => { cb = f; } };
  const ctx = vm.createContext({ window: win, document: { createElement: el, createTextNode: () => ({}) }, requestAnimationFrame: win.requestAnimationFrame, Math });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../main/secretary_office.js'), 'utf8'), ctx);
  const office = win.SECRETARY_OFFICE.mount(sc);
  const rooms = (m) => ['ceo', 'head', 'ezadmin', 'ebut'].map((id) => ({ id, name: id, mode: id === 'ceo' ? 'idle' : m, say: '', count: 0 }));
  const run = (sec) => { for (let i = 0; i < sec * 10; i++) { rects = []; now += 100; const f = cb; f(now); } };
  /* 윗옷 몸통 칸: 서 있으면 폭 16, 앉아 있으면 폭 15 */
  const top = () => { const r = rects.filter((x) => x.c === TOP && (x.w === 16 || x.w === 15))[0]; return { x: r.x, seated: r.w === 15 }; };
  run(0);
  const f0 = cb; now = 100; f0(now);
  return { office, rooms, run, top };
}

test('걷던 중 대기로 바뀌면 그 자리에서 앉지 않고 자리까지 걸어가서 앉음 (순간 이동 없음)', () => {
  const s = setup();
  s.office.update(s.rooms('work'));
  s.run(2.5);   /* 2.4초 앉아서 일함 */
  s.run(1.5);   /* 걷는 중 */
  const away = s.top();
  assert.strictEqual(away.seated, false);
  assert.ok(away.x > SEAT + 20, '자리에서 멀어져 있어야 함: ' + away.x);

  s.office.update(s.rooms('idle'));
  s.run(0.1);
  const next = s.top();
  assert.strictEqual(next.seated, false, '바로 앉으면 안 됨');
  assert.ok(Math.abs(next.x - away.x) <= 8, '순간 이동 없음: ' + away.x + ' → ' + next.x);

  let prev = next.x;
  for (let i = 0; i < 60 && !s.top().seated; i++) {
    s.run(0.1);
    const t = s.top();
    assert.ok(Math.abs(t.x - prev) <= 8, '한 번에 크게 움직이지 않음: ' + prev + ' → ' + t.x);
    prev = t.x;
  }
  assert.strictEqual(s.top().seated, true, '자리에 도착하면 앉음');
  assert.strictEqual(s.top().x, SEAT);
});

test('자리에 있으면 상태가 바뀌어도 그대로 앉아 있음', () => {
  const s = setup();
  s.office.update(s.rooms('idle'));
  s.run(1);
  assert.deepStrictEqual({ ...s.top() }, { x: SEAT, seated: true });
  s.office.update(s.rooms('work'));
  s.run(0.5);
  assert.deepStrictEqual({ ...s.top() }, { x: SEAT, seated: true });
});

test('걷기는 목적지를 지나치지 않음: 프레임이 튀어도 자리에 정확히 도착', () => {
  const s = setup();
  s.office.update(s.rooms('work'));
  let max = 0;
  for (let i = 0; i < 200; i++) { s.run(0.1); max = Math.max(max, s.top().x); }
  assert.ok(max <= 16 + 256 - 8, '목적지 256 을 넘지 않음: ' + max);
});
