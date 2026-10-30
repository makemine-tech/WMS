/* ===========================================================
   QR 출퇴근기록기 — 근태일지 엑셀과 메일 (관리 화면 내려받기와 자동 메일이 같은 양식을 씀)
=========================================================== */
const ExcelJS = require('exceljs');
const nodemailer = require('nodemailer');
const { dayOf, workMinutes, summarize } = require('./logic');

const KST = 9 * 3600e3;
const hhmm = (ms) => (ms == null ? '' : new Date(ms + KST).toISOString().slice(11, 16));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const oneLine = (s) => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ');

function hours(min){
  if (min == null) return '';
  return Math.floor(min / 60) + '시간 ' + (min % 60) + '분';
}

function remark(log){
  const r = [];
  if (log.status === 'noout') r.push('퇴근 미기록');
  if (log.status === 'open') r.push('근무 중');
  if (log.edits) r.push('수정됨');
  return r.join(', ');
}

function styleHeader(sheet, widths){
  sheet.columns = widths.map((width) => ({ width }));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

async function buildWorkbook(company, logs){
  const wb = new ExcelJS.Workbook();
  const sorted = logs.slice().sort((a, b) => a.in - b.in);

  const daily = wb.addWorksheet('근태일지');
  daily.addRow(['날짜', '이름', '휴대폰', '출근', '퇴근', '근무시간', '비고']);
  sorted.forEach((l) => daily.addRow([dayOf(l.in), l.name, l.phone, hhmm(l.in), hhmm(l.out), hours(workMinutes(l)), remark(l)]));
  styleHeader(daily, [12, 12, 15, 8, 8, 13, 20]);

  const byWorker = new Map();
  sorted.forEach((l) => {
    const p = byWorker.get(l.wid) || { name: l.name, phone: l.phone, days: new Set(), minutes: 0, noout: 0 };
    p.days.add(dayOf(l.in));
    p.minutes += workMinutes(l) || 0;
    if (l.status === 'noout') p.noout++;
    byWorker.set(l.wid, p);
  });
  const total = wb.addWorksheet('사람별 합계');
  total.addRow(['이름', '휴대폰', '근무일수', '총 근무시간', '퇴근 미기록']);
  byWorker.forEach((p) => total.addRow([p.name, p.phone, p.days.size, hours(p.minutes), p.noout]));
  styleHeader(total, [12, 15, 9, 13, 11]);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

function mailContent(company, period, summary){
  const name = oneLine(company.name);
  const logo = company.logo ? '<img src="cid:qra-logo" alt="" style="max-height:60px"><br>' : '';
  const lines = summary
    ? ['출근 인원 ' + summary.people + '명', '총 근무시간 ' + hours(summary.totalMinutes), '퇴근 미기록 ' + summary.noout + '건']
    : ['기록 없음'];
  return {
    subject: '[' + name + '] 근태일지 ' + period.label,
    text: name + ' 근태일지 ' + period.label + '\n\n' + lines.join('\n') + '\n',
    html: '<div style="font-family:sans-serif;font-size:14px;line-height:1.8">' + logo
      + '<div style="font-size:18px;font-weight:bold">' + esc(name) + '</div>'
      + '<div style="color:#666">근태일지 ' + esc(period.label) + '</div><p>'
      + lines.map(esc).join('<br>') + '</p></div>',
  };
}

function logoAttachment(company){
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/.exec(company.logo || '');
  if (!m) return null;
  return { filename: 'logo', cid: 'qra-logo', contentType: m[1], content: Buffer.from(m[2], 'base64') };
}

function makeTransport(user, pass){
  return nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
}

async function sendReport(transport, company, period, logs, from){
  const mail = company.mail || {};
  if (!mail.to || !mail.to.length) throw new Error('받는 사람이 없습니다');
  const c = mailContent(company, period, logs.length ? summarize(logs) : null);
  const attachments = [];
  const logo = logoAttachment(company);
  if (logo) attachments.push(logo);
  if (logs.length){
    attachments.push({ filename: '근태일지_' + period.label.replace(/\s/g, '') + '.xlsx', content: await buildWorkbook(company, logs) });
  }
  await transport.sendMail({ from, to: mail.to, cc: mail.cc || [], subject: c.subject, text: c.text, html: c.html, attachments });
}

module.exports = { buildWorkbook, mailContent, sendReport, makeTransport };
