/* ===========================================================
   스마트스토어 커머스 API 클라이언트 (조회만 — 주문 상태를 바꾸는 호출은 넣지 않음)
   인증: POST /external/v1/oauth2/token  (form-urlencoded, grant_type=client_credentials, type=SELF)
         client_secret_sign = base64( bcrypt(client_id + "_" + timestamp, client_secret) )
   커머스API센터에 등록한 「API 호출 IP」에서만 호출됨 → 이 함수는 고정 IP(Cloud NAT)로 나간다.
=========================================================== */
const bcrypt = require('bcryptjs');

const BASE = 'https://api.commerce.naver.com/external';

function makeStore(clientId, clientSecret) {
  clientId = String(clientId || '').trim(); clientSecret = String(clientSecret || '').trim();
  if (!clientId || !clientSecret) throw new Error('스토어 API 키가 설정되지 않았습니다 (NAVER_COMMERCE_CLIENT_ID · NAVER_COMMERCE_CLIENT_SECRET)');
  let token = null, tokenUntil = 0;

  async function getToken() {
    if (token && Date.now() < tokenUntil) return token;
    const ts = String(Date.now());
    const sign = Buffer.from(bcrypt.hashSync(clientId + '_' + ts, clientSecret), 'utf8').toString('base64');
    const body = new URLSearchParams({ client_id: clientId, timestamp: ts, grant_type: 'client_credentials', client_secret_sign: sign, type: 'SELF' });
    const r = await fetch(BASE + '/v1/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(), signal: AbortSignal.timeout(20000) });
    const txt = await r.text();
    let d = null; try { d = JSON.parse(txt); } catch (e) { /* 그대로 */ }
    if (!r.ok || !d || !d.access_token) throw new Error('스토어 인증 실패 ' + r.status + ' — ' + ((d && (d.message || d.code)) || txt.slice(0, 200)));
    token = d.access_token; tokenUntil = Date.now() + Math.max(60, (+d.expires_in || 3600) - 300) * 1000;
    return token;
  }

  async function req(method, uri, query, body) {
    const qs = new URLSearchParams();
    Object.keys(query || {}).forEach((k) => { if (query[k] != null) qs.append(k, String(query[k])); });
    const url = BASE + uri + (qs.toString() ? '?' + qs.toString() : '');
    let last;
    for (let k = 0; k < 4; k++) {
      const r = await fetch(url, { method, headers: { Authorization: 'Bearer ' + await getToken(), 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      const txt = await r.text();
      let d = null; try { d = txt ? JSON.parse(txt) : null; } catch (e) { d = txt; }
      if (r.status === 429 || r.status >= 500) { last = new Error('스토어 ' + r.status + ' ' + String(txt).slice(0, 200)); await new Promise((s) => setTimeout(s, 1000 * (k + 1))); continue; }
      if (r.status === 401 && k === 0) { token = null; continue; }
      if (!r.ok) throw new Error('스토어 ' + r.status + ' ' + uri + ' — ' + ((d && (d.message || d.code)) || String(txt).slice(0, 200)));
      return d;
    }
    throw last;
  }

  /* 결제(PAYED)가 [from, to) 안에 일어난 상품주문번호 — 한 번에 최대 24시간, 넘치면 more 로 이어 받음 */
  async function paidIds(fromIso, toIso) {
    const ids = new Set();
    let from = fromIso, seq;
    for (let n = 0; n < 50; n++) {
      const d = await req('GET', '/v1/pay-order/seller/product-orders/last-changed-statuses',
        { lastChangedFrom: from, lastChangedTo: toIso, lastChangedType: 'PAYED', moreSequence: seq });
      const data = (d && d.data) || {};
      (data.lastChangeStatuses || []).forEach((x) => ids.add(x.productOrderId));
      if (!data.more || !data.more.moreFrom) break;
      from = data.more.moreFrom; seq = data.more.moreSequence;
    }
    return Array.from(ids);
  }

  /* 상품주문 상세 — 300개씩 */
  async function details(ids) {
    const out = [];
    for (let i = 0; i < ids.length; i += 300) {
      const d = await req('POST', '/v1/pay-order/seller/product-orders/query', null, { productOrderIds: ids.slice(i, i + 300) });
      ((d && d.data) || []).forEach((x) => out.push(x));
    }
    return out;
  }

  return { paidIds, details };
}

module.exports = { makeStore };
