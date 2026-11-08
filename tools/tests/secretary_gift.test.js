/* 사은품 세팅: 대상 계산과 헤드비서 넣기(가짜 이벗) 시험. 실제 이벗에는 닿지 않음 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const C = require('../../main/secretary_core.js');
const G = require('../../main/secretary_gift.js');
const { createRunner } = require('../../main/secretary_runner.js');
const T0 = new Date('2026-11-08T15:00:00+09:00').getTime();

const ITEM = { seq: '900', code: '1558860', name: '샤워볼', opt: '-', prov: '', qty: 1 };
const SET = { start: '2026-11-06T00:00', end: '2026-11-07T23:59', all: false, memos: ['hhh'],
  tiers: [{ min: 10000, max: 20000, items: [ITEM] }, { min: 20000, max: '', items: [Object.assign({}, ITEM, { code: '1', seq: '901', name: '크림' })] }] };
const CHASU = [{ date: '20261108', ivno: '1', cnt: 5, memo: 'hhh', site: '14374', cust: '2237' }, { date: '20261108', ivno: '2', cnt: 1, memo: 'aaa', site: '14374', cust: '2237' }];
function row(no, ivno, amt, odate, extra){ return Object.assign({ no: no, hap: 'H' + no, ivdate: '20261108', ivno: ivno, odate: odate || '2026-11-06T14:10:52.990+09:00', amt: amt, gift: false }, extra || {}); }
const ROWS = [
  row('A', '1', 9000, null, {}), row('A', '1', 3000),            /* 12,000 → 1구간 */
  row('B', '1', 25000),                                           /* 2구간 */
  row('C', '1', 15000, '2026-11-08T10:00:00+09:00'),              /* 기간 밖 */
  row('D', '1', 5000),                                            /* 가격대 밖 */
  row('E', '1', 15000), row('E', '1', 0, null, { gift: true }),   /* 이미 사은품 */
  row('F', '2', 30000),                                           /* aaa 차수 → 안 고름 */
];

test('설정 확인: 기간·묶음출력·가격대·겹침', () => {
  assert.deepStrictEqual(G.check(SET), []);
  assert.ok(G.check(Object.assign({}, SET, { end: '2026-11-05T00:00' })).some((w) => /종료/.test(w)));
  assert.ok(G.check(Object.assign({}, SET, { memos: [] })).some((w) => /묶음출력/.test(w)));
  assert.ok(G.check(Object.assign({}, SET, { tiers: [{ min: 10000, max: 30000, items: [ITEM] }, { min: 20000, max: '', items: [ITEM] }] })).some((w) => /겹칩/.test(w)));
  assert.ok(G.check(Object.assign({}, SET, { tiers: [{ min: 10000, max: 20000, items: [] }] })).some((w) => /사은품 상품/.test(w)));
  assert.deepStrictEqual(G.check(Object.assign({}, SET, { all: true, memos: [] })), []);
});

test('대상 계산: 결제일시 기간, 주문 전체 금액, 이미 사은품 있으면 뺌, 고른 메모 차수만', () => {
  const p = G.plan(SET, CHASU, ROWS);
  assert.strictEqual(p.orders, 5);
  assert.deepStrictEqual(p.skip, { period: 1, range: 1, already: 1, nodate: 0 });
  assert.deepStrictEqual(p.groups.map((g) => [g.key, g.nos]), [['1|0', ['A']], ['1|1', ['B']]]);
  assert.strictEqual(p.groups[0].label, '10,000원 이상 ~ 20,000원 미만');
  const all = G.plan(Object.assign({}, SET, { all: true }), CHASU, ROWS);
  assert.deepStrictEqual(all.groups.map((g) => g.key), ['1|0', '1|1', '2|1']);
});

test('한 묶음에 주문이 둘이면 사은품은 묶음 하나', () => {
  const p = G.plan(SET, CHASU, [row('A', '1', 12000, null, { hap: 'H1' }), row('B', '1', 15000, null, { hap: 'H1' })]);
  assert.strictEqual(p.groups[0].nos.length, 2);
  assert.strictEqual(p.groups[0].haps.length, 1);
  assert.deepStrictEqual(G.counts(p), { '1|0': 1 });
});

test('기간 경계와 한국 시각', () => {
  assert.strictEqual(G.kstMs('2026-11-06T00:00'), Date.parse('2026-11-05T15:00:00Z'));
  const p = G.plan(SET, CHASU, [row('A', '1', 12000, '2026-11-07T23:59:00+09:00'), row('B', '1', 12000, '2026-11-08T00:00:01+09:00')]);
  assert.deepStrictEqual(p.groups[0].nos, ['A']);
});

test('명령·규칙·도우미 목록에 사은품이 있고, 넣기는 읽기 목록에 없음', () => {
  assert.ok(C.COMMAND_TYPES.includes('gift_check') && C.COMMAND_TYPES.includes('gift_add'));
  const rules = fs.readFileSync(__dirname + '/../../database.rules.json', 'utf8');
  assert.ok(rules.includes("'gift_check'") && rules.includes("'gift_add'"));
  assert.ok(C.HELPER_WRITE.includes('giftAdd'));
  assert.throws(() => C.assertSafeCmd('giftAdd'));
  C.assertSafeCmd('giftRead');
  const helper = fs.readFileSync(__dirname + '/../../main/ebut_helper.js', 'utf8');
  assert.ok(helper.includes("gbn: '10'") && helper.includes('/site/site3110save'), '이벗 사은품추가 조건10 으로만 넣음');
});

