/* 비젬 주문수집: 도우미(가짜 화면)와 헤드비서(가짜 응답) 시험. 실제 비젬에는 닿지 않음 */
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const C = require('../../main/secretary_core.js');
const { bizemSteps, flow } = require('../../main/secretary_menso.js');
const { createRunner } = require('../../main/secretary_runner.js');
const SRC = fs.readFileSync(__dirname + '/../../main/bizem_helper.js', 'utf8');
const NOW = new Date('2026-11-03T12:00:00+09:00').getTime();

function cell(t) { return { textContent: t }; }
function row(name, checked, last, status) {
  const cb = checked === null ? null : { checked };
  return { cells: [cell(''), cell('1'), cell(''), cell('계정아이디'), cell(name), cell(last + '[boxn계정]'), cell(status)], querySelector: () => cb };
}
/* 주문서수집 화면 흉내. after = 확인창·진행창 결과 */
function collectPage(o) {
  o = o || {};
  const state = { rows: o.rows || [row('맨소래담-무신사', true, '2026-11-02 15:17:03', '정상종료'), row('옥션2.0', null, '', ''), row('텐바이텐', false, '2026-11-02 15:17:01', '정상종료')], clicks: { go: 0, ok: 0 }, tabs: [] };
  const els = {};
  const btn = { disabled: false, click() { state.clicks.go++; if (o.noConfirm) return; els.myConfirmModalBody = { textContent: '주문건들이 발주확인 처리됩니다.' }; els.myConfirmModalOkBtn = okBtn; } };
  const okBtn = { click() { state.clicks.ok++; if (o.refuse) { els.__modal = { textContent: ' 속도 개선으로 인해 3분 이내 주문 수집을 막고 있습니다. ' }; return; } btn.disabled = true; els.myframe = { getAttribute: () => '../COM/COM004PB?cmdtype=getOrderAfterConfirm&x=1', contentWindow: { document: { querySelector: () => state.popupError || null } } }; } };
  els.btngetorderafterconfirm = btn;
  els.txtstdt = { value: '2026-10-30' }; els.txtenddt = { value: '2026-11-03' };
  const frameDoc = {
    getElementById: (i) => els[i] || null,
    querySelector: (q) => (/getOpt/.test(q) ? { value: '10' } : /myModal/.test(q) ? els.__modal || null : null),
    querySelectorAll: () => state.rows,
  };
  const frame = { contentWindow: { document: frameDoc, alert() {} } };
  const heard = [];
  const win = { location: { hostname: 'partner.bizesm.com' }, addEventListener: (n, f) => heard.push(f), removeEventListener() {}, alert() {}, opener: null, setTimeout, clearTimeout, Promise, JSON };
  win.document = { querySelector: () => null, getElementById: (i) => (i === 'iframe_REQ005MA' && state.tabs.length ? frame : null) };
  win.addTabReload = (id) => state.tabs.push(id);
  win.window = win;
  win.fetch = async () => ({ text: async () => '([])' });
  vm.runInNewContext(SRC, Object.assign(win, { RegExp, Object, String, Number, Array, Error }));
  const send = (cmd, args) => new Promise((res) => {
    heard[0]({ data: { to: 'bizem-helper', id: 1, cmd, args }, origin: 'https://makewon.com', source: { postMessage: (m) => res(JSON.parse(JSON.stringify(m))) } });
  });
  return { send, state, btn, els };
}

test('collectCheck: 메뉴를 열어 체크된 쇼핑몰·기간만 읽고, 버튼은 누르지 않으며 계정 ID 를 돌려주지 않음', async () => {
  const p = collectPage();
  const m = await p.send('collectCheck', {});
  assert.ok(m.ok, m.err);
  assert.deepStrictEqual(p.state.tabs, ['REQ005MA']);
  assert.deepStrictEqual(m.data.checked, ['맨소래담-무신사']);
  assert.strictEqual(m.data.from, '2026-10-30');
  assert.strictEqual(m.data.to, '2026-11-03');
  assert.strictEqual(m.data.opt, '10');
  assert.strictEqual(m.data.malls[0].last, '2026-11-02 15:17:03');
  assert.strictEqual(p.state.clicks.go, 0);
  assert.ok(!JSON.stringify(m.data).includes('계정'));
});

test('collectGo: 수집 버튼과 비젬 확인창을 한 번씩 누르고 진행창이 뜨면 시작으로 답함', async () => {
  const p = collectPage();
  await p.send('collectCheck', {});
  const m = await p.send('collectGo', {});
  assert.strictEqual(m.data.started, true);
  assert.deepStrictEqual(p.state.clicks, { go: 1, ok: 1 });
});

test('collectGo: 3분 제한 안내가 뜨면 시작 안 됨으로 답함', async () => {
  const p = collectPage({ refuse: true });
  await p.send('collectCheck', {});
  const m = await p.send('collectGo', {});
  assert.strictEqual(m.data.started, false);
  assert.match(m.data.why, /3분/);
  assert.deepStrictEqual(p.state.clicks, { go: 1, ok: 1 });
});

test('collectGo: 버튼이 잠겨 있으면 누르지 않음', async () => {
  const p = collectPage();
  await p.send('collectCheck', {});
  p.btn.disabled = true;
  const m = await p.send('collectGo', {});
  assert.strictEqual(m.data.started, false);
  assert.strictEqual(p.state.clicks.go, 0);
});

test('collectStatus: 버튼이 풀리면 끝, 진행창 오류는 알림, 화면이 사라지면 lost', async () => {
  const p = collectPage();
  assert.strictEqual((await p.send('collectStatus', {})).data.lost, true);
  await p.send('collectCheck', {});
  await p.send('collectGo', {});
  assert.strictEqual((await p.send('collectStatus', {})).data.done, false);
  p.state.popupError = { textContent: ' 쇼핑몰 접속 실패 ' };
  assert.strictEqual((await p.send('collectStatus', {})).data.error, '쇼핑몰 접속 실패');
  p.state.popupError = null;
  p.btn.disabled = false;
  const end = (await p.send('collectStatus', {})).data;
  assert.strictEqual(end.done, true);
  assert.strictEqual(end.malls.length, 2);
});

test('도우미 코드에 선택 확정·삭제·보류·양식다운로드 버튼은 없음', () => {
  for (const id of ['btnSave', 'btnDel', 'btnDelSearch', 'btnAllResrve', 'preexcelFormDownload']) assert.ok(!SRC.includes(id), id);
});

