/* 전담비서 판단 모듈 (main/secretary_core.js) */
const test = require('node:test');
const assert = require('node:assert');
const C = require('../../main/secretary_core.js');

/* KST 시각으로 Date 만들기 */
const kst = (s) => new Date(s + '+09:00');
const MIN = 60 * 1000;

test('맨소래담 작업은 이벗 방만 바꾸고, 이지어드민 미리 보기 결과와 섞이지 않음', () => {
  const now = 1000 * MIN, on = { ts: now }, sites = { ezadmin: { state: 'ok' }, ebut: { state: 'ok' } };
  const byId = (rooms) => Object.fromEntries(rooms.map((x) => [x.id, x]));
  let r = byId(C.officeRooms({ runner: on, sites, jobs: { a: { recipe: 'menso_read', state: 'running', at: now } }, now }));
  assert.strictEqual(r.ebut.mode, 'work');
  assert.strictEqual(r.ezadmin.mode, 'idle');
  r = byId(C.officeRooms({ runner: on, sites, jobs: { a: { recipe: 'menso_read', state: 'done', at: now, menso: { campaigns: [{ need: 3 }, { need: 2 }] } }, b: { recipe: 'ez_daily', state: 'done', at: now - MIN, preview: { invoices: 25, orders: 10 } } }, now }));
  assert.match(r.ebut.say, /5건/);
  assert.match(r.ezadmin.say, /송장 25장/);
  r = byId(C.officeRooms({ runner: on, sites, jobs: { a: { recipe: 'menso_read', state: 'stopped', at: now } }, now }));
  assert.strictEqual(r.ebut.mode, 'alert');
  assert.strictEqual(r.ezadmin.mode, 'idle');
});

test('도우미 명령은 읽기만 통과', () => {
  assert.deepStrictEqual(C.HELPER_CMDS, ['ping', 'read', 'search', 'orders', 'matchRead', 'matchSearch', 'relogin', 'counts', 'collectCheck', 'collectStatus', 'confirmCheck', 'confirmStatus', 'formCheck', 'storeCheck', 'storeStatus']);
  C.HELPER_CMDS.forEach((c) => C.assertSafeCmd(c));
  for (const bad of ['commit', 'printGo', 'printPrep', 'printStatus', 'printEnd', 'printClose', 'fill', 'reset', 'save', 'find', '', undefined, 'constructor']) {
    assert.throws(() => C.assertSafeCmd(bad), /허용되지 않은 명령/, String(bad));
  }
});

test('runnerState: 3분 이내만 켜짐', () => {
  const now = 1000 * MIN;
  assert.strictEqual(C.runnerState({ ts: now - 3 * MIN }, now), 'on');
  assert.strictEqual(C.runnerState({ ts: now - 3 * MIN - 1 }, now), 'off');
  assert.strictEqual(C.runnerState(null, now), 'off');
  assert.strictEqual(C.runnerState({}, now), 'off');
});

test('commandExpired: 10분 초과나 시각 없음은 만료', () => {
  const now = 1000 * MIN;
  assert.strictEqual(C.commandExpired({ at: now - 10 * MIN }, now), false);
  assert.strictEqual(C.commandExpired({ at: now - 10 * MIN - 1 }, now), true);
  assert.strictEqual(C.commandExpired({}, now), true);
  assert.strictEqual(C.commandExpired(null, now), true);
});

test('quietHours: 23:30~00:30', () => {
  assert.strictEqual(C.quietHours(kst('2026-11-01T23:29:59')), false);
  assert.strictEqual(C.quietHours(kst('2026-11-01T23:30:00')), true);
  assert.strictEqual(C.quietHours(kst('2026-11-02T00:29:59')), true);
  assert.strictEqual(C.quietHours(kst('2026-11-02T00:30:00')), false);
  assert.strictEqual(C.quietHours(kst('2026-11-02T12:00:00')), false);
});

test('startBlock: 막는 이유', () => {
  const now = kst('2026-11-01T12:00:00').getTime();
  const runner = { ts: now };
  assert.strictEqual(C.startBlock({ runner, now }), '');
  assert.match(C.startBlock({ runner: null, now }), /상시 컴퓨터/);
  assert.match(C.startBlock({ runner, control: { pause: true }, now }), /멈춤/);
  assert.match(C.startBlock({ runner, job: { state: 'running' }, now }), /진행 중/);
  const night = kst('2026-11-01T23:40:00').getTime();
  assert.match(C.startBlock({ runner: { ts: night }, now: night }), /23:30/);
});

test('siteState: 이벗 조회 실패는 로그인 유지가 아님', () => {
  assert.strictEqual(C.siteState('ebut', { login: true, checked: true }).state, 'ok');
  assert.strictEqual(C.siteState('ebut', { login: true }).state, 'ok');
  assert.strictEqual(C.siteState('ebut', { login: false }).state, 'login');
  const r = C.siteState('ebut', { login: true, checked: false, err: '네트워크' });
  assert.strictEqual(r.state, 'error');
  assert.match(r.msg, /네트워크/);
});

