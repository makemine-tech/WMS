/* ===========================================================
   QR 출퇴근기록기 — 관리 함수와 예약 작업 (담당자·슈퍼관리자)
   기록 변경은 전부 여기서 하고 DB 규칙은 브라우저의 직접 쓰기를 막는다.
   로그에 이름·휴대폰번호를 남기지 않는다.
=========================================================== */
const crypto = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const { STALE_MS, normalizePhone, normalizeName, workerId, validateEdit, duePeriod, monthsInRange, monthsToPurge, monthOf, dayOf } = require('./logic');
const { buildWorkbook, sendReport } = require('./mail');

const KST = 9 * 3600e3;
const RETAIN_MS = 3 * 365.25 * 24 * 3600e3;
const KEY_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

function newKey(){
  return Array.from(crypto.randomBytes(24), (b) => KEY_CHARS[b % KEY_CHARS.length]).join('');
}
function mailError(e){
  if (e && e.code === 'EAUTH') return '메일 계정 인증에 실패했습니다';
  return '메일 발송에 실패했습니다: ' + String((e && e.message) || e).slice(0, 150);
}

/* mailer() → { transport, from } */
function makeAdmin(db, nowFn, mailer){
  const val = async (path) => (await db.ref(path).once('value')).val();
  const emailOf = (auth) => (auth && auth.token && auth.token.email) || '';

  async function isSuper(auth){ return !!(auth && auth.uid && await val('superadmins/' + auth.uid)); }

  async function canManage(auth, cid){
    if (!auth || !cid || !/^[A-Za-z0-9_-]{1,64}$/.test(String(cid))) return false;
    if (await isSuper(auth)) return true;
    if (!auth.token || auth.token.email_verified !== true || !auth.token.email) return false;
    const ekey = auth.token.email.toLowerCase().replace(/\./g, ',');
    return !!(await val('qra/admins/' + ekey + '/' + cid));
  }
  async function must(auth, cid){
    if (!await canManage(auth, cid)) throw new HttpsError('permission-denied', '이 고객사를 관리할 권한이 없습니다');
  }

  async function collectLogs(cid, fromMs, toMs){
    const out = [];
    for (const m of monthsInRange(fromMs, toMs)) {
      const logs = (await val('qra/logs/' + cid + '/' + m)) || {};
      Object.keys(logs).forEach((id) => { if (logs[id].in >= fromMs && logs[id].in < toMs) out.push(logs[id]); });
    }
    return out;
  }
  function checkRange(fromMs, toMs){
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) throw new HttpsError('invalid-argument', '기간을 다시 확인해 주세요');
  }

  async function createLog(d, auth, now){
    const phone = normalizePhone(d.create.phone);
    const name = normalizeName(d.create.name);
    if (!phone) throw new HttpsError('invalid-argument', '휴대폰번호를 다시 확인해 주세요');
    if (!name) throw new HttpsError('invalid-argument', '이름을 입력해 주세요');
    const chk = validateEdit({ inMs: d.inMs, outMs: d.outMs }, now);
    if (!chk.ok) throw new HttpsError('invalid-argument', chk.message);
    const wid = workerId(d.cid, phone);
    const month = monthOf(d.inMs);
    const logId = db.ref('qra/logs/' + d.cid).push().key;
    const up = {};
    const worker = await val('qra/workers/' + d.cid + '/' + wid);
    if (!worker) up['qra/workers/' + d.cid + '/' + wid] = { name, phone, at: now };
    up['qra/logs/' + d.cid + '/' + month + '/' + logId] = {
      wid, name: worker ? worker.name : name, phone, in: d.inMs, out: d.outMs == null ? null : d.outMs,
      status: d.outMs == null ? 'noout' : 'done', manual: true, by: emailOf(auth),
    };
    await db.ref().update(up);
    return { ok: true };
  }

  async function editLog(data, auth){
    const d = data || {};
    await must(auth, d.cid);
    const now = nowFn();
    if (d.create) return createLog(d, auth, now);

    if (!/^\d{4}-\d{2}$/.test(String(d.month)) || !/^[A-Za-z0-9_-]{1,40}$/.test(String(d.logId))) throw new HttpsError('invalid-argument', '기록을 찾을 수 없습니다');
    const path = 'qra/logs/' + d.cid + '/' + d.month + '/' + d.logId;
    const log = await val(path);
    if (!log) throw new HttpsError('not-found', '기록을 찾을 수 없습니다');
    const openPath = 'qra/open/' + d.cid + '/' + log.wid;
    const open = await val(openPath);
    const isOpen = !!(open && open.logId === d.logId);

    if (d.remove) {
      const up = { [path]: null };
      if (isOpen) up[openPath] = null;
      await db.ref().update(up);
      return { ok: true };
    }

    const chk = validateEdit({ inMs: d.inMs, outMs: d.outMs }, now);
    if (!chk.ok) throw new HttpsError('invalid-argument', chk.message);
    if (monthOf(d.inMs) !== d.month) throw new HttpsError('invalid-argument', '다른 달로 옮길 수 없습니다. 삭제 후 새로 추가해 주세요');

    const hasOut = d.outMs != null;
    const editId = db.ref(path + '/edits').push().key;
    const up = {
      [path + '/in']: d.inMs,
      [path + '/out']: hasOut ? d.outMs : null,
      [path + '/status']: hasOut ? 'done' : (isOpen ? 'open' : 'noout'),
      [path + '/edits/' + editId]: { at: now, by: emailOf(auth), in: log.in, out: log.out == null ? null : log.out },
    };
    if (isOpen) {
      if (hasOut) up[openPath] = { lastAt: now, lastType: 'out' };
      else up[openPath + '/in'] = d.inMs;
    }
    await db.ref().update(up);
    return { ok: true };
  }

  async function editWorker(data, auth){
    const d = data || {};
    await must(auth, d.cid);
    if (!/^[a-f0-9A-Z]{1,40}$/.test(String(d.wid))) throw new HttpsError('invalid-argument', '직원을 찾을 수 없습니다');
    const wpath = 'qra/workers/' + d.cid + '/' + d.wid;
    const worker = await val(wpath);
    if (!worker) throw new HttpsError('not-found', '직원을 찾을 수 없습니다');
    if (d.remove) {
      const up = { [wpath]: null };
      Object.keys(worker.tokens || {}).forEach((h) => { up['qra/tokens/' + d.cid + '/' + h] = null; });
      const open = await val('qra/open/' + d.cid + '/' + d.wid);
      if (open) {
        up['qra/open/' + d.cid + '/' + d.wid] = null;
        if (open.logId) up['qra/logs/' + d.cid + '/' + open.month + '/' + open.logId + '/status'] = 'noout';
      }
      await db.ref().update(up);
      return { ok: true };
    }
    const name = normalizeName(d.name);
    if (!name) throw new HttpsError('invalid-argument', '이름을 입력해 주세요');
    await db.ref(wpath).update({ name });
    return { ok: true };
  }

  async function rotateKey(data, auth){
    const cid = data && data.cid;
    if (!await isSuper(auth)) throw new HttpsError('permission-denied', '슈퍼관리자만 재발급할 수 있습니다');
    const old = await val('qra/companies/' + cid + '/qrKey');
    const qrKey = newKey();
    const up = { ['qra/keys/' + qrKey]: cid, ['qra/companies/' + cid + '/qrKey']: qrKey };
    if (old) up['qra/keys/' + old] = null;
    await db.ref().update(up);
    return { qrKey };
  }

  async function exportLogs(data, auth){
    const d = data || {};
    await must(auth, d.cid);
    checkRange(d.fromMs, d.toMs);
    const company = await val('qra/companies/' + d.cid);
    const buf = await buildWorkbook(company, await collectLogs(d.cid, d.fromMs, d.toMs));
    return { base64: buf.toString('base64'), filename: '근태일지_' + dayOf(d.fromMs) + '_' + dayOf(d.toMs - 1) + '.xlsx' };
  }

  async function recordMail(cid, period, ok, error, company, now){
    await db.ref('qra/mailLog/' + cid).push().set({ at: now, period: period.label, ok, error: error || null, to: (company.mail && company.mail.to) || [] });
  }

  async function sendNow(data, auth){
    const d = data || {};
    await must(auth, d.cid);
    checkRange(d.fromMs, d.toMs);
    const now = nowFn();
    const company = await val('qra/companies/' + d.cid);
    const label = dayOf(d.fromMs) === dayOf(d.toMs - 1) ? dayOf(d.fromMs) : dayOf(d.fromMs) + ' ~ ' + dayOf(d.toMs - 1);
    const period = { id: 'NOW', label };
    if (!company || !company.mail || !company.mail.to || !company.mail.to.length) throw new HttpsError('failed-precondition', '받는 사람을 먼저 저장해 주세요');
    const { transport, from } = mailer();
    try {
      await sendReport(transport, company, period, await collectLogs(d.cid, d.fromMs, d.toMs), from);
    } catch (e) {
      const msg = mailError(e);
      await recordMail(d.cid, period, false, msg, company, now);
      throw new HttpsError('internal', msg);
    }
    await recordMail(d.cid, period, true, null, company, now);
    return { ok: true };
  }

  /* 퇴근 없이 돌아오지 않은 사람의 기록이 계속 「근무 중」으로 남지 않게 닫는다 */
  async function closeStale(cid, now){
    const opens = (await val('qra/open/' + cid)) || {};
    const up = {};
    Object.keys(opens).forEach((wid) => {
      const o = opens[wid];
      if (!o.logId || now - o.in < STALE_MS) return;
      up['qra/logs/' + cid + '/' + o.month + '/' + o.logId + '/status'] = 'noout';
      up['qra/open/' + cid + '/' + wid] = { lastAt: o.lastAt, lastType: o.lastType };
    });
    if (Object.keys(up).length) await db.ref().update(up);
  }

  async function purge(cid, now){
    const up = {};
    monthsToPurge(monthsInRange(now - 4 * 366 * 24 * 3600e3, now), now).forEach((m) => { up['qra/logs/' + cid + '/' + m] = null; });
    const workers = (await val('qra/workers/' + cid)) || {};
    Object.keys(workers).forEach((wid) => {
      if (now - (workers[wid].lastAt || workers[wid].at || 0) <= RETAIN_MS) return;
      up['qra/workers/' + cid + '/' + wid] = null;
      up['qra/open/' + cid + '/' + wid] = null;
      Object.keys(workers[wid].tokens || {}).forEach((h) => { up['qra/tokens/' + cid + '/' + h] = null; });
    });
    const logs = (await val('qra/mailLog/' + cid)) || {};
    Object.keys(logs).forEach((id) => { if (now - logs[id].at > RETAIN_MS) up['qra/mailLog/' + cid + '/' + id] = null; });
    await db.ref().update(up);
  }

  async function mailOne(cid, company, now, getMailer){
    if (company.off) return;
    const mail = company.mail || {};
    const period = duePeriod(mail.freq, now);
    if (!period || mail.lastPeriod === period.id || !mail.to || !mail.to.length) return;
    try {
      const { transport, from } = getMailer();
      await sendReport(transport, company, period, await collectLogs(cid, period.fromMs, period.toMs), from);
      await db.ref('qra/companies/' + cid + '/mail').update({ lastPeriod: period.id, lastError: null });
      await recordMail(cid, period, true, null, company, now);
    } catch (e) {
      const msg = mailError(e);
      logger.error('qra 메일 실패', { cid, period: period.id, code: e && e.code });
      await db.ref('qra/companies/' + cid + '/mail').update({ lastError: msg });
      await recordMail(cid, period, false, msg, company, now);
    }
  }

  async function runTick(){
    const now = nowFn();
    const companies = (await val('qra/companies')) || {};
    const isPurgeHour = new Date(now + KST).getUTCHours() === 7;
    for (const cid of Object.keys(companies)) {
      try {
        await closeStale(cid, now);
        await mailOne(cid, companies[cid], now, mailer);
        if (isPurgeHour) await purge(cid, now);
      } catch (e) {
        logger.error('qra 예약 실패', { cid, message: String((e && e.message) || e).slice(0, 150) });
      }
    }
  }

  return { canManage, editLog, editWorker, rotateKey, exportLogs, sendNow, runTick };
}

module.exports = { makeAdmin };