test('명령 목록: 읽기와 저장을 나눔', () => {
  ['collectCheck', 'collectStatus'].forEach((c) => C.assertSafeCmd(c));
  assert.throws(() => C.assertSafeCmd('collectGo'));
  assert.ok(C.HELPER_WRITE.includes('collectGo'));
  assert.ok(C.COMMAND_TYPES.includes('bizem_check') && C.COMMAND_TYPES.includes('bizem_collect'));
  const rules = fs.readFileSync(__dirname + '/../../database.rules.json', 'utf8');
  C.COMMAND_TYPES.forEach((t) => assert.ok(rules.includes("'" + t + "'"), t));
});

function mall(name, last, status) { return { name, checked: true, last, status: status || '정상종료' }; }
const BEFORE = { malls: [mall('맨소래담-무신사', '2026-11-02 15:17:03'), mall('텐바이텐', '2026-11-02 15:17:01')], checked: ['맨소래담-무신사', '텐바이텐'], from: '2026-10-30', to: '2026-11-03', opt: '10' };
function setup(o) {
  o = o || {};
  const db = { commands: {}, jobs: Object.assign({}, o.jobs), sites: {}, go: 0, sent: [] };
  const statuses = (o.statuses || [{ done: false }, { done: true, malls: [mall('맨소래담-무신사', '2026-11-03 12:00:10'), mall('텐바이텐', '2026-11-03 12:00:12')] }]).slice();
  const store = {
    getRunner: async () => ({ id: 'me', ts: NOW }), getControl: async () => o.control || null,
    claimCommand: async () => true, setCommand: async (id, p) => { db.commands[id] = Object.assign(db.commands[id] || {}, p); },
    getJobs: async () => db.jobs, setJob: async (k, p) => { db.jobs[k] = Object.assign(db.jobs[k] || {}, p); }, setSite: async (id, p) => { db.sites[id] = p; },
  };
  let counts = 0;
  const runner = createRunner({
    store, now: () => NOW, runnerId: 'me', info: {}, sleep: async () => {},
    openSite: async () => ({ login: o.login !== false }),
    bizemCounts: async () => ({ unconfirmed: counts++ ? 7 : 2, printWait: 0 }),
    bizemRead: async (cmd) => { db.sent.push(cmd); if (cmd === 'collectCheck') return o.check || BEFORE; const s = statuses.shift(); if (s === undefined) throw new Error('끊김'); return s; },
    bizemGo: async () => { db.go++; if (o.goThrow) throw new Error('도우미 응답 없음'); return o.go || { started: true, alerts: [] }; },
  });
  return { runner, db };
}
const collect = (o) => Object.assign({ type: 'bizem_collect', at: NOW, by: 'x', malls: BEFORE.checked, from: BEFORE.from, to: BEFORE.to, opt: '10' }, o);
const job = (db) => db.jobs[Object.keys(db.jobs)[0]];

test('확인 명령: 쇼핑몰 목록을 명령 결과로 돌려주고 수집하지 않음', async () => {
  const { runner, db } = setup();
  await runner.handleCommand('c', { type: 'bizem_check', at: NOW });
  assert.strictEqual(db.commands.c.status, 'done');
  assert.deepStrictEqual(db.commands.c.check.checked, BEFORE.checked);
  assert.strictEqual(db.go, 0);
  assert.deepStrictEqual(db.jobs, {});
});

test('수집: 한 번 눌러 끝까지 기다리고 건수와 쇼핑몰 결과를 남김', async () => {
  const { runner, db } = setup();
  await runner.handleCommand('c', collect());
  assert.strictEqual(db.go, 1);
  const j = job(db);
  assert.strictEqual(j.state, 'done');
  assert.strictEqual(j.recipe, 'bizem_collect');
  assert.deepStrictEqual(j.result.counts, { before: 2, after: 7 });
  assert.deepStrictEqual(j.result.notNew, []);
  assert.strictEqual(db.sites.bizem.counts.unconfirmed, 7);
  assert.strictEqual(db.commands.c.status, 'done');
});

test('수집: 수집 시각이 안 바뀐 쇼핑몰이 있거나 상태가 정상이 아니면 확인 필요', async () => {
  const { runner, db } = setup({ statuses: [{ done: true, malls: [mall('맨소래담-무신사', '2026-11-02 15:17:03'), mall('텐바이텐', '2026-11-03 12:00:12', '오류')] }] });
  await runner.handleCommand('c', collect());
  const j = job(db);
  assert.strictEqual(j.state, 'stopped');
  assert.deepStrictEqual(j.result.notNew, ['맨소래담-무신사', '텐바이텐']);
});

test('수집: 사람이 본 쇼핑몰·기간과 다르면 누르지 않음', async () => {
  for (const c of [collect({ malls: ['맨소래담-무신사'] }), collect({ from: '2026-10-01' }), collect({ opt: '20' })]) {
    const { runner, db } = setup();
    await runner.handleCommand('c', c);
    assert.strictEqual(db.go, 0);
    assert.strictEqual(job(db).state, 'stopped');
  }
});

test('수집: 늦게 처리된 요청·멈춤·진행 중 작업·로그아웃이면 누르지 않음', async () => {
  let t = setup();
  await t.runner.handleCommand('c', collect({ at: NOW - C.RELAY_TTL - 1 }));
  assert.strictEqual(t.db.commands.c.status, 'expired');
  assert.strictEqual(t.db.go, 0);
  t = setup({ control: { pause: true } });
  await t.runner.handleCommand('c', collect());
  assert.strictEqual(t.db.commands.c.status, 'refused');
  assert.strictEqual(t.db.go, 0);
  t = setup({ jobs: { 'menso_read:2026-11-03:1': { state: 'running', at: NOW } } });
  await t.runner.handleCommand('c', collect());
  assert.strictEqual(t.db.commands.c.status, 'refused');
  assert.strictEqual(t.db.go, 0);
  t = setup({ login: false });
  await t.runner.handleCommand('c', collect());
  assert.strictEqual(t.db.go, 0);
  assert.strictEqual(job(t.db).state, 'stopped');
});

test('수집: 시작 거절이나 응답 끊김이면 다시 누르지 않고 멈춤', async () => {
  let t = setup({ go: { started: false, why: '3분 이내 수집 제한' } });
  await t.runner.handleCommand('c', collect());
  assert.strictEqual(t.db.go, 1);
  assert.match(job(t.db).notes, /3분/);
  t = setup({ goThrow: true });
  await t.runner.handleCommand('c', collect());
  assert.strictEqual(t.db.go, 1);
  assert.strictEqual(job(t.db).state, 'stopped');
  assert.match(job(t.db).notes, /확인/);
});

