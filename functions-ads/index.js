/* ===========================================================
   WMS 광고 관제 — 네이버 검색광고 API (대표님 2026-10-21)

   목적: 시즌 상품(빼빼로 만들기) 쇼핑검색광고를 30분마다 수집해서
        광고 관제 화면(main/ad_control.html)에서 시간대별 성과를 보고 입찰가를 바로 바꾼다.
        1단계 = 수집 + 보기 + 승인 후 적용. 자동 조정·AI 보고·스마트스토어 주문 연결은 이 데이터 위에 붙인다.

   비밀값 (Secret Manager — 코드·DB 에 남지 않음):
     firebase functions:secrets:set NAVER_SA_API_KEY      (액세스라이선스)
     firebase functions:secrets:set NAVER_SA_SECRET_KEY   (비밀키)
     firebase functions:secrets:set NAVER_SA_CUSTOMER_ID  (고객 ID 숫자)

   함수 (서울 asia-northeast3)
     adsCollect      30분마다 자동 수집 (한국시간)
     adsCollectNow   화면의 「지금 새로 받기」 — 슈퍼관리자
     adsSetBid       입찰가 변경 { kind:'ad'|'adgroup'|'keyword', id, bid, reason } — 슈퍼관리자
     adsSetLock      켜기/끄기  { kind, id, lock:true|false, reason } — 슈퍼관리자

   DB (adctl/ — 읽기는 슈퍼관리자, 쓰기는 이 함수만. config·sales 만 화면에서 씀)
     adctl/struct              캠페인·광고그룹·소재(상품)·키워드 이름/입찰가/상태 (매 수집 덮어씀)
     adctl/snap/{날짜}/{HHmm}  { ts, s:{ id:[노출,클릭,광고비,전환수,평균순위×10,전환매출] } }  — 오늘 누적, 차이로 시간당 변화
     adctl/hour/{날짜}/{캠페인} { HH:[노출,클릭,광고비,전환수] }  — 네이버 시간대 분할(hh24)
     adctl/day/{날짜}          { id:[…] }  — 지난 날 최종 (최근 7일 채움)
     adctl/status              마지막 수집 결과
     adctl/log/{push}          입찰·켜기끄기 변경 기록 (누가·언제·전→후·이유)
     adctl/config              화면 설정 (객단가·마진율·목표 광고비율·최고 입찰가·시즌 시작일)
     adctl/sales/{날짜}        스토어 매출 — 지금은 화면에서 수동 입력(src:'manual'),
                               스마트스토어 커머스 API 연결되면 같은 자리에 시간대별로 채움(src:'store', h:{HH:금액})
   날짜·시각은 모두 한국시간(KST).
=========================================================== */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { makeClient } = require('./naver');
if (!admin.apps.length) admin.initializeApp();

const REGION = 'asia-northeast3';
const SA_KEY = defineSecret('NAVER_SA_API_KEY');
const SA_SECRET = defineSecret('NAVER_SA_SECRET_KEY');
const SA_CUSTOMER = defineSecret('NAVER_SA_CUSTOMER_ID');
const SECRETS = [SA_KEY, SA_SECRET, SA_CUSTOMER];
const OPTS = { region: REGION, secrets: SECRETS, timeoutSeconds: 300, memory: '256MiB' };

const BASE_FIELDS = ['impCnt', 'clkCnt', 'salesAmt', 'ccnt', 'avgRnk'];
const DEFAULT_MAX_BID = 3000;

function db() { return admin.database(); }
function client() { return makeClient(SA_KEY.value(), SA_SECRET.value(), SA_CUSTOMER.value()); }
function kst(t) { return new Date((t || Date.now()) + 9 * 3600e3); }
function kday(t) { return kst(t).toISOString().slice(0, 10); }
function addDays(d, n) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
function clean(o) { return JSON.parse(JSON.stringify(o === undefined ? null : o)); }

async function pool(list, n, fn) {
  const out = new Array(list.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (i < list.length) { const k = i++; out[k] = await fn(list[k], k); }
  }));
  return out;
}

async function requireSuper(req) {
  const uid = req.auth && req.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다');
  const sa = await db().ref('superadmins/' + uid).once('value');
  if (!sa.exists()) throw new HttpsError('permission-denied', '슈퍼관리자만 쓸 수 있습니다');
  return { uid, email: (req.auth.token && req.auth.token.email) || '' };
}

