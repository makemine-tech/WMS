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
    setMatch: async (path, p) => { db.match = db.match || {}; db.match[path] = p; },
  };
  const openSite = opts.openSite || (async (site) => {
    opened.push(site.id);
    return site.id === 'ezadmin' ? { ver: 'v1', page: 'DG00' } : { ver: 'v2', login: true };
  });
  const asked = [];
  const ezPreview = opts.ezPreview || (async (range) => { asked.push(range); return { orders: 2, invoices: 3, blockers: [] }; });
  db.asked = asked;
  const mensoPreview = opts.mensoPreview || (async (range) => { asked.push(range); return { rows: 10, campaigns: [{ need: 2 }], blockers: [] }; });
  const matchRead = opts.matchRead || (async () => ({ items: [{ name: 'A' }], masters: [], history: {} }));
  const matchSearch = async (text) => [{ code: '1', name: text }];
  const runner = createRunner({ store, openSite, ezPreview, mensoPreview, matchRead, matchSearch, relogin: opts.relogin, now: () => opts.now || NOW, runnerId: 'me', info: { ext: '1.0.0' } });
  return { runner, db, opened, store };
}
const start = (at) => ({ type: 'start', at: at === undefined ? NOW : at, by: 'x' });

test('start runs check and reports done', async () => {
  const { runner, db, opened } = setup();
  await runner.handleCommand('c1', start());
  assert.deepStrictEqual(opened, ['ezadmin', 'ebut', 'bizem']);
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

test('매칭 자료 읽기: 결과를 match 에 두고 작업 기록은 만들지 않음', async () => {
  const { runner, db } = setup();
  await runner.handleCommand('c1', { type: 'match_read', at: NOW, from: '2026-10-30' });
  assert.strictEqual(db.commands.c1.status, 'done');
  assert.strictEqual(db.match.data.items[0].name, 'A');
  assert.deepStrictEqual(db.jobs, {});
});

test('매칭 검색: 명령별로 결과를 둠', async () => {
  const { runner, db } = setup();
  await runner.handleCommand('c2', { type: 'match_search', at: NOW, text: '클렌저' });
  assert.strictEqual(db.match['search/c2'].rows[0].name, '클렌저');
});

test('매칭 자료: 이벗 로그인이 풀리거나 읽기 실패면 이유를 돌려줌', async () => {
  let t = setup({ openSite: async () => ({ login: false }) });
  await t.runner.handleCommand('c1', { type: 'match_read', at: NOW });
  assert.strictEqual(t.db.commands.c1.status, 'refused');
  assert.match(t.db.commands.c1.why, /이벗/);
  t = setup({ matchRead: async () => { throw new Error('시간 초과'); } });
  await t.runner.handleCommand('c1', { type: 'match_read', at: NOW });
  assert.match(t.db.commands.c1.why, /시간 초과/);
});

/* 이벗이 처음엔 풀려 있고 재로그인 뒤 살아나는 가짜 */
function flaky(afterLogin) {
  let logged = false;
  return {
    logged: () => { logged = true; },
    open: async (s) => (s.id === 'ezadmin' ? { page: 'DG00' } : { login: logged || !afterLogin ? logged : false }),
  };
}

test('재로그인: 성공하면 로그인 유지로 표시', async () => {
  const f = flaky(true); let calls = 0;
  const { runner, db } = setup({ openSite: f.open, relogin: async () => { calls++; f.logged(); return { tried: true }; } });
  await runner.keepAlive();
  assert.strictEqual(calls, 1);
  assert.strictEqual(db.sites.ebut.state, 'ok');
  assert.match(db.sites.ebut.msg, /자동 재로그인/);
});

test('재로그인: 실패하면 한 번만 시도하고 이유를 남김', async () => {
  let calls = 0;
  const { runner, db } = setup({ openSite: async (s) => (s.id === 'ezadmin' ? { page: 'DG00' } : s.id === 'bizem' ? { login: true } : { login: false }), relogin: async () => { calls++; return { tried: false, why: '비밀번호가 채워지지 않음' }; } });
  await runner.keepAlive();
  await runner.keepAlive();
  await runner.handleCommand('c1', menso());
  assert.strictEqual(calls, 1);
  assert.strictEqual(db.sites.ebut.state, 'login');
  assert.match(db.sites.ebut.msg, /비밀번호가 채워지지 않음/);
});

test('재로그인: 로그인이 돌아왔다가 다시 끊기면 다시 한 번 시도', async () => {
  let login = false, calls = 0;
  const { runner } = setup({ openSite: async (s) => (s.id === 'ezadmin' ? { page: 'DG00' } : s.id === 'bizem' ? { login: true } : { login }), relogin: async () => { calls++; return { tried: false }; } });
  await runner.keepAlive();
  login = true; await runner.keepAlive();
  login = false; await runner.keepAlive();
  assert.strictEqual(calls, 2);
});

test('재로그인 오류나 사이트 오류로 멈추지 않음', async () => {
  const { runner, db } = setup({ openSite: async (s) => { if (s.id === 'ezadmin') throw new Error('탭 안 열림'); return { login: false }; }, relogin: async () => { throw new Error('화면 없음'); } });
  await runner.keepAlive();
  assert.strictEqual(db.sites.ezadmin.state, 'error');
  assert.match(db.sites.ebut.msg, /화면 없음/);
});

test('로그인 유지: 작업 중이나 멈춤이면 건너뜀', async () => {
  let t = setup({ jobs: { a: { state: 'running' } } });
  assert.strictEqual(await t.runner.keepAlive(), false);
  assert.deepStrictEqual(t.opened, []);
  t = setup({ control: { pause: true } });
  assert.strictEqual(await t.runner.keepAlive(), false);
  t = setup();
  assert.strictEqual(await t.runner.keepAlive(), true);
  assert.deepStrictEqual(t.opened, ['ezadmin', 'ebut', 'bizem']);
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
  assert.strictEqual(opened.length, 3);
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
  assert.deepStrictEqual(seen, ['ezadmin', 'ebut', 'bizem']);
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

test('비젬: 로그인돼 있으면 건수를 사이트 기록에 남기고, 못 읽어도 다른 비서를 막지 않음', async () => {
  const { createRunner: make } = require('../../main/secretary_runner.js');
  const run = async (counts) => {
    const sites = {}, jobs = {};
    const store = { claimRunner: async () => true, getRunner: async () => ({ id: 'me', ts: NOW }), claimCommand: async () => true, setCommand: async () => {},
      getJobs: async () => jobs, setJob: async (k, p) => { jobs[k] = Object.assign(jobs[k] || {}, p); }, getControl: async () => null, setSite: async (id, p) => { sites[id] = p; }, setMatch: async () => {} };
    const r = make({ store, now: () => NOW, runnerId: 'me', info: {}, openSite: async (s) => (s.id === 'ezadmin' ? { page: 'DG00' } : { login: true }), ezPreview: async () => ({ orders: 2, blockers: [] }), mensoPreview: async () => ({ blockers: [] }), bizemCounts: counts });
    await r.handleCommand('c', { type: 'start', at: NOW, by: 'x' });
    return { sites, jobs };
  };
  let o = await run(async () => ({ unconfirmed: 5, printWait: 3 }));
  assert.deepStrictEqual(o.sites.bizem.counts, { unconfirmed: 5, printWait: 3 });
  assert.strictEqual(o.sites.bizem.countsAt, NOW);
  o = await run(async () => { throw new Error('응답 없음'); });
  assert.strictEqual(o.sites.bizem.counts, undefined);
  assert.strictEqual(o.jobs['ez_daily:2026-11-01:1'].state, 'done');
});

test('비젬 로그인이 풀려도 이지어드민 작업은 진행', async () => {
  const { runner, db } = setup({ openSite: async (s) => (s.id === 'ezadmin' ? { page: 'DG00' } : s.id === 'bizem' ? { login: false } : { login: true }) });
  await runner.handleCommand('c1', start());
  assert.strictEqual(db.sites.bizem.state, 'login');
  assert.strictEqual(db.jobs['ez_daily:2026-11-01:1'].state, 'done');
});

/* 반품입고관리(star_return.html) → 상시 컴퓨터 이벗 도우미 (secretary/retcall) */
function retSetup(opts) {
  opts = opts || {};
  const s = setup(opts);
  const sent = [];
  const rets = {};
  s.store.claimRet = async (id) => { if (rets[id] && rets[id].status) return false; rets[id] = { status: 'taken' }; return true; };
  s.store.setRet = async (id, p) => { rets[id] = Object.assign(rets[id] || {}, p); };
  const alive = { v: opts.alive !== false, ver: opts.ver || '2026-11-12a' };
  const ebutAsk = async (cmd, args) => {
    sent.push({ cmd, args });
    if (cmd === 'ping') { if (!alive.v) throw new Error('도우미가 연결되지 않았습니다'); return { ok: true, login: opts.login !== false, ver: alive.ver }; }
    if (opts.fail) throw new Error(opts.fail);
    return { cmd, got: args };
  };
  /* 탭을 새로 열면 확장이 최신 도우미를 넣음 */
  const openSite = async (site) => { s.opened.push(site.id); alive.v = true; alive.ver = '2026-11-12a'; return { ver: 'v2', login: true }; };
  const runner = createRunner({ store: s.store, openSite, ebutAsk, now: () => opts.now || NOW, runnerId: 'me' });
  return { runner, db: s.db, opened: s.opened, sent, rets, alive };
}
const ret = (cmd, args, at) => ({ cmd, args: JSON.stringify(args || {}), at: at === undefined ? NOW : at, by: 'x' });
const outOf = (rets, id) => JSON.parse(rets[id].out);

test('반품: 조회(find)를 이벗 도우미로 넘기고 결과를 돌려줌', async () => {
  const { runner, sent, rets, opened } = retSetup();
  await runner.handleRet('r1', ret('find', { orig: '123', cust: null }));
  assert.deepStrictEqual(outOf(rets, 'r1'), { ok: true, data: { cmd: 'find', got: { orig: '123', cust: null } } });
  assert.deepStrictEqual(sent.map((x) => x.cmd), ['ping', 'find']);
  assert.deepStrictEqual(opened, []);
});

test('반품: 정해진 명령만 받음', async () => {
  const { runner, sent, rets } = retSetup();
  await runner.handleRet('r1', ret('giftAdd', {}));
  assert.strictEqual(outOf(rets, 'r1').ok, false);
  assert.match(outOf(rets, 'r1').err, /^NOTSENT:/);
  assert.deepStrictEqual(sent, []);
});

test('반품: 만료된 저장 요청은 보내지 않음', async () => {
  const { runner, sent, rets } = retSetup();
  await runner.handleRet('r1', ret('save', { rno: '1' }, NOW - 3 * 60 * 1000));
  assert.match(outOf(rets, 'r1').err, /^NOTSENT:/);
  assert.deepStrictEqual(sent, []);
});

test('반품: 전체 멈춤·진행 중 작업이면 저장하지 않음', async () => {
  const a = retSetup({ control: { pause: true } });
  await a.runner.handleRet('r1', ret('save', { rno: '1' }));
  assert.match(outOf(a.rets, 'r1').err, /^NOTSENT:/);
  assert.ok(!a.sent.some((x) => x.cmd === 'save'));
  const b = retSetup({ jobs: { 'gift_add:2026-11-01:1': { state: 'running' } } });
  await b.runner.handleRet('r1', ret('save', { rno: '1' }));
  assert.match(outOf(b.rets, 'r1').err, /^NOTSENT:/);
  assert.ok(!b.sent.some((x) => x.cmd === 'save'));
});

test('반품: 저장은 실패해도 한 번만 보냄', async () => {
  const { runner, sent, rets } = retSetup({ fail: '도우미 응답 없음' });
  await runner.handleRet('r1', ret('save', { rno: '1' }));
  assert.strictEqual(sent.filter((x) => x.cmd === 'save').length, 1);
  assert.strictEqual(outOf(rets, 'r1').err, '도우미 응답 없음');
});

test('반품: 도우미가 없으면 작업이 없을 때만 이벗 탭을 열고 조회', async () => {
  const a = retSetup({ alive: false });
  await a.runner.handleRet('r1', ret('find', { orig: '1' }));
  assert.deepStrictEqual(a.opened, ['ebut']);
  assert.strictEqual(outOf(a.rets, 'r1').ok, true);
  const b = retSetup({ alive: false, jobs: { 'match_save:2026-11-01:1': { state: 'running' } } });
  await b.runner.handleRet('r1', ret('find', { orig: '1' }));
  assert.deepStrictEqual(b.opened, []);
  assert.strictEqual(outOf(b.rets, 'r1').err, 'NOHELPER');
});

test('반품: 연결 확인(ping)은 이벗 탭을 열지 않음', async () => {
  const { runner, rets, opened } = retSetup({ alive: false });
  await runner.handleRet('r1', ret('ping'));
  assert.deepStrictEqual(opened, []);
  assert.strictEqual(outOf(rets, 'r1').err, 'NOHELPER');
});

test('반품: 이벗 로그아웃이면 LOGIN 으로 알림', async () => {
  const { runner, rets, sent } = retSetup({ login: false });
  await runner.handleRet('r1', ret('find', { orig: '1' }));
  assert.strictEqual(outOf(rets, 'r1').err, 'LOGIN');
  assert.ok(!sent.some((x) => x.cmd === 'find'));
});

test('반품: 이미 다른 쪽이 가져간 요청은 처리하지 않음', async () => {
  const { runner, sent, rets } = retSetup();
  rets.r1 = { status: 'cancelled' };
  await runner.handleRet('r1', ret('find', { orig: '1' }));
  assert.deepStrictEqual(sent, []);
});

test('반품: 이벗 탭 도우미가 옛 판이면 작업이 없을 때 탭을 새로 열고 저장', async () => {
  const { runner, sent, rets, opened } = retSetup({ ver: '2026-11-08c' });
  await runner.handleRet('r1', ret('save', { rno: '1', db: 'cargo' }));
  assert.deepStrictEqual(opened, ['ebut']);
  assert.strictEqual(outOf(rets, 'r1').ok, true);
  assert.strictEqual(sent.filter((x) => x.cmd === 'save').length, 1);
});

test('반품: 도우미가 옛 판인데 다른 작업 중이면 저장하지 않음', async () => {
  const { runner, sent, rets, opened } = retSetup({ ver: '2026-11-08c', jobs: { 'gift_add:2026-11-01:1': { state: 'running' } } });
  await runner.handleRet('r1', ret('find', { orig: '1' }));
  assert.deepStrictEqual(opened, []);
  assert.match(outOf(rets, 'r1').err, /^NOTSENT:.*옛 판/);
  assert.ok(!sent.some((x) => x.cmd === 'find'));
});
