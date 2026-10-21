/* ===========================================================
   WMS 광고 관제 — 네이버 검색광고 API (대표님 2026-10-21)

   목적: 시즌 상품(빼빼로 만들기) 쇼핑검색광고를 30분마다 수집해서
        광고 관제 화면(main/ad_control.html)에서 시간대별 성과를 보고 입찰가를 바로 바꾼다.
        1단계 = 수집 + 보기 + 승인 후 적용. 자동 조정·AI 보고·스마트스토어 주문 연결은 이 데이터 위에 붙인다.

   비밀값 (Secret Manager — 코드·DB 에 남지 않음):
     firebase functions:secrets:set NAVER_SA_API_KEY      (액세스라이선스)
     firebase functions:secrets:set NAVER_SA_SECRET_KEY   (비밀키)
     firebase functions:secrets:set NAVER_SA_CUSTOMER_ID  (고객 ID 숫자)
     값을 바꾸면 함수를 다시 배포해야 새 값을 쓴다 (배포 때의 버전을 물고 있음).

   함수 (서울 asia-northeast3)
     adsCollect      30분마다 자동 수집 (한국시간) + 목표 순위 추적
     adsCollectNow   화면의 「지금 새로 받기」 — 슈퍼관리자
     adsSetBid       입찰가 변경 { kind:'ad'|'adgroup'|'keyword', id, bid, reason } — 손으로 정하면 그 대상의 목표 순위 추적은 꺼짐
     adsSetLock      켜기/끄기  { kind, id, lock:true|false, reason }
     adsSetTarget    목표 순위  { kind:'ad'|'keyword', id, dev:'mo'|'pc', rank:1~15 | null(해제), cap } — 바로 한 번 맞추고 30분마다 추적

   DB (adctl/ — 읽기는 슈퍼관리자, 쓰기는 이 함수만. config·sales 만 화면에서 씀)
     adctl/struct              캠페인·광고그룹·소재(상품)·키워드 이름/입찰가/상태/품질지수(qi) (매 수집 덮어씀)
     adctl/snap/{날짜}/{HHmm}  { ts, s:{ id:[노출,클릭,광고비,전환수,평균순위×10,전환매출] } }  — 오늘 누적, 차이로 시간당 변화
     adctl/hour/{날짜}/{캠페인} { HH:[노출,클릭,광고비,전환수] }  — 네이버 시간대 분할(hh24)
     adctl/day/{날짜}          { id:[…] }  — 지난 날 최종 (최근 7일 채움)
     adctl/rank                { ts, id:{ pc:[평균순위,노출,클릭], mo:[…], d7:오늘 노출 없어 7일 값 } }  — 집행 중인 상품·키워드만
     adctl/target/{id}         목표 순위 (adsSetTarget)
     adctl/status              마지막 수집 결과
     adctl/log/{push}          입찰·켜기끄기·목표 변경 기록 (누가·언제·전→후·이유, 자동 추적은 by:'auto')
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
function qiOf(x) { return x && x.nccQi && x.nccQi.qiGrade != null ? x.nccQi.qiGrade : null; }   /* 품질지수 1~7칸 */
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
    lock: !!a.userLock, status: a.status || '', inspect: a.inspectStatus || '', qi: qiOf(a)
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
      status: g.status || '', budget: g.useDailyBudget ? g.dailyBudget : null,
      pcW: g.pcNetworkBidWeight != null ? g.pcNetworkBidWeight : null, moW: g.mobileNetworkBidWeight != null ? g.mobileNetworkBidWeight : null });
  });
  await pool(groups, 4, async (g) => {
    const ads = (await api.get('/ncc/ads', { nccAdgroupId: g.nccAdgroupId })) || [];
    ads.forEach((a) => { S.ads[a.nccAdId] = adInfo(a); });
    if (String(g.adgroupType || '').toUpperCase() !== 'SHOPPING') {   /* 쇼핑검색은 키워드 대신 상품 소재 입찰 */
      try {
        const kws = (await api.get('/ncc/keywords', { nccAdgroupId: g.nccAdgroupId })) || [];
        kws.forEach((k) => {
          S.keywords[k.nccKeywordId] = clean({ gid: g.nccAdgroupId, kw: k.keyword, bid: k.bidAmt, useGroupBid: !!k.useGroupBidAmt,
            lock: !!k.userLock, status: k.status || '', qi: qiOf(k) });
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
/* 기기별(PC/모바일) 평균 노출순위 — breakdown 이름이 'PC' / '모바일'. 오늘 노출이 없으면 최근 7일로 (d7:true) */
async function statsDevice(api, id) {
  const one = async (q) => {
    const res = await api.get('/stats', Object.assign({ id, fields: JSON.stringify(['impCnt', 'clkCnt', 'avgRnk']), timeIncrement: 'allDays', breakdown: 'pcMblTp' }, q));
    const out = {};
    ((((res && res.data) || [])[0] || {}).breakdowns || []).forEach((b) => {
      const k = /PC/i.test(b.name) ? 'pc' : 'mo';
      out[k] = [Math.round((+b.avgRnk || 0) * 10) / 10, +b.impCnt || 0, +b.clkCnt || 0];
    });
    return out;
  };
  let r = await one({ datePreset: 'today' });
  if (!r.pc && !r.mo) { r = await one({ datePreset: 'last7days' }); if (r.pc || r.mo) r.d7 = true; }
  return r;
}

/* 지금 실제로 집행(노출 가능) 중인가 — 캠페인·광고그룹·소재(키워드) 모두 ELIGIBLE 이고 끄기 아님 (화면과 같은 기준).
   꺼졌어도 오늘 노출이 있었던 건 포함 */
function eligible(x) { return x && !x.lock && String(x.status || '').toUpperCase() === 'ELIGIBLE'; }
function runningIds(S, s) {
  const gOk = (gid) => { const g = S.adgroups[gid]; return eligible(g) && eligible(S.campaigns[g.cid]); };
  const seen = (id) => s[id] && s[id][0] > 0;
  const out = [];
  Object.keys(S.ads).forEach((id) => { const a = S.ads[id]; if (/SHOPPING/i.test(a.type) && ((gOk(a.gid) && eligible(a)) || seen(id))) out.push(id); });
  Object.keys(S.keywords).forEach((id) => { const k = S.keywords[id]; if ((gOk(k.gid) && eligible(k)) || seen(id)) out.push(id); });
  return out;
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
  /* 집행 중인 상품·키워드의 PC/모바일 순위 */
  const rank = {};
  await pool(runningIds(S, s), 4, async (id) => {
    try { rank[id] = await statsDevice(api, id); } catch (e) { logger.warn('기기별 순위 실패', { id, e: e.message }); }
  });
  const up = {};
  up['adctl/struct'] = Object.assign({ ts: t0 }, S);
  up['adctl/snap/' + today + '/' + hm] = { ts: t0, s };
  up['adctl/rank'] = Object.assign({ ts: t0 }, rank);
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
  await db().ref().update(clean(up));

  /* 목표 순위 추적 — 대표님이 「반영」으로 정해 둔 것만 */
  let track = 0;
  try { track = await applyTargets(api, S, rank); } catch (e) { logger.warn('목표 순위 추적 실패', { e: e.message }); }

  const status = { ts: t0, ok: true, trigger, ms: Date.now() - t0, track,
    n: { campaigns: Object.keys(S.campaigns).length, adgroups: Object.keys(S.adgroups).length, ads: Object.keys(S.ads).length,
      keywords: Object.keys(S.keywords).length, ranked: Object.keys(rank).length },
    fields: FIELDS };
  await db().ref('adctl/status').set(clean(status));
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
async function maxBidCfg() { const cfg = (await db().ref('adctl/config').once('value')).val() || {}; return +cfg.maxBid || DEFAULT_MAX_BID; }

/* 네이버에 입찰가 쓰기 — 화면의 수동 변경과 목표 순위 추적이 같이 쓴다 */
async function putBid(api, kind, id, bid) {
  const cur = await api.get(PATH[kind] + id);
  let from = null, saved;
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
  const to = kind === 'ad' ? (saved && saved.adAttr ? saved.adAttr.bidAmt : bid) : (saved && saved.bidAmt != null ? saved.bidAmt : bid);
  const upd = { bid: to }; if (kind !== 'adgroup') upd.useGroupBid = false;
  await db().ref('adctl/struct/' + NODE[kind] + '/' + id).update(upd);
  return { from, to };
}

exports.adsSetBid = onCall(OPTS, async (req) => {
  const who = await requireSuper(req);
  const d = req.data || {}, kind = d.kind, id = String(d.id || '');
  if (!PATH[kind] || !id) throw new HttpsError('invalid-argument', '대상이 올바르지 않습니다');
  const maxBid = await maxBidCfg();
  const bid = Math.round((+d.bid || 0) / 10) * 10;
  if (!(bid >= 50)) throw new HttpsError('invalid-argument', '입찰가는 50원 이상이어야 합니다');
  if (kind === 'keyword' && bid < 70) throw new HttpsError('invalid-argument', '파워링크 키워드 입찰가는 70원 이상이어야 합니다');
  if (bid > maxBid) throw new HttpsError('failed-precondition', '최고 입찰가(' + maxBid + '원)를 넘습니다 — 설정에서 최고 입찰가를 올리세요');
  /* 손으로 금액을 정하면 그 대상의 목표 순위 추적은 끈다 (다음 수집 때 덮어쓰지 않게) */
  const had = (await db().ref('adctl/target/' + id).once('value')).exists();
  if (had) await db().ref('adctl/target/' + id).remove();
  let r;
  try { r = await putBid(client(), kind, id, bid); }
  catch (e) {
    await writeLog(who, { kind, id, act: 'bid', to: bid, reason: d.reason || '', ok: false, err: String(e.message).slice(0, 300) });
    throw new HttpsError('internal', e.message);
  }
  await writeLog(who, { kind, id, act: 'bid', from: r.from, to: r.to, reason: (d.reason || '') + (had ? ' (목표 순위 추적 해제)' : ''), ok: true });
  return { ok: true, from: r.from, to: r.to, targetCleared: had };
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

/* ── 목표 순위 추적 ──────────────────────────────────────
   adctl/target/{id} = { kind:'ad'|'keyword', dev:'mo'|'pc', rank, cap, by, ts, lastAdj, note, chk }
   파워링크 키워드: 네이버 「순위별 예상 입찰가」(estimate/average-position-bid/id) 로 그 순위 금액을 바로 맞춘다.
     경쟁이 바뀌면 30분마다 다시 맞춤 (5% 넘게 달라질 때만).
   쇼핑 상품: 네이버가 쇼핑 소재의 순위별 입찰가는 비워서 준다(2026-10-22 확인) → 30분마다 실제 순위를 보고 조금씩 조정.
     목표보다 밀림 → +10% (2위 넘게 밀리면 +20%), 오늘 그 기기 노출 없음 → +15%, 목표보다 0.7위 넘게 위 → −7%.
     한 번 바꾼 뒤 55분은 기다렸다가 다시 본다 (오늘 평균 순위가 따라오는 시간).
   상한 = min(목표의 상한, 설정 최고 입찰가). 상한에 닿으면 더 올리지 않고 note 에 남긴다. */
const DEV = { mo: 'MOBILE', pc: 'PC' };
async function estimateBid(api, id, dev, rank) {
  const r = await api.post('/estimate/average-position-bid/id', {}, { device: DEV[dev], items: [{ key: id, position: rank }] });
  const e = r && r.estimate && r.estimate[0];
  return e && e.bid ? +e.bid : null;
}
function curBid(S, kind, id) {
  const x = kind === 'ad' ? (S.ads || {})[id] : (S.keywords || {})[id]; if (!x) return null;
  const g = (S.adgroups || {})[x.gid] || {};
  return x.useGroupBid ? g.bid : x.bid;
}
async function trackOne(api, S, rank, id, T, maxBid, now) {
  const cap = Math.min(+T.cap || maxBid, maxBid);
  const bid = curBid(S, T.kind, id);
  if (bid == null) return { id, skip: 'no-bid' };
  let want = null, why = '';
  if (T.kind === 'keyword') {
    const est = await estimateBid(api, id, T.dev, T.rank);
    if (!est) { await db().ref('adctl/target/' + id).update({ note: '네이버 예상 입찰가를 못 받음', chk: now }); return { id, skip: 'no-estimate' }; }
    /* 예상 입찰가 흐름 — 경쟁(비딩)이 세지는지 화면 경고등이 본다: est0 = 목표 건 뒤 첫 값, estDay = 오늘 첫 값 */
    const today = kday(now), eu = { est, estTs: now, estPrev: T.est != null ? T.est : est };
    if (T.est0 == null) eu.est0 = est;
    if (T.estDayD !== today) { eu.estDayD = today; eu.estDay = est; }
    await db().ref('adctl/target/' + id).update(eu); Object.assign(T, eu);
    /* 광고그룹의 기기별 입찰 가중치(%)가 걸려 있으면 실제 입찰 = 입찰가 × 가중치 — 그만큼 나눠서 맞춘다 */
    const g = (S.adgroups || {})[((S.keywords || {})[id] || {}).gid] || {};
    const w = +(T.dev === 'pc' ? g.pcW : g.moW) || 100;
    want = est * 100 / w; why = '예상 입찰가 ' + est + '원' + (w !== 100 ? ' (가중치 ' + w + '%)' : '');
  } else {
    if (now - (+T.lastAdj || 0) < 55 * 60e3) return { id, skip: 'wait' };
    const RR = rank[id] || {}, R = RR[T.dev];
    /* 오늘 그 기기 노출이 있으면 오늘 순위, 없으면 최근 7일 순위로 판단 (2026-10-22: 새벽 1시 「오늘 노출 없음」으로 밤새 올라갈 뻔함) */
    const rk = R && R[1] > 0 ? R[0] : null, src = RR.d7 ? '최근 7일 ' : '현재 ';
    const hh = kst(now).getUTCHours();
    if (rk == null) {
      if (hh < 8) { await db().ref('adctl/target/' + id).update({ note: '새벽이라 노출이 적어 아침까지 기다림', chk: now }); return { id, skip: 'night' }; }
      if (now - (+T.lastAdj || 0) < 2 * 3600e3) { await db().ref('adctl/target/' + id).update({ note: '노출 기록 없음 — 2시간 지켜본 뒤 올림', chk: now }); return { id, skip: 'wait-noimp' }; }
      want = bid * 1.1; why = '노출 기록 없음';
    }
    else if (rk > T.rank + 0.5) { want = bid * (rk - T.rank > 2 ? 1.2 : 1.1); why = src + rk + '위'; }
    else if (rk < T.rank - 0.7) { want = bid * 0.93; why = src + rk + '위'; }
    else { await db().ref('adctl/target/' + id).update({ note: '목표 근처 (' + src + rk + '위)', chk: now }); return { id, skip: 'on-target', rk }; }
  }
  const raw = Math.round(want / 10) * 10;
  const minBid = T.kind === 'keyword' ? 70 : 50;   /* 파워링크 최소 입찰가 70원 (50원 보내면 400 Invalid value), 쇼핑 50원 */
  const to = Math.max(minBid, Math.min(cap, raw)), atCap = raw > cap;
  if (to === bid || (Math.abs(to - bid) < Math.max(10, bid * 0.05) && !(atCap && bid < cap))) {
    await db().ref('adctl/target/' + id).update({ note: atCap ? '상한 ' + cap + '원에 닿음 — 목표 순위가 안 나오면 상한을 올리세요' : '목표 근처 · ' + why, chk: now });
    return { id, skip: 'small', atCap };
  }
  const r = await putBid(api, T.kind, id, to);
  await db().ref('adctl/target/' + id).update({ lastAdj: now, chk: now, note: (atCap ? '상한 ' + cap + '원까지만 · ' : '') + why });
  await writeLog({ email: 'auto' }, { kind: T.kind, id, act: 'bid', from: r.from, to: r.to,
    reason: '목표 ' + (T.dev === 'pc' ? 'PC' : '모바일') + ' ' + T.rank + '위 추적 · ' + why, ok: true, auto: true });
  return { id, from: r.from, to: r.to, atCap };
}
async function applyTargets(api, S, rank) {
  const all = (await db().ref('adctl/target').once('value')).val() || {};
  const ids = Object.keys(all); if (!ids.length) return 0;
  const maxBid = await maxBidCfg(), now = Date.now(); let n = 0;
  for (const id of ids) {
    try { const r = await trackOne(api, S, rank, id, all[id], maxBid, now); if (r.to != null) n++; }
    catch (e) { logger.warn('추적 실패', { id, e: e.message }); await db().ref('adctl/target/' + id).update({ note: '오류: ' + String(e.message).slice(0, 120), chk: now }); }
  }
  return n;
}

/* 여러 개 한 번에 — 파워링크 키워드 일괄 { kind:'keyword', ids:[…], dev, rank:1~15 | null(일괄 해제), cap }
   하나씩과 같은 규칙(trackOne)으로 바로 맞춘다. 최대 100개. */
exports.adsSetTargetBulk = onCall(OPTS, async (req) => {
  const who = await requireSuper(req);
  const d = req.data || {}, kind = d.kind;
  const ids = [...new Set((d.ids || []).map(String).filter(Boolean))].slice(0, 100);
  if (!(kind === 'ad' || kind === 'keyword') || !ids.length) throw new HttpsError('invalid-argument', '대상이 없습니다');
  if (d.rank == null || d.rank === '') {
    const up = {}; ids.forEach((id) => { up['adctl/target/' + id] = null; });
    await db().ref().update(up);
    await writeLog(who, { kind, id: ids[0], ids, act: 'target', to: null, reason: '목표 순위 일괄 해제 · ' + ids.length + '개', ok: true, bulk: ids.length });
    return { ok: true, cleared: ids.length };
  }
  const rank = Math.round(+d.rank), dev = d.dev === 'pc' ? 'pc' : 'mo';
  if (!(rank >= 1 && rank <= 15)) throw new HttpsError('invalid-argument', '목표 순위는 1~15위');
  const maxBid = await maxBidCfg();
  const cap = d.cap ? Math.max(50, Math.min(Math.round(+d.cap / 10) * 10, maxBid)) : maxBid;
  const now = Date.now(), T = { kind, dev, rank, cap, by: who.email || who.uid, ts: now, lastAdj: 0 };
  const up = {}; ids.forEach((id) => { up['adctl/target/' + id] = T; });
  await db().ref().update(up);
  await writeLog(who, { kind, id: ids[0], ids, act: 'target', to: rank, bulk: ids.length,
    reason: '목표 ' + (dev === 'pc' ? 'PC' : '모바일') + ' ' + rank + '위 일괄 · ' + ids.length + '개 · 상한 ' + cap + '원', ok: true });
  const api = client();
  const S = (await db().ref('adctl/struct').once('value')).val() || {};
  const rk = (await db().ref('adctl/rank').once('value')).val() || {};
  const res = await pool(ids, 3, async (id) => {
    try { return await trackOne(api, S, rk, id, T, maxBid, now); }
    catch (e) { await db().ref('adctl/target/' + id).update({ note: '오류: ' + String(e.message).slice(0, 120) }); return { id, err: e.message }; }
  });
  return { ok: true, n: ids.length, changed: res.filter((r) => r && r.to != null).length,
    capped: res.filter((r) => r && r.atCap).length, failed: res.filter((r) => r && (r.err || r.skip === 'no-estimate')).length };
});

exports.adsSetTarget = onCall(OPTS, async (req) => {
  const who = await requireSuper(req);
  const d = req.data || {}, kind = d.kind, id = String(d.id || '');
  if (!(kind === 'ad' || kind === 'keyword') || !id) throw new HttpsError('invalid-argument', '대상이 올바르지 않습니다');
  if (d.rank == null || d.rank === '') {
    await db().ref('adctl/target/' + id).remove();
    await writeLog(who, { kind, id, act: 'target', to: null, reason: '목표 순위 해제', ok: true });
    return { ok: true, cleared: true };
  }
  const rank = Math.round(+d.rank), dev = d.dev === 'pc' ? 'pc' : 'mo';
  if (!(rank >= 1 && rank <= 15)) throw new HttpsError('invalid-argument', '목표 순위는 1~15위');
  const maxBid = await maxBidCfg();
  const cap = d.cap ? Math.max(50, Math.min(Math.round(+d.cap / 10) * 10, maxBid)) : maxBid;
  const T = { kind, dev, rank, cap, by: who.email || who.uid, ts: Date.now(), lastAdj: 0 };
  await db().ref('adctl/target/' + id).set(T);
  await writeLog(who, { kind, id, act: 'target', to: rank, reason: '목표 ' + (dev === 'pc' ? 'PC' : '모바일') + ' ' + rank + '위 · 상한 ' + cap + '원', ok: true });
  /* 바로 한 번 맞춘다 */
  const S = (await db().ref('adctl/struct').once('value')).val() || {};
  const rk = (await db().ref('adctl/rank').once('value')).val() || {};
  let applied;
  try { applied = await trackOne(client(), S, rk, id, T, maxBid, Date.now()); }
  catch (e) { await db().ref('adctl/target/' + id).update({ note: '오류: ' + String(e.message).slice(0, 120) }); throw new HttpsError('internal', e.message); }
  return { ok: true, applied };
});
