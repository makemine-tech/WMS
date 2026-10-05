/* ===========================================================
   정산관리 — 반품비 역추적 (대표님 2026-10-05)
   박스앤캔 택배비 「반품」 시트의 반품 등기번호 → 우체국 배송조회(공개 페이지) 맨 아래
   「반품원등기번호:6077486468911 (2026-07-27)」 = 원송장 → 정산관리 화면이 이벗 주문목록에서 고객사를 찾음.

   브라우저는 우체국 페이지를 직접 못 읽어서(다른 사이트) 이 함수가 대신 조회한다.
   호출: firebase.app().functions('asia-northeast3').httpsCallable('epostReturnOrigin')
     입력  { nos: ['7077480532049', …] }  (한 번에 최대 40개)
     출력  { ok, rows: [{ no, orig, origDate, sender, recvDate, result, err }] }
   슈퍼관리자만. 서울 지역(asia-northeast3) — 싱가포르에선 우체국이 응답 안 함(2026-10-05 시간 초과). 동시 5개, 한 건 15초 제한.
=========================================================== */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp();

const MAX = 15;   /* 한 번 호출에 15건 — 화면이 나눠서 여러 번 부름 */
const URL = 'https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?displayHeader=N&sid1=';

function text(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(td|th|tr|p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*/g, '\n');
}

async function get(url) {   /* 첫 연결이 가끔 끊김(2026-10-05 서울 첫 호출 fetch failed) → 2번까지 다시 */
  let last;
  for (let k = 0; k < 3; k++) { try { return await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 (makewon WMS settlement)', 'Accept-Language': 'ko' } }); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 800 * (k + 1))); } }
  throw last;
}
async function lookup(no) {
  const out = { no };
  try {
    const r = await get(URL + encodeURIComponent(no));
    if (!r.ok) { out.err = 'http ' + r.status; return out; }
    const t = text(await r.text());
    const m = t.match(/반품\s*원\s*등기번호\s*[:：]?\s*(\d{10,15})(?:\s*\(?\s*(\d{4}-\d{2}-\d{2})\s*\)?)?/);
    if (m) { out.orig = m[1]; if (m[2]) out.origDate = m[2]; }
    /* 기본정보 줄: 등기번호 보내는분 접수일 받는분 수령인 배달일 … 배달결과 */
    const b = t.match(new RegExp(no + '\\s*\\n?\\s*([^\\n]*?)\\s*\\n?\\s*(\\d{4}\\.\\d{2}\\.\\d{2})'));
    if (b) { out.sender = b[1].trim().slice(0, 30); }
    const done = t.match(/(\d{4}\.\d{2}\.\d{2})\s+\d{2}:\d{2}\s+\S+\s+배달완료/);
    if (done) out.recvDate = done[1].replace(/\./g, '-');
    if (/배달완료/.test(t)) out.result = '배달완료'; else if (/조회.*없|존재하지/.test(t)) out.result = '조회 없음';
  } catch (e) { out.err = String((e && e.cause && (e.cause.code || e.cause.message)) || (e && e.message) || e).slice(0, 120); }
  return out;
}

exports.epostReturnOrigin = onCall({ region: 'asia-northeast3', timeoutSeconds: 300, memory: '256MiB' }, async (req) => {
  const uid = req.auth && req.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다');
  const sa = await admin.database().ref('superadmins/' + uid).once('value');
  if (!sa.exists()) throw new HttpsError('permission-denied', '슈퍼관리자만 쓸 수 있습니다');
  const nos = [...new Set(((req.data && req.data.nos) || []).map((x) => String(x).replace(/\D/g, '')).filter((x) => x.length >= 10 && x.length <= 15))].slice(0, MAX);
  const rows = [];
  for (let i = 0; i < nos.length; i += 5) {
    const part = await Promise.all(nos.slice(i, i + 5).map(lookup));
    rows.push(...part);
  }
  logger.info('epostReturnOrigin', { n: nos.length, found: rows.filter((r) => r.orig).length });
  return { ok: true, rows };
});

