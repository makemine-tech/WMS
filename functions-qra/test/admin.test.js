const { test } = require('node:test');
const assert = require('node:assert');
const ExcelJS = require('exceljs');
const { fakeDb } = require('./fakedb');
const { makeAdmin } = require('../admin');

const at = (s) => Date.parse(s + '+09:00');
const SUPER = { uid: 'su', token: { email: 'boss@gmail.com', email_verified: true } };
const MGR = { uid: 'm1', token: { email: 'Kim.Mgr@gmail.com', email_verified: true } };
const OTHER = { uid: 'm2', token: { email: 'other@gmail.com', email_verified: true } };
const UNVERIFIED = { uid: 'm3', token: { email: 'kim.mgr@gmail.com', email_verified: false } };
const IN = at('2026-10-30T09:00:00');

function setup(now, extra){
  const db = fakeDb({
    superadmins: { su: true },
    qra: Object.assign({
      keys: { OLDKEYOLDKEYOLDKEYOLDKEY: 'c1' },
      admins: { 'kim,mgr@gmail,com': { c1: true }, 'other@gmail,com': { c2: true } },
      companies: {
        c1: { name: '회사1', qrKey: 'OLDKEYOLDKEYOLDKEYOLDKEY', mail: { freq: 'daily', to: ['a@b.kr'], cc: ['c@b.kr'] } },
        c2: { name: '회사2', mail: { freq: 'daily', to: ['z@b.kr'] } },
      },
      workers: { c1: { W1: { name: '김민지', phone: '01012345678', lastAt: IN, tokens: { H1: { at: 1 } } } } },
      tokens: { c1: { H1: 'W1' } },
      logs: { c1: { '2026-10': { L1: { wid: 'W1', name: '김민지', phone: '01012345678', in: IN, out: null, status: 'open' } } } },
      open: { c1: { W1: { logId: 'L1', month: '2026-10', in: IN, lastAt: IN, lastType: 'in' } } },
    }, extra || {}),
  });
  const clock = { now };
  const sent = [];
  const transport = { fail: {}, sendMail: async (m) => {
    if (transport.fail[m.to[0]]) throw Object.assign(new Error('boom'), { code: transport.fail[m.to[0]] });
    sent.push(m);
  } };
  const a = makeAdmin(db, () => clock.now, () => ({ transport, from: 'me@gmail.com' }));
  return { db, clock, sent, transport, a };
}
const denied = (e) => e.code === 'permission-denied';

test('담당자 판별: 자기 회사만, 미인증 메일 거부', async () => {
  const { a } = setup(IN);
  assert.equal(await a.canManage(SUPER, 'c1'), true);
  assert.equal(await a.canManage(MGR, 'c1'), true);
  assert.equal(await a.canManage(OTHER, 'c1'), false);
  assert.equal(await a.canManage(UNVERIFIED, 'c1'), false);
  assert.equal(await a.canManage(null, 'c1'), false);
});

test('담당자는 자기 회사 엑셀만, 수정·직원 관리·발송은 거부', async () => {
  const { a } = setup(IN + 3600e3);
  const c = { cid: 'c1', month: '2026-10', logId: 'L1', inMs: IN };
  await assert.rejects(a.editLog(c, MGR), denied);
  await assert.rejects(a.editLog({ cid: 'c1', create: { name: '가', phone: '01099998888' }, inMs: IN }, MGR), denied);
  await assert.rejects(a.editWorker({ cid: 'c1', wid: 'W1', name: 'x' }, MGR), denied);
  await assert.rejects(a.sendNow({ cid: 'c1', fromMs: IN, toMs: IN + 1 }, MGR), denied);
  assert.ok((await a.exportLogs({ cid: 'c1', fromMs: IN, toMs: IN + 3600e3 }, MGR)).base64);
});

test('다른 고객사 담당자는 수정·엑셀·발송 거부', async () => {
  const { a } = setup(IN + 3600e3);
  const c = { cid: 'c1', month: '2026-10', logId: 'L1', inMs: IN };
  await assert.rejects(a.editLog(c, OTHER), denied);
  await assert.rejects(a.exportLogs({ cid: 'c1', fromMs: IN, toMs: IN + 1 }, OTHER), denied);
  await assert.rejects(a.sendNow({ cid: 'c1', fromMs: IN, toMs: IN + 1 }, OTHER), denied);
  await assert.rejects(a.editWorker({ cid: 'c1', wid: 'W1', name: 'x' }, OTHER), denied);
});

test('퇴근이 출근보다 앞이면 거부', async () => {
  const { a, db } = setup(IN + 3600e3);
  await assert.rejects(a.editLog({ cid: 'c1', month: '2026-10', logId: 'L1', inMs: IN, outMs: IN - 60e3 }, SUPER), /앞입니다/);
  assert.equal(db.get('qra/logs/c1/2026-10/L1/out'), null);
});