test('수집: 진행창 오류·화면 사라짐이면 멈추고, 끝 소식이 없어도 작업을 풀어 줌', async () => {
  let t = setup({ statuses: [{ done: false, error: '쇼핑몰 접속 실패' }] });
  await t.runner.handleCommand('c', collect());
  assert.match(job(t.db).notes, /접속 실패/);
  t = setup({ statuses: [{ lost: true }] });
  await t.runner.handleCommand('c', collect());
  assert.strictEqual(job(t.db).state, 'stopped');
  t = setup({ statuses: [] });
  await t.runner.handleCommand('c', collect());
  assert.strictEqual(job(t.db).state, 'stopped');
  assert.strictEqual(t.db.go, 1);
});

test('흐름 칸: 진행 중이면 run, 오늘 멈췄으면 todo, 끝나고 대기 0이면 done', () => {
  const st = (job, counts) => bizemSteps(flow({ rows: [] }, []).steps, { state: 'ok', counts: counts || { unconfirmed: 0, printWait: 0 } }, job).find((s) => s.id === 'bizem_collect');
  assert.strictEqual(st({ state: 'running' }).state, 'run');
  assert.strictEqual(st({ state: 'stopped' }).state, 'todo');
  assert.strictEqual(st({ state: 'interrupted' }).state, 'todo');
  assert.strictEqual(st({ state: 'done' }).state, 'done');
  assert.strictEqual(st({ state: 'done' }, { unconfirmed: 3, printWait: 0 }).count, 3);
  assert.strictEqual(st(null).who, '비서');
});

test('사무실: 수집 중에는 이벗 비서만 일하고 단계를 말함', () => {
  const jobs = { 'bizem_collect:2026-11-03:1': { state: 'running', recipe: 'bizem_collect', at: NOW, step: '주문수집 중' } };
  const rooms = C.officeRooms({ runner: { id: 'me', ts: NOW }, sites: {}, jobs, now: NOW });
  const eb = rooms.find((r) => r.id === 'ebut'), ez = rooms.find((r) => r.id === 'ezadmin');
  assert.strictEqual(eb.mode, 'work');
  assert.strictEqual(eb.say, '주문수집 중');
  assert.notStrictEqual(ez.mode, 'work');
});

/* 주문서확정 화면 흉내 */
function confirmPage(o) {
  o = o || {};
  const state = { clicks: { search: 0, all: 0, ok: 0 }, tabs: [], popup: {} };
  const els = { selresrveat: { value: o.hold || '10' }, ordercnt: { value: '' }, grpcnt: { value: '' } };
  els.btnSearch = { click() { state.clicks.search++; els.ordercnt.value = String(o.orders === undefined ? 143 : o.orders); els.grpcnt.value = '120'; } };
  const okBtn = { click() { state.clicks.ok++; els.__popup = { contentWindow: { isSuccess: state.popup.done === true, document: { querySelector: (q) => (/ForceConfirm/.test(q) ? state.popup.ask || null : state.popup.error || null) } } }; } };
  const item = { click() { state.clicks.all++; if (o.noConfirm) return; els.myConfirmModalBody = { textContent: o.text || '조회된 전체 주문건을 주문확정 하시겠습니까?' }; els.myConfirmModalOkBtn = okBtn; } };
  const frameDoc = { readyState: 'complete', getElementById: (i) => els[i] || null, querySelector: (q) => (q === '#btnAllOrderSave a' ? item : /radiotrnsprtsttusse/.test(q) ? { value: o.status || 'A10' } : /myframeMid/.test(q) ? els.__popup || null : null) };
  const frame = { contentWindow: { document: frameDoc, alert() {}, cmdSearch() {} } };
  const heard = [];
  const win = { location: { hostname: 'partner.bizesm.com' }, addEventListener: (n, f) => heard.push(f), removeEventListener() {}, alert() {}, opener: null, setTimeout, clearTimeout, Promise, JSON };
  win.document = { querySelector: () => null, getElementById: (i) => (i === 'iframe_REQ008MA' && state.tabs.length ? frame : null) };
  win.addTabReload = (id) => state.tabs.push(id);
  win.window = win;
  win.fetch = async () => ({ text: async () => '([])' });
  vm.runInNewContext(SRC, Object.assign(win, { RegExp, Object, String, Number, Array, Error }));
  const send = (cmd, args) => new Promise((res) => { heard[0]({ data: { to: 'bizem-helper', id: 1, cmd, args }, origin: 'https://makewon.com', source: { postMessage: (m) => res(JSON.parse(JSON.stringify(m))) } }); });
  return { send, state, els };
}

test('confirmCheck: 메뉴를 열어 검색하고 건수만 읽으며 확정은 누르지 않음', async () => {
  const p = confirmPage();
  const m = await p.send('confirmCheck', {});
  assert.deepStrictEqual(m.data, { orders: 143, invoices: 120, status: 'A10', hold: '10' });
  assert.deepStrictEqual(p.state.tabs, ['REQ008MA']);
  assert.deepStrictEqual(p.state.clicks, { search: 1, all: 0, ok: 0 });
});

test('confirmGo: 전체 확정과 확인창을 한 번씩 누르고, 건수가 다르거나 문구가 다르면 확인을 누르지 않음', async () => {
  let p = confirmPage();
  await p.send('confirmCheck', {});
  assert.strictEqual((await p.send('confirmGo', { orders: 143 })).data.started, true);
  assert.deepStrictEqual(p.state.clicks, { search: 1, all: 1, ok: 1 });
  p = confirmPage();
  await p.send('confirmCheck', {});
  assert.strictEqual((await p.send('confirmGo', { orders: 100 })).data.started, false);
  assert.strictEqual(p.state.clicks.all, 0);
  p = confirmPage({ text: '전체 삭제하시겠습니까?' });
  await p.send('confirmCheck', {});
  const r = (await p.send('confirmGo', { orders: 143 })).data;
  assert.strictEqual(r.started, false);
  assert.strictEqual(p.state.clicks.ok, 0);
});

