/* 비서 화면 로그인 입력 (secretary_login.js, secretary_runner.handleLogin) */
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const L = require('../../main/secretary_login.js');
const C = require('../../main/secretary_core.js');
const { createRunner } = require('../../main/secretary_runner.js');

const NOW = new Date('2026-11-02T10:00:00+09:00').getTime();
const SECRET = 'p@ss비밀1';

test('잠금: 공개키로 잠근 값은 그 개인키로만 풀리고, 잠긴 글자에 값이 보이지 않음', async () => {
  const k = await L.createKeys();
  const sealed = await L.seal(k.publicJwk, { id: 'me', pw: SECRET });
  assert.ok(!sealed.includes(SECRET));
  assert.ok(!Buffer.from(sealed, 'base64').toString('latin1').includes('me'));
  assert.deepStrictEqual(await L.unseal(k.privateKey, sealed), { id: 'me', pw: SECRET });
  const other = await L.createKeys();
  await assert.rejects(L.unseal(other.privateKey, sealed));
});

test('잠금: 개인키는 꺼낼 수 없고, 너무 긴 값은 거절', async () => {
  const k = await L.createKeys();
  assert.strictEqual(k.privateKey.extractable, false);
  assert.ok(!('d' in k.publicJwk), '공개키에 개인키 값이 없음');
  await assert.rejects(L.seal(k.publicJwk, { id: 'x', pw: 'y'.repeat(300) }), /너무 깁니다/);
});

function setup(o) {
  o = o || {};
  const log = [], writes = [];
  let loggedIn = !!o.loggedIn;
  const db = { sites: {}, jobs: Object.assign({}, o.jobs), results: {}, cleared: [] };
  const rec = (k, v) => { writes.push(JSON.stringify([k, v])); };
  const store = {
    claimRunner: async () => true, getRunner: async () => ({ id: 'me', ts: NOW }), claimCommand: async () => true, setCommand: async (i, p) => rec('cmd', p),
    getJobs: async () => db.jobs, setJob: async (k, p) => { rec('job', p); db.jobs[k] = Object.assign(db.jobs[k] || {}, p); },
    getControl: async () => null, setSite: async (id, p) => { rec('site', p); db.sites[id] = p; }, setMatch: async () => {},
    claimCall: async () => true, setCall: async (i, p) => rec('call', p),
    clearLoginReq: async (id) => { db.cleared.push(id); }, setLoginResult: async (id, p) => { rec('res', p); db.results[id] = p; },
  };
  const runner = createRunner({
    store, now: () => NOW, runnerId: 'me', info: {},
    openSite: async (s) => { log.push('open:' + s.id); return s.id === 'ezadmin' ? { page: loggedIn ? 'DG00' : '' } : { login: loggedIn }; },
    ezPing: async () => true, ezSearch: async () => ({ rows: [], total: 0 }), ezPreview: async () => ({ blockers: [] }), mensoPreview: async () => ({ blockers: [] }),
    ezWrite: async (c) => { log.push(c); if (c === 'fill') return { done: ['1'], skipped: [] }; return { started: true, problems: [] }; },
    unseal: async (s) => { if (s === 'BAD') throw new Error('키 다름'); return JSON.parse(s); },
    login: async (site, creds) => { log.push('login:' + creds.id); if (o.tried === false) return { tried: false, why: '보안문자' }; loggedIn = creds.pw === SECRET; return { tried: true }; },
  });
  return { runner, db, log, writes };
}
const req = (site, pw, at) => ({ site, sealed: JSON.stringify({ id: 'me', pw }), at: at === undefined ? NOW : at, by: 'x' });

test('맞는 값이면 로그인되고, 요청은 바로 지우며, 값은 어디에도 기록하지 않음', async () => {
  const s = setup();
  await s.runner.handleLogin('r1', req('ezadmin', SECRET));
  assert.deepStrictEqual(s.db.cleared, ['r1']);
  assert.deepStrictEqual(s.db.results.r1.ok, true);
  assert.strictEqual(s.db.sites.ezadmin.state, 'ok');
  assert.ok(!s.writes.join().includes(SECRET));
  assert.ok(!s.writes.join().includes('"me"'));
});

test('틀린 값이면 한 번만 시도하고 실패를 알리며, 값을 기록하지 않음', async () => {
  const s = setup();
  await s.runner.handleLogin('r1', req('ebut', 'wrong'));
  assert.strictEqual(s.db.results.r1.ok, false);
  assert.match(s.db.results.r1.why, /확인해 주세요/);
  assert.strictEqual(s.log.filter((x) => x.startsWith('login')).length, 1);
  assert.strictEqual(s.db.sites.ebut.state, 'login');
  assert.ok(!s.writes.join().includes('wrong'));
});

test('보안문자가 있으면 이유를 그대로 알림', async () => {
  const s = setup({ tried: false });
  await s.runner.handleLogin('r1', req('ebut', SECRET));
  assert.strictEqual(s.db.results.r1.why, '보안문자');
});

