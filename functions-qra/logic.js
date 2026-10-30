/* ===========================================================
   QR 출퇴근기록기 — 순수 판단 로직 (DB·네트워크 없음, test/logic.test.js 로 시험)
   날짜 경계는 전부 한국 시간.
=========================================================== */
const crypto = require('crypto');

const STALE_MS = 18 * 3600e3;   /* 출근 후 이만큼 지나면 「퇴근 미기록」으로 닫음 */
const DUP_MS = 60000;           /* 이 안의 같은 요청은 한 번으로 침 */
const KST = 9 * 3600e3;
const DAY = 24 * 3600e3;
const RETAIN_MONTHS = 12;
const COMPANY_OFF_MESSAGE = '담당자에게 새 QR을 요청해 주세요';

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

function normalizePhone(s){
  let d = String(s || '').replace(/\D/g, '');
  if (d.startsWith('82')) d = '0' + d.slice(2);
  return /^01[016789]\d{7,8}$/.test(d) ? d : null;
}
function normalizeName(s){
  return String(s || '').replace(/[\u0000-\u001f\s]/g, '').slice(0, 20);
}
function workerId(cid, phone){ return sha256(cid + ':' + phone).slice(0, 24); }
function hashToken(t){ return sha256(t); }

function checkCompany(cid, company){
  if (!cid || !company || company.off) return { ok: false, message: COMPANY_OFF_MESSAGE };
  return { ok: true };
}

/* worker = 번호(또는 토큰)로 찾은 직원. 토큰만 왔는데 못 찾았으면 null */
function resolveIdentity(worker, { name, phone, token } = {}){
  if (worker && token && worker.tokens && worker.tokens[hashToken(token)]) return { result: 'token' };
  const p = normalizePhone(phone);
  if (!p) return { result: 'needPhone' };
  if (!worker) return { result: 'new' };
  if (worker.phone === p && worker.name === normalizeName(name)) return { result: 'match' };
  return { result: 'nameMismatch' };
}

function isLive(open, now){ return !!(open && open.logId && now - open.in < STALE_MS); }

function decidePunch(open, action, now){
  if (open && open.lastType === action && now - open.lastAt < DUP_MS) return { kind: 'dup', closeStale: false };
  const live = isLive(open, now);
  if (action === 'out') return { kind: live ? 'out' : 'stale', closeStale: false };
  if (live) return { kind: 'stale', closeStale: false };
  return { kind: 'in', closeStale: !!(open && open.logId) };
}
function nextAction(open, now){ return isLive(open, now) ? 'out' : 'in'; }

const kstIso = (ms) => new Date(ms + KST).toISOString();
function monthOf(ms){ return kstIso(ms).slice(0, 7); }
function dayOf(ms){ return kstIso(ms).slice(0, 10); }
const kstMidnight = (ms) => Math.floor((ms + KST) / DAY) * DAY - KST;
const kstDate = (y, m, d) => Date.UTC(y, m, d) - KST;

/* 오늘(now) 보내야 할 기간. 보낼 날이 아니면 null */
function duePeriod(freq, now){
  const today = kstMidnight(now);
  const d = new Date(today + KST);
  if (freq === 'daily'){
    const from = today - DAY;
    return { id: 'D' + dayOf(from), kind: 'daily', fromMs: from, toMs: today, label: dayOf(from) };
  }
  if (freq === 'weekly'){
    if (d.getUTCDay() !== 1) return null;
    const from = today - 7 * DAY;
    return { id: 'W' + dayOf(from), kind: 'weekly', fromMs: from, toMs: today, label: dayOf(from) + ' ~ ' + dayOf(today - DAY) };
  }
  if (freq === 'monthly'){
    if (d.getUTCDate() !== 1) return null;
    const from = kstDate(d.getUTCFullYear(), d.getUTCMonth() - 1, 1);
    return { id: 'M' + monthOf(from), kind: 'monthly', fromMs: from, toMs: today, label: monthOf(from) };
  }
  return null;
}

/* 직접 고른 기간의 보고서 양식 — 하루·이레·한 달(1일~말일)은 자동 메일과 같은 양식 */
function kindOf(fromMs, toMs){
  const days = Math.round((toMs - fromMs) / DAY);
  if (days === 1) return 'daily';
  if (days === 7) return 'weekly';
  if (dayOf(fromMs).endsWith('-01') && dayOf(toMs).endsWith('-01') && days >= 28 && days <= 31) return 'monthly';
  return 'custom';
}

/* toMs 는 기간에 포함되지 않음 */
function monthsInRange(fromMs, toMs){
  const out = [];
  const end = monthOf(toMs - 1);
  let m = monthOf(fromMs);
  while (m <= end){
    out.push(m);
    const [y, mm] = m.split('-').map(Number);
    m = monthOf(kstDate(y, mm, 1));
  }
  return out;
}

function monthsToPurge(months, now){
  const [y, m] = monthOf(now).split('-').map(Number);
  const cutoff = monthOf(kstDate(y, m - 1 - RETAIN_MONTHS, 1));
  return months.filter((x) => x < cutoff);
}

function validateEdit({ inMs, outMs } = {}, now){
  if (!Number.isFinite(inMs)) return { ok: false, message: '출근 시각을 입력해 주세요' };
  if (inMs > now) return { ok: false, message: '출근 시각이 현재보다 뒤입니다' };
  if (outMs != null){
    if (!Number.isFinite(outMs)) return { ok: false, message: '퇴근 시각이 올바르지 않습니다' };
    if (outMs < inMs) return { ok: false, message: '퇴근 시각이 출근 시각보다 앞입니다' };
    if (outMs > now) return { ok: false, message: '퇴근 시각이 현재보다 뒤입니다' };
  }
  return { ok: true };
}

function parseRecipients(input){
  const parts = Array.isArray(input) ? input : String(input || '').split(/[,;\n]/);
  const valid = [], invalid = [];
  parts.map((s) => String(s).trim()).filter(Boolean).forEach((s) => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) { invalid.push(s); return; }
    if (!valid.some((v) => v.toLowerCase() === s.toLowerCase())) valid.push(s);
  });
  return { valid, invalid };
}

function workMinutes(log){
  if (log.in == null || log.out == null) return null;
  return Math.round((log.out - log.in) / 60000);
}
function summarize(logs){
  const people = new Set();
  let totalMinutes = 0, noout = 0;
  logs.forEach((l) => {
    people.add(l.wid);
    totalMinutes += workMinutes(l) || 0;
    if (l.status === 'noout') noout++;
  });
  return { people: people.size, totalMinutes, noout };
}

module.exports = { STALE_MS, DUP_MS, COMPANY_OFF_MESSAGE, normalizePhone, normalizeName, workerId, hashToken, checkCompany, resolveIdentity,
  decidePunch, nextAction, monthOf, dayOf, duePeriod, kindOf, monthsInRange, monthsToPurge, validateEdit, parseRecipients, workMinutes, summarize };
