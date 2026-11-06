/* 비젬 송장업로드: 세 열 고르기와 헤드비서 진행(가짜 비젬) 시험. 실제 비젬에는 닿지 않음 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const C = require('../../main/secretary_core.js');
const I = require('../../main/bizem_invoice.js');
const { createRunner } = require('../../main/secretary_runner.js');
const SRC = fs.readFileSync(__dirname + '/../../main/bizem_helper.js', 'utf8');
const T0 = new Date('2026-11-06T15:00:00+09:00').getTime();

function line(o, post, w, name) { const r = new Array(25).fill(''); r[0] = o; r[3] = name || '홍길동'; r[5] = '서울시 어딘가'; r[9] = post; r[22] = w; return r; }
const HEAD = (() => { const r = new Array(25).fill('칸'); r[0] = '주문번호'; r[9] = '우편번호'; r[22] = '송장번호'; return r; })();

test('세 열만 남기고 이름·주소는 버림, 제목 줄과 우편번호 앞 0', () => {
  const p = I.pick([HEAD, line('A1', '6234', '6091234567890'), line('A2', '12345', '6091234567891'), line('A2', '12345', '6091234567892'), line('', '', '')]);
  assert.strictEqual(p.lines.length, 3);
  assert.deepStrictEqual(p.orders, ['A1', 'A2']);
  assert.strictEqual(p.dup, 1);
  assert.strictEqual(p.empty, 1);
  assert.deepStrictEqual(p.lines[0], ['A1', '06234', '6091234567890']);
  const rows = I.sheetRows(p);
  assert.strictEqual(rows.length, 4);
  assert.strictEqual(rows[0][0], '주문번호');
  assert.strictEqual(rows[1][22], '6091234567890');
  assert.strictEqual(rows[1][9], '06234');
  assert.ok(!JSON.stringify(rows).includes('홍길동') && !JSON.stringify(rows).includes('서울시'));
});

test('운송장번호가 이상하거나 주문번호가 지수 표기면 이상한 줄', () => {
  const p = I.pick([HEAD, line('A1', '1', '12'), line('2.02611E+15', '1', '6091234567890'), line('A3', '1', '6091234567893')]);
  assert.deepStrictEqual(p.bad, [2, 3]);
  assert.strictEqual(p.lines.length, 1);
});

test('tally: 우리 주문만, 상태별, 비젬주문번호는 한 번씩', () => {
  const t = I.tally([{ o: 'A1', b: 'B1', s: 'C10' }, { o: 'A1', b: 'B1', s: 'C10' }, { o: 'A2', b: 'B2', s: 'D10' }, { o: 'Z9', b: 'B9', s: 'C10' }], ['A1', 'A2', 'A3']);
  assert.strictEqual(t.C10, 1); assert.strictEqual(t.D10, 1); assert.strictEqual(t.missing, 1);
  assert.deepStrictEqual(t.bzm.C10, ['B1']); assert.deepStrictEqual(t.bzm.D10, ['B2']);
});

test('명령·규칙·도우미 목록에 송장업로드가 있고, 쓰는 명령은 읽기 목록에 없음', () => {
  assert.ok(C.COMMAND_TYPES.includes('bizem_invoice'));
  assert.ok(fs.readFileSync(__dirname + '/../../database.rules.json', 'utf8').includes("'bizem_invoice'"));
  ['invoiceUpload', 'invoiceCheckup', 'invoiceSend'].forEach((c) => { assert.ok(C.HELPER_WRITE.includes(c)); assert.throws(() => C.assertSafeCmd(c)); });
  C.assertSafeCmd('invoiceList'); C.assertSafeCmd('invoiceSendStatus');
  assert.ok(SRC.includes("['selHdryc', '우체국택배']") && SRC.includes("['selbzmordernocolidx', 'A']") && SRC.includes("['selwaybilnocolidx', 'W']") && SRC.includes("['selpostcolidx', 'J']"));
});

/* 가짜 비젬: 주문 상태 B10 → (올림) C10 → (발송검수) D10 → (전송) E10 */
function setup(o) {
  o = o || {};
  const n = o.n || 3, orders = Array.from({ length: n }, (_, i) => 'A' + i);
  const split = o.split || [n], chunks = []; let at = 0; split.forEach((k) => { chunks.push(orders.slice(at, at + k)); at += k; });
  const bz = {}; orders.forEach((x, i) => { bz[x] = { b: 'B' + i, s: (o.start && o.start[x]) || 'B10' }; });
  const db = { commands: {}, jobs: {}, sites: {}, calls: [] };
  let clock = T0;
  const store = {
    getRunner: async () => ({ id: 'me', ts: clock }), getControl: async () => null,
    claimCommand: async () => true, setCommand: async (id, p) => { db.commands[id] = Object.assign(db.commands[id] || {}, p); },
    getJobs: async () => db.jobs, setJob: async (k, p) => { db.jobs[k] = Object.assign(db.jobs[k] || {}, p); }, setSite: async (id, p) => { db.sites[id] = p; },
  };
  const rows = (screen) => orders.filter((x) => screen === 'send' ? /^(D10|E1)/.test(bz[x].s) : /^(C10|D10|E11)/.test(bz[x].s)).map((x) => ({ o: x, b: bz[x].b, s: bz[x].s }));
  const runner = createRunner({
    store, now: () => (clock += 5000), runnerId: 'me', info: {}, sleep: async () => {},
    openSite: async () => ({ login: true }),
    bizemCounts: async () => ({ unconfirmed: 0, printWait: 0 }),
    openInvoice: async (sealed) => { const m = /^SEALED(\d*)$/.exec(sealed); if (!m) throw new Error('키'); const c = chunks[Number(m[1] || 0)]; return { buffer: { idx: Number(m[1] || 0) }, name: '송장업로드.xlsx', orders: c, lines: c.length }; },
    bizemList: async (a) => { db.calls.push('list:' + a.screen); return { rows: rows(a.screen) }; },
    bizemRead: async (cmd) => { db.calls.push(cmd); return { done: true }; },
    bizemGo: async (cmd, a) => {
      db.calls.push(cmd + (a.bzm ? ':' + a.bzm.length : ''));
      if (cmd === 'invoiceUpload') { db.calls.push('up:' + a.name); if (o.upFail) return { started: false, why: '업로드 화면 선택칸을 맞추지 못했습니다' }; chunks[a.buffer.idx].forEach((x) => { if (bz[x].s === 'B10' && !(o.skipUp || []).includes(x)) bz[x].s = 'C10'; }); return { started: true }; }
      if (cmd === 'invoiceCheckup') { if (!o.stuck) orders.forEach((x) => { if (a.bzm.includes(bz[x].b) && bz[x].s === 'C10') bz[x].s = 'D10'; }); return { ok: true }; }
      if (cmd === 'invoiceSend') { orders.forEach((x) => { if (a.bzm.includes(bz[x].b) && bz[x].s === 'D10') bz[x].s = (o.fail || []).includes(x) ? 'E11' : 'E10'; }); return { started: true }; }
      throw new Error('모르는 명령 ' + cmd);
    },
  });
  const cmd = (p) => Object.assign({ type: 'bizem_invoice', at: T0, by: 'x', sealed: 'SEALED', lines: n, orders: n }, p);
  const job = () => db.jobs[Object.keys(db.jobs)[0]];
  return { runner, db, bz, cmd, job };
}

