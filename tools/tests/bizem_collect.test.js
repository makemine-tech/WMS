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