/* ── 구조 읽기 ─────────────────────────────────────────── */
function adInfo(a) {
  const rd = a.referenceData || {}, ad = a.ad || {}, at = a.adAttr || {};
  return clean({
    gid: a.nccAdgroupId, type: a.type || '',
    name: rd.productName || ad.productName || ad.headline || a.referenceKey || a.nccAdId,
    img: rd.imageUrl || rd.mobileImageUrl || null,
    price: rd.lowPrice || rd.mobileLowPrice || null,
    mallId: rd.mallProductId || null,
    bid: at.bidAmt != null ? at.bidAmt : null,
    useGroupBid: at.useGroupBidAmt != null ? !!at.useGroupBidAmt : null,
    lock: !!a.userLock, status: a.status || '', inspect: a.inspectStatus || ''
  });
}

async function readStruct(api) {
  const camps = (await api.get('/ncc/campaigns')) || [];
  const groups = (await api.get('/ncc/adgroups')) || [];
  const S = { campaigns: {}, adgroups: {}, ads: {}, keywords: {} };
  camps.forEach((c) => {
    S.campaigns[c.nccCampaignId] = clean({ name: c.name, tp: c.campaignTp || '', lock: !!c.userLock, status: c.status || '',
      budget: c.useDailyBudget ? c.dailyBudget : null });
  });
  groups.forEach((g) => {
    S.adgroups[g.nccAdgroupId] = clean({ cid: g.nccCampaignId, name: g.name, tp: g.adgroupType || '', bid: g.bidAmt, lock: !!g.userLock,
      status: g.status || '', budget: g.useDailyBudget ? g.dailyBudget : null });
  });
  await pool(groups, 4, async (g) => {
    const ads = (await api.get('/ncc/ads', { nccAdgroupId: g.nccAdgroupId })) || [];
    ads.forEach((a) => { S.ads[a.nccAdId] = adInfo(a); });
    if (String(g.adgroupType || '').toUpperCase() !== 'SHOPPING') {   /* 쇼핑검색은 키워드 대신 상품 소재 입찰 */
      try {
        const kws = (await api.get('/ncc/keywords', { nccAdgroupId: g.nccAdgroupId })) || [];
        kws.forEach((k) => {
          S.keywords[k.nccKeywordId] = clean({ gid: g.nccAdgroupId, kw: k.keyword, bid: k.bidAmt, useGroupBid: !!k.useGroupBidAmt,
            lock: !!k.userLock, status: k.status || '' });
        });
      } catch (e) { logger.warn('keywords 읽기 실패', { gid: g.nccAdgroupId, e: e.message }); }
    }
  });
  return S;
}

/* ── 통계 ─────────────────────────────────────────────── */
let FIELDS = BASE_FIELDS.concat(['convAmt']);   /* convAmt(전환매출)를 못 받는 계정이면 처음 실패 때 빼고 다시 */
function pack(x) {
  return [+x.impCnt || 0, +x.clkCnt || 0, +x.salesAmt || 0, +x.ccnt || 0, Math.round((+x.avgRnk || 0) * 10), +x.convAmt || 0];
}
/* idGroups: [[캠페인 id…], [광고그룹 id…], …] — 네이버는 한 번에 같은 종류의 ID만 받는다
   (섞으면 400 「모든 ID는 동일한 타입이어야 합니다」, 2026-10-22 첫 수집) */
