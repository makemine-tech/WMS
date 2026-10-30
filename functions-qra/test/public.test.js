const { test } = require('node:test');
const assert = require('node:assert');
const { fakeDb } = require('./fakedb');
const { makeHandlers } = require('../public');
const { workerId, hashToken } = require('../logic');

const at = (s) => Date.parse(s + '+09:00');
const KEY = 'KEYKEYKEYKEYKEYKEYKEYKEY';
const CID = 'cid1';
const ME = { name: '김민지', phone: '010-1234-5678', dev: 'dev-1' };

function setup(now){
  const db = fakeDb({ qra: {
    keys: { [KEY]: CID, OFFKEYOFFKEYOFFKEYOFFKEY: 'cid2' },
    companies: { [CID]: { name: '회사', site: '1센터', logo: 'data:image/png;base64,AA' }, cid2: { name: '중지', off: true } },
  } });
  const clock = { now };
  return { db, clock, h: makeHandlers(db, () => clock.now) };
}
const ctx = { ip: '1.1.1.1' };
const logsOf = (db, m) => Object.values(db.get('qra/logs/' + CID + '/' + m) || {});

test('첫 출근은 동의를 요구하고 기록하지 않음', async () => {
  const { h, db } = setup(at('2026-10-30T09:00:00'));
  const r = await h.punch({ key: KEY, action: 'in', ...ME }, ctx);
  assert.equal(r.needConsent, true);
  assert.equal(logsOf(db, '2026-10').length, 0);
  assert.equal(db.get('qra/workers/' + CID), null);
});

test('동의 후 출근 기록과 토큰 발급, 토큰은 해시로만 저장', async () => {
  const { h, db } = setup(at('2026-10-30T09:00:00'));
  const r = await h.punch({ key: KEY, action: 'in', agree: true, ...ME }, ctx);
  assert.equal(r.kind, 'in');
  assert.equal(r.next, 'out');
  assert.ok(r.token);
  const wid = workerId(CID, '01012345678');
  const w = db.get('qra/workers/' + CID + '/' + wid);
  assert.equal(w.name, '김민지');
  assert.ok(w.consentAt);
  assert.ok(w.tokens[hashToken(r.token)]);
  assert.ok(!JSON.stringify(db.state.root).includes(r.token));
  assert.equal(db.get('qra/tokens/' + CID + '/' + hashToken(r.token)), wid);
  const [log] = logsOf(db, '2026-10');
  assert.equal(log.in, at('2026-10-30T09:00:00'));
  assert.equal(log.status, 'open');
});

test('같은 폰 토큰으로 동의 없이 퇴근', async () => {
  const s = setup(at('2026-10-30T09:00:00'));
  const first = await s.h.punch({ key: KEY, action: 'in', agree: true, ...ME }, ctx);
  s.clock.now = at('2026-10-30T18:00:00');
  const info = await s.h.info({ key: KEY, token: first.token }, ctx);
  assert.equal(info.me.name, '김민지');
  assert.equal(info.me.next, 'out');
  const r = await s.h.punch({ key: KEY, action: 'out', token: first.token, dev: 'dev-1' }, ctx);
  assert.equal(r.kind, 'out');
  assert.equal(r.next, 'in');
  const [log] = logsOf(s.db, '2026-10');
  assert.equal(log.status, 'done');
  assert.equal(log.out, at('2026-10-30T18:00:00'));
  assert.equal(r.records.length, 1);
});

test('저장소가 빈 폰도 이름·번호가 맞으면 동의 없이 기록', async () => {
  const s = setup(at('2026-10-30T09:00:00'));
  await s.h.punch({ key: KEY, action: 'in', agree: true, ...ME }, ctx);
  s.clock.now = at('2026-10-30T18:00:00');
  const r = await s.h.punch({ key: KEY, action: 'out', name: '김 민지', phone: '01012345678' }, ctx);
  assert.equal(r.kind, 'out');
  assert.ok(r.token);
});

test('번호는 같은데 이름이 다르면 거부하고 등록 이름 비노출', async () => {
  const s = setup(at('2026-10-30T09:00:00'));
  await s.h.punch({ key: KEY, action: 'in', agree: true, ...ME }, ctx);
  await assert.rejects(s.h.punch({ key: KEY, action: 'out', name: '이민지', phone: '01012345678' }, ctx), (e) => {
    assert.equal(e.message, '등록된 정보와 다릅니다. 담당자에게 문의해 주세요');
    return true;
  });
});

test('토큰이 틀리고 번호도 없으면 번호 입력 요청', async () => {
  const s = setup(at('2026-10-30T09:00:00'));
  const r = await s.h.punch({ key: KEY, action: 'in', token: '없는토큰' }, ctx);
  assert.equal(r.needPhone, true);
});

