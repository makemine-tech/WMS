/* 일괄합포제외 상시 컴퓨터 실행 (secretary_runner.runEzSplit) — 가짜 저장소와 가짜 탭으로 시험 */
const test = require('node:test');
const assert = require('node:assert');
const C = require('../../main/secretary_core.js');
const { createRunner } = require('../../main/secretary_runner.js');

const NOW = new Date('2026-11-02T10:00:00+09:00').getTime();
const SRC = 'ez_daily:2026-11-02:1';
const pv = (over) => Object.assign({ orders: 5, invoices: 7, splitPacks: 3, unseen: 0, flags: { unknown: 0 }, blockers: [] }, over);
const packs = (n) => Array.from({ length: n }, (_, i) => ({ pack_seq: 'P' + (i + 1) }));

function setup(o) {
  o = o || {};
  const log = [];
  let reads = 0;
  const db = { commands: {}, sites: {}, control: o.control || null, jobs: Object.assign({ [SRC]: { recipe: 'ez_daily', state: 'done', at: NOW - 60000, from: '2026-10-26', to: '2026-11-02', preview: pv(o.src) } }, o.jobs) };
  const store = {
    claimRunner: async () => true, getRunner: async () => ({ id: 'me', ts: NOW }), claimCommand: async () => true,
    setCommand: async (id, p) => { db.commands[id] = Object.assign(db.commands[id] || {}, p); },
    getJobs: async () => db.jobs, setJob: async (k, p) => { db.jobs[k] = Object.assign(db.jobs[k] || {}, p); },
    getControl: async () => db.control, setSite: async (id, p) => { db.sites[id] = p; }, setMatch: async () => {},
  };
  const runner = createRunner({
    store, now: () => NOW, runnerId: 'me', info: {},
    openSite: async (s) => { log.push('open'); return s.id === 'ezadmin' ? { page: o.login === false ? '' : 'DG00' } : { login: true }; },
    ezPlan: async () => { reads++; log.push('plan'); return reads === 1 ? { preview: pv(o.now), pay: packs(pv(o.now).splitPacks), rows: [] } : { preview: pv(o.after || { splitPacks: 0 }), pay: [], rows: [] }; },
    ezFill: async (pay) => { log.push('fill:' + pay.length); if (o.pauseOnFill) db.control = { pause: true }; return o.fill || { done: pay.map((p) => p.pack_seq), skipped: [] }; },
    ezCommit: async () => { log.push('commit'); if (o.commitErr) throw new Error(o.commitErr); return o.commit || { error: 0, fail_list: [], lock: 1 }; },
    ezVerify: (pay) => { log.push('verify'); return o.verify || { ok: pay.map((p) => p.pack_seq), notApplied: [], gone: [] }; },
  });
  return { runner, db, log };
}
const cmd = (extra) => Object.assign({ type: 'ez_split', at: NOW, by: 'x', job: SRC }, extra);
const JOB = 'ez_split:2026-11-02:1';

test('확인한 자료와 같으면 채우기→저장→대조 후 다음 칸을 위한 자료를 남김', async () => {
  const { runner, db, log } = setup();
  await runner.handleCommand('c', cmd());
  assert.deepStrictEqual(log, ['open', 'plan', 'fill:3', 'commit', 'open', 'plan', 'verify']);
  assert.strictEqual(db.jobs[JOB].state, 'done');
  assert.strictEqual(db.jobs[JOB].result.ok, 3);
  assert.strictEqual(db.jobs['ez_daily:2026-11-02:2'].preview.splitPacks, 0);
  assert.strictEqual(db.commands.c.status, 'done');
});

test('10건 먼저: 앞 10건만 채움', async () => {
  const { runner, log } = setup({ src: { splitPacks: 30 }, now: { splitPacks: 30 }, after: { splitPacks: 20 } });
  await runner.handleCommand('c', cmd({ limit: 10 }));
  assert.ok(log.includes('fill:10'));
});

test('다시 읽으니 건수가 달라졌으면 채우지 않음', async () => {
  const { runner, db, log } = setup({ now: { splitPacks: 4 } });
  await runner.handleCommand('c', cmd());
  assert.ok(!log.some((x) => x.startsWith('fill') || x === 'commit'));
  assert.strictEqual(db.jobs[JOB].state, 'stopped');
  assert.match(db.jobs[JOB].notes, /3건에서 4건/);
});

test('줄 수가 안 맞으면 확인했어도 채우지 않음', async () => {
  const { runner, log } = setup({ now: { blockers: ['이지어드민에는 2줄이 있는데 1줄만 읽혔습니다'] } });
  await runner.handleCommand('c', cmd());
  assert.ok(!log.some((x) => x.startsWith('fill')));
});

test('건너뛴 묶음이 있으면 저장하지 않고 채운 것을 버림', async () => {
  const { runner, db, log } = setup({ fill: { done: ['P1'], skipped: [{ pack_seq: 'P2', why: '상품·수량이 바뀜' }] } });
  await runner.handleCommand('c', cmd());
  assert.ok(!log.includes('commit'));
  assert.strictEqual(log[log.length - 1], 'open');
  assert.strictEqual(db.jobs[JOB].state, 'stopped');
  assert.strictEqual(db.jobs[JOB].result.skipList[0].pack_seq, 'P2');
});