/* 가짜 이벗: giftAdd 하면 그 주문 줄에 사은품 줄이 생김 */
function setup(o) {
  o = o || {};
  const rows = ROWS.map((r) => Object.assign({}, r));
  const db = { commands: {}, jobs: {}, calls: [] };
  let clock = T0;
  const store = {
    getRunner: async () => ({ id: 'me', ts: clock }), getControl: async () => null,
    claimCommand: async () => true, setCommand: async (id, p) => { db.commands[id] = Object.assign(db.commands[id] || {}, p); },
    getJobs: async () => db.jobs, setJob: async (k, p) => { db.jobs[k] = Object.assign(db.jobs[k] || {}, p); }, setSite: async () => {},
  };
  const runner = createRunner({
    store, now: () => (clock += 1000), runnerId: 'me', info: {}, sleep: async () => {},
    openSite: async () => ({ login: true }),
    giftRead: async (a) => { db.calls.push('read:' + a.date); return { chasu: CHASU, rows: rows }; },
    ebutGo: async (cmd, a) => {
      db.calls.push(cmd + ':' + a.ivno + ':' + a.nos.join('') + ':' + a.hap);
      if (o.refuse) return { ok: false, hap: 0, said: '이벗에서 찾은 묶음이 0건' };
      if (!o.noEffect) a.nos.forEach((no) => rows.push(row(no, a.ivno, 0, null, { gift: true })));
      return { ok: true, hap: a.hap, said: '' };
    },
  });
  const cmd = (type, p) => Object.assign({ type, at: T0, by: 'x', setId: 's1', set: SET }, p);
  const job = () => db.jobs[Object.keys(db.jobs)[0]];
  return { runner, db, rows, cmd, job };
}

test('미리 보기는 건수만 돌려주고 이벗에 쓰지 않음', async () => {
  const { runner, db, cmd } = setup();
  await runner.handleCommand('c', cmd('gift_check'));
  const c = db.commands.c;
  assert.strictEqual(c.status, 'done', c.why);
  assert.deepStrictEqual(c.gift.groups.map((g) => [g.key, g.n]), [['1|0', 1], ['1|1', 1]]);
  assert.ok(!db.calls.some((x) => /^giftAdd/.test(x)));
  assert.ok(!JSON.stringify(c.gift).includes('"A"'), '미리 보기 결과에 주문번호를 남기지 않음');
});

test('넣기: 본 건수와 같으면 묶음마다 한 번, 넣은 뒤 다시 읽어 확인', async () => {
  const { runner, db, cmd, job } = setup();
  await runner.handleCommand('c', cmd('gift_add', { expect: { '1|0': 1, '1|1': 1 } }));
  assert.strictEqual(job().state, 'done', job().notes);
  assert.strictEqual(job().result.added, 2);
  assert.deepStrictEqual(db.calls.filter((x) => /^giftAdd/.test(x)), ['giftAdd:1:A:1', 'giftAdd:1:B:1']);
});

test('한 번 넣은 뒤 다시 누르면 이미 사은품이 있어 건수가 달라 멈춤 (두 번 안 들어감)', async () => {
  const { runner, db, cmd, job } = setup();
  await runner.handleCommand('c', cmd('gift_add', { expect: { '1|0': 1, '1|1': 1 } }));
  await runner.handleCommand('d', cmd('gift_add', { expect: { '1|0': 1, '1|1': 1 } }));
  const second = db.jobs[Object.keys(db.jobs)[1]];
  assert.strictEqual(second.state, 'stopped');
  assert.strictEqual(db.calls.filter((x) => /^giftAdd/.test(x)).length, 2);
});

test('본 건수와 다르면 넣지 않음', async () => {
  const { runner, db, cmd, job } = setup();
  await runner.handleCommand('c', cmd('gift_add', { expect: { '1|0': 2 } }));
  assert.strictEqual(job().state, 'stopped');
  assert.ok(!db.calls.some((x) => /^giftAdd/.test(x)));
});

test('넣었는데 사은품 줄이 안 생기면 멈추고 다음 묶음은 보내지 않음', async () => {
  const { runner, db, cmd, job } = setup({ noEffect: true });
  await runner.handleCommand('c', cmd('gift_add', { expect: { '1|0': 1, '1|1': 1 } }));
  assert.strictEqual(job().state, 'stopped');
  assert.match(job().notes, /다시 보내지 않았습니다/);
  assert.strictEqual(db.calls.filter((x) => /^giftAdd/.test(x)).length, 1);
});

test('이벗이 받지 않으면 멈춤, 늦은 명령은 만료', async () => {
  const a = setup({ refuse: true });
  await a.runner.handleCommand('c', a.cmd('gift_add', { expect: { '1|0': 1, '1|1': 1 } }));
  assert.strictEqual(a.job().state, 'stopped');
  const b = setup();
  await b.runner.handleCommand('c', b.cmd('gift_add', { at: T0 - 10 * 60 * 1000, expect: {} }));
  assert.strictEqual(b.db.commands.c.status, 'expired');
});