test('confirmStatus: 끝, 강제 확정 질문, 오류, 화면 없음을 구분하고 질문에는 답하지 않음', async () => {
  const p = confirmPage();
  assert.strictEqual((await p.send('confirmStatus', {})).data.lost, true);
  await p.send('confirmCheck', {});
  p.state.popup = { ask: {} };
  await p.send('confirmGo', { orders: 143 });
  assert.strictEqual((await p.send('confirmStatus', {})).data.ask, true);
  p.state.popup = { error: { textContent: ' 오류 ' } };
  p.els.__popup.contentWindow.document.querySelector = (q) => (/ForceConfirm/.test(q) ? null : { textContent: ' 오류 ' });
  assert.strictEqual((await p.send('confirmStatus', {})).data.error, '오류');
  p.els.__popup.contentWindow.isSuccess = true;
  assert.strictEqual((await p.send('confirmStatus', {})).data.done, true);
});

function setupConfirm(o) {
  o = o || {};
  const db = { commands: {}, jobs: {}, sites: {}, go: [], sent: [] };
  const seq = (o.counts || [{ unconfirmed: 0, printWait: 0 }, { unconfirmed: 143, printWait: 0 }, { unconfirmed: 143, printWait: 0 }, { unconfirmed: 0, printWait: 120 }]).slice();
  const store = {
    getRunner: async () => ({ id: 'me', ts: NOW }), getControl: async () => null, claimCommand: async () => true,
    setCommand: async (id, p) => { db.commands[id] = Object.assign(db.commands[id] || {}, p); },
    getJobs: async () => db.jobs, setJob: async (k, p) => { db.jobs[k] = Object.assign(db.jobs[k] || {}, p); }, setSite: async (id, p) => { db.sites[id] = p; },
  };
  const runner = createRunner({
    store, now: () => NOW, runnerId: 'me', info: {}, sleep: async () => {},
    openSite: async () => ({ login: true }),
    bizemCounts: async () => (seq.length > 1 ? seq.shift() : seq[0]),
    bizemRead: async (cmd) => {
      db.sent.push(cmd);
      if (cmd === 'collectCheck') return BEFORE;
      if (cmd === 'collectStatus') return o.collect || { done: true, malls: [mall('맨소래담-무신사', '2026-11-03 12:00:10'), mall('텐바이텐', '2026-11-03 12:00:12')] };
      if (cmd === 'confirmCheck') return o.check || { orders: 143, invoices: 120, status: 'A10', hold: '10' };
      return o.status || { done: true };
    },
    bizemGo: async (cmd, args) => { db.go.push([cmd, args]); return (o.go && o.go[cmd]) || { started: true, alerts: [] }; },
  });
  return { runner, db };
}

test('수집 + 확정: 수집이 정상이면 전체 확정까지 한 번에 하고 결과를 남김', async () => {
  const { runner, db } = setupConfirm();
  await runner.handleCommand('c', collect({ confirm: true }));
  assert.deepStrictEqual(db.go.map((g) => g[0]), ['collectGo', 'confirmGo']);
  assert.deepStrictEqual(db.go[1][1], { orders: 143 });
  const j = job(db);
  assert.strictEqual(j.state, 'done');
  assert.deepStrictEqual(j.result.confirm, { orders: 143, after: 0, printWait: 120 });
  assert.strictEqual(db.sites.bizem.counts.printWait, 120);
});

test('수집 + 확정: 빠진 쇼핑몰이 있으면 확정하지 않음', async () => {
  const { runner, db } = setupConfirm({ collect: { done: true, malls: [mall('맨소래담-무신사', '2026-11-02 15:17:03'), mall('텐바이텐', '2026-11-03 12:00:12')] } });
  await runner.handleCommand('c', collect({ confirm: true }));
  assert.deepStrictEqual(db.go.map((g) => g[0]), ['collectGo']);
  assert.strictEqual(job(db).state, 'stopped');
  assert.match(job(db).notes, /주문확정은 하지 않았습니다/);
});

test('확정만: 사람이 본 건수와 다르거나 화면 조건이 다르면 누르지 않음', async () => {
  let t = setupConfirm({ counts: [{ unconfirmed: 150, printWait: 0 }] });
  await t.runner.handleCommand('c', { type: 'bizem_confirm', at: NOW, seen: 143 });
  assert.deepStrictEqual(t.db.go, []);
  assert.strictEqual(job(t.db).state, 'stopped');
  t = setupConfirm({ counts: [{ unconfirmed: 143, printWait: 0 }], check: { orders: 143, invoices: 1, status: 'A', hold: '10' } });
  await t.runner.handleCommand('c', { type: 'bizem_confirm', at: NOW, seen: 143 });
  assert.deepStrictEqual(t.db.go, []);
  t = setupConfirm({ counts: [{ unconfirmed: 143, printWait: 0 }] });
  await t.runner.handleCommand('c', { type: 'bizem_confirm', at: NOW - C.RELAY_TTL - 1, seen: 143 });
  assert.strictEqual(t.db.commands.c.status, 'expired');
  assert.deepStrictEqual(t.db.go, []);
});

test('확정만: 끝나면 완료, 대기가 남거나 비젬이 물으면 멈추고 다시 누르지 않음', async () => {
  let t = setupConfirm({ counts: [{ unconfirmed: 143, printWait: 0 }, { unconfirmed: 0, printWait: 120 }] });
  await t.runner.handleCommand('c', { type: 'bizem_confirm', at: NOW, seen: 143 });
  assert.strictEqual(job(t.db).state, 'done');
  assert.strictEqual(t.db.go.length, 1);
  t = setupConfirm({ counts: [{ unconfirmed: 143, printWait: 0 }, { unconfirmed: 5, printWait: 120 }] });
  await t.runner.handleCommand('c', { type: 'bizem_confirm', at: NOW, seen: 143 });
  assert.strictEqual(job(t.db).state, 'stopped');
  assert.match(job(t.db).notes, /5건/);
  t = setupConfirm({ counts: [{ unconfirmed: 143, printWait: 0 }], status: { done: false, ask: true } });
  await t.runner.handleCommand('c', { type: 'bizem_confirm', at: NOW, seen: 143 });
  assert.match(job(t.db).notes, /묻고/);
  assert.strictEqual(t.db.go.length, 1);
  t = setupConfirm({ counts: [{ unconfirmed: 143, printWait: 0 }], go: { confirmGo: { started: false, why: '확인창 없음' } } });
  await t.runner.handleCommand('c', { type: 'bizem_confirm', at: NOW, seen: 143 });
  assert.strictEqual(t.db.go.length, 1);
  assert.match(job(t.db).notes, /확인창/);
});

