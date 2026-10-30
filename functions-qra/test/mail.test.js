const { test } = require('node:test');
const assert = require('node:assert');
const ExcelJS = require('exceljs');
const { buildWorkbook, mailContent, sendReport } = require('../mail');

const at = (s) => Date.parse(s + '+09:00');
const logs = [
  { wid: 'A', name: '김민지', phone: '01012345678', in: at('2026-10-30T09:00:00'), out: at('2026-10-30T18:30:00'), status: 'done' },
  { wid: 'A', name: '김민지', phone: '01012345678', in: at('2026-10-29T09:00:00'), out: null, status: 'noout' },
  { wid: 'B', name: '=SUM(1)', phone: '01099998888', in: at('2026-10-30T10:00:00'), out: at('2026-10-30T11:00:00'), status: 'done', edits: { x: {} } },
];
const period = { id: 'D2026-10-30', label: '2026-10-30' };

async function readBook(buf){
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

test('근태일지 시트: 7열·시간순·비고', async () => {
  const wb = await readBook(await buildWorkbook({ name: '회사' }, logs));
  const s = wb.getWorksheet('근태일지');
  assert.deepEqual(s.getRow(1).values.slice(1), ['날짜', '이름', '휴대폰', '출근', '퇴근', '근무시간', '비고']);
  assert.equal(s.getRow(2).getCell(1).value, '2026-10-29');
  assert.equal(s.getRow(2).getCell(7).value, '퇴근 미기록');
  assert.equal(s.getRow(3).getCell(4).value, '09:00');
  assert.equal(s.getRow(3).getCell(5).value, '18:30');
  assert.equal(s.getRow(3).getCell(6).value, '9시간 30분');
  assert.equal(s.getRow(4).getCell(7).value, '수정됨');
});

test('근무 중인 기록은 비고에 표시', async () => {
  const wb = await readBook(await buildWorkbook({ name: '회사' }, [{ wid: 'A', name: '가', phone: '1', in: at('2026-10-30T09:00:00'), out: null, status: 'open' }]));
  assert.equal(wb.getWorksheet('근태일지').getRow(2).getCell(7).value, '근무 중');
});

test('이름이 수식처럼 생겨도 글자로 저장', async () => {
  const wb = await readBook(await buildWorkbook({ name: '회사' }, logs));
  assert.equal(wb.getWorksheet('근태일지').getRow(4).getCell(2).value, '=SUM(1)');
});

test('사람별 합계 시트', async () => {
  const wb = await readBook(await buildWorkbook({ name: '회사' }, logs));
  const s = wb.getWorksheet('사람별 합계');
  assert.deepEqual(s.getRow(1).values.slice(1), ['이름', '휴대폰', '근무일수', '총 근무시간', '퇴근 미기록']);
  assert.deepEqual(s.getRow(2).values.slice(1), ['김민지', '01012345678', 2, '9시간 30분', 1]);
});

test('메일 본문: 회사명 이스케이프와 요약', () => {
  const c = mailContent({ name: '<b>회사</b>' }, period, { people: 2, totalMinutes: 630, noout: 1 });
  assert.equal(c.subject, '[<b>회사</b>] 근태일지 2026-10-30');
  assert.ok(c.html.includes('&lt;b&gt;회사'));
  assert.ok(!c.html.includes('<b>회사'));
  assert.ok(c.text.includes('10시간 30분'));
  assert.ok(c.text.includes('퇴근 미기록 1건'));
});

function fakeTransport(){
  const sent = [];
  return { sent, sendMail: async (m) => { sent.push(m); } };
}

test('받는 사람과 참조로 엑셀 첨부 발송', async () => {
  const t = fakeTransport();
  await sendReport(t, { name: '회사', mail: { to: ['a@b.kr', 'c@b.kr'], cc: ['d@b.kr'] } }, period, logs);
  assert.deepEqual(t.sent[0].to, ['a@b.kr', 'c@b.kr']);
  assert.deepEqual(t.sent[0].cc, ['d@b.kr']);
  assert.ok(t.sent[0].attachments.some((a) => a.filename.endsWith('.xlsx')));
});

test('기록이 없으면 첨부 없이 「기록 없음」', async () => {
  const t = fakeTransport();
  await sendReport(t, { name: '회사', mail: { to: ['a@b.kr'] } }, period, []);
  assert.ok(!t.sent[0].attachments.some((a) => a.filename.endsWith('.xlsx')));
  assert.ok(t.sent[0].text.includes('기록 없음'));
});

test('받는 사람이 없으면 오류', async () => {
  await assert.rejects(sendReport(fakeTransport(), { name: '회사', mail: { to: [] } }, period, logs));
});

test('로고가 있으면 본문에 cid 로 포함', async () => {
  const t = fakeTransport();
  await sendReport(t, { name: '회사', logo: 'data:image/png;base64,AAAA', mail: { to: ['a@b.kr'] } }, period, []);
  assert.ok(t.sent[0].html.includes('cid:qra-logo'));
  assert.equal(t.sent[0].attachments.find((a) => a.cid === 'qra-logo').content.length, 3);
});