test('다른 달로 옮기는 수정은 거부', async () => {
  const { a } = setup(at('2026-11-05T09:00:00'));
  await assert.rejects(a.editLog({ cid: 'c1', month: '2026-10', logId: 'L1', inMs: at('2026-11-01T09:00:00') }, SUPER), /다른 달/);
});

test('수정 전 값을 남기고, 근무 중 기록의 출근 수정은 open 에 반영', async () => {
  const { a, db } = setup(IN + 3600e3);
  await a.editLog({ cid: 'c1', month: '2026-10', logId: 'L1', inMs: IN - 600e3 }, SUPER);
  const log = db.get('qra/logs/c1/2026-10/L1');
  assert.equal(log.in, IN - 600e3);
  assert.equal(log.status, 'open');
  const e = Object.values(log.edits)[0];
  assert.equal(e.in, IN);
  assert.equal(e.by, 'boss@gmail.com');
  assert.equal(db.get('qra/open/c1/W1/in'), IN - 600e3);
});

test('근무 중 기록에 퇴근을 넣으면 근무 중이 풀림', async () => {
  const { a, db } = setup(IN + 7200e3);
  await a.editLog({ cid: 'c1', month: '2026-10', logId: 'L1', inMs: IN, outMs: IN + 3600e3 }, SUPER);
  assert.equal(db.get('qra/logs/c1/2026-10/L1/status'), 'done');
  assert.equal(db.get('qra/open/c1/W1/logId'), null);
});

test('기록 삭제 시 근무 중도 풀림', async () => {
  const { a, db } = setup(IN + 3600e3);
  await a.editLog({ cid: 'c1', month: '2026-10', logId: 'L1', remove: true }, SUPER);
  assert.equal(db.get('qra/logs/c1/2026-10/L1'), null);
  assert.equal(db.get('qra/open/c1/W1'), null);
});

test('수기 추가: 기존 직원에 붙고 동의 기록은 만들지 않음', async () => {
  const { a, db } = setup(at('2026-10-31T09:00:00'));
  await a.editLog({ cid: 'c1', create: { name: '박지수', phone: '010-9999-8888' }, inMs: IN, outMs: IN + 3600e3 }, SUPER);
  const logs = Object.values(db.get('qra/logs/c1/2026-10'));
  const made = logs.find((l) => l.name === '박지수');
  assert.equal(made.status, 'done');
  assert.equal(made.manual, true);
  const w = db.get('qra/workers/c1/' + made.wid);
  assert.equal(w.phone, '01099998888');
  assert.equal(w.consentAt, undefined);
});

test('직원 이름 수정, 삭제해도 기록은 남고 토큰은 지워짐', async () => {
  const { a, db } = setup(IN + 3600e3);
  await a.editWorker({ cid: 'c1', wid: 'W1', name: '김 민 지2' }, SUPER);
  assert.equal(db.get('qra/workers/c1/W1/name'), '김민지2');
  await a.editWorker({ cid: 'c1', wid: 'W1', remove: true }, SUPER);
  assert.equal(db.get('qra/workers/c1/W1'), null);
  assert.equal(db.get('qra/tokens/c1/H1'), null);
  assert.equal(db.get('qra/open/c1/W1'), null);
  assert.equal(db.get('qra/logs/c1/2026-10/L1/status'), 'noout');
});

test('QR 재발급은 슈퍼관리자만, 이전 열쇠 즉시 무효', async () => {
  const { a, db } = setup(IN);
  await assert.rejects(a.rotateKey({ cid: 'c1' }, MGR), denied);
  const r = await a.rotateKey({ cid: 'c1' }, SUPER);
  assert.match(r.qrKey, /^[A-Za-z0-9]{24}$/);
  assert.equal(db.get('qra/keys/OLDKEYOLDKEYOLDKEYOLDKEY'), null);
  assert.equal(db.get('qra/keys/' + r.qrKey), 'c1');
  assert.equal(db.get('qra/companies/c1/qrKey'), r.qrKey);
});

test('엑셀은 기간 안의 기록만', async () => {
  const { a } = setup(at('2026-11-05T09:00:00'), { logs: { c1: {
    '2026-10': { A: { wid: 'W1', name: '가', phone: '1', in: at('2026-10-31T09:00:00'), out: null, status: 'noout' }, B: { wid: 'W1', name: '나', phone: '1', in: at('2026-10-01T09:00:00'), out: null, status: 'noout' } },
    '2026-11': { C: { wid: 'W1', name: '다', phone: '1', in: at('2026-11-01T09:00:00'), out: null, status: 'noout' } },
  } } });
  const r = await a.exportLogs({ cid: 'c1', fromMs: at('2026-10-31T00:00:00'), toMs: at('2026-11-02T00:00:00') }, MGR);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(r.base64, 'base64'));
  assert.equal(wb.getWorksheet('근태일지').rowCount, 7);   /* 머리 5줄 + 기록 2건 */
  assert.ok(r.filename.endsWith('.xlsx'));
});

