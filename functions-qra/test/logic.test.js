const { test } = require('node:test');
const assert = require('node:assert');
const L = require('../logic');
const { normalizePhone, normalizeName, hashToken, workerId, checkCompany, resolveIdentity, decidePunch, nextAction,
  monthOf, dayOf, duePeriod, monthsInRange, monthsToPurge, validateEdit, parseRecipients, workMinutes, summarize } = L;

const at = (s) => Date.parse(s + '+09:00');
const t = at('2026-10-31T22:00:00');
const open = { logId: 'L', month: '2026-10', in: t, lastAt: t, lastType: 'in' };

test('휴대폰번호 표기가 달라도 같은 번호', () => {
  assert.equal(normalizePhone('010-1234-5678'), '01012345678');
  assert.equal(normalizePhone('010 1234 5678'), '01012345678');
  assert.equal(normalizePhone('+82 10-1234-5678'), '01012345678');
  assert.equal(normalizePhone('02-123-4567'), null);
  assert.equal(normalizePhone(''), null);
});

test('이름 띄어쓰기 무시', () => {
  assert.equal(normalizeName(' 김 민지 '), '김민지');
  assert.equal(normalizeName('가'.repeat(30)).length, 20);
});

test('직원 키는 회사마다 다름', () => {
  assert.notEqual(workerId('a', '01012345678'), workerId('b', '01012345678'));
  assert.equal(workerId('a', '01012345678').length, 24);
});

test('신원 확인: 토큰·이름번호·신규·불일치', () => {
  const w = { name: '김민지', phone: '01012345678', tokens: { [hashToken('T')]: { at: 1 } } };
  assert.equal(resolveIdentity(w, { token: 'T' }).result, 'token');
  assert.equal(resolveIdentity(w, { name: '김 민지', phone: '010-1234-5678' }).result, 'match');
  assert.equal(resolveIdentity(w, { name: '이민지', phone: '01012345678' }).result, 'nameMismatch');
  assert.equal(resolveIdentity(null, { name: '김민지', phone: '01012345678' }).result, 'new');
  assert.equal(resolveIdentity(null, { name: '김민지' }).result, 'needPhone');
  assert.equal(resolveIdentity(w, { token: '틀림' }).result, 'needPhone');
});

test('중지·없는 회사는 새 QR 안내', () => {
  assert.equal(checkCompany('c', { off: true }).message, '담당자에게 새 QR을 요청해 주세요');
  assert.equal(checkCompany('c', null).ok, false);
  assert.equal(checkCompany(null, { name: 'x' }).ok, false);
  assert.equal(checkCompany('c', { name: 'x' }).ok, true);
});

test('출퇴근 판단', () => {
  assert.deepEqual(decidePunch(null, 'in', t), { kind: 'in', closeStale: false });
  assert.equal(decidePunch(null, 'out', t).kind, 'stale');
  assert.equal(decidePunch(open, 'in', t + 30e3).kind, 'dup');
  assert.equal(decidePunch(open, 'in', t + 120e3).kind, 'stale');
  assert.equal(decidePunch(open, 'out', at('2026-11-01T06:00:00')).kind, 'out');
  assert.deepEqual(decidePunch(open, 'in', t + 18 * 3600e3), { kind: 'in', closeStale: true });
  assert.equal(decidePunch(open, 'out', t + 18 * 3600e3).kind, 'stale');
  assert.equal(decidePunch({ lastAt: t, lastType: 'out' }, 'out', t + 30e3).kind, 'dup');
  assert.equal(decidePunch({ lastAt: t, lastType: 'out' }, 'in', t + 30e3).kind, 'in');
});

test('다음 버튼', () => {
  assert.equal(nextAction(null, t), 'in');
  assert.equal(nextAction(open, t + 3600e3), 'out');
  assert.equal(nextAction(open, t + 18 * 3600e3), 'in');
  assert.equal(nextAction({ lastAt: t, lastType: 'out' }, t + 1), 'in');
});

test('달·날 경계는 한국 시간', () => {
  assert.equal(monthOf(Date.parse('2026-10-31T15:30:00Z')), '2026-11');
  assert.equal(dayOf(Date.parse('2026-10-31T15:30:00Z')), '2026-11-01');
});

test('메일 대상 기간', () => {
  assert.equal(duePeriod('daily', at('2026-11-01T07:00:00')).id, 'D2026-10-31');
  const w = duePeriod('weekly', at('2026-11-02T07:00:00'));
  assert.equal(w.id, 'W2026-10-26');
  assert.equal(w.fromMs, at('2026-10-26T00:00:00'));
  assert.equal(w.toMs, at('2026-11-02T00:00:00'));
  assert.equal(duePeriod('weekly', at('2026-11-03T07:00:00')), null);
  assert.equal(duePeriod('monthly', at('2027-01-01T07:00:00')).id, 'M2026-12');
  assert.equal(duePeriod('monthly', at('2027-01-01T07:00:00')).fromMs, at('2026-12-01T00:00:00'));
  assert.equal(duePeriod('monthly', at('2026-11-02T07:00:00')), null);
  assert.equal(duePeriod('off', at('2026-11-01T07:00:00')), null);
  assert.equal(duePeriod(undefined, at('2026-11-01T07:00:00')), null);
});

test('기간에 걸친 달 목록', () => {
  assert.deepEqual(monthsInRange(at('2026-10-26T00:00:00'), at('2026-11-02T00:00:00')), ['2026-10', '2026-11']);
  assert.deepEqual(monthsInRange(at('2026-10-01T00:00:00'), at('2026-11-01T00:00:00')), ['2026-10']);
  assert.deepEqual(monthsInRange(at('2026-12-31T00:00:00'), at('2027-01-02T00:00:00')), ['2026-12', '2027-01']);
});

test('3년 지난 달만 삭제', () => {
  assert.deepEqual(monthsToPurge(['2023-09', '2023-10', '2026-10'], at('2026-10-31T07:00:00')), ['2023-09']);
});

test('기록 수정 검증', () => {
  assert.equal(validateEdit({ inMs: t, outMs: t - 60e3 }, t).ok, false);
  assert.equal(validateEdit({ inMs: t + 3600e3 }, t).ok, false);
  assert.equal(validateEdit({ inMs: t, outMs: t + 3600e3 }, t + 3600e3).ok, true);
  assert.equal(validateEdit({}, t).ok, false);
});

test('메일 수신자 분리', () => {
  assert.deepEqual(parseRecipients('a@b.kr; c@d.com,\nbad').valid, ['a@b.kr', 'c@d.com']);
  assert.deepEqual(parseRecipients('a@b.kr; bad').invalid, ['bad']);
  assert.deepEqual(parseRecipients(['a@b.kr', 'A@B.kr']).valid, ['a@b.kr']);
  assert.deepEqual(parseRecipients(undefined).valid, []);
});

test('근무시간과 요약', () => {
  assert.equal(workMinutes({ in: 0, out: 90 * 60e3 }), 90);
  assert.equal(workMinutes({ in: 0, out: null }), null);
  assert.deepEqual(summarize([
    { wid: 'A', in: 0, out: 90 * 60e3, status: 'done' },
    { wid: 'A', in: 0, out: null, status: 'noout' },
    { wid: 'B', in: 0, out: 30 * 60e3, status: 'done' },
  ]), { people: 2, totalMinutes: 120, noout: 1 });
});
