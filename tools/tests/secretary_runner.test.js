/* 헤드비서 실행기 (main/secretary_runner.js) — 가짜 저장소와 가짜 탭으로 시험 */
const test = require('node:test');
const assert = require('node:assert');
const { createRunner } = require('../../main/secretary_runner.js');

const NOW = new Date('2026-11-01T12:00:00+09:00').getTime();

function setup(opts) {
  opts = opts || {};
  const db = { commands: {}, jobs: Object.assign({}, opts.jobs), sites: {}, control: opts.control || null, runner: opts.runner === undefined ? { id: 'me', ts: NOW } : opts.runner, taken: {} };
  const opened = [];
  const store = {
    claimRunner: async (id, info) => {
      if (db.runner && db.runner.id && db.runner.id !== id) return false;
      db.runner = Object.assign({}, info, { id, ts: NOW });
      return true;
    },
    getRunner: async () => db.runner,
    claimCommand: async (id) => { if (db.taken[id]) return false; db.taken[id] = true; return true; },
    setCommand: async (id, p) => { db.commands[id] = Object.assign(db.commands[id] || {}, p); },
    getJobs: async () => db.jobs,
    setJob: async (k, p) => { db.jobs[k] = Object.assign(db.jobs[k] || {}, p); },
    getControl: async () => db.control,
    setSite: async (id, p) => { db.sites[id] = p; },
  };
  const openSite = opts.openSite || (async (site) => {
    opened.push(site.id);
    return site.id === 'ezadmin' ? { ver: 'v1', page: 'DG00' } : { ver: 'v2', login: true };
  });
  const asked = [];
  const ezPreview = opts.ezPreview || (async (range) => { asked.push(range); return { orders: 2, invoices: 3, blockers: [] }; });
  db.asked = asked;
  const mensoPreview = opts.mensoPreview || (async (range) => { asked.push(range); return { rows: 10, campaigns: [{ need: 2 }], blockers: [] }; });
  const runner = createRunner({ store, openSite, ezPreview, mensoPreview, now: () => opts.now || NOW, runnerId: 'me', info: { ext: '1.0.0' } });
  return { runner, db, opened, store };
}
const start = (at) => ({ type: 'start', at: at === undefined ? NOW : at, by: 'x' });

test('start runs check and reports done', async () => {
  const { runner, db, opened } = setup();
  await runner.handleCommand('c1', start());
  assert.deepStrictEqual(opened, ['ezadmin', 'ebut']);
  const key = 'ez_daily:2026-11-01:1';
  assert.strictEqual(db.commands.c1.status, 'done');
  assert.strictEqual(db.commands.c1.jobKey, key);
  assert.strictEqual(db.jobs[key].state, 'done');
  assert.strictEqual(db.jobs[key].by, 'x');
  assert.strictEqual(db.sites.ezadmin.state, 'ok');
  assert.strictEqual(db.sites.ebut.state, 'ok');
});

test('미리 보기 결과를 작업에 남기고, 시작일은 명령에서 받음', async () => {
  const { runner, db } = setup();
  await runner.handleCommand('c1', Object.assign(start(), { from: '2026-10-30' }));
  const j = db.jobs['ez_daily:2026-11-01:1'];
  assert.deepStrictEqual(db.asked, [{ from: '2026-10-30', to: '2026-11-01' }]);
  assert.strictEqual(j.preview.invoices, 3);
  assert.strictEqual(j.state, 'done');
  assert.strictEqual(j.from, '2026-10-30');
});

test('멈출 이유가 있으면 멈춤으로 기록', async () => {
  const { runner, db } = setup({ ezPreview: async () => ({ orders: 1, blockers: ['처음 보는 구성 1건'] }) });
  await runner.handleCommand('c1', start());
  const j = db.jobs['ez_daily:2026-11-01:1'];
  assert.strictEqual(j.state, 'stopped');
  assert.match(j.notes, /처음 보는 구성 1건/);
});

test('주문 읽기 실패는 이유를 남기고 멈춤', async () => {
  const { runner, db } = setup({ ezPreview: async () => { throw new Error('검색 시간 초과'); } });
  await runner.handleCommand('c1', start());
  const j = db.jobs['ez_daily:2026-11-01:1'];
  assert.strictEqual(j.state, 'stopped');
  assert.match(j.notes, /검색 시간 초과/);
  assert.strictEqual(db.commands.c1.status, 'done');
});

test('이지어드민 로그인이 풀리면 주문을 읽지 않음', async () => {
  const { runner, db } = setup({ openSite: async (s) => (s.id === 'ezadmin' ? { page: '' } : { login: true }) });
  await runner.handleCommand('c1', start());
  assert.deepStrictEqual(db.asked, []);
});