const dailyLog = { logs: { c1: { '2026-10': { L: { wid: 'W1', name: '김민지', phone: '1', in: at('2026-10-31T09:00:00'), out: at('2026-10-31T18:00:00'), status: 'done' } } } }, open: {} };

test('예약: 받는 사람·참조로 보내고 같은 기간은 다시 안 보냄', async () => {
  const s = setup(at('2026-11-01T07:00:00'), dailyLog);
  await s.a.runTick();
  assert.equal(s.sent.filter((m) => m.to[0] === 'a@b.kr').length, 1);
  assert.deepEqual(s.sent[0].cc, ['c@b.kr']);
  assert.equal(s.db.get('qra/companies/c1/mail/lastPeriod'), 'D2026-10-31');
  s.clock.now = at('2026-11-01T08:00:00');
  await s.a.runTick();
  assert.equal(s.sent.filter((m) => m.to[0] === 'a@b.kr').length, 1);
});

test('예약: 한 회사가 실패해도 다음 회사는 발송, 실패는 다음 회차에 재시도', async () => {
  const s = setup(at('2026-11-01T07:00:00'), dailyLog);
  s.transport.fail['a@b.kr'] = 'EAUTH';
  await s.a.runTick();
  assert.ok(s.sent.some((m) => m.to[0] === 'z@b.kr'));
  assert.equal(s.db.get('qra/companies/c1/mail/lastPeriod'), null);
  assert.equal(s.db.get('qra/companies/c1/mail/lastError'), '메일 계정 인증에 실패했습니다');
  assert.equal(Object.values(s.db.get('qra/mailLog/c1'))[0].ok, false);
  delete s.transport.fail['a@b.kr'];
  s.clock.now = at('2026-11-01T08:00:00');
  await s.a.runTick();
  assert.ok(s.sent.some((m) => m.to[0] === 'a@b.kr'));
  assert.equal(s.db.get('qra/companies/c1/mail/lastError'), null);
});

test('예약: 중지 회사와 주기 꺼짐은 안 보냄', async () => {
  const s = setup(at('2026-11-01T07:00:00'), dailyLog);
  s.db.set('qra/companies/c1/off', true);
  s.db.set('qra/companies/c2/mail/freq', 'off');
  await s.a.runTick();
  assert.equal(s.sent.length, 0);
});

test('예약: 18시간 넘게 열린 기록을 미기록으로 닫음', async () => {
  const s = setup(IN + 18 * 3600e3);
  await s.a.runTick();
  assert.equal(s.db.get('qra/logs/c1/2026-10/L1/status'), 'noout');
  assert.equal(s.db.get('qra/open/c1/W1/logId'), null);
});

test('예약: 7시 회차에 1년 지난 기록·직원 삭제, 다른 시각엔 안 함', async () => {
  const old = at('2025-08-15T09:00:00');
  const extra = { logs: { c1: { '2025-09': { O: { wid: 'W0', in: old } }, '2025-10': { K: { wid: 'W1', in: at('2025-10-01T09:00:00') } } } },
    workers: { c1: { W0: { name: '옛', phone: '1', lastAt: old, tokens: { H0: { at: 1 } } }, W1: { name: '새', phone: '2', lastAt: at('2026-10-01T09:00:00') } } },
    tokens: { c1: { H0: 'W0' } }, open: {} };
  const s = setup(at('2026-10-31T08:00:00'), extra);
  await s.a.runTick();
  assert.ok(s.db.get('qra/logs/c1/2025-09'));
  s.clock.now = at('2026-10-31T07:00:00');
  await s.a.runTick();
  assert.equal(s.db.get('qra/logs/c1/2025-09'), null);
  assert.ok(s.db.get('qra/logs/c1/2025-10'));
  assert.equal(s.db.get('qra/workers/c1/W0'), null);
  assert.equal(s.db.get('qra/tokens/c1/H0'), null);
  assert.ok(s.db.get('qra/workers/c1/W1'));
});

test('지금 보내기는 예약 기록을 건드리지 않음', async () => {
  const s = setup(at('2026-11-05T09:00:00'), dailyLog);
  await s.a.sendNow({ cid: 'c1', fromMs: at('2026-10-31T00:00:00'), toMs: at('2026-11-01T00:00:00') }, SUPER);
  assert.equal(s.sent.length, 1);
  assert.equal(s.db.get('qra/companies/c1/mail/lastPeriod'), null);
  assert.equal(Object.values(s.db.get('qra/mailLog/c1'))[0].ok, true);
});