test('한 번 누르면 올림 → 발송검수 → 전송까지, 잠긴 파일은 바로 지움', async () => {
  const { runner, db, cmd, job } = setup();
  await runner.handleCommand('c', cmd());
  const j = job();
  assert.strictEqual(j.state, 'done', j.notes);
  assert.strictEqual(j.recipe, 'bizem_invoice');
  assert.deepStrictEqual([j.result.uploaded, j.result.checked, j.result.sent, j.result.done], [3, 3, 3, 3]);
  assert.strictEqual(db.commands.c.sealed, null);
  assert.ok(!JSON.stringify(db.jobs).includes('A0'), '작업 기록에 주문번호를 남기지 않음');
  assert.deepStrictEqual(db.calls.filter((c) => /^invoice(Upload|Checkup|Send)(:|$)/.test(c)), ['invoiceUpload', 'invoiceCheckup:3', 'invoiceSend:3']);
});

test('250건은 100개씩 세 번 발송검수하고 세 번 전송', async () => {
  const { runner, db, cmd, job } = setup({ n: 250 });
  await runner.handleCommand('c', cmd());
  assert.strictEqual(job().state, 'done', job().notes);
  assert.deepStrictEqual(db.calls.filter((c) => /^invoiceCheckup/.test(c)), ['invoiceCheckup:100', 'invoiceCheckup:100', 'invoiceCheckup:50']);
  assert.deepStrictEqual(db.calls.filter((c) => /^invoiceSend:/.test(c)), ['invoiceSend:100', 'invoiceSend:100', 'invoiceSend:50']);
});

test('이미 전송된 주문이 섞이면 올리지 않음', async () => {
  const { runner, db, cmd, job } = setup({ start: { A1: 'E10' } });
  await runner.handleCommand('c', cmd());
  assert.strictEqual(job().state, 'stopped');
  assert.match(job().notes, /이미 운송장이 전송된 주문 1건/);
  assert.ok(!db.calls.includes('invoiceUpload'));
});