test('kstDate 는 한국 날짜', () => {
  assert.strictEqual(C.kstDate(new Date('2026-11-01T15:30:00Z').getTime()), '2026-11-02');
  assert.strictEqual(C.kstDate(new Date('2026-11-01T14:30:00Z').getTime()), '2026-11-01');
});

test('dateRange: 시작일 검사, 기본 7일 전', () => {
  const now = kst('2026-11-01T12:00:00').getTime();
  assert.deepStrictEqual(C.dateRange('2026-10-30', now), { from: '2026-10-30', to: '2026-11-01' });
  assert.deepStrictEqual(C.dateRange('', now), { from: '2026-10-25', to: '2026-11-01' });
  assert.deepStrictEqual(C.dateRange('2026-11-02', now), { from: '2026-10-25', to: '2026-11-01' });
  assert.deepStrictEqual(C.dateRange('아무말', now), { from: '2026-10-25', to: '2026-11-01' });
});

test('officeRooms: 켜짐·꺼짐·일함·문제가 왼쪽 화면 상태와 같음', () => {
  const now = 1000 * MIN;
  const byId = (rooms) => Object.fromEntries(rooms.map((x) => [x.id, x]));
  const on = { ts: now };
  const okSites = { ezadmin: { state: 'ok', msg: '' }, ebut: { state: 'ok', msg: '' } };

  /* 실제 있는 비서만 방이 있음 */
  assert.deepStrictEqual(C.officeRooms({ now }).map((x) => x.id), ['ceo', 'head', 'ebut', 'ezadmin']);

  /* 상시 컴퓨터가 꺼지면 대표실 빼고 퇴근 */
  let r = byId(C.officeRooms({ runner: { ts: now - 4 * MIN }, sites: okSites, now }));
  assert.strictEqual(r.head.mode, 'off');
  assert.strictEqual(r.ezadmin.mode, 'off');
  assert.strictEqual(r.ebut.mode, 'off');
  assert.strictEqual(r.ceo.mode, 'idle');

  /* 대기 */
  r = byId(C.officeRooms({ runner: on, sites: okSites, now }));
  assert.strictEqual(r.ezadmin.mode, 'idle');
  assert.strictEqual(r.head.count, 3);

  /* 작업 중 */
  r = byId(C.officeRooms({ runner: on, sites: okSites, jobs: { a: { state: 'running', at: now } }, now }));
  assert.strictEqual(r.head.mode, 'work');
  assert.strictEqual(r.ezadmin.mode, 'work');

  /* 끝난 미리 보기는 건수와 일감으로 보임 */
  r = byId(C.officeRooms({ runner: on, sites: okSites, jobs: { a: { state: 'done', at: now, preview: { invoices: 60, orders: 40 } } }, now }));
  assert.match(r.ezadmin.say, /송장 60장/);
  assert.strictEqual(r.ezadmin.count, 3);

  /* 멈춘 작업이 가장 최근이면 빨간 방, 예전 멈춤은 무시 */
  r = byId(C.officeRooms({ runner: on, sites: okSites, jobs: { a: { state: 'stopped', at: now } }, now }));
  assert.strictEqual(r.ezadmin.mode, 'alert');
  r = byId(C.officeRooms({ runner: on, sites: okSites, jobs: { a: { state: 'stopped', at: now - MIN }, b: { state: 'done', at: now } }, now }));
  assert.strictEqual(r.ezadmin.mode, 'idle');

  /* 로그인이 풀린 사이트만 빨간 방 */
  r = byId(C.officeRooms({ runner: on, sites: { ezadmin: { state: 'ok' }, ebut: { state: 'login', msg: '로그인이 필요합니다' } }, now }));
  assert.strictEqual(r.ebut.mode, 'alert');
  assert.match(r.ebut.say, /로그인/);
  assert.strictEqual(r.ezadmin.mode, 'idle');

  /* 전체 멈춤과 대표실 특이사항 */
  r = byId(C.officeRooms({ runner: on, sites: okSites, control: { pause: true }, noteCount: 2, now }));
  assert.strictEqual(r.head.mode, 'alert');
  assert.strictEqual(r.ceo.mode, 'alert');
  assert.match(r.ceo.say, /2건/);
});

test('ezFlow: 읽은 자료대로 차례가 넘어감', () => {
  const st = (site, job) => Object.fromEntries(C.ezFlow(site, job).map((x) => [x.id, x.state]));
  const ok = { state: 'ok' };
  assert.deepStrictEqual(C.ezFlow(ok, null).map((x) => x.id), ['ez_preview', 'ez_split']);
  assert.strictEqual(st({ state: 'login' }, { preview: { orders: 10, splitPacks: 3, blockers: [] } }).ez_split, 'wait');
  let s = st(ok, { preview: { orders: 10, splitPacks: 3, blockers: [] } });
  assert.deepStrictEqual([s.ez_preview, s.ez_split], ['done', 'todo']);
  s = st(ok, { preview: { orders: 10, splitPacks: 0, blockers: [] } });
  assert.strictEqual(s.ez_split, 'done');
  assert.strictEqual(s.ez_print, undefined);
  s = st(ok, { preview: { orders: 10, splitPacks: 3, blockers: ['처음 보는 구성 1건'] } });
  assert.deepStrictEqual([s.ez_preview, s.ez_split], ['todo', 'wait']);
  s = st(ok, { preview: { orders: 0, splitPacks: 0 } });
  assert.deepStrictEqual([s.ez_preview, s.ez_split], ['done', 'wait']);
  assert.strictEqual(C.ezFlow(ok, { preview: { orders: 10, splitPacks: 3 } }).find((x) => x.id === 'ez_split').count, 3);
});

