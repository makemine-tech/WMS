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

test('도우미 명령은 읽기 네 가지만 통과', () => {
  assert.deepStrictEqual(C.HELPER_CMDS, ['ping', 'read', 'search', 'orders']);
  C.assertSafeCmd('ping'); C.assertSafeCmd('read'); C.assertSafeCmd('search'); C.assertSafeCmd('orders');
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
  assert.deepStrictEqual(C.officeRooms({ now }).map((x) => x.id), ['ceo', 'head', 'ezadmin', 'ebut']);

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
