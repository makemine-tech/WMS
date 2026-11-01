/* 메이크창고 비서 확장 (tools/secretary_ext) — 도우미 주입 조건, 헤드비서 탭 유지, 설치 파일 */
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'secretary_ext');
const INJECT = fs.readFileSync(path.join(DIR, 'inject.js'), 'utf8');
const BACKGROUND = fs.readFileSync(path.join(DIR, 'background.js'), 'utf8');

function run(name, opener, hostname) {
  const added = [];
  const win = { name, opener, location: { hostname }, Date, Object,
    document: { createElement: () => ({}), head: { appendChild: (s) => added.push(s.src) } } };
  win.window = win;
  vm.runInNewContext(INJECT, win);
  return added;
}

test('비서가 연 이지어드민 탭에 도우미를 켠다', () => {
  const a = run('mkw_sec_ez', {}, 'ga89.ezadmin.co.kr');
  assert.strictEqual(a.length, 1);
  assert.match(a[0], /^https:\/\/makewon\.com\/ez_helper\.js\?v=\d+$/);
});

test('비서가 연 이벗 탭에 도우미를 켠다', () => {
  const a = run('mkw_sec_ebut', {}, 'ebut3pl.co.kr');
  assert.match(a[0], /^https:\/\/makewon\.com\/ebut_helper\.js\?v=\d+$/);
});

test('직접 연 탭과 기존 페이지가 연 탭에는 켜지 않는다', () => {
  assert.deepStrictEqual(run('', null, 'ga89.ezadmin.co.kr'), []);
  assert.deepStrictEqual(run('', {}, 'ga89.ezadmin.co.kr'), []);
  assert.deepStrictEqual(run('mkw_sec_ez', null, 'ga89.ezadmin.co.kr'), []);
  assert.deepStrictEqual(run('constructor', {}, 'ga89.ezadmin.co.kr'), []);
  assert.deepStrictEqual(run('mkw_ez_tab', {}, 'ga89.ezadmin.co.kr'), []);
  assert.deepStrictEqual(run('mkw_ebut_tab', {}, 'ebut3pl.co.kr'), []);
});

test('탭 이름과 사이트가 다르면 켜지 않는다', () => {
  assert.deepStrictEqual(run('mkw_sec_ebut', {}, 'ga89.ezadmin.co.kr'), []);
  assert.deepStrictEqual(run('mkw_sec_ez', {}, 'ebut3pl.co.kr'), []);
  assert.deepStrictEqual(run('mkw_sec_ez', {}, 'ezadmin.co.kr.evil.example'), []);
});

async function tick(tabs, diskVersion, details) {
  const created = []; const reloaded = []; const tabReloads = [];
  let installed = null;
  const chrome = {
    tabs: { query: async () => tabs, create: async (o) => { created.push(o); return { id: 99 }; }, update: async () => {}, reload: async (id) => tabReloads.push(id) },
    runtime: { getURL: (p) => p, getManifest: () => ({ version: '1.0.0' }), reload: () => reloaded.push(1),
      onStartup: { addListener() {} }, onInstalled: { addListener: (f) => { installed = f; } }, onMessage: { addListener() {} } },
    alarms: { create() {}, onAlarm: { addListener() {} } },
  };
  const fetch = async () => ({ json: async () => ({ version: diskVersion || '1.0.0' }) });
  vm.runInNewContext(BACKGROUND, { chrome, fetch, console });
  await installed(details);
  return { created, reloaded, tabReloads };
}

test('헤드비서 탭이 없으면 고정 탭으로 연다', async () => {
  const { created } = await tick([{ id: 1, url: 'https://makewon.com/secretary.html' }]);
  assert.strictEqual(created.length, 1);
  assert.strictEqual(created[0].url, 'https://makewon.com/secretary.html?run=1');
  assert.strictEqual(created[0].pinned, true);
});

test('헤드비서 탭이 있으면 새로 열지 않는다', async () => {
  const { created } = await tick([{ id: 1, url: 'https://makewon.com/secretary.html?run=1', autoDiscardable: false }]);
  assert.strictEqual(created.length, 0);
});

test('WMS 로그인 화면으로 넘어간 헤드비서 탭이 있으면 탭을 늘리지 않는다', async () => {
  const url = 'https://makewon.com/wms_login.html?return=' + encodeURIComponent('/secretary.html?run=1');
  const { created } = await tick([{ id: 1, url }]);
  assert.strictEqual(created.length, 0);
});

test('디스크의 판이 다르면 다시 불러온다', async () => {
  assert.strictEqual((await tick([], '1.0.1')).reloaded.length, 1);
  assert.strictEqual((await tick([], '1.0.0')).reloaded.length, 0);
});

test('확장이 새 판으로 갱신되면 헤드비서 탭을 새로고침한다', async () => {
  const tabs = [{ id: 7, url: 'https://makewon.com/secretary.html?run=1', autoDiscardable: false }];
  assert.deepStrictEqual((await tick(tabs, null, { reason: 'update' })).tabReloads, [7]);
  assert.deepStrictEqual((await tick(tabs, null, { reason: 'install' })).tabReloads, []);
});

function epostBg(fetch) {
  let on = null;
  const chrome = {
    tabs: {}, alarms: { create() {}, onAlarm: { addListener() {} } },
    runtime: { onStartup: { addListener() {} }, onInstalled: { addListener() {} }, onMessage: { addListener: (f) => { on = f; } } },
  };
  vm.runInNewContext(BACKGROUND, { chrome, fetch, console, AbortSignal });
  return (msg, url) => new Promise((ok) => { if (on(msg, { url }, ok) !== true) ok('안 받음'); });
}
const SEC = 'https://makewon.com/secretary.html?run=1';

test('우체국 대신 조회: 헤드비서 페이지의 숫자 번호만 받아 본문을 글자로 돌려준다', async () => {
  const urls = [];
  const send = epostBg(async (u) => { urls.push(u); return { ok: true, text: async () => '<script>x</script><td>반품원등기번호:<a href="#">6077</a></td>' }; });
  const r = await send({ epost: '7077480535132' }, SEC);
  assert.match(urls[0], /^https:\/\/service\.epost\.go\.kr\/.*sid1=7077480535132$/);
  assert.match(r.text, /반품원등기번호: 6077/);
  assert.doesNotMatch(r.text, /script|href/);
  assert.strictEqual((await send({ epost: '1&x=2' }, SEC)).err, '등기번호 형식');
  assert.strictEqual(await send({ epost: '7077480535132' }, 'https://example.com/'), '안 받음');
  assert.strictEqual(urls.length, 1);
});

test('우체국 대신 조회: 실패는 오류로 돌려준다', async () => {
  assert.strictEqual((await epostBg(async () => ({ ok: false, status: 500 }))({ epost: '7077480535132' }, SEC)).err, 'http 500');
  assert.match((await epostBg(async () => { throw new Error('끊김'); })({ epost: '7077480535132' }, SEC)).err, /끊김/);
});

test('manifest: 필요한 권한만, 판 번호 있음', () => {
  const m = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
  assert.strictEqual(m.manifest_version, 3);
  assert.match(m.version, /^\d+\.\d+\.\d+$/);
  assert.deepStrictEqual(m.permissions.sort(), ['alarms', 'tabs']);
  assert.deepStrictEqual(m.host_permissions, ['https://makewon.com/*', 'https://service.epost.go.kr/*']);
  for (const c of m.content_scripts) for (const f of c.js) assert.ok(fs.existsSync(path.join(DIR, f)), f);
  assert.ok(fs.existsSync(path.join(DIR, m.background.service_worker)));
});
