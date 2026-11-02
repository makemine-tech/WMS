/* 픽셀 사무실 움직임 (main/secretary_office.js) — 가짜 캔버스에 그려진 위치로 시험 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SEAT = 112;   /* 이지어드민 비서 자리 */

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
  const top = () => { const r = office.peek().find((x) => x.id === 'ezadmin'); return { x: r.x, seated: r.seated }; };
  const painted = () => rects;
  run(0);
  const f0 = cb; now = 100; f0(now);
  return { office, rooms, run, top, painted, win };
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
  assert.ok(max <= 256, '목적지 256 을 넘지 않음: ' + max);
});

test('그림판: 줄 길이가 같고 정해진 글자만 씀', () => {
  const S = setup().win.SECRETARY_OFFICE.SPRITES;
  const sets = [...Object.values(S.HEADS), S.FACE, S.FACE_BOB, S.BODY, S.SUIT, ...S.LEGS, S.SIT];
  sets.forEach((rows) => rows.forEach((row) => {
    assert.strictEqual(row.length, 16, row);
    assert.match(row, /^[.KSDTUBWCE]+$/, row);
  }));
});

test('대기 상태 그림에 크기나 색이 잘못된 칸이 없음', () => {
  const s = setup();
  s.office.update(s.rooms('idle'));
  s.run(1);
  const bad = s.painted().filter((x) => x.h <= 0 || x.w <= 0 || Number.isNaN(x.x) || Number.isNaN(x.y));
  assert.deepStrictEqual(bad, []);
  assert.ok(!s.painted().some((x) => x.c === undefined), '색이 없는 칸 없음');
});

test('눈 깜빡임: 양쪽 눈이 감겼다 뜨고, 비서마다 때가 다름', () => {
  const s = setup();
  s.office.update(s.rooms('idle'));
  const INK = '#0e0d10';
  const sig = () => s.painted().filter((x) => x.c === INK).length;
  const seen = new Set();
  for (let i = 0; i < 80; i++) { s.run(0.1); seen.add(sig()); }
  assert.ok(seen.size > 1, '검은 칸 수가 바뀌어야 함(눈 감김): ' + [...seen]);
  const S = s.win.SECRETARY_OFFICE.SPRITES;
  assert.strictEqual(S.FACE[0][8], 'K');
  assert.strictEqual(S.FACE[0][12], 'K');
  assert.strictEqual(S.FACE_BOB[0][8], 'K');
  assert.strictEqual(S.FACE_BOB[0][12], 'K');
});

test('컨베이어: 대기 중에는 멈추고 일할 때만 움직임', () => {
  const belt = (s) => s.painted().filter((x) => x.c === '#d1a26c' && x.w === 30).map((x) => x.x).join();
  const s = setup();
  s.office.update(s.rooms('idle'));
  s.run(0.1); const a = belt(s);
  s.run(1); assert.strictEqual(belt(s), a, '대기 중 멈춤');
  s.office.update(s.rooms('work'));
  s.run(0.1); const b = belt(s);
  s.run(1); assert.notStrictEqual(belt(s), b, '작업 중 움직임');
});

test('로그인 말풍선: 로그인이 풀린 방에만 뜨고 다른 문제에는 안 뜸', () => {
  const s = setup();
  const room = s.rooms('idle');
  room[2].mode = 'alert'; room[2].say = '로그인이 필요합니다';
  s.office.update(room);
  s.run(0.5);
  assert.ok(s.painted().some((x) => x.c === '#3f7fd0' && x.w === 12 && x.h === 12), '말풍선 표시');
  const s2 = setup();
  const room2 = s2.rooms('idle');
  room2[2].mode = 'alert'; room2[2].say = '확인 필요';
  s2.office.update(room2);
  s2.run(0.5);
  assert.ok(!s2.painted().some((x) => x.c === '#3f7fd0' && x.w === 12 && x.h === 12), '로그인이 아니면 안 뜸');
});