test('이벗만 문제면 미리 보기는 진행하고 알림', async () => {
  const { runner, db } = setup({ openSite: async (s) => (s.id === 'ezadmin' ? { page: 'DG00' } : { login: false }) });
  await runner.handleCommand('c1', start());
  const j = db.jobs['ez_daily:2026-11-01:1'];
  assert.strictEqual(j.state, 'done');
  assert.match(j.notes, /이벗/);
  assert.strictEqual(db.asked.length, 1);
});

const menso = (o) => Object.assign({ type: 'menso', at: NOW, by: 'x', from: '2026-10-30' }, o);

test('맨소래담: 이벗만 열어 읽고 결과를 작업에 남김', async () => {
  const { runner, db, opened } = setup();
  await runner.handleCommand('c1', menso());
  const j = db.jobs['menso_read:2026-11-01:1'];
  assert.deepStrictEqual(opened, ['ebut']);
  assert.deepStrictEqual(db.asked, [{ from: '2026-10-30', to: '2026-11-01' }]);
  assert.strictEqual(j.state, 'done');
  assert.strictEqual(j.menso.campaigns[0].need, 2);
  assert.strictEqual(db.commands.c1.status, 'done');
});

test('맨소래담: 멈출 이유가 있으면 멈춤, 읽기 실패도 멈춤', async () => {
  let t = setup({ mensoPreview: async () => ({ campaigns: [], blockers: ['매칭 안 된 줄 2건'] }) });
  await t.runner.handleCommand('c1', menso());
  assert.strictEqual(t.db.jobs['menso_read:2026-11-01:1'].state, 'stopped');
  assert.match(t.db.jobs['menso_read:2026-11-01:1'].notes, /매칭 안 된 줄/);
  t = setup({ mensoPreview: async () => { throw new Error('시간 초과'); } });
  await t.runner.handleCommand('c1', menso());
  assert.match(t.db.jobs['menso_read:2026-11-01:1'].notes, /시간 초과/);
});

test('맨소래담: 이벗 로그인이 풀리면 읽지 않음', async () => {
  const { runner, db } = setup({ openSite: async () => ({ login: false }) });
  await runner.handleCommand('c1', menso());
  assert.deepStrictEqual(db.asked, []);
  assert.strictEqual(db.jobs['menso_read:2026-11-01:1'].state, 'stopped');
  assert.strictEqual(db.sites.ebut.state, 'login');
});

test('맨소래담: 멈춤 상태·진행 중이면 거절', async () => {
  const { runner, db } = setup({ control: { pause: true } });
  await runner.handleCommand('c1', menso());
  assert.strictEqual(db.commands.c1.status, 'refused');
});

test('expired command: 만료 표시만 하고 실행 안 함', async () => {
  const { runner, db, opened } = setup();
  await runner.handleCommand('c1', start(NOW - 11 * 60 * 1000));
  assert.strictEqual(db.commands.c1.status, 'expired');
  assert.deepStrictEqual(opened, []);
  assert.deepStrictEqual(db.jobs, {});
});

test('handles a command once: 두 번 받아도 한 번만', async () => {
  const { runner, db, opened } = setup();
  await Promise.all([runner.handleCommand('c1', start()), runner.handleCommand('c1', start())]);
  assert.strictEqual(opened.length, 2);
  assert.strictEqual(Object.keys(db.jobs).length, 1);
});

test('명령은 차례로 처리, 둘째 시동은 새 회차', async () => {
  const { runner, db } = setup();
  await Promise.all([runner.handleCommand('c1', start()), runner.handleCommand('c2', start())]);
  assert.deepStrictEqual(Object.keys(db.jobs).sort(), ['ez_daily:2026-11-01:1', 'ez_daily:2026-11-01:2']);
});

test('refuses other runner: 다른 PC 는 실행 안 함', async () => {
  const { runner, db } = setup({ runner: { id: 'other', ts: NOW } });
  assert.strictEqual(await runner.claim(), false);
  assert.strictEqual(db.runner.id, 'other');
});

test('claim: 빈 자리를 잡고, 끊긴 작업은 중단 처리', async () => {
  const { runner, db } = setup({ runner: null, jobs: { 'ez_daily:2026-11-01:1': { state: 'running' }, 'ez_daily:2026-10-31:1': { state: 'done' } } });
  assert.strictEqual(await runner.claim(), true);
  assert.strictEqual(db.runner.id, 'me');
  assert.strictEqual(db.runner.ext, '1.0.0');
  assert.strictEqual(db.jobs['ez_daily:2026-11-01:1'].state, 'interrupted');
  assert.strictEqual(db.jobs['ez_daily:2026-10-31:1'].state, 'done');
});