/* ── 비젬 주문 이벗에 넣기 ── */
const { newPages, addPage } = require('../../main/bizem_split.js');
test('쪽 합치기: 제목은 한 번, 앞 쪽과 같은 줄은 빼고, 같은 쪽을 또 받으면 0', () => {
  const st = newPages(), h = ['주문번호', '주문자이름'];
  assert.strictEqual(addPage(st, [h, [1, 'a'], [2, 'b']]), 2);
  assert.strictEqual(addPage(st, [h, [2, 'b'], [3, 'c']]), 1);
  assert.strictEqual(addPage(st, [h, [1, 'a'], [2, 'b'], [3, 'c']]), 0);
  assert.strictEqual(addPage(st, [['없음']]), 0);
  assert.deepStrictEqual(st.rows.map((r) => r[0]), ['주문번호', 1, 2, 3]);
});

function formPage(o) {
  o = o || {};
  const state = { tabs: [], fetched: [], made: 0 };
  const sel = { value: '', options: [{ text: ' 다른양식 ', value: '1' }, { text: '0000_박스앤캔_코코나나양식', value: '3880' }] };
  const frameWin = { pageNo: 1, alert() {}, document: { readyState: 'complete', getElementById: (i) => (i === 'selexcelform' ? sel : i === 'seltrnsprtsttusse' ? { value: 'B10' } : null) },
    getWaybildwlddtCnt: async () => o.downloaded || 0, cmdCheckMsgConfirm: () => o.memo || '0',
    downloadDateCheckExcelRequest() { state.realDownload = true; }, excelFormDownload() { state.made++; frameWin.downloadDateCheckExcelRequest('/api/TB_ORDER/GetTB_ORDER_WAYBILLFORM', JSON.stringify({ p_pageno: frameWin.pageNo, p_formid: sel.value })); } };
  const heard = [];
  const win = { location: { hostname: 'partner.bizesm.com' }, addEventListener: (n, f) => heard.push(f), removeEventListener() {}, alert() {}, opener: null, setTimeout, clearTimeout, Promise, JSON, encodeURIComponent };
  win.document = { querySelector: () => null, getElementById: (i) => (i === 'iframe_REQ023MA' && state.tabs.length ? { contentWindow: frameWin } : null) };
  win.addTabReload = (id) => state.tabs.push(id);
  win.window = win;
  win.fetch = async (u, init) => { state.fetched.push([u, init.body]); return { ok: !(o.bad && u === o.bad), status: 500, arrayBuffer: async () => new ArrayBuffer(4) }; };
  vm.runInNewContext(SRC, Object.assign(win, { RegExp, Object, String, Number, Array, Error }));
  const send = (cmd, args) => new Promise((res) => { heard[0]({ data: { to: 'bizem-helper', id: 1, cmd, args }, origin: 'https://makewon.com', source: { postMessage: (m) => res(m) } }); });
  return { send, state, sel };
}
test('formCheck: 양식을 고르고 읽기만 하며 받지 않음', async () => {
  const p = formPage({ downloaded: 2 });
  const d = (await p.send('formCheck', {})).data;
  assert.strictEqual(d.form, '0000_박스앤캔_코코나나양식');
  assert.strictEqual(d.downloaded, 2);
  assert.strictEqual(p.sel.value, '3880');
  assert.deepStrictEqual(p.state.fetched, []);
  assert.strictEqual(p.state.made, 0);
});
test('formPage: 비젬이 만든 요청을 DateCheck 뒤 보내고 내용을 돌려주며 원래 함수를 되돌림', async () => {
  const p = formPage();
  await p.send('formCheck', {});
  const m = await p.send('formPage', { page: 2 });
  assert.ok(m.ok, m.err);
  assert.strictEqual(m.data.buffer.byteLength, 4);
  assert.strictEqual(p.state.fetched[0][0], '/api/TB_ORDER/DateCheck');
  assert.strictEqual(p.state.fetched[1][0], '/api/TB_ORDER/GetTB_ORDER_WAYBILLFORM');
  assert.match(decodeURIComponent(p.state.fetched[1][1]), /command=excel&data=.*"p_pageno":2/);
  assert.ok(!p.state.realDownload);
});
test('formPage: 비젬 오류면 실패로 답함', async () => {
  const p = formPage({ bad: '/api/TB_ORDER/DateCheck' });
  await p.send('formCheck', {});
  const m = await p.send('formPage', { page: 1 });
  assert.strictEqual(m.ok, false);
  assert.strictEqual(p.state.fetched.length, 1);
});

function setupImport(o) {
  o = o || {};
  const db = { commands: {}, jobs: {}, sites: {}, uploads: [], saved: [], fileAsked: 0, uploadAsked: 0 };
  const store = {
    getRunner: async () => ({ id: 'me', ts: NOW }), getControl: async () => null, claimCommand: async () => true,
    setCommand: async (id, p) => { db.commands[id] = Object.assign(db.commands[id] || {}, p); },
    getJobs: async () => db.jobs, setJob: async (k, p) => { db.jobs[k] = Object.assign(db.jobs[k] || {}, p); }, setSite: async (id, p) => { db.sites[id] = p; }, setUpload: async (p) => { db.uploads.push(p); },
  };
  const file = Object.assign({ lines: { menso: 6, boxncan: 63 }, orders: 5, noAddress: 0, sites: [{ name: '맨소래담-무신사', count: 6, to: 'menso' }], menso: { buffer: new ArrayBuffer(2), name: 'm.xlsx' } }, o.file);
  const runner = createRunner({
    store, now: () => NOW, runnerId: 'me', info: {}, sleep: async () => {},
    openSite: async (s) => ({ login: !(o.ebutOut && s.id === 'ebut') }),
    bizemCounts: async () => ({ unconfirmed: 0, printWait: o.wait === undefined ? 69 : o.wait }),
    bizemRead: async () => Object.assign({ form: '0000_박스앤캔_코코나나양식', status: 'B10', memo: 0, downloaded: 0 }, o.form),
    bizemFile: async () => { db.fileAsked++; if (o.fileThrow) throw new Error('응답 없음'); return file; },
    saveBizem: async (k) => { db.saved.push(k); },
    ebutUpload: async () => { db.uploadAsked++; if (o.upThrow) throw new Error('끊김'); return o.up || { status: 200, alerts: ['5건 등록되었습니다', '홍길동 010-1234-5678 중복'] }; },
  });
  return { runner, db };
}
const imp = (o) => Object.assign({ type: 'bizem_import', at: NOW, by: 'x', seen: 69 }, o);