test('저장이 실패하면 다시 시도하지 않고 멈춤', async () => {
  const { runner, db, log } = setup({ commitErr: 'TIMEOUT' });
  await runner.handleCommand('c', cmd());
  assert.strictEqual(log.filter((x) => x === 'commit').length, 1);
  assert.strictEqual(db.jobs[JOB].state, 'stopped');
  assert.match(db.jobs[JOB].notes, /저장됐을 수 있으니/);
  assert.strictEqual(db.jobs['ez_daily:2026-11-02:2'], undefined);
});

test('대조에서 안 된 묶음이 있으면 확인 필요로 멈춤', async () => {
  const { runner, db } = setup({ verify: { ok: ['P1'], notApplied: ['P2', 'P3'], gone: [] } });
  await runner.handleCommand('c', cmd());
  assert.strictEqual(db.jobs[JOB].state, 'stopped');
  assert.deepStrictEqual(db.jobs[JOB].result.notApplied, ['P2', 'P3']);
  assert.strictEqual(db.jobs['ez_daily:2026-11-02:2'], undefined);
});

test('전체 멈춤: 시작 전이면 거절, 채우는 사이에 걸리면 저장하지 않고 버림', async () => {
  const t = setup({ control: { pause: true } });
  await t.runner.handleCommand('c', cmd());
  assert.strictEqual(t.db.commands.c.status, 'refused');
  assert.deepStrictEqual(t.log, []);
  const s = setup({ pauseOnFill: true });
  await s.runner.handleCommand('c', cmd());
  assert.ok(s.log.includes('fill:3'));
  assert.ok(!s.log.includes('commit'));
  assert.strictEqual(s.log[s.log.length - 1], 'open');
  assert.match(s.db.jobs[JOB].notes, /전체 멈춤/);
});

test('같은 자료로 두 번 실행 못 함, 더 새 자료가 있으면 거절, 확인 전이면 거절', async () => {
  let s = setup({ jobs: { [JOB]: { recipe: 'ez_split', src: SRC, state: 'stopped', at: NOW - 1000 } } });
  await s.runner.handleCommand('c', cmd());
  assert.strictEqual(s.db.commands.c.status, 'refused');
  assert.match(s.db.commands.c.why, /이미 실행/);
  s = setup({ jobs: { 'ez_daily:2026-11-02:2': { recipe: 'ez_daily', state: 'done', at: NOW - 100, preview: pv() } } });
  await s.runner.handleCommand('c', cmd());
  assert.match(s.db.commands.c.why, /더 새로/);
  s = setup({ src: { blockers: ['처음 보는 구성 1건'], unseen: 1 } });
  await s.runner.handleCommand('c', cmd());
  assert.match(s.db.commands.c.why, /확인이 끝나지/);
  assert.deepStrictEqual(s.log, []);
});

test('확인을 이어 가는 것은 새 확인거리가 없을 때만', async () => {
  const ack = { at: 1 };
  let s = setup({ src: { blockers: ['처음 보는 구성 1건'], unseen: 1 }, now: { unseen: 1 }, after: { splitPacks: 0, unseen: 1, blockers: ['처음 보는 구성 1건'] } });
  s.db.jobs[SRC].ack = ack;
  await s.runner.handleCommand('c', cmd());
  assert.deepStrictEqual(s.db.jobs['ez_daily:2026-11-02:2'].ack, ack);
  s = setup({ src: { blockers: ['처음 보는 구성 1건'], unseen: 1 }, now: { unseen: 1 }, after: { splitPacks: 0, unseen: 2, blockers: ['처음 보는 구성 2건'] } });
  s.db.jobs[SRC].ack = ack;
  await s.runner.handleCommand('c', cmd());
  assert.strictEqual(s.db.jobs['ez_daily:2026-11-02:2'].ack, undefined);
});

test('흐름도: 진행 중 칸, 저장 명령은 읽기 명령 목록에 없음', () => {
  const ok = { state: 'ok' }, job = { preview: pv() };
  const st = (s) => Object.fromEntries(C.ezFlow(ok, job, s).map((x) => [x.id, x.state]));
  assert.strictEqual(st({ state: 'running' }).ez_split, 'run');
  assert.strictEqual(st(null).ez_split, 'todo');
  C.HELPER_WRITE.forEach((c) => assert.throws(() => C.assertSafeCmd(c), /허용되지 않은 명령/));
  const room = C.officeRooms({ runner: { ts: NOW }, sites: { ezadmin: ok, ebut: ok }, jobs: { a: { recipe: 'ez_split', state: 'running', at: NOW, step: '채우는 중' } }, now: NOW });
  assert.strictEqual(room.find((x) => x.id === 'ezadmin').say, '채우는 중');
  assert.strictEqual(room.find((x) => x.id === 'ebut').mode, 'idle');
});
