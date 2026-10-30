const { test } = require('node:test');
const assert = require('node:assert');
const ExcelJS = require('exceljs');
const { buildWorkbook, mailContent, sendReport } = require('../mail');

const at = (s) => Date.parse(s + '+09:00');
const A = { wid: 'A', name: '김민지', phone: '01012345678' };
const B = { wid: 'B', name: '=SUM(1)', phone: '01099998888' };
const logs = [
  { ...A, in: at('2026-10-30T09:00:00'), out: at('2026-10-30T18:30:00'), status: 'done' },
  { ...A, in: at('2026-10-29T09:00:00'), out: null, status: 'noout' },
  { ...B, in: at('2026-10-30T10:00:00'), out: at('2026-10-30T11:00:00'), status: 'done', edits: { x: {} } },
];
const daily = { id: 'D2026-10-30', label: '2026-10-30', kind: 'daily', fromMs: at('2026-10-30T00:00:00'), toMs: at('2026-10-31T00:00:00') };
const weekly = { id: 'W2026-10-26', label: '2026-10-26 ~ 2026-11-01', kind: 'weekly', fromMs: at('2026-10-26T00:00:00'), toMs: at('2026-11-02T00:00:00') };
const monthly = { id: 'M2026-10', label: '2026-10', kind: 'monthly', fromMs: at('2026-10-01T00:00:00'), toMs: at('2026-11-01T00:00:00') };
const custom = { id: 'NOW', label: '2026-10-01 ~ 2026-10-20', kind: 'custom', fromMs: at('2026-10-01T00:00:00'), toMs: at('2026-10-21T00:00:00') };

async function book(period, list){
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildWorkbook({ name: '회사' }, list || logs, period));
  return wb;
}
const names = (wb) => wb.worksheets.map((s) => s.name);
const HEAD = 5;   /* 1~3줄 제목·기간·요약, 4줄 빈 줄 */

test('근태일지 시트: 제목·7열·시간순·비고', async () => {
  const s = (await book(custom)).getWorksheet('근태일지');
  assert.equal(s.getRow(1).getCell(1).value, '회사 근태일지');
  assert.equal(s.getRow(2).getCell(1).value, '기간: 2026-10-01 ~ 2026-10-20');
  assert.equal(s.getRow(3).getCell(1).value, '출근 인원 2명 · 총 근무시간 10시간 30분 · 퇴근 미기록 1건');
  assert.deepEqual(s.getRow(HEAD).values.slice(1), ['날짜', '이름', '휴대폰', '출근', '퇴근', '근무시간', '비고']);
  assert.equal(s.getRow(HEAD + 1).getCell(1).value, '2026-10-29');
  assert.equal(s.getRow(HEAD + 1).getCell(7).value, '퇴근 미기록');
  assert.equal(s.getRow(HEAD + 2).getCell(4).value, '09:00');
  assert.equal(s.getRow(HEAD + 2).getCell(5).value, '18:30');
  assert.equal(s.getRow(HEAD + 2).getCell(6).value, '9시간 30분');
  assert.equal(s.getRow(HEAD + 3).getCell(7).value, '수정됨');
});

test('근무 중인 기록은 비고에 표시', async () => {
  const s = (await book(custom, [{ ...A, in: at('2026-10-30T09:00:00'), out: null, status: 'open' }])).getWorksheet('근태일지');
  assert.equal(s.getRow(HEAD + 1).getCell(7).value, '근무 중');
});

test('이름이 수식처럼 생겨도 글자로 저장', async () => {
  const s = (await book(custom)).getWorksheet('근태일지');
  assert.equal(s.getRow(HEAD + 3).getCell(2).value, '=SUM(1)');
});

test('기간 지정은 근태일지와 사람별 합계', async () => {
  const wb = await book(custom);
  assert.deepEqual(names(wb), ['근태일지', '사람별 합계']);
  const s = wb.getWorksheet('사람별 합계');
  assert.deepEqual(s.getRow(HEAD).values.slice(1), ['이름', '휴대폰', '근무일수', '총 근무시간', '퇴근 미기록']);
  assert.deepEqual(s.getRow(HEAD + 2).values.slice(1), ['김민지', '01012345678', 2, '9시간 30분', 1]);
});

test('일간은 일간 근태일지 한 장', async () => {
  const wb = await book(daily);
  assert.deepEqual(names(wb), ['일간 근태일지']);
  assert.equal(wb.getWorksheet('일간 근태일지').getRow(1).getCell(1).value, '회사 일간 근태일지');
});