test('ezFlow: 모르는 상품·60박스 넘침은 확인하면 넘어가고, 줄 수 불일치는 확인해도 막힘', () => {
  const st = (job) => Object.fromEntries(C.ezFlow({ state: 'ok' }, job).map((x) => [x.id, x.state]));
  const preview = { orders: 10, splitPacks: 3, blockers: ['모르는 상품 3건', '60박스 넘침 4건'] };
  assert.deepStrictEqual([st({ preview }).ez_preview, st({ preview }).ez_split], ['todo', 'wait']);
  assert.deepStrictEqual([st({ preview, ack: { at: 1 } }).ez_preview, st({ preview, ack: { at: 1 } }).ez_split], ['done', 'todo']);
  const hard = { orders: 10, splitPacks: 3, blockers: ['이지어드민에는 2줄이 있는데 1줄만 읽혔습니다', '모르는 상품 1건'] };
  assert.strictEqual(st({ preview: hard, ack: { at: 1 } }).ez_split, 'wait');
  assert.deepStrictEqual(C.ezOpenBlockers({ preview: hard, ack: { at: 1 } }), [hard.blockers[0]]);
  const now = 1000 * MIN, rooms = (job) => C.officeRooms({ runner: { ts: now }, sites: { ezadmin: { state: 'ok' }, ebut: { state: 'ok' } }, jobs: { a: { state: 'stopped', at: now, ...job } }, now }).find((x) => x.id === 'ezadmin').mode;
  assert.strictEqual(rooms({ preview }), 'alert');
  assert.strictEqual(rooms({ preview, ack: { at: 1 } }), 'idle');
  assert.strictEqual(rooms({}), 'alert');
});

test('jobKey 와 회차', () => {
  assert.strictEqual(C.jobKey('check', '2026-11-01', 2), 'check:2026-11-01:2');
  assert.strictEqual(C.nextRound({}, 'check', '2026-11-01'), 1);
  assert.strictEqual(C.nextRound(null, 'check', '2026-11-01'), 1);
  assert.strictEqual(C.nextRound({
    'check:2026-11-01:1': {}, 'check:2026-11-01:3': {}, 'check:2026-10-31:9': {}, 'other:2026-11-01:7': {},
  }, 'check', '2026-11-01'), 4);
});

test('사이트 정의: 도우미 탭 이름과 주소', () => {
  const ez = C.SITES.find((s) => s.id === 'ezadmin');
  const eb = C.SITES.find((s) => s.id === 'ebut');
  /* 기존 페이지(ez_split·star_return)의 탭 이름과 겹치면 안 됨 */
  assert.strictEqual(ez.tab, 'mkw_sec_ez');
  assert.strictEqual(eb.tab, 'mkw_sec_ebut');
  assert.match(ez.url, /template=DG00/);
  assert.match(eb.url, /^https:\/\/ebut3pl\.co\.kr/);
});

test('시작 버튼: 확장이 있으면 이 컴퓨터가 맡고, 폰은 상시 컴퓨터에 맡김', () => {
  const now = 1000 * MIN, on = { id: 'dmzoot', ts: now }, off = { id: 'dmzoot', ts: now - 4 * MIN };
  const go = (o) => C.startChoice(Object.assign({ myId: 'me', hasExt: true, isHead: false, jobRunning: false, now }, o));
  assert.strictEqual(go({ runner: on }), 'ask');
  assert.strictEqual(go({ runner: off }), 'take');
  assert.strictEqual(go({ runner: null }), 'take');
  assert.strictEqual(go({ runner: on, hasExt: false }), 'send');
  assert.strictEqual(go({ runner: off, hasExt: false }), 'need_ext');
  assert.strictEqual(go({ runner: on, isHead: true }), 'send');
  assert.strictEqual(go({ runner: { id: 'me', ts: now } }), 'send');
  assert.strictEqual(go({ runner: { id: 'me', ts: now - 4 * MIN } }), 'take');
});

test('시작 버튼: 작업·출력·채운 내용이 있으면 가져오지 않고 맡김', () => {
  const now = 1000 * MIN, on = { id: 'dmzoot', ts: now };
  assert.strictEqual(C.startChoice({ runner: on, myId: 'me', hasExt: true, jobRunning: true, now }), 'send');
  assert.strictEqual(C.startChoice({ runner: { id: 'dmzoot', ts: now, busy: true }, myId: 'me', hasExt: true, now }), 'send');
});
