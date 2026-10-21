/* ===========================================================
   네이버 검색광고 API 클라이언트 (공식 예제 naver/searchad-apidoc 기준)
   인증 헤더: X-Timestamp(ms) · X-API-KEY(액세스라이선스) · X-Customer(고객 ID)
             X-Signature = base64( HMAC-SHA256(비밀키, "{timestamp}.{METHOD}.{uri}") )  — uri 는 쿼리 제외 경로
=========================================================== */
const crypto = require('crypto');

const BASE = 'https://api.searchad.naver.com';

function makeClient(apiKey, secret, customerId) {
  apiKey = String(apiKey || '').trim(); secret = String(secret || '').trim(); customerId = String(customerId || '').trim();
  if (!apiKey || !secret || !customerId) throw new Error('광고 API 키가 설정되지 않았습니다 (NAVER_SA_API_KEY · NAVER_SA_SECRET_KEY · NAVER_SA_CUSTOMER_ID)');

  function headers(method, uri) {
    const ts = String(Date.now());
    const sig = crypto.createHmac('sha256', secret).update(ts + '.' + method + '.' + uri).digest('base64');
    return { 'Content-Type': 'application/json; charset=UTF-8', 'X-Timestamp': ts, 'X-API-KEY': apiKey, 'X-Customer': customerId, 'X-Signature': sig };
  }

  /* query: { k: v | [v…] } — 배열은 같은 이름으로 여러 번 (공식 파이썬 예제의 ids=[…] 와 같은 방식) */
  async function req(method, uri, query, body) {
    const qs = new URLSearchParams();
    Object.keys(query || {}).forEach((k) => {
      const v = query[k];
      if (v === undefined || v === null) return;
      if (Array.isArray(v)) v.forEach((x) => qs.append(k, String(x)));
      else qs.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    });
    const url = BASE + uri + (qs.toString() ? '?' + qs.toString() : '');
    let last;
    for (let k = 0; k < 3; k++) {
      try {
        const r = await fetch(url, { method, headers: headers(method, uri), body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
        const txt = await r.text();
        let data = null; try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
        if (r.status === 429 || r.status >= 500) { last = new Error('네이버 ' + r.status + ' ' + String(txt).slice(0, 200)); await new Promise((s) => setTimeout(s, 700 * (k + 1))); continue; }
        if (!r.ok) {
          const msg = (data && (data.title || data.message || data.detail)) || String(txt).slice(0, 200);
          const e = new Error('네이버 ' + r.status + ' ' + uri + ' — ' + msg); e.status = r.status; e.data = data; throw e;
        }
        return data;
      } catch (e) {
        if (e.status) throw e;          /* 4xx — 다시 해도 같음 */
        last = e; await new Promise((s) => setTimeout(s, 700 * (k + 1)));
      }
    }
    throw last;
  }
  return {
    get: (uri, q) => req('GET', uri, q),
    put: (uri, q, body) => req('PUT', uri, q, body),
    post: (uri, q, body) => req('POST', uri, q, body),
  };
}

module.exports = { makeClient };