test('화면에서 본 건수와 파일이 다르면 올리지 않음', async () => {
  const { runner, db, cmd, job } = setup();
  await runner.handleCommand('c', cmd({ lines: 9 }));
  assert.strictEqual(job().state, 'stopped');
  assert.ok(!db.calls.includes('invoiceUpload'));
});

test('올린 뒤 운송장번호가 안 들어간 주문이 있으면 발송검수로 넘기지 않음', async () => {
  const { runner, db, cmd, job } = setup({ skipUp: ['A2'] });
  await runner.handleCommand('c', cmd());
  assert.strictEqual(job().state, 'stopped');
  assert.match(job().notes, /2 \/ 3건/);
  assert.ok(!db.calls.some((c) => /^invoiceCheckup/.test(c)));
});

test('발송검수를 보냈는데 상태가 안 바뀌면 다시 보내지 않고 멈춤', async () => {
  const { runner, db, cmd, job } = setup({ stuck: true });
  await runner.handleCommand('c', cmd());
  assert.strictEqual(job().state, 'stopped');
  assert.strictEqual(db.calls.filter((c) => /^invoiceCheckup/.test(c)).length, 1);
  assert.ok(!db.calls.some((c) => /^invoiceSend:/.test(c)));
});

test('전송 실패가 있으면 확인 필요로 끝냄', async () => {
  const { runner, cmd, job } = setup({ fail: ['A0'] });
  await runner.handleCommand('c', cmd());
  assert.strictEqual(job().state, 'stopped');
  assert.match(job().notes, /운송장전송 실패 1건/);
});

test('업로드 화면을 못 맞추면 멈추고 잠긴 파일도 지움', async () => {
  const { runner, db, cmd, job } = setup({ upFail: true });
  await runner.handleCommand('c', cmd());
  assert.strictEqual(job().state, 'stopped');
  assert.match(job().notes, /선택칸/);
  assert.strictEqual(db.commands.c.sealed, null);
});

test('늦게 받은 명령은 만료, 잠긴 파일 지움', async () => {
  const { runner, db, cmd } = setup();
  await runner.handleCommand('c', cmd({ at: T0 - 10 * 60 * 1000 }));
  assert.strictEqual(db.commands.c.status, 'expired');
  assert.strictEqual(db.commands.c.sealed, null);
});

test('파일 두 개(맨소래담 2·박스앤캔 1)를 차례로 올린 뒤 3건 전부 한꺼번에 발송검수·전송', async () => {
  const { runner, db, cmd, job } = setup({ split: [2, 1] });
  await runner.handleCommand('c', cmd({ sealed: ['SEALED0', 'SEALED1'], parts: [{ lines: 2, orders: 2 }, { lines: 1, orders: 1 }] }));
  const j = job();
  assert.strictEqual(j.state, 'done', j.notes);
  assert.strictEqual(j.result.files, 2);
  assert.deepStrictEqual(db.calls.filter((c) => /^up:/.test(c)), ['up:송장업로드_1.xlsx', 'up:송장업로드_2.xlsx']);
  assert.deepStrictEqual(db.calls.filter((c) => /^invoice(Checkup|Send):/.test(c)), ['invoiceCheckup:3', 'invoiceSend:3']);
  assert.ok(db.calls.indexOf('up:송장업로드_2.xlsx') < db.calls.indexOf('invoiceCheckup:3'), '다 올린 뒤에 발송검수');
  assert.strictEqual(db.commands.c.sealed, null);
});

test('두 번째 파일이 덜 올라가면 발송검수로 넘기지 않음', async () => {
  const { runner, db, cmd, job } = setup({ split: [2, 1], skipUp: ['A2'] });
  await runner.handleCommand('c', cmd({ sealed: ['SEALED0', 'SEALED1'], parts: [{ lines: 2, orders: 2 }, { lines: 1, orders: 1 }] }));
  assert.strictEqual(job().state, 'stopped');
  assert.match(job().notes, /2번째 파일/);
  assert.ok(!db.calls.some((c) => /^invoiceCheckup/.test(c)));
});

test('파일별 건수가 화면과 다르면 하나도 올리지 않음', async () => {
  const { runner, db, cmd, job } = setup({ split: [2, 1] });
  await runner.handleCommand('c', cmd({ sealed: ['SEALED0', 'SEALED1'], parts: [{ lines: 1, orders: 1 }, { lines: 2, orders: 2 }] }));
  assert.strictEqual(job().state, 'stopped');
  assert.ok(!db.calls.some((c) => /^up:/.test(c)));
});