test('주간 근태표: 사람별 월~일 출퇴근과 합계', async () => {
  const wb = await book(weekly);
  assert.deepEqual(names(wb), ['주간 근태표', '근태일지']);
  const s = wb.getWorksheet('주간 근태표');
  assert.deepEqual(s.getRow(HEAD).values.slice(1), ['이름', '휴대폰', '10/26(월)', '10/27(화)', '10/28(수)', '10/29(목)', '10/30(금)', '10/31(토)', '11/1(일)', '근무일수', '총 근무시간', '퇴근 미기록']);
  const r = s.getRow(HEAD + 2).values.slice(1);   /* 이름순: =SUM(1), 김민지 */
  assert.equal(r[0], '김민지');
  assert.equal(r[5], '09:00~미기록');
  assert.equal(r[6], '09:00~18:30');
  assert.equal(r[9], 2);
  assert.equal(r[10], '9시간 30분');
  assert.equal(r[11], 1);
});

test('월간 근태표: 사람별 1일~말일 근무시간과 합계', async () => {
  const wb = await book(monthly);
  assert.deepEqual(names(wb), ['월간 근태표', '근태일지']);
  const s = wb.getWorksheet('월간 근태표');
  const h = s.getRow(HEAD).values.slice(1);
  assert.equal(h.length, 2 + 31 + 3);
  assert.equal(h[2], '1');
  assert.equal(h[32], '31');
  const r = s.getRow(HEAD + 2);
  assert.equal(r.getCell(3 + 28).value, '미');     /* 29일: 퇴근 미기록 */
  assert.equal(r.getCell(3 + 29).value, 9.5);      /* 30일: 9시간 30분 */
  assert.equal(r.getCell(3 + 31).value, 2);
  assert.equal(r.getCell(3 + 32).value, '9시간 30분');
});

test('2월 월간 근태표는 말일까지만', async () => {
  const feb = { id: 'M2026-02', label: '2026-02', kind: 'monthly', fromMs: at('2026-02-01T00:00:00'), toMs: at('2026-03-01T00:00:00') };
  const s = (await book(feb, [{ ...A, in: at('2026-02-03T09:00:00'), out: at('2026-02-03T10:00:00'), status: 'done' }])).getWorksheet('월간 근태표');
  assert.equal(s.getRow(HEAD).values.slice(1).length, 2 + 28 + 3);
});

test('메일 제목은 주기별, 회사명 이스케이프, 요약 포함', () => {
  const c = mailContent({ name: '<b>회사</b>' }, weekly, logs);
  assert.equal(c.subject, '[<b>회사</b>] 주간 근태표 2026-10-26 ~ 2026-11-01');
  assert.ok(c.html.includes('&lt;b&gt;회사'));
  assert.ok(!c.html.includes('<b>회사'));
  assert.ok(c.text.includes('10시간 30분'));
  assert.ok(c.text.includes('퇴근 미기록 1건'));
  assert.equal(mailContent({ name: '회사' }, daily, logs).subject, '[회사] 일간 근태일지 2026-10-30');
  assert.equal(mailContent({ name: '회사' }, monthly, logs).subject, '[회사] 월간 근태표 2026-10');
});

test('메일 본문 표: 일간은 출퇴근, 주·월간은 사람별 합계, 휴대폰번호 없음', () => {
  const d = mailContent({ name: '회사' }, daily, logs).html;
  assert.ok(d.includes('18:30'));
  const w = mailContent({ name: '회사' }, weekly, logs).html;
  assert.ok(w.includes('근무일수'));
  assert.ok(w.includes('9시간 30분'));
  assert.ok(!d.includes('5678') && !w.includes('5678'));
});

function fakeTransport(){
  const sent = [];
  return { sent, sendMail: async (m) => { sent.push(m); } };
}

test('받는 사람과 참조로 엑셀 첨부 발송', async () => {
  const t = fakeTransport();
  await sendReport(t, { name: '회사', mail: { to: ['a@b.kr', 'c@b.kr'], cc: ['d@b.kr'] } }, daily, logs);
  assert.deepEqual(t.sent[0].to, ['a@b.kr', 'c@b.kr']);
  assert.deepEqual(t.sent[0].cc, ['d@b.kr']);
  assert.ok(t.sent[0].attachments.some((a) => a.filename === '일간 근태일지_2026-10-30.xlsx'));
});

test('기록이 없으면 첨부 없이 「기록 없음」', async () => {
  const t = fakeTransport();
  await sendReport(t, { name: '회사', mail: { to: ['a@b.kr'] } }, daily, []);
  assert.ok(!t.sent[0].attachments.some((a) => a.filename.endsWith('.xlsx')));
  assert.ok(t.sent[0].text.includes('기록 없음'));
});

test('받는 사람이 없으면 오류', async () => {
  await assert.rejects(sendReport(fakeTransport(), { name: '회사', mail: { to: [] } }, daily, logs));
});

test('로고가 있으면 본문에 cid 로 포함', async () => {
  const t = fakeTransport();
  await sendReport(t, { name: '회사', logo: 'data:image/png;base64,AAAA', mail: { to: ['a@b.kr'] } }, daily, []);
  assert.ok(t.sent[0].html.includes('cid:qra-logo'));
  assert.equal(t.sent[0].attachments.find((a) => a.cid === 'qra-logo').content.length, 3);
});
