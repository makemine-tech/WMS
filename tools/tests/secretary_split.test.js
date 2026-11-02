/* 합포 분할 화면 요청을 상시 컴퓨터에서 처리 (secretary_runner.handleCall) — 가짜 저장소와 가짜 탭으로 시험 */
const test = require('node:test');
const assert = require('node:assert');
const C = require('../../main/secretary_core.js');
const { createRunner } = require('../../main/secretary_runner.js');

const NOW = new Date('2026-11-02T10:00:00+09:00').getTime();

function setup(o) {
  o = o || {};
  const log = [];
  let clock = NOW;
  const db = { calls: {}, commands: {}, sites: {}, control: o.control || null, jobs: Object.assign({}, o.jobs), taken: {} };
  const store = {
    claimRunner: async () => true, getRunner: async () => ({ id: 'me', ts: clock }), claimCommand: async () => true,
    setCommand: async (id, p) => { db.commands[id] = Object.assign(db.commands[id] || {}, p); },
    getJobs: async () => db.jobs, setJob: async (k, p) => { db.jobs[k] = Object.assign(db.jobs[k] || {}, p); },
    getControl: async () => db.control, setSite: async (id, p) => { db.sites[id] = p; }, setMatch: async () => {},
    claimCall: async (id) => { if (db.taken[id]) return false; db.taken[id] = true; return true; },
    setCall: async (id, p) => { db.calls[id] = Object.assign(db.calls[id] || {}, p); },
  };
  const runner = createRunner({
    store, now: () => clock, runnerId: 'me', info: {},
    openSite: async (s) => { log.push('open'); return s.id === 'ezadmin' ? { page: 'DG00' } : { login: true }; },
    ezPreview: async () => ({ orders: 0, blockers: [] }), mensoPreview: async () => ({ blockers: [] }),
    ezSearch: async (a) => { log.push('search'); return { total: 1, rows: [{ recv: '홍길동', pack_seq: '1', name: 'A' }], args: a }; },
    ezWrite: async (cmd) => {
      log.push(cmd);
      if (cmd === 'fill') return o.fill || { done: ['1'], skipped: [] };
      if (cmd === 'reset') return { done: ['1'] };
      if (o.commitErr) throw new Error(o.commitErr);
      return o.commit || { error: 0, fail_list: [], lock: 1 };
    },
  });
  let n = 0;
  async function call(cmd, args, at) {
    const id = 'c' + (++n);
    await runner.handleCall(id, { cmd, args: JSON.stringify(args || {}), by: 'x', at: at === undefined ? clock : at });
    return JSON.parse(db.calls[id].out);
  }
  return { runner, db, log, call, tick: (ms) => { clock += ms; } };
}

test('불러오기→채우기→저장 순서로 전달하고 저장 기록을 남김', async () => {
  const { call, log, db } = setup();
  assert.ok((await call('search', { supplier: '곡물도감' })).ok);
  assert.ok((await call('fill', { packs: [] })).ok);
  const c = await call('commit', { confirm: true, lockUnpack: true });
  assert.ok(c.ok);
  assert.deepStrictEqual(log, ['open', 'search', 'fill', 'commit']);
  assert.strictEqual(c.data.jobKey, 'ez_split:2026-11-02:1');
  assert.strictEqual(db.jobs[c.data.jobKey].state, 'done');
});

test('수령자 이름은 Firebase 로 나가지 않음', async () => {
  const { call, db } = setup();
  const r = await call('search', {});
  assert.strictEqual(r.data.rows[0].recv, undefined);
  assert.strictEqual(r.data.rows[0].pack_seq, '1');
  assert.ok(!db.calls.c1.out.includes('홍길동'));
});

test('허용되지 않은 요청은 거절, 송장출력 명령도 아직 안 됨', async () => {
  const { call, log } = setup();
  for (const bad of ['printGo', 'printPrep', 'read', 'relogin', 'constructor']) {
    const r = await call(bad);
    assert.strictEqual(r.ok, false);
    assert.match(r.err, /허용되지 않은 요청/);
  }
  assert.deepStrictEqual(log, []);
});

test('늦게 처리된 요청은 저장하지 않음', async () => {
  const { call, log, tick } = setup();
  await call('search');
  await call('fill');
  tick(C.RELAY_TTL + 1);
  const r = await call('commit', { confirm: true }, NOW);
  assert.match(r.err, /만료/);
  assert.ok(!log.includes('commit'));
});

test('불러오기 없이 채우기, 채우기 없이 저장은 거절', async () => {
  const { call, log } = setup();
  assert.match((await call('fill')).err, /불러오기부터/);
  await call('search');
  assert.match((await call('commit', { confirm: true })).err, /불러오기부터/);
  assert.ok(!log.includes('commit'));
});

test('채운 뒤 탭이 새로 열렸으면(시동 등) 저장하지 않음', async () => {
  const { call, log, runner } = setup();
  await call('search');
  await call('fill');
  await runner.handleCommand('s', { type: 'start', at: NOW, by: 'x' });
  const r = await call('commit', { confirm: true });
  assert.match(r.err, /사라졌습니다/);
  assert.ok(!log.includes('commit'));
});

