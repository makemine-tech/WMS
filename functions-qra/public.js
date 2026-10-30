/* ===========================================================
   QR 출퇴근기록기 — 직원 폰 화면이 부르는 공개 함수 (로그인 없음)
   DB 를 받아 동작하게 만들어 시험에서는 메모리 DB 를 넣는다. 실제 연결은 index.js.
   로그에 이름·휴대폰번호를 남기지 않는다.
=========================================================== */
const crypto = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { normalizePhone, normalizeName, workerId, hashToken, checkCompany, resolveIdentity, decidePunch, nextAction, monthOf } = require('./logic');

const CONSENT_VER = 1;
const RATE_LIMIT = 120;       /* 주소당 분당 호출 — 같은 와이파이의 출근 몰림을 막지 않을 만큼 */
const RATE_WINDOW = 60000;

/* 프록시 뒤에서는 req.ip 가 프록시 주소일 수 있어 전달 헤더를 먼저 본다 (호출 제한용, 위조돼도 제한만 느슨해짐) */
function clientIp(req){
  const fwd = req && req.headers && req.headers['x-forwarded-for'];
  const first = fwd ? String(fwd).split(',')[0].trim() : '';
  return first || (req && req.ip) || 'unknown';
}

function makeHandlers(db, nowFn){
  const hits = new Map();

  function rateCheck(ip){
    const now = nowFn();
    if (hits.size > 5000) hits.clear();
    const h = hits.get(ip);
    if (!h || now - h.at >= RATE_WINDOW) { hits.set(ip, { at: now, n: 1 }); return; }
    if (++h.n > RATE_LIMIT) throw new HttpsError('resource-exhausted', '잠시 후 다시 시도해 주세요');
  }

  const val = async (path) => (await db.ref(path).once('value')).val();

  async function openCompany(key){
    const k = String(key || '');
    const cid = /^[A-Za-z0-9]{16,64}$/.test(k) ? await val('qra/keys/' + k) : null;
    const company = cid ? await val('qra/companies/' + cid) : null;
    const chk = checkCompany(cid, company);
    if (!chk.ok) throw new HttpsError('permission-denied', chk.message);
    return { cid, company };
  }

  async function widFromToken(cid, token){
    if (!token || typeof token !== 'string') return null;
    return val('qra/tokens/' + cid + '/' + hashToken(token));
  }

  async function myRecords(cid, wid, now){
    const snap = await db.ref('qra/logs/' + cid + '/' + monthOf(now)).orderByChild('wid').equalTo(wid).once('value');
    return Object.values(snap.val() || {})
      .sort((a, b) => b.in - a.in)
      .map((l) => ({ in: l.in, out: l.out || null, status: l.status }));
  }

  async function info(data, ctx){
    rateCheck(ctx.ip);
    const now = nowFn();
    const { cid, company } = await openCompany(data && data.key);
    const res = { company: { name: company.name, site: company.site || '', logo: company.logo || '' }, consentVer: CONSENT_VER, me: null };
    const wid = await widFromToken(cid, data && data.token);
    const worker = wid ? await val('qra/workers/' + cid + '/' + wid) : null;
    if (worker) {
      const open = await val('qra/open/' + cid + '/' + wid);
      res.me = { name: worker.name, next: nextAction(open, now), records: await myRecords(cid, wid, now) };
    }
    return res;
  }

  async function punch(data, ctx){
    rateCheck(ctx.ip);
    const now = nowFn();
    const d = data || {};
    const action = d.action === 'out' ? 'out' : 'in';
    const { cid } = await openCompany(d.key);

    const typed = d.phone != null && String(d.phone).trim() !== '';
    const phone = normalizePhone(d.phone);
    if (typed && !phone) throw new HttpsError('invalid-argument', '휴대폰번호를 다시 확인해 주세요');
    const wid = phone ? workerId(cid, phone) : await widFromToken(cid, d.token);
    const worker = wid ? await val('qra/workers/' + cid + '/' + wid) : null;

    const who = resolveIdentity(worker, { name: d.name, phone, token: d.token }).result;
    if (who === 'needPhone') return { needPhone: true };
    if (who === 'nameMismatch') throw new HttpsError('failed-precondition', '등록된 정보와 다릅니다. 담당자에게 문의해 주세요');
    const name = who === 'new' ? normalizeName(d.name) : worker.name;
    if (!name) throw new HttpsError('invalid-argument', '이름을 입력해 주세요');
    const oldConsent = !worker || !(worker.consentVer >= CONSENT_VER);
    if (oldConsent && d.agree !== true) return { needConsent: true };

    /* 첫 실행은 캐시 없이 null 로 돌 수 있어, 쓰기 없는 경우에도 받은 값을 그대로 돌려줘 서버 값으로 다시 돌게 한다 */
    const logId = db.ref('qra/logs/' + cid).push().key;
    const month = monthOf(now);
    let prev = null, decision = null;
    await db.ref('qra/open/' + cid + '/' + wid).transaction((cur) => {
      prev = cur; decision = decidePunch(cur, action, now);
      if (decision.kind === 'in') return { logId, month, in: now, lastAt: now, lastType: 'in' };
      if (decision.kind === 'out') return { lastAt: now, lastType: 'out' };
      return cur;
    });

    const dev = d.dev ? hashToken(String(d.dev).slice(0, 64)).slice(0, 12) : null;
    const up = {};
    const L = 'qra/logs/' + cid + '/';
    if (decision.kind === 'in') {
      up[L + month + '/' + logId] = { wid, name, phone: worker ? worker.phone : phone, in: now, out: null, inDev: dev, status: 'open' };
      if (decision.closeStale) up[L + prev.month + '/' + prev.logId + '/status'] = 'noout';
    }
    if (decision.kind === 'out') {
      const base = L + prev.month + '/' + prev.logId + '/';
      up[base + 'out'] = now; up[base + 'outDev'] = dev; up[base + 'status'] = 'done';
    }

    const W = 'qra/workers/' + cid + '/' + wid + '/';
    if (!worker) { up[W + 'name'] = name; up[W + 'phone'] = phone; up[W + 'at'] = now; }
    if (oldConsent) { up[W + 'consentAt'] = now; up[W + 'consentVer'] = CONSENT_VER; }
    up[W + 'lastAt'] = now;
    let token;
    if (who !== 'token') {
      token = crypto.randomBytes(32).toString('base64url');
      const th = hashToken(token);
      up[W + 'tokens/' + th] = { at: now };
      up['qra/tokens/' + cid + '/' + th] = wid;
    }
    try {
      await db.ref().update(up);
    } catch (e) {
      /* 기록이 저장되지 않았으면 근무 상태도 되돌려 직원이 다시 누를 수 있게 한다 */
      if (decision.kind === 'in' || decision.kind === 'out') await db.ref('qra/open/' + cid + '/' + wid).set(prev);
      throw e;
    }

    const open = await val('qra/open/' + cid + '/' + wid);
    return { kind: decision.kind, at: now, next: nextAction(open, now), name, token, records: await myRecords(cid, wid, now) };
  }

  return { info, punch };
}

module.exports = { makeHandlers, clientIp, CONSENT_VER };
