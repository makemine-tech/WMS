/* ===========================================================
   스마트스토어 매출 수집기 — 커머스API센터에 IP 를 등록한 컴퓨터에서 10분마다 (install.ps1 이 작업 스케줄러에 등록)
   어제·오늘 하루 매출을 네이버에서 받아 합친 뒤 광고 관제 받는 창구(functions-ads adsStoreIngest)로 보낸다.
   키는 run.ps1 이 이 컴퓨터에만 암호화해 둔 값을 환경변수로 넘겨 준다 (NAVER_COMMERCE_CLIENT_ID · NAVER_COMMERCE_CLIENT_SECRET).
=========================================================== */
const crypto = require('crypto');
const os = require('os');
const { makeStore, storeDays, kday, addDays } = require('./store');

const INGEST = 'https://asia-northeast3-makechango-wms.cloudfunctions.net/adsStoreIngest';
const ID = process.env.NAVER_COMMERCE_CLIENT_ID, SECRET = String(process.env.NAVER_COMMERCE_CLIENT_SECRET || '').replace(/[^\x21-\x7E]/g, '');

async function send(body) {
  const raw = JSON.stringify(body);
  const sign = crypto.createHmac('sha256', SECRET).update(body.ts + '.' + raw).digest('hex');
  const r = await fetch(INGEST, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Store-Sign': sign }, body: raw, signal: AbortSignal.timeout(30000) });
  const txt = await r.text();
  if (!r.ok) throw new Error('받는 창구 ' + r.status + ' ' + txt.slice(0, 200));
  return txt;
}

(async () => {
  const today = kday(), days = {};
  try {
    const api = makeStore(ID, SECRET);
    Object.assign(days, await storeDays(api, [addDays(today, -1), today]));   /* 어제 것도 다시 — 늦은 취소 반영 */
  } catch (e) {
    const err = String(e && e.message || e).slice(0, 300);
    console.error('네이버에서 받기 실패: ' + err);
    if (SECRET) await send({ ts: Date.now(), host: os.hostname(), err }).catch(() => {});
    process.exitCode = 1; return;   /* process.exit 은 윈도우에서 fetch 정리 중 죽음 */
  }
  const out = await send({ ts: Date.now(), host: os.hostname(), days });
  console.log(Object.keys(days).map((d) => d + ' ' + days[d].amt.toLocaleString('ko-KR') + '원 ' + days[d].n + '건').join(' · ') + ' → 보냄 ' + out);
})().catch((e) => { console.error(String(e && e.message || e)); process.exitCode = 1; });