test('만료, 다른 키, 모르는 사이트, 진행 중 작업이면 로그인하지 않고 요청은 지움', async () => {
  for (const [r, opt, why] of [
    [req('ebut', SECRET, NOW - C.LOGIN_TTL - 1), {}, /시간이 지났/],
    [{ site: 'ebut', sealed: 'BAD', at: NOW }, {}, /다시 입력/],
    [req('nope', SECRET), {}, /모르는 사이트/],
    [req('ebut', SECRET), { jobs: { a: { state: 'running', at: NOW } } }, /진행 중/],
  ]) {
    const s = setup(opt);
    await s.runner.handleLogin('r1', r);
    assert.match(s.db.results.r1.why, why);
    assert.deepStrictEqual(s.db.cleared, ['r1']);
    assert.ok(!s.log.some((x) => x.startsWith('login')));
  }
});

test('채운 내용이 있으면 탭을 움직이는 로그인을 하지 않음', async () => {
  const s = setup({ loggedIn: true });
  await s.runner.handleCall('c', { cmd: 'search', args: '{}', at: NOW });
  await s.runner.handleCall('d', { cmd: 'fill', args: '{}', at: NOW });
  await s.runner.handleLogin('r1', req('ezadmin', SECRET));
  assert.match(s.db.results.r1.why, /진행 중/);
  assert.ok(!s.log.some((x) => x.startsWith('login')));
});

test('로그인 명령은 페이지가 바뀌어도 다시 보내지 않는 목록에 있고, 읽기 명령 목록에는 없음', () => {
  assert.ok(C.HELPER_WRITE.includes('login'));
  assert.throws(() => C.assertSafeCmd('login'), /허용되지 않은 명령/);
  assert.ok(!C.RELAY_CMDS.includes('login'));
});

function page(file, host, fields) {
  const src = fs.readFileSync(__dirname + '/../../main/' + file, 'utf8');
  const clicks = { n: 0 };
  const box = () => ({ style: {}, set innerHTML(v) {}, remove() {}, appendChild() {}, querySelector() { return null; } });
  const doc = { body: box(), head: box(), createElement: box, getElementById: (i) => fields[i] || null, querySelector: (q) => fields[q] || null, querySelectorAll: () => [] };
  const win = { location: { hostname: host, search: '' }, document: doc, alert() {}, confirm() { return false; }, open() { return null; }, opener: null,
    addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout, Promise, JSON, getComputedStyle: (e) => ({ display: e.style.display || 'block' }), URLSearchParams };
  win.window = win;
  fields['.login-btn'] = fields['.login-btn'] || { click() { clicks.n++; } };
  vm.runInNewContext(src, Object.assign(win, { setTimeout, clearTimeout }));
  return { win, clicks };
}

test('이지어드민 도우미: 칸을 채우고 버튼을 한 번 누르며, 값을 돌려주지 않음', async () => {
  const el = (v) => ({ value: v || '', defaultValue: '', style: {}, offsetParent: {} });
  const f = { 'login-pwd': el(), 'login-id': el(), 'login-domain': el('도메인') };
  const { win, clicks } = page('ez_helper.js', 'www.ezadmin.co.kr', f);
  const r = win.__mkwEzHelper.login({ id: 'me', pw: SECRET, domain: 'ga89' });
  assert.deepStrictEqual({ ...r }, { tried: true });
  assert.ok(!JSON.stringify(r).includes(SECRET));
  assert.strictEqual(f['login-id'].value, 'me');
  assert.strictEqual(f['login-pwd'].value, SECRET);
  assert.strictEqual(f['login-domain'].value, 'ga89');
  await new Promise((d) => setTimeout(d, 350));
  assert.strictEqual(clicks.n, 1);
});

test('이지어드민 도우미: 보안문자가 있으면 칸을 채우지도 누르지도 않음', async () => {
  const el = (v) => ({ value: v || '', defaultValue: '', style: {}, offsetParent: {} });
  const f = { 'login-pwd': el(), 'login-id': el(), 'login-domain': el(), captchaCode: el() };
  const { win, clicks } = page('ez_helper.js', 'www.ezadmin.co.kr', f);
  const r = win.__mkwEzHelper.login({ id: 'me', pw: SECRET, domain: 'ga89' });
  assert.strictEqual(r.tried, false);
  assert.match(r.why, /보안문자/);
  assert.strictEqual(f['login-pwd'].value, '');
  await new Promise((d) => setTimeout(d, 350));
  assert.strictEqual(clicks.n, 0);
});

test('이지어드민 새 로그인 화면(login3, 버튼 .btn-login)에서도 한 번 누름 · 로그인 주소는 login2 로그인 화면', async () => {
  const el = (v) => ({ value: v || '', defaultValue: '', style: {}, offsetParent: {} });
  let n = 0;
  const f = { 'login-pwd': el(), 'login-id': el(), 'login-domain': el(), '.btn-login': { click() { n++; } }, '.login-btn': null };
  const { win, clicks } = page('ez_helper.js', 'login3.ezadmin.co.kr', f);
  const r = win.__mkwEzHelper.login({ id: 'me', pw: SECRET, domain: 'clf' });
  assert.strictEqual(r.tried, true);
  await new Promise((d) => setTimeout(d, 350));
  assert.strictEqual(n, 1);
  assert.strictEqual(clicks.n, 0);
  const ez = C.SITES.find((s) => s.id === 'ezadmin');
  assert.strictEqual(ez.login, 'https://login2.ezadmin.co.kr/login.htm');
});