test('reports site failures: 한 사이트가 실패해도 다음 사이트 점검', async () => {
  const seen = [];
  const { runner, db } = setup({
    openSite: async (site) => {
      seen.push(site.id);
      if (site.id === 'ezadmin') throw new Error('도우미 응답 없음');
      return { login: false };
    },
  });
  await runner.handleCommand('c1', start());
  assert.deepStrictEqual(seen, ['ezadmin', 'ebut']);
  assert.strictEqual(db.sites.ezadmin.state, 'error');
  assert.match(db.sites.ezadmin.msg, /도우미 응답 없음/);
  assert.strictEqual(db.sites.ebut.state, 'login');
  assert.strictEqual(db.jobs['ez_daily:2026-11-01:1'].state, 'stopped');
  assert.match(db.jobs['ez_daily:2026-11-01:1'].notes, /이지어드민/);
  assert.match(db.jobs['ez_daily:2026-11-01:1'].notes, /이벗/);
  assert.strictEqual(db.commands.c1.status, 'done');
});

test('이지어드민: 일괄합포제외 화면이 아니면 로그인 필요', async () => {
  const { runner, db } = setup({ openSite: async (s) => (s.id === 'ezadmin' ? { page: '' } : { login: true }) });
  await runner.handleCommand('c1', start());
  assert.strictEqual(db.sites.ezadmin.state, 'login');
  assert.strictEqual(db.jobs['ez_daily:2026-11-01:1'].state, 'stopped');
});

test('pause blocks start', async () => {
  const { runner, db, opened } = setup({ control: { pause: true } });
  await runner.handleCommand('c1', start());
  assert.strictEqual(db.commands.c1.status, 'refused');
  assert.match(db.commands.c1.why, /멈춤/);
  assert.deepStrictEqual(opened, []);
});

test('quiet hours blocks start', async () => {
  const late = new Date('2026-11-01T23:45:00+09:00').getTime();
  const { runner, db, opened } = setup({ now: late, runner: { id: 'me', ts: late } });
  await runner.handleCommand('c1', start(late));
  assert.strictEqual(db.commands.c1.status, 'refused');
  assert.match(db.commands.c1.why, /23:30/);
  assert.deepStrictEqual(opened, []);
});

test('진행 중 작업이 있으면 거절', async () => {
  const { runner, db } = setup({ jobs: { 'ez_daily:2026-11-01:1': { state: 'running' } } });
  await runner.handleCommand('c1', start());
  assert.strictEqual(db.commands.c1.status, 'refused');
  assert.match(db.commands.c1.why, /진행 중/);
});

test('claim: 끊긴 작업의 명령도 닫아 폰이 멈춰 있지 않게 함', async () => {
  const { runner, db } = setup({ jobs: { 'ez_daily:2026-11-01:1': { state: 'running', cmd: 'c9' } } });
  await runner.claim();
  assert.strictEqual(db.commands.c9.status, 'interrupted');
});

test('점검 중 쓰기 실패: 작업이 진행 중으로 남지 않고 다음 시동이 가능', async () => {
  let fail = true;
  const { runner, db, store } = setup();
  const real = store.setSite;
  store.setSite = async (id, p) => { if (fail) throw new Error('쓰기 거부'); return real(id, p); };
  await assert.rejects(runner.handleCommand('c1', start()), /쓰기 거부/);
  assert.strictEqual(db.jobs['ez_daily:2026-11-01:1'].state, 'interrupted');
  assert.match(db.jobs['ez_daily:2026-11-01:1'].notes, /쓰기 거부/);
  fail = false;
  await runner.handleCommand('c2', start());
  assert.strictEqual(db.commands.c2.status, 'done');
  assert.strictEqual(db.jobs['ez_daily:2026-11-01:2'].state, 'done');
});

test('pause 명령은 받지 않음: 멈춤은 페이지가 control 에 직접 씀', async () => {
  const { runner, db } = setup();
  await runner.handleCommand('c1', { type: 'pause', at: NOW, by: 'x' });
  assert.strictEqual(db.commands.c1.status, 'refused');
  assert.strictEqual(db.control, null);
});

test('모르는 명령은 거절', async () => {
  const { runner, db, opened } = setup();
  await runner.handleCommand('c1', { type: 'commit', at: NOW });
  assert.strictEqual(db.commands.c1.status, 'refused');
  assert.deepStrictEqual(opened, []);
});
