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

async function tick(tabs, diskVersion) {
  const created = []; const reloaded = [];
  let installed = null;
  const chrome = {
    tabs: { query: async () => tabs, create: async (o) => { created.push(o); return { id: 99 }; }, update: async () => {} },
    runtime: { getURL: (p) => p, getManifest: () => ({ version: '1.0.0' }), reload: () => reloaded.push(1),
      onStartup: { addListener() {} }, onInstalled: { addListener: (f) => { installed = f; } } },
    alarms: { create() {}, onAlarm: { addListener() {} } },
  };
  const fetch = async () => ({ json: async () => ({ version: diskVersion || '1.0.0' }) });
  vm.runInNewContext(BACKGROUND, { chrome, fetch, console });
  await installed();
  return { created, reloaded };
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

test('manifest: 필요한 권한만, 판 번호 있음', () => {
  const m = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
  assert.strictEqual(m.manifest_version, 3);
  assert.match(m.version, /^\d+\.\d+\.\d+$/);
  assert.deepStrictEqual(m.permissions.sort(), ['alarms', 'tabs']);
  assert.deepStrictEqual(m.host_permissions, ['https://makewon.com/*']);
  for (const c of m.content_scripts) for (const f of c.js) assert.ok(fs.existsSync(path.join(DIR, f)), f);
  assert.ok(fs.existsSync(path.join(DIR, m.background.service_worker)));
});