test('잘못된 번호와 빈 이름은 안내', async () => {
  const s = setup(at('2026-10-30T09:00:00'));
  await assert.rejects(s.h.punch({ key: KEY, action: 'in', agree: true, name: '', phone: '01012345678' }, ctx), /이름을 입력/);
  await assert.rejects(s.h.punch({ key: KEY, action: 'in', agree: true, name: '김', phone: '0212345678' }, ctx), /휴대폰번호/);
});

test('중지·재발급된 QR 은 안내 문구로 거부', async () => {
  const s = setup(at('2026-10-30T09:00:00'));
  const msg = '담당자에게 새 QR을 요청해 주세요';
  await assert.rejects(s.h.punch({ key: 'OFFKEYOFFKEYOFFKEYOFFKEY', action: 'in', agree: true, ...ME }, ctx), (e) => e.message === msg);
  await assert.rejects(s.h.punch({ key: 'GONEGONEGONEGONEGONEGONE', action: 'in', agree: true, ...ME }, ctx), (e) => e.message === msg);
  await assert.rejects(s.h.info({ key: 'GONEGONEGONEGONEGONEGONE' }, ctx), (e) => e.message === msg);
});

test('달을 넘긴 퇴근은 출근 달의 기록을 닫음', async () => {
  const s = setup(at('2026-10-31T22:00:00'));
  const first = await s.h.punch({ key: KEY, action: 'in', agree: true, ...ME }, ctx);
  s.clock.now = at('2026-11-01T06:00:00');
  await s.h.punch({ key: KEY, action: 'out', token: first.token }, ctx);
  assert.equal(logsOf(s.db, '2026-10')[0].status, 'done');
  assert.equal(logsOf(s.db, '2026-11').length, 0);
});

test('18시간 지나면 퇴근 미기록으로 닫고 새 출근', async () => {
  const s = setup(at('2026-10-30T09:00:00'));
  const first = await s.h.punch({ key: KEY, action: 'in', agree: true, ...ME }, ctx);
  s.clock.now = at('2026-10-31T09:00:00');
  const r = await s.h.punch({ key: KEY, action: 'in', token: first.token }, ctx);
  assert.equal(r.kind, 'in');
  const logs = logsOf(s.db, '2026-10');
  assert.equal(logs.length, 2);
  assert.equal(logs.filter((l) => l.status === 'noout').length, 1);
});

test('연속 누름은 한 건, 화면과 상태가 달라도 쓰지 않음', async () => {
  const s = setup(at('2026-10-30T09:00:00'));
  const first = await s.h.punch({ key: KEY, action: 'in', agree: true, ...ME }, ctx);
  s.clock.now += 20e3;
  const dup = await s.h.punch({ key: KEY, action: 'in', token: first.token }, ctx);
  assert.equal(dup.kind, 'dup');
  s.clock.now += 120e3;
  const stale = await s.h.punch({ key: KEY, action: 'in', token: first.token }, ctx);
  assert.equal(stale.kind, 'stale');
  assert.equal(stale.next, 'out');
  assert.equal(logsOf(s.db, '2026-10').length, 1);
});

test('내 기록은 이번 달 본인 것만', async () => {
  const s = setup(at('2026-10-30T09:00:00'));
  const a = await s.h.punch({ key: KEY, action: 'in', agree: true, ...ME }, ctx);
  await s.h.punch({ key: KEY, action: 'in', agree: true, name: '박지수', phone: '01099998888' }, ctx);
  const info = await s.h.info({ key: KEY, token: a.token }, ctx);
  assert.equal(info.me.records.length, 1);
  assert.equal(info.company.name, '회사');
  assert.equal(info.company.site, '1센터');
  s.clock.now = at('2026-11-02T09:00:00');
  assert.equal((await s.h.info({ key: KEY, token: a.token }, ctx)).me.records.length, 0);
});

test('토큰 없는 안내 정보에는 개인정보 없음', async () => {
  const s = setup(at('2026-10-30T09:00:00'));
  await s.h.punch({ key: KEY, action: 'in', agree: true, ...ME }, ctx);
  const info = await s.h.info({ key: KEY }, ctx);
  assert.equal(info.me, null);
  assert.ok(!JSON.stringify(info).includes('김민지'));
});

test('같은 주소의 호출이 너무 많으면 거부', async () => {
  const s = setup(at('2026-10-30T09:00:00'));
  const c = { ip: '9.9.9.9' };
  for (let i = 0; i < 120; i++) await s.h.info({ key: KEY }, c);
  await assert.rejects(s.h.info({ key: KEY }, c), /잠시 후/);
  s.clock.now += 61e3;
  await s.h.info({ key: KEY }, c);
});
