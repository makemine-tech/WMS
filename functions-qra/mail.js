/* ===========================================================
   QR 출퇴근기록기 — 근태 보고서 엑셀과 메일 (관리 화면 내려받기와 자동 메일이 같은 양식을 씀)
   양식은 기간 종류(period.kind)에 따라 다르다
     daily   일간 근태일지 : 그날 출퇴근 목록
     weekly  주간 근태표   : 사람별 월~일 출퇴근 + 합계 + 상세
     monthly 월간 근태표   : 사람별 1일~말일 근무시간 + 합계 + 상세
     custom  근태일지      : 기간 지정 목록 + 사람별 합계
=========================================================== */
const ExcelJS = require('exceljs');
const nodemailer = require('nodemailer');
const { dayOf, workMinutes, summarize } = require('./logic');

const KST = 9 * 3600e3;
const DAY = 24 * 3600e3;
const TITLES = { daily: '일간 근태일지', weekly: '주간 근태표', monthly: '월간 근태표', custom: '근태일지' };
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const HEAD_ROW = 5;

const hhmm = (ms) => (ms == null ? '' : new Date(ms + KST).toISOString().slice(11, 16));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const oneLine = (s) => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ');
const titleOf = (period) => TITLES[period && period.kind] || TITLES.custom;

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
function summaryLine(logs){
  if (!logs.length) return '기록 없음';
  const s = summarize(logs);
  return '출근 인원 ' + s.people + '명 · 총 근무시간 ' + hours(s.totalMinutes) + ' · 퇴근 미기록 ' + s.noout + '건';
}

/* 시트 머리: 1줄 제목, 2줄 기간, 3줄 요약, 5줄 표 머리 */
function addSheet(wb, name, company, period, logs, title, head, widths){
  const sheet = wb.addWorksheet(name);
  sheet.getCell('A1').value = oneLine(company.name) + ' ' + title;
  sheet.getCell('A1').font = { bold: true, size: 14 };
  sheet.getCell('A2').value = '기간: ' + period.label;
  sheet.getCell('A3').value = summaryLine(logs);
  head.forEach((h, i) => { sheet.getRow(HEAD_ROW).getCell(i + 1).value = h; });
  const row = sheet.getRow(HEAD_ROW);
  row.font = { bold: true };
  row.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  row.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8ECF3' } }; });
  sheet.columns.forEach(() => {});
  widths.forEach((w, i) => { sheet.getColumn(i + 1).width = w; });
  sheet.views = [{ state: 'frozen', ySplit: HEAD_ROW }];
  return sheet;
}

function byWorker(logs){
  const map = new Map();
  logs.slice().sort((a, b) => a.in - b.in).forEach((l) => {
    const p = map.get(l.wid) || { name: l.name, phone: l.phone, logs: [], days: new Set(), minutes: 0, noout: 0 };
    p.logs.push(l);
    p.days.add(dayOf(l.in));
    p.minutes += workMinutes(l) || 0;
    if (l.status === 'noout') p.noout++;
    map.set(l.wid, p);
  });
  return Array.from(map.values()).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'));
}
function daysOf(period){
  const out = [];
  for (let t = period.fromMs; t < period.toMs; t += DAY) out.push(t);
  return out;
}
const weekdayOf = (ms) => new Date(ms + KST).getUTCDay();

function addListSheet(wb, name, company, period, logs, title){
  const s = addSheet(wb, name, company, period, logs, title, ['날짜', '이름', '휴대폰', '출근', '퇴근', '근무시간', '비고'], [12, 12, 15, 8, 8, 13, 20]);
  logs.slice().sort((a, b) => a.in - b.in).forEach((l) => s.addRow([dayOf(l.in), l.name, l.phone, hhmm(l.in), hhmm(l.out), hours(workMinutes(l)), remark(l)]));
}