test('저장은 한 번만: 실패 뒤 다시 눌러도 나가지 않고 기록을 남김', async () => {
  const { call, log, db } = setup({ commitErr: 'TIMEOUT' });
  await call('search');
  await call('fill');
  assert.strictEqual((await call('commit', { confirm: true })).err, 'TIMEOUT');
  assert.match((await call('commit', { confirm: true })).err, /불러오기부터/);
  assert.strictEqual(log.filter((x) => x === 'commit').length, 1);
  assert.strictEqual(db.jobs['ez_split:2026-11-02:1'].state, 'stopped');
  assert.match(db.jobs['ez_split:2026-11-02:1'].notes, /저장됐을 수 있으니/);
});

test('전체 멈춤이나 진행 중 작업이 있으면 전달하지 않음', async () => {
  let s = setup({ control: { pause: true } });
  assert.match((await s.call('search')).err, /전체 멈춤/);
  s = setup({ jobs: { a: { state: 'running', at: NOW } } });
  assert.match((await s.call('search')).err, /진행 중/);
  assert.deepStrictEqual(s.log, []);
});

test('화면을 보는 동안에는 로그인 유지가 탭을 새로 열지 않고, 30분 지나면 다시 함', async () => {
  const { call, runner, log, tick } = setup();
  await call('search');
  await call('fill');
  const before = log.length;
  assert.ok(runner.holding());
  assert.strictEqual(await runner.keepAlive(), false);
  assert.strictEqual(log.length, before);
  tick(C.RELAY_HOLD + 1);
  assert.ok(!runner.holding());
  assert.strictEqual(await runner.keepAlive(), true);
});

test('같은 요청을 두 번 받아도 한 번만 처리', async () => {
  const { runner, log } = setup();
  const q = { cmd: 'search', args: '{}', at: NOW };
  await runner.handleCall('x', q);
  await runner.handleCall('x', q);
  assert.strictEqual(log.filter((v) => v === 'search').length, 1);
});

test('확인은 같은 구성일 때만 이어 감', () => {
  const ack = { at: 1 }, prev = { ack, preview: { flags: { unknown: 1 }, overComps: [{ comp: 'A' }, { comp: 'B' }], unknownProds: [{ prd: 'X' }] } };
  assert.strictEqual(C.ezAckCarry(prev, { flags: { unknown: 1 }, overComps: [{ comp: 'A' }], unknownProds: [{ prd: 'X' }] }), ack);
  assert.strictEqual(C.ezAckCarry(prev, { flags: { unknown: 0 }, overComps: [{ comp: 'C' }], unknownProds: [] }), null);
  assert.strictEqual(C.ezAckCarry(prev, { flags: { unknown: 1 }, overComps: [], unknownProds: [{ prd: 'Y' }] }), null);
  assert.strictEqual(C.ezAckCarry({ preview: prev.preview }, { overComps: [] }), null);
});

test('미분할 목록이 있어도 오류가 아니면 저장 기록은 완료, 건수만 남김', async () => {
  const { call, db } = setup({ commit: { error: 0, fail_list: ['1', '2', '3'], lock: 1 } });
  await call('search');
  await call('fill');
  const c = await call('commit', { confirm: true });
  assert.strictEqual(db.jobs[c.data.jobKey].state, 'done');
  assert.strictEqual(db.jobs[c.data.jobKey].result.undivided, 3);
});

test('이지어드민이 오류로 답하면 저장 기록은 멈춤', async () => {
  const { call, db } = setup({ commit: { error: 9, fail_list: [], lock: 1 } });
  await call('search');
  await call('fill');
  const c = await call('commit', { confirm: true });
  assert.strictEqual(db.jobs[c.data.jobKey].state, 'stopped');
});

test('흐름도: 저장 중 칸, 저장 명령은 읽기 명령 목록에 없음', () => {
  const ok = { state: 'ok' }, job = { preview: { orders: 5, splitPacks: 3, blockers: [] } };
  const st = (s) => Object.fromEntries(C.ezFlow(ok, job, s).map((x) => [x.id, x.state]));
  assert.strictEqual(st({ state: 'running' }).ez_split, 'run');
  assert.strictEqual(st(null).ez_split, 'todo');
  C.HELPER_WRITE.forEach((c) => assert.throws(() => C.assertSafeCmd(c), /허용되지 않은 명령/));
  const room = C.officeRooms({ runner: { ts: NOW }, sites: { ezadmin: ok, ebut: ok }, jobs: { a: { recipe: 'ez_split', state: 'running', at: NOW, step: '저장 중' } }, now: NOW });
  assert.strictEqual(room.find((x) => x.id === 'ezadmin').say, '저장 중');
  assert.strictEqual(room.find((x) => x.id === 'ebut').mode, 'idle');
});