test('등록: 받아서 나누고 맨소래담만 이벗에 한 번 등록, 박스앤캔은 저장, 고객 정보는 기록하지 않음', async () => {
  const { runner, db } = setupImport();
  await runner.handleCommand('c', imp());
  const j = job(db);
  assert.strictEqual(j.state, 'done');
  assert.strictEqual(db.uploadAsked, 1);
  assert.strictEqual(j.result.box, true);
  assert.strictEqual(j.result.menso, false);
  assert.strictEqual(j.result.held, true);
  assert.deepStrictEqual(j.result.upload.alerts, ['5건 등록되었습니다']);
  assert.deepStrictEqual(db.uploads[0].lines, 6);
  assert.ok(!JSON.stringify(db.jobs).includes('홍길동'));
  assert.ok(!Object.keys(j.result).includes('buffer'));
});
test('등록: 이미 받은 주문이 섞여도 파일은 만들고 등록함 (중복은 이벗이 거름)', async () => {
  const { runner, db } = setupImport({ form: { downloaded: 3 } });
  await runner.handleCommand('c', imp());
  assert.strictEqual(db.fileAsked, 1);
  assert.strictEqual(job(db).state, 'done');
  assert.strictEqual(job(db).result.box, true);
  assert.strictEqual(job(db).result.dup, 3);
});
test('등록: 건수가 다르거나 쪽지·조건 차이가 있으면 받지 않음', async () => {
  for (const o of [{ wait: 70 }, { form: { memo: 1 } }, { form: { status: 'A' } }, { form: { form: '' } }]) {
    const { runner, db } = setupImport(o);
    await runner.handleCommand('c', imp());
    assert.strictEqual(db.fileAsked, 0, JSON.stringify(o));
    assert.strictEqual(job(db).state, 'stopped');
  }
});
test('등록: 늦은 요청은 만료', async () => {
  const { runner, db } = setupImport();
  await runner.handleCommand('c', imp({ at: NOW - C.RELAY_TTL - 1 }));
  assert.strictEqual(db.commands.c.status, 'expired');
  assert.strictEqual(db.fileAsked, 0);
});
test('등록: 받은 줄이 모자라거나 주소 없는 줄이 있으면 등록하지 않고 파일을 남김', async () => {
  let t = setupImport({ file: { lines: { menso: 1, boxncan: 2 } } });
  await t.runner.handleCommand('c', imp());
  assert.strictEqual(t.db.uploadAsked, 0);
  assert.strictEqual(job(t.db).result.box, true);
  assert.strictEqual(job(t.db).result.menso, true);
  t = setupImport({ file: { noAddress: 2 } });
  await t.runner.handleCommand('c', imp());
  assert.strictEqual(t.db.uploadAsked, 0);
  assert.match(job(t.db).notes, /주소 없는 줄 2건/);
});
test('등록: 이벗 로그아웃·끊김·오류 응답이면 다시 보내지 않고 맨소래담 파일을 남김', async () => {
  for (const o of [{ ebutOut: true }, { upThrow: true }, { up: { status: 500, alerts: [] } }]) {
    const { runner, db } = setupImport(o);
    await runner.handleCommand('c', imp());
    assert.ok(db.uploadAsked <= 1);
    assert.strictEqual(job(db).state, 'stopped');
    assert.strictEqual(job(db).result.menso, true);
  }
});
test('등록: 맨소래담 줄이 없으면 등록 없이 끝, 받기 실패면 멈춤', async () => {
  let t = setupImport({ file: { lines: { menso: 0, boxncan: 69 }, menso: null } });
  await t.runner.handleCommand('c', imp());
  assert.strictEqual(job(t.db).state, 'done');
  assert.strictEqual(t.db.uploadAsked, 0);
  t = setupImport({ fileThrow: true });
  await t.runner.handleCommand('c', imp());
  assert.strictEqual(job(t.db).state, 'stopped');
  assert.strictEqual(t.db.fileAsked, 1);
});
test('흐름 칸: 등록 진행 중 run, 멈춤 todo, 끝 done', () => {
  const st = (j) => bizemSteps(flow({ rows: [] }, []).steps, { state: 'ok', counts: { unconfirmed: 0, printWait: 5 } }, null, j).find((s) => s.id === 'bizem_import');
  assert.strictEqual(st({ state: 'running' }).state, 'run');
  assert.strictEqual(st({ state: 'stopped' }).state, 'todo');
  assert.strictEqual(st({ state: 'done' }).state, 'done');
  assert.strictEqual(st(null).state, 'todo');
  assert.strictEqual(st(null).who, '비서');
});

test('파일 잠금: 받는 화면의 키로만 풀리고, 다른 키로는 못 풂', async () => {
  const L = require('../../main/secretary_login.js');
  const mine = await L.createKeys(), other = await L.createKeys();
  const buf = new Uint8Array(200000).map((_, i) => i % 251);
  const sealed = await L.sealFile(mine.publicJwk, buf.buffer);
  assert.ok(!sealed.data.includes('AAEC'));
  const back = new Uint8Array(await L.openFile(mine.privateKey, sealed));
  assert.deepStrictEqual(back, buf);
  await assert.rejects(L.openFile(other.privateKey, sealed));
});

/* ── 이벗 주문수집 ── */
function setupEbut(o) {
  o = o || {};
  const db = { commands: {}, jobs: {}, sites: {}, go: 0, reads: [] };
  const store = {
    getRunner: async () => ({ id: 'me', ts: NOW }), getControl: async () => null, claimCommand: async () => true,
    setCommand: async (id, p) => { db.commands[id] = Object.assign(db.commands[id] || {}, p); },
    getJobs: async () => db.jobs, setJob: async (k, p) => { db.jobs[k] = Object.assign(db.jobs[k] || {}, p); }, setSite: async (id, p) => { db.sites[id] = p; },
  };
  const statuses = (o.statuses || [{ done: false }, { done: true, lines: ['32건 등록'], newCnt: '0' }]).slice();
  const runner = createRunner({
    store, now: () => NOW, runnerId: 'me', info: {}, sleep: async () => {},
    ebutOrderPage: async () => ({ login: o.login !== false }),
    ebutRead: async (cmd) => { db.reads.push(cmd); if (cmd === 'storeCheck') return Object.assign({ page: true, busy: false, newCnt: '32', waitCnt: '328' }, o.check); const s = statuses.shift(); if (!s) throw new Error('끊김'); return s; },
    ebutGo: async () => { db.go++; if (o.goThrow) throw new Error('응답 없음'); return o.go || { started: true, alerts: [] }; },
  });
  return { runner, db };
}
const ecol = (o) => Object.assign({ type: 'ebut_collect', at: NOW, by: 'x', seen: '32' }, o);