async function statsSummary(api, idGroups, since, until) {
  const out = {};
  for (const ids of idGroups) {
    for (let i = 0; i < ids.length; i += 50) {
      const part = ids.slice(i, i + 50);
      const ask = () => api.get('/stats', { ids: part, fields: JSON.stringify(FIELDS), timeRange: JSON.stringify({ since, until }) });
      let res;
      try { res = await ask(); }
      catch (e) {
        if (e.status !== 400 || FIELDS.indexOf('convAmt') < 0) throw e;
        const keep = FIELDS; FIELDS = BASE_FIELDS.slice();       /* 전환매출을 못 받는 계정일 수 있어 빼고 한 번 더 */
        try { res = await ask(); } catch (e2) { FIELDS = keep; throw e2; }
      }
      ((res && res.data) || []).forEach((x) => { if (x && x.id) out[x.id] = pack(x); });
    }
  }
  return out;
}
/* 캠페인별 시간대(0~23시) 분할 — 시간대 성과 분석용 */
async function statsHourly(api, id, since, until) {
  const res = await api.get('/stats', { id, fields: JSON.stringify(BASE_FIELDS), timeRange: JSON.stringify({ since, until }), timeIncrement: 'allDays', breakdown: 'hh24' });
  const h = {};
  const rows = (res && res.data) || (res && res.summaryStat && res.summaryStat.data) || [];
  rows.forEach((r) => (r.breakdowns || []).forEach((b) => {
    const hh = String(parseInt(b.name, 10)).padStart(2, '0');
    if (hh === 'NaN') return;
    h[hh] = [+b.impCnt || 0, +b.clkCnt || 0, +b.salesAmt || 0, +b.ccnt || 0];
  }));
  return h;
}

function allIds(S) {
  return [Object.keys(S.campaigns), Object.keys(S.adgroups), Object.keys(S.ads), Object.keys(S.keywords)].filter((a) => a.length);
}

/* ── 수집 1회 ─────────────────────────────────────────── */
async function collect(trigger) {
  const t0 = Date.now(), api = client();
  const today = kday(t0), hm = kst(t0).toISOString().slice(11, 16).replace(':', '');
  const S = await readStruct(api);
  const ids = allIds(S);
  const s = await statsSummary(api, ids, today, today);
  const hours = {};
  await pool(Object.keys(S.campaigns), 3, async (cid) => {
    try { hours[cid] = await statsHourly(api, cid, today, today); } catch (e) { logger.warn('hh24 실패', { cid, e: e.message }); }
  });
  const up = {};
  up['adctl/struct'] = Object.assign({ ts: t0 }, S);
  up['adctl/snap/' + today + '/' + hm] = { ts: t0, s };
  Object.keys(hours).forEach((cid) => { up['adctl/hour/' + today + '/' + cid] = hours[cid]; });

  /* 지난 7일 최종값 채우기 — 비어 있는 날만, 한 번에 2일씩 (처음 배포 후 몇 번 돌면 다 찬다) */
  const have = (await db().ref('adctl/dayIdx').once('value')).val() || {};
  const need = [];
  for (let k = 1; k <= 7; k++) { const d = addDays(today, -k); if (!have[d]) need.push(d); }
  for (const d of need.slice(0, 2)) {
    try {
      up['adctl/day/' + d] = await statsSummary(api, ids, d, d);
      for (const cid of Object.keys(S.campaigns)) {
        try { up['adctl/hour/' + d + '/' + cid] = await statsHourly(api, cid, d, d); } catch (e) {}
      }
      up['adctl/dayIdx/' + d] = true;
    } catch (e) { logger.warn('지난날 채우기 실패', { d, e: e.message }); }
  }
  const status = { ts: t0, ok: true, trigger, ms: Date.now() - t0,
    n: { campaigns: Object.keys(S.campaigns).length, adgroups: Object.keys(S.adgroups).length, ads: Object.keys(S.ads).length, keywords: Object.keys(S.keywords).length },
    fields: FIELDS };
  up['adctl/status'] = status;
  await db().ref().update(clean(up));
  /* 스냅샷은 14일만 보관 */
  const old = addDays(today, -14);
  const snapDays = (await db().ref('adctl/snap').orderByKey().endAt(old).limitToFirst(10).once('value')).val() || {};
  await Promise.all(Object.keys(snapDays).map((d) => db().ref('adctl/snap/' + d).remove()));
  logger.info('adsCollect', status);
  return status;
}

async function collectSafe(trigger) {
  try { return await collect(trigger); }
  catch (e) {
    const st = { ts: Date.now(), ok: false, trigger, err: String(e && e.message || e).slice(0, 400) };
    await db().ref('adctl/status').update(st).catch(() => {});
    logger.error('adsCollect 실패', st);
    return st;
  }
}

exports.adsCollect = onSchedule(Object.assign({ schedule: 'every 30 minutes', timeZone: 'Asia/Seoul' }, OPTS), async () => { await collectSafe('schedule'); });