function addWeeklySheet(wb, company, period, logs){
  const days = daysOf(period);
  const label = (t) => { const d = new Date(t + KST); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '(' + WEEK[d.getUTCDay()] + ')'; };
  const s = addSheet(wb, TITLES.weekly, company, period, logs, TITLES.weekly,
    ['이름', '휴대폰'].concat(days.map(label), ['근무일수', '총 근무시간', '퇴근 미기록']),
    [12, 15].concat(days.map(() => 13), [9, 13, 11]));
  byWorker(logs).forEach((p) => {
    const cells = days.map((t) => p.logs.filter((l) => dayOf(l.in) === dayOf(t)).map((l) => hhmm(l.in) + '~' + (l.out != null ? hhmm(l.out) : (l.status === 'open' ? '근무 중' : '미기록'))).join('\n'));
    const r = s.addRow([p.name, p.phone].concat(cells, [p.days.size, hours(p.minutes), p.noout]));
    r.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
}

function addMonthlySheet(wb, company, period, logs){
  const days = daysOf(period);
  const s = addSheet(wb, TITLES.monthly, company, period, logs, TITLES.monthly,
    ['이름', '휴대폰'].concat(days.map((t) => String(new Date(t + KST).getUTCDate())), ['근무일수', '총 근무시간', '퇴근 미기록']),
    [12, 15].concat(days.map(() => 5), [9, 13, 11]));
  days.forEach((t, i) => {
    const w = weekdayOf(t);
    if (w === 0 || w === 6) s.getRow(HEAD_ROW).getCell(3 + i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: w === 0 ? 'FFF8D7DA' : 'FFD6E4F5' } };
  });
  byWorker(logs).forEach((p) => {
    const cells = days.map((t) => {
      const list = p.logs.filter((l) => dayOf(l.in) === dayOf(t));
      if (!list.length) return '';
      const min = list.reduce((sum, l) => sum + (workMinutes(l) || 0), 0);
      if (!min) return list.some((l) => l.status === 'open') ? '중' : '미';
      return Math.round(min / 6) / 10;   /* 시간 단위, 소수 첫째 자리 */
    });
    const r = s.addRow([p.name, p.phone].concat(cells, [p.days.size, hours(p.minutes), p.noout]));
    r.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  s.addRow([]);
  s.addRow(['숫자는 그날 근무시간(시간), 미 = 퇴근 미기록, 중 = 근무 중']);
}

function addTotalSheet(wb, company, period, logs){
  const s = addSheet(wb, '사람별 합계', company, period, logs, '사람별 합계', ['이름', '휴대폰', '근무일수', '총 근무시간', '퇴근 미기록'], [12, 15, 9, 13, 11]);
  byWorker(logs).forEach((p) => s.addRow([p.name, p.phone, p.days.size, hours(p.minutes), p.noout]));
}

async function buildWorkbook(company, logs, period){
  const wb = new ExcelJS.Workbook();
  const kind = period.kind;
  if (kind === 'daily') addListSheet(wb, TITLES.daily, company, period, logs, TITLES.daily);
  else if (kind === 'weekly') { addWeeklySheet(wb, company, period, logs); addListSheet(wb, TITLES.custom, company, period, logs, TITLES.custom); }
  else if (kind === 'monthly') { addMonthlySheet(wb, company, period, logs); addListSheet(wb, TITLES.custom, company, period, logs, TITLES.custom); }
  else { addListSheet(wb, TITLES.custom, company, period, logs, TITLES.custom); addTotalSheet(wb, company, period, logs); }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* 메일 본문 표 — 휴대폰번호는 넣지 않는다(엑셀에만) */
function bodyTable(period, logs){
  const th = (t) => '<th style="text-align:left;padding:6px 10px;background:#f1f3f7;border-bottom:1px solid #d5dae3;font-size:13px">' + t + '</th>';
  const td = (t) => '<td style="padding:6px 10px;border-bottom:1px solid #e6e9ef;font-size:13px">' + esc(t) + '</td>';
  const table = (head, rows) => '<table style="border-collapse:collapse;margin-top:10px"><tr>' + head.map(th).join('') + '</tr>' + rows.map((r) => '<tr>' + r.map(td).join('') + '</tr>').join('') + '</table>';
  if (period.kind === 'daily') {
    const list = logs.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko') || a.in - b.in);
    return table(['이름', '출근', '퇴근', '근무시간', '비고'], list.map((l) => [l.name, hhmm(l.in), hhmm(l.out), hours(workMinutes(l)), remark(l)]));
  }
  return table(['이름', '근무일수', '총 근무시간', '퇴근 미기록'], byWorker(logs).map((p) => [p.name, p.days.size + '일', hours(p.minutes), p.noout + '건']));
}

function mailContent(company, period, logs){
  const name = oneLine(company.name);
  const title = titleOf(period);
  const logo = company.logo ? '<img src="cid:qra-logo" alt="" style="max-height:60px"><br>' : '';
  const s = logs.length ? summarize(logs) : null;
  const lines = s
    ? ['출근 인원 ' + s.people + '명', '총 근무시간 ' + hours(s.totalMinutes), '퇴근 미기록 ' + s.noout + '건']
    : ['기록 없음'];
  return {
    subject: '[' + name + '] ' + title + ' ' + period.label,
    text: name + ' ' + title + ' ' + period.label + '\n\n' + lines.join('\n') + '\n' + (s ? '\n자세한 내용은 첨부한 엑셀 파일을 확인해 주세요.\n' : ''),
    html: '<div style="font-family:sans-serif;font-size:14px;line-height:1.8;color:#1c2331">' + logo
      + '<div style="font-size:18px;font-weight:bold">' + esc(name) + '</div>'
      + '<div style="color:#666">' + esc(title) + ' · ' + esc(period.label) + '</div><p style="margin:12px 0 0">'
      + lines.map(esc).join(' &nbsp;|&nbsp; ') + '</p>'
      + (s ? bodyTable(period, logs) + '<p style="color:#666;font-size:13px;margin-top:12px">자세한 내용은 첨부한 엑셀 파일을 확인해 주세요.</p>' : '')
      + '</div>',
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
  const c = mailContent(company, period, logs);
  const attachments = [];
  const logo = logoAttachment(company);
  if (logo) attachments.push(logo);
  if (logs.length){
    attachments.push({ filename: titleOf(period) + '_' + period.label.replace(/\s/g, '') + '.xlsx', content: await buildWorkbook(company, logs, period) });
  }
  await transport.sendMail({ from, to: mail.to, cc: mail.cc || [], subject: c.subject, text: c.text, html: c.html, attachments });
}

module.exports = { buildWorkbook, mailContent, sendReport, makeTransport, TITLES };