test('이벗 확인: 건수만 돌려주고 가져오지 않음', async () => {
  const { runner, db } = setupEbut();
  await runner.handleCommand('c', { type: 'ebut_check', at: NOW });
  assert.strictEqual(db.commands.c.store.newCnt, '32');
  assert.strictEqual(db.go, 0);
});
test('이벗 가져오기: 한 번 누르고 끝까지 기다려 결과를 남김', async () => {
  const { runner, db } = setupEbut();
  await runner.handleCommand('c', ecol());
  assert.strictEqual(db.go, 1);
  const j = job(db);
  assert.strictEqual(j.state, 'done');
  assert.strictEqual(j.recipe, 'ebut_collect');
  assert.deepStrictEqual(j.result, { before: { newCnt: '32', waitCnt: '328' }, after: '0', lines: ['32건 등록'] });
});
test('이벗 가져오기: 건수가 바뀌었거나 이미 가져오는 중·화면 없음·로그아웃이면 누르지 않음', async () => {
  for (const o of [{ check: { newCnt: '33' } }, { check: { busy: true } }, { check: { page: false } }, { login: false }]) {
    const { runner, db } = setupEbut(o);
    await runner.handleCommand('c', ecol());
    assert.strictEqual(db.go, 0, JSON.stringify(o));
    assert.strictEqual(job(db).state, 'stopped');
  }
  const t = setupEbut();
  await t.runner.handleCommand('c', ecol({ at: NOW - C.RELAY_TTL - 1 }));
  assert.strictEqual(t.db.commands.c.status, 'expired');
  assert.strictEqual(t.db.go, 0);
});
test('이벗 가져오기: 시작 거절·끊김·화면 사라짐이면 다시 누르지 않고 멈춤', async () => {
  for (const o of [{ go: { started: false, why: '확인창 문구가 다름', alerts: [] } }, { goThrow: true }, { statuses: [{ lost: true }] }, { statuses: [] }]) {
    const { runner, db } = setupEbut(o);
    await runner.handleCommand('c', ecol());
    assert.strictEqual(db.go, 1, JSON.stringify(o));
    assert.strictEqual(job(db).state, 'stopped');
  }
});
test('흐름 칸: 이벗 주문수집은 비서, 진행·멈춤·끝을 보여 줌', () => {
  const st = (j) => bizemSteps(flow({ rows: [] }, []).steps, null, null, null, j).find((s) => s.id === 'collect');
  assert.strictEqual(st({ state: 'running' }).state, 'run');
  assert.strictEqual(st({ state: 'stopped' }).state, 'todo');
  assert.strictEqual(st({ state: 'done' }).state, 'done');
  assert.strictEqual(st(null).who, '비서');
});
test('이벗 도우미: 주문가져오기 명령이 있고 확인창은 발주확인○·중복 경고 문구일 때만 받아들임', () => {
  const src = fs.readFileSync(__dirname + '/../../main/ebut_helper.js', 'utf8');
  assert.ok(/m\.cmd === 'storeGo' \? cmdStoreGo/.test(src));
  assert.ok(src.includes("return /발주확인:○/.test(m) && /중복등록/.test(m);"));
  assert.ok(src.includes("STORE = '14374'"));
});

/* ── 주문 매칭 ── */
function setupMatch(o) {
  o = o || {};
  const db = { commands: {}, jobs: {}, sites: {}, match: {}, go: [] };
  const store = {
    getRunner: async () => ({ id: 'me', ts: NOW }), getControl: async () => null, claimCommand: async () => true,
    setCommand: async (id, p) => { db.commands[id] = Object.assign(db.commands[id] || {}, p); },
    getJobs: async () => db.jobs, setJob: async (k, p) => { db.jobs[k] = Object.assign(db.jobs[k] || {}, p); }, setSite: async (id, p) => { db.sites[id] = p; },
    setMatch: async (path, p) => { db.match[path] = JSON.parse(JSON.stringify(p)); },
  };
  const results = (o.results || [{ ok: true, msg: '매칭되었습니다' }, { ok: true, msg: '매칭되었습니다' }]).slice();
  const runner = createRunner({
    store, now: () => NOW, runnerId: 'me', info: {}, sleep: async () => {},
    openSite: async () => ({ login: true }), ebutMatchPage: async () => ({ login: o.login !== false }),
    matchRead: async () => ({ items: o.after || [], masters: [], history: { '[추가10%적립] 아크네스 2개': [{ qty: 1 }] } }),
    ebutGo: async (cmd, args) => { db.go.push([cmd, args]); if (o.throwAt === db.go.length) throw new Error('끊김'); return results.shift() || { ok: true }; },
  });
  return { runner, db };
}
const mitems = [{ key: 'k1', name: '[추가10%적립] 아크네스 2개', opt: '수량: 3개', qty: 1, picks: [{ code: '1659344', qty: 6, name: 'A' }] }, { key: 'k2', name: '멘소래담 롤온', opt: '', qty: 2, picks: [{ code: '2', qty: 2, name: 'B' }] }];