exports.adsCollectNow = onCall(OPTS, async (req) => {
  await requireSuper(req);
  const st = await collectSafe('manual');
  if (!st.ok) throw new HttpsError('internal', st.err || '수집 실패');
  return st;
});

/* ── 변경 (입찰가 · 켜기/끄기) ─────────────────────────── */
const PATH = { ad: '/ncc/ads/', adgroup: '/ncc/adgroups/', keyword: '/ncc/keywords/' };
const NODE = { ad: 'ads', adgroup: 'adgroups', keyword: 'keywords' };

async function writeLog(who, o) {
  await db().ref('adctl/log').push(clean(Object.assign({ t: Date.now(), by: who.email || who.uid }, o)));
}

exports.adsSetBid = onCall(OPTS, async (req) => {
  const who = await requireSuper(req);
  const d = req.data || {}, kind = d.kind, id = String(d.id || '');
  if (!PATH[kind] || !id) throw new HttpsError('invalid-argument', '대상이 올바르지 않습니다');
  const cfg = (await db().ref('adctl/config').once('value')).val() || {};
  const maxBid = +cfg.maxBid || DEFAULT_MAX_BID;
  let bid = Math.round((+d.bid || 0) / 10) * 10;
  if (!(bid >= 50)) throw new HttpsError('invalid-argument', '입찰가는 50원 이상이어야 합니다');
  if (bid > maxBid) throw new HttpsError('failed-precondition', '최고 입찰가(' + maxBid + '원)를 넘습니다 — 설정에서 최고 입찰가를 올리세요');
  const api = client();
  const cur = await api.get(PATH[kind] + id);
  let from = null, saved;
  try {
    if (kind === 'ad') {
      from = cur.adAttr ? cur.adAttr.bidAmt : null;
      cur.adAttr = Object.assign({}, cur.adAttr || {}, { bidAmt: bid, useGroupBidAmt: false });
      saved = await api.put(PATH.ad + id, { fields: 'adAttr' }, cur);
    } else if (kind === 'adgroup') {
      from = cur.bidAmt; cur.bidAmt = bid;
      saved = await api.put(PATH.adgroup + id, { fields: 'bidAmt' }, cur);
    } else {
      from = cur.bidAmt; cur.bidAmt = bid; cur.useGroupBidAmt = false;
      saved = await api.put('/ncc/keywords', { fields: 'bidAmt' }, [cur]);
      if (Array.isArray(saved)) saved = saved[0];
    }
  } catch (e) {
    await writeLog(who, { kind, id, act: 'bid', from, to: bid, reason: d.reason || '', ok: false, err: String(e.message).slice(0, 300) });
    throw new HttpsError('internal', e.message);
  }
  const now = kind === 'ad' ? (saved && saved.adAttr ? saved.adAttr.bidAmt : bid) : (saved && saved.bidAmt != null ? saved.bidAmt : bid);
  const upd = { bid: now }; if (kind !== 'adgroup') upd.useGroupBid = false;
  await db().ref('adctl/struct/' + NODE[kind] + '/' + id).update(upd);
  await writeLog(who, { kind, id, act: 'bid', from, to: now, reason: d.reason || '', ok: true });
  return { ok: true, from, to: now };
});

exports.adsSetLock = onCall(OPTS, async (req) => {
  const who = await requireSuper(req);
  const d = req.data || {}, kind = d.kind, id = String(d.id || ''), lock = !!d.lock;
  if (!PATH[kind] || !id) throw new HttpsError('invalid-argument', '대상이 올바르지 않습니다');
  const api = client();
  const cur = await api.get(PATH[kind] + id);
  const from = !!cur.userLock; cur.userLock = lock;
  try {
    if (kind === 'keyword') await api.put('/ncc/keywords', { fields: 'userLock' }, [cur]);
    else await api.put(PATH[kind] + id, { fields: 'userLock' }, cur);
  } catch (e) {
    await writeLog(who, { kind, id, act: 'lock', from, to: lock, reason: d.reason || '', ok: false, err: String(e.message).slice(0, 300) });
    throw new HttpsError('internal', e.message);
  }
  await db().ref('adctl/struct/' + NODE[kind] + '/' + id).update({ lock });
  await writeLog(who, { kind, id, act: 'lock', from, to: lock, reason: d.reason || '', ok: true });
  return { ok: true, lock };
});