test('매칭 읽기: 지난 매칭을 상품명 이름표가 아닌 목록으로 저장 ([ ] 는 Firebase 이름표 금지)', async () => {
  const { runner, db } = setupMatch();
  await runner.handleCommand('c', { type: 'match_read', at: NOW });
  assert.strictEqual(db.commands.c.status, 'done');
  assert.ok(Array.isArray(db.match.data.history));
  assert.strictEqual(db.match.data.history[0].name, '[추가10%적립] 아크네스 2개');
  const keys = (v) => (v && typeof v === 'object' ? Object.keys(v).concat(...Object.values(v).map(keys)) : []);
  assert.ok(keys(db.match.data).every((k) => !/[.#$\[\]\/]/.test(k)));
});
test('매칭 저장: 상품마다 한 번씩 보내고, 결과를 초안에 남기고, 다시 읽어 대조', async () => {
  const { runner, db } = setupMatch();
  await runner.handleCommand('c', { type: 'match_save', at: NOW, items: mitems });
  assert.deepStrictEqual(db.go.map((g) => g[0]), ['matchSave', 'matchSave']);
  assert.deepStrictEqual(db.go[0][1], { name: mitems[0].name, opt: '수량: 3개', qty: 1, picks: mitems[0].picks });
  assert.strictEqual(db.match['drafts/k1/saved'].ok, true);
  const j = db.jobs[Object.keys(db.jobs)[0]];
  assert.strictEqual(j.state, 'done');
  assert.deepStrictEqual(j.result, { saved: 2, total: 2, stillOpen: 0 });
});
test('매칭 저장: 실패하면 거기서 멈추고 뒤는 보내지 않으며, 끊겨도 다시 보내지 않음', async () => {
  const still = [{ name: mitems[0].name, opt: mitems[0].opt, qty: 1 }];
  let t = setupMatch({ results: [{ ok: false, msg: '주문 줄을 찾지 못했습니다' }], after: still });
  await t.runner.handleCommand('c', { type: 'match_save', at: NOW, items: mitems });
  assert.strictEqual(t.db.go.length, 1);
  assert.strictEqual(t.db.match['drafts/k1/saved'].ok, false);
  assert.strictEqual(t.db.jobs[Object.keys(t.db.jobs)[0]].state, 'stopped');
  t = setupMatch({ throwAt: 1, after: still });
  await t.runner.handleCommand('c', { type: 'match_save', at: NOW, items: mitems });
  assert.strictEqual(t.db.go.length, 1);
  assert.match(t.db.match['drafts/k1/saved'].msg, /끊겼/);
});
test('매칭 저장: 저장 뒤에도 미매칭으로 남으면 확인 필요, 늦은 요청·로그아웃은 보내지 않음', async () => {
  let t = setupMatch({ after: [{ name: '멘소래담 롤온', opt: '', qty: 2 }] });
  await t.runner.handleCommand('c', { type: 'match_save', at: NOW, items: mitems });
  const j = t.db.jobs[Object.keys(t.db.jobs)[0]];
  assert.strictEqual(j.state, 'stopped');
  assert.strictEqual(j.result.stillOpen, 1);
  t = setupMatch();
  await t.runner.handleCommand('c', { type: 'match_save', at: NOW - C.RELAY_TTL - 1, items: mitems });
  assert.strictEqual(t.db.commands.c.status, 'expired');
  t = setupMatch({ login: false });
  await t.runner.handleCommand('c', { type: 'match_save', at: NOW, items: mitems });
  assert.strictEqual(t.db.go.length, 0);
});
test('이벗 도우미: 매칭 저장은 2개 이상 확인창만 받아들이고 수량 합이 다르면 수량 확인 안 함 체크', () => {
  const src = fs.readFileSync(__dirname + '/../../main/ebut_helper.js', 'utf8');
  assert.ok(/m\.cmd === 'matchSave' \? cmdMatchSave/.test(src));
  assert.ok(src.includes("return picks.length > 1 && /2개이상 선택/.test(String(m));"));
  assert.ok(src.includes("prop('checked', sum !== Number($('#name1_qty').text()))"));
});

test('헤드비서: 이벗·비젬 저장 요청은 받은 내용을 그대로 도우미에 넘김 (빈 요청을 보내 매칭이 멈췄던 일)', () => {
  const s = fs.readFileSync(__dirname + '/../../main/secretary.html', 'utf8');
  const body = (name) => { const i = s.indexOf(name + ': function(cmd, args){'); return i < 0 ? '' : s.slice(i, s.indexOf('60000)', i) + 6); };
  assert.ok(body('ebutGo').endsWith('cmd, args || {}, 60000)'), body('ebutGo'));
  assert.ok(body('bizemGo').endsWith('cmd, args, 60000)'), body('bizemGo'));
});

test('이벗 매칭: 왼쪽 검색은 기호 앞까지 잘라 찾고, 없으면 검색어 없이 다시 찾음', () => {
  const src = fs.readFileSync(__dirname + '/../../main/ebut_helper.js', 'utf8');
  assert.ok(src.includes(".concat(['']);"));
  assert.ok(src.includes('function findLeft(i){'));
  const cut = (name) => String(name).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().replace(/\[[^\]]*\]/g, ' ').split(/[+,()\[\]\/%&]/)[0].trim();
  assert.strictEqual(cut('하다라보 고쿠쥰 리프팅 2종 세트, 로션 170ml + 밀크 140ml'), '하다라보 고쿠쥰 리프팅 2종 세트');
  assert.strictEqual(cut('하다라보 고쿠쥰 3종 세트, 로션 170ml + 밀크 + 크림'), '하다라보 고쿠쥰 3종 세트');
  assert.strictEqual(cut('[추가10%적립] 아크네스 데일리 딥 클렌저 120g, 2개'), '아크네스 데일리 딥 클렌저 120g');
});

test('매칭 저장: 결과가 애매해도 다시 읽어 미매칭에서 빠졌으면 저장됨으로 바로잡고, 남은 것은 보내지 않음', async () => {
  const { runner, db } = setupMatch({ results: [{ ok: false, msg: '이벗 저장 결과를 확인하지 못했습니다' }], after: [{ name: '멘소래담 롤온', opt: '', qty: 2 }] });
  await runner.handleCommand('c', { type: 'match_save', at: NOW, items: mitems });
  assert.strictEqual(db.go.length, 1);
  assert.deepStrictEqual(db.match['drafts/k1/saved'].ok, true);
  assert.match(db.match['drafts/k1/saved'].msg, /다시 읽어 확인/);
  const j = db.jobs[Object.keys(db.jobs)[0]];
  assert.strictEqual(j.state, 'stopped');
  assert.strictEqual(j.result.saved, 1);
  assert.match(j.notes, /남은 1건/);
});
test('매칭 저장: 실패한 상품이 다시 읽어도 미매칭으로 남으면 실패 그대로', async () => {
  const { runner, db } = setupMatch({ results: [{ ok: false, msg: '주문 줄을 찾지 못했습니다' }], after: [{ name: mitems[0].name, opt: mitems[0].opt, qty: 1 }] });
  await runner.handleCommand('c', { type: 'match_save', at: NOW, items: mitems });
  assert.strictEqual(db.match['drafts/k1/saved'].ok, false);
  assert.match(db.jobs[Object.keys(db.jobs)[0]].notes, /저장 멈춤/);
});
test('이벗 도우미: 매칭 저장 성공은 이벗 결과 칸의 success 로 판단', () => {
  const src = fs.readFileSync(__dirname + '/../../main/ebut_helper.js', 'utf8');
  assert.ok(src.includes("var shown = norm($('#result_msg').text())"));
  assert.ok(src.includes("$('#result_msg').text('');"));
});
