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
     adsStoreIngest  스마트스토어 매출 받는 창구 — 네이버에 IP 를 등록한 컴퓨터(tools/store_agent)가 10분마다 보냄

   DB (adctl/ — 읽기는 슈퍼관리자, 쓰기는 이 함수만. config·sales 만 화면에서 씀)
     adctl/struct              캠페인·광고그룹·소재(상품)·키워드 이름/입찰가/상태/품질지수(qi) (매 수집 덮어씀)
     adctl/snap/{날짜}/{HHmm}  { ts, s:{ id:[노출,클릭,광고비,전환수,평균순위×10,전환매출] } }  — 오늘 누적, 차이로 시간당 변화
     adctl/hour/{날짜}/{캠페인} { HH:[노출,클릭,광고비,전환수] }  — 네이버 시간대 분할(hh24)
     adctl/day/{날짜}          { id:[…] }  — 지난 날 최종 (최근 7일 채움)
     adctl/rank                { ts, id:{ pc:[평균순위,노출,클릭], mo:[…], d7:오늘 노출 없어 7일 값 } }  — 집행 중인 상품·키워드만
     adctl/target/{id}         목표 순위 (adsSetTarget)
     adctl/status              마지막 수집 결과
     adctl/log/{push}          입찰·켜기끄기·목표 변경 기록 (누가·언제·전→후·이유, 자동 추적은 by:'auto')
     adctl/config              화면 설정 (객단가·원가·수수료·목표 광고비율·최고 입찰가·시즌 시작일 · hourShift{HH:순위 더하기} 시간대별 목표 순위 조정)
     adctl/sales/{날짜}        스토어 매출 — 커머스 API 자동(src:'store', h:{HH:금액}), 연결 안 된 날은 화면 수동 입력(src:'manual')
     adctl/storeStatus         스토어 매출 마지막 수집 결과
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
const DL_ID = defineSecret('NAVER_DATALAB_CLIENT_ID');          /* 데이터랩 검색어 트렌드 (NAVER API HUB) */
const DL_SECRET = defineSecret('NAVER_DATALAB_CLIENT_SECRET');
const SECRETS = [SA_KEY, SA_SECRET, SA_CUSTOMER, DL_ID, DL_SECRET];
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

  /* 손익분기 입찰 상한 · 키워드 월 검색 수 */
  let be = null;
  try { be = await breakEven(S, s, today); await db().ref('adctl/be').set(clean(be)); } catch (e) { logger.warn('손익분기 계산 실패', { e: e.message }); }
  try { await keywordVolumes(api, S); } catch (e) { logger.warn('키워드 검색 수 실패', { e: e.message }); }
  try { await seasonTrend(S, false); } catch (e) { logger.warn('데이터랩 실패', { e: e.message }); await db().ref('adctl/trend/err').set(String(e.message).slice(0, 300)).catch(() => {}); }

  /* 목표 순위 추적 — 대표님이 「반영」으로 정해 둔 것만 */
  let track = 0;
  try { track = await applyTargets(api, S, rank, be); } catch (e) { logger.warn('목표 순위 추적 실패', { e: e.message }); }

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

/* ── 손익분기 입찰 상한 (2026-10-22 대표님 ②) ─────────────────
   클릭 1번이 벌어 오는 이익 = (전환매출 ÷ 클릭) × 남는 비율, 남는 비율 = (객단가 × (1 − 수수료) − 원가) ÷ 객단가.
   이보다 비싸게 클릭을 사면 팔릴수록 손해 → 입찰 상한 = 클릭당 이익 × 1.25 (실제 클릭단가는 입찰가보다 낮게 나오므로 여유).
   전환매출은 네이버 광고 전환(최근 7일 + 오늘). 클릭이 적은 키워드는 같은 종류(파워링크/쇼핑) 평균을 섞는다:
     클릭당 전환매출 = (그 항목 전환매출 + 30 × 평균) ÷ (그 항목 클릭 + 30)  — 클릭 30번어치 평균을 미리 깔고 시작.
   종류 전체 클릭이 50번 미만이거나 네이버 전환이 3건 미만이면 아직 판단할 근거가 없어 상한을 걸지 않는다.
   (2026-10-22: 파워링크 전환 집계가 0 — 집계가 늦고 빠지는데 0 으로 계산하면 전부 최저가로 떨어짐)
   adctl/be = { ts, m:남는 비율, pool:{kw:[클릭,전환매출,전환수], shop:[…]}, items:{ id:[클릭, 전환매출, 클릭당 이익, 입찰 상한] } } */
const BE_PRIOR = 30, BE_MIN_POOL = 50, BE_MIN_CONV = 3, BE_BID_X = 1.25;
function profitRate(cfg) {
  const aov = +cfg.aov || 0, cost = +cfg.cost || 0, fee = cfg.fee != null && cfg.fee !== '' ? +cfg.fee / 100 : 0;
  if (aov && cost) return (aov * (1 - fee) - cost) / aov;
  if (+cfg.margin) return +cfg.margin / 100;
  return null;
}
async function breakEven(S, sToday, today) {
  const cfg = (await db().ref('adctl/config').once('value')).val() || {};
  const m = profitRate(cfg);
  if (!(m > 0)) return { ts: Date.now(), m: m, off: '기준 설정에 객단가·원가·수수료가 없음' };
  const days = (await db().ref('adctl/day').orderByKey().startAt(addDays(today, -7)).endAt(addDays(today, -1)).once('value')).val() || {};
  const sum = {};
  [sToday].concat(Object.keys(days).map((d) => days[d])).forEach((D) => Object.keys(D || {}).forEach((id) => {
    const a = D[id] || [], o = sum[id] || (sum[id] = [0, 0, 0]); o[0] += +a[1] || 0; o[1] += +a[5] || 0; o[2] += +a[3] || 0;
  }));
  const kind = {};
  Object.keys(S.keywords || {}).forEach((id) => { kind[id] = 'kw'; });
  Object.keys(S.ads || {}).forEach((id) => { if (/SHOPPING/i.test(S.ads[id].type)) kind[id] = 'shop'; });
  const pool = { kw: [0, 0, 0], shop: [0, 0, 0] };
  Object.keys(kind).forEach((id) => { const o = sum[id]; if (o) { pool[kind[id]][0] += o[0]; pool[kind[id]][1] += o[1]; pool[kind[id]][2] += o[2]; } });
  const items = {};
  Object.keys(kind).forEach((id) => {
    const P = pool[kind[id]], o = sum[id] || [0, 0];
    if (P[0] < BE_MIN_POOL || P[2] < BE_MIN_CONV) return;
    const rpc = (o[1] + BE_PRIOR * P[1] / P[0]) / (o[0] + BE_PRIOR);
    const per = Math.round(rpc * m), capBid = Math.round(per * BE_BID_X / 10) * 10;
    items[id] = [o[0], o[1], per, capBid];
  });
  return { ts: Date.now(), m: Math.round(m * 1000) / 1000, pool, items };
}

/* ── 키워드 월 검색 수 (검색광고 키워드 도구 /keywordstool, 최근 30일) — 하루 한 번
   adctl/kwvol = { ts, k:{ 키워드: [PC, 모바일, 경쟁정도] } } — 「< 10」 은 5 로 */
function qc(v) { return typeof v === 'number' ? v : /</.test(String(v)) ? 5 : (+v || 0); }
async function keywordVolumes(api, S) {
  const cur = (await db().ref('adctl/kwvol/ts').once('value')).val();
  if (cur && Date.now() - cur < 20 * 3600e3) return;
  const words = Array.from(new Set(Object.keys(S.keywords || {}).map((id) => String(S.keywords[id].kw || '').replace(/\s+/g, '')).filter(Boolean)));
  const out = {};
  for (let i = 0; i < words.length; i += 5) {
    const part = words.slice(i, i + 5);
    try {
      const r = await api.get('/keywordstool', { hintKeywords: part.join(','), showDetail: 1 });
      ((r && r.keywordList) || []).forEach((x) => {
        const w = String(x.relKeyword || '').replace(/\s+/g, '');
        if (part.some((p) => p.toUpperCase() === w.toUpperCase())) out[w] = [qc(x.monthlyPcQcCnt), qc(x.monthlyMobileQcCnt), String(x.compIdx || '')];
      });
    } catch (e) { logger.warn('keywordstool 실패', { part, e: e.message }); }
  }
  await db().ref('adctl/kwvol').set(clean({ ts: Date.now(), k: out }));
}

/* ── 시즌 검색 추이 (네이버 데이터랩 검색어 트렌드, NAVER API HUB) — 하루 한 번
   데이터랩은 실제 검색 수가 아니라 「요청한 기간·묶음 전체에서 가장 높은 날 = 100」 상대값을 준다.
   그래서 묶음마다 키워드 도구의 최근 30일 실제 검색 수(adctl/kwvol)로 눈금을 맞춘다:
     눈금 = 최근 30일 실제 검색 합 ÷ 최근 30일 상대값 합 → 하루 추정 검색 = 상대값 × 눈금 (지난 해도 같은 눈금)
   묶음(최대 5개, 한 번에 받아야 서로 비교 가능): ① 목표 순위를 건 키워드 전체(검색 많은 20개) ② 검색 많은 4개 각각.
   adctl/config/trendGroups = [{ name, keywords[] }] 가 있으면 그걸 씀.
   adctl/trend = { ts, start, end, groups:[{ name, kws[], vol30, scale, r:[start 부터 하루씩 상대값] }] } */
const DL_URL = 'https://naverapihub.apigw.ntruss.com/search-trend/v1/search';
async function seasonTrend(S, force) {
  const cur = (await db().ref('adctl/trend/ts').once('value')).val();
  if (!force && cur && Date.now() - cur < 20 * 3600e3) return null;
  const id = String(DL_ID.value() || '').trim(), sec = String(DL_SECRET.value() || '').trim();
  if (!id || !sec) throw new Error('데이터랩 열쇠 없음 (NAVER_DATALAB_CLIENT_ID · SECRET)');
  const vol = ((await db().ref('adctl/kwvol/k').once('value')).val()) || {};
  const v30 = (w) => { const x = vol[String(w).replace(/\s+/g, '')]; return x ? (+x[0] || 0) + (+x[1] || 0) : 0; };
  let groups = (await db().ref('adctl/config/trendGroups').once('value')).val();
  if (!Array.isArray(groups) || !groups.length) {
    const T = (await db().ref('adctl/target').once('value')).val() || {};
    const words = Array.from(new Set(Object.keys(T).filter((k) => T[k].kind === 'keyword' && (S.keywords || {})[k])
      .map((k) => String(S.keywords[k].kw || '').replace(/\s+/g, '')).filter(Boolean)));
    words.sort((a, b) => v30(b) - v30(a));
    if (!words.length) throw new Error('목표 순위를 건 파워링크 키워드가 없어 묶음을 못 만듦');
    groups = [{ name: '우리 키워드 전체', keywords: words.slice(0, 20) }].concat(words.slice(0, 4).map((w) => ({ name: w, keywords: [w] })));
  }
  groups = groups.slice(0, 5).map((g) => ({ name: String(g.name).slice(0, 40), keywords: (g.keywords || []).slice(0, 20).map(String) }));
  const today = kday(), y = +today.slice(0, 4);
  const start = (y - 2) + '-09-01', end = addDays(today, -1);
  const r = await fetch(DL_URL, { method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { 'X-NCP-APIGW-API-KEY-ID': id, 'X-NCP-APIGW-API-KEY': sec, 'Content-Type': 'application/json' },
    body: JSON.stringify({ startDate: start, endDate: end, timeUnit: 'date', keywordGroups: groups.map((g) => ({ groupName: g.name, keywords: g.keywords })) }) });
  const txt = await r.text();
  if (!r.ok) throw new Error('데이터랩 ' + r.status + ' ' + txt.slice(0, 200));
  const res = JSON.parse(txt);
  const n = Math.round((Date.parse(end) - Date.parse(start)) / 864e5) + 1;
  const out = (res.results || []).map((x, i) => {
    const arr = new Array(n).fill(0);
    (x.data || []).forEach((p) => { const k = Math.round((Date.parse(p.period) - Date.parse(start)) / 864e5); if (k >= 0 && k < n) arr[k] = Math.round(+p.ratio * 100) / 100; });
    const kws = (groups[i] || {}).keywords || x.keywords || [];
    const vol30 = kws.reduce((s, w) => s + v30(w), 0), last = arr.slice(-30).reduce((s, v) => s + v, 0);
    return { name: x.title || (groups[i] || {}).name, kws, vol30, scale: vol30 && last ? Math.round(vol30 / last * 1000) / 1000 : null, r: arr };
  });
  const doc = { ts: Date.now(), start, end, groups: out, err: null };
  await db().ref('adctl/trend').set(clean(doc));
  return { start, end, groups: out.map((g) => ({ name: g.name, vol30: g.vol30, scale: g.scale, days: g.r.length })) };
}
exports.adsTrendNow = onCall(OPTS, async (req) => {
  await requireSuper(req);
  const S = (await db().ref('adctl/struct').once('value')).val() || {};
  try { return await seasonTrend(S, true); }
  catch (e) { await db().ref('adctl/trend/err').set(String(e.message).slice(0, 300)).catch(() => {}); throw new HttpsError('internal', e.message); }
});

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
const KW_MIN_IMP = 10;   /* 파워링크 실제 순위 보정 — 바꾼 뒤 노출이 이만큼 모여야 판단 (바꾼 뒤 노출 10회 이상일 때) */
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
/* 시간대별 목표 순위 조정 (2026-10-22) — adctl/config/hourShift = { HH: 더할 순위 } (예 02~06시 +3 → 3위 목표가 6위)
   금액을 직접 깎으면 순위 보정이 되올리므로, 목표 순위를 바꿔 추적이 알아서 맞추게 한다.
   조정된 목표가 바뀌는 시각엔 실제 순위 보정 기준(base)을 새로 잡는다. */
async function hourShiftCfg() {
  const cfg = (await db().ref('adctl/config').once('value')).val() || {}, m = Object.assign({}, cfg.hourShift || {});
  /* 배송 마감 뒤(피크 날 끝까지) — 모든 시간에 cutoff.rank 를 더 얹음 */
  const ph = seasonPhase(cfg, Date.now());
  if (ph.after && +ph.C.rank) for (let h = 0; h < 24; h++) { const k = String(h).padStart(2, '0'); m[k] = (+m[k] || 0) + +ph.C.rank; }
  return m;
}
async function trackOne(api, S, rank, id, T0, maxBid, now, shift, beCap) {
  const hk = kst(now).toISOString().slice(11, 13), sh = Math.round(+((shift || {})[hk]) || 0);
  const eff = Math.max(1, Math.min(15, T0.rank + sh));
  const T = Object.assign({}, T0, { rank: eff });   /* 복사 — 일괄 반영 때 여러 키워드가 같은 목표 객체를 나눠 쓰므로 */
  if (T0.effRank !== eff) { T.base = null; await db().ref('adctl/target/' + id).update({ effRank: eff, base: null }); }
  const tag = sh ? ' · ' + (+hk) + '시 조정 ' + T0.rank + '→' + eff + '위' : '';
  /* 손익분기 입찰 상한(beCap) — 이보다 비싸게 사면 팔릴수록 손해. 목표 상한·최고 입찰가보다 낮을 때만 씀 */
  const capT = Math.min(+T.cap || maxBid, maxBid), beOn = beCap > 0 && beCap < capT;
  const cap = beOn ? beCap : capT, capWhy = beOn ? ' · 이익 상한 ' + beCap + '원' : '';
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
    /* 실제 순위 보정 (2026-10-22: 예상가대로 넣어도 빼빼로만들기 3위 목표가 4.9위) — 마지막으로 입찰가를 바꾼 뒤의 노출만 본다.
       오늘 누적 [평균순위, 노출] 에서 바꿀 때 적어 둔 기준(base)을 빼면 그 뒤 노출의 평균순위가 나온다.
       목표보다 0.5위 넘게 밀림 → 보정 +10% (2위 넘게 밀리면 +20%), 0.7위 넘게 위 → −7%, 노출 10회 미만이면 판단 보류 */
    const RR = rank[id] || {}, R = !RR.d7 && RR[T.dev] ? RR[T.dev] : null;
    const curImp = R ? +R[1] || 0 : 0, curRk = R ? +R[0] || 0 : 0;
    const B = T.base ? (T.base.d === today ? T.base : { imp: 0, rk: 0 }) : null;   /* 기준이 어제 것이면 오늘 노출은 전부 바꾼 뒤 */
    const dImp = B ? curImp - (+B.imp || 0) : 0;
    let adj = +T.adj || 1, fb = '';
    if (B && dImp >= KW_MIN_IMP) {
      const recent = Math.round((curRk * curImp - (+B.rk || 0) * (+B.imp || 0)) / dImp * 10) / 10;
      if (recent > T.rank + 0.5) { const k = recent - T.rank > 2 ? 1.2 : 1.1; adj *= k; fb = ' · 최근 노출 ' + dImp + '회 ' + recent + '위 → 보정 +' + Math.round((k - 1) * 100) + '%'; }
      else if (recent < T.rank - 0.7) { adj *= 0.93; fb = ' · 최근 노출 ' + dImp + '회 ' + recent + '위 → 보정 −7%'; }
      else fb = ' · 최근 노출 ' + dImp + '회 ' + recent + '위';
    } else fb = ' · 최근 노출 ' + Math.max(0, dImp) + '회 (' + KW_MIN_IMP + '회 모이면 순위 확인)';
    /* 상한에 닿으면 보정을 더 키우지 않음 */
    const capAdj = Math.min(+T.cap || maxBid, maxBid) * w / 100 / est;
    if (adj > (+T.adj || 1) && adj > capAdj) adj = Math.max(+T.adj || 1, capAdj);
    adj = Math.round(Math.max(0.7, Math.min(3, adj)) * 100) / 100;
    T.adj = adj; T.cur = { d: today, imp: curImp, rk: curRk };
    await db().ref('adctl/target/' + id).update({ adj, base: B ? T.base : T.cur });   /* 기준이 없던 목표는 지금부터 잰다 */
    if (!B) T.base = T.cur;
    want = est * adj * 100 / w;
    why = '예상 입찰가 ' + est + '원' + (w !== 100 ? ' (가중치 ' + w + '%)' : '') + (adj !== 1 ? ' × 보정 ' + adj : '') + fb + tag + capWhy;
  } else {
    if (now - (+T.lastAdj || 0) < 55 * 60e3) return { id, skip: 'wait' };
    const RR = rank[id] || {}, R = RR[T.dev];
    /* 오늘 그 기기 노출이 있으면 오늘 순위, 없으면 최근 7일 순위로 판단 (2026-10-22: 새벽 1시 「오늘 노출 없음」으로 밤새 올라갈 뻔함) */
    const rk = R && R[1] > 0 ? R[0] : null, src = RR.d7 ? '최근 7일 ' : '현재 ';
    const hh = kst(now).getUTCHours();
    if (rk == null) {
      if (hh < 8) { await db().ref('adctl/target/' + id).update({ note: '새벽이라 노출이 적어 아침까지 기다림', chk: now }); return { id, skip: 'night' }; }
      if (now - (+T.lastAdj || 0) < 2 * 3600e3) { await db().ref('adctl/target/' + id).update({ note: '노출 기록 없음 — 2시간 지켜본 뒤 올림', chk: now }); return { id, skip: 'wait-noimp' }; }
      want = bid * 1.1; why = '노출 기록 없음' + tag + capWhy;
    }
    else if (rk > T.rank + 0.5) { want = bid * (rk - T.rank > 2 ? 1.2 : 1.1); why = src + rk + '위' + tag + capWhy; }
    else if (rk < T.rank - 0.7) { want = bid * 0.93; why = src + rk + '위' + tag + capWhy; }
    else { await db().ref('adctl/target/' + id).update({ note: '목표 근처 (' + src + rk + '위)', chk: now }); return { id, skip: 'on-target', rk }; }
  }
  const raw = Math.round(want / 10) * 10;
  const minBid = T.kind === 'keyword' ? 70 : 50;   /* 파워링크 최소 입찰가 70원 (50원 보내면 400 Invalid value), 쇼핑 50원 */
  const to = Math.max(minBid, Math.min(cap, raw)), atCap = raw > cap;
  if (to === bid || (Math.abs(to - bid) < Math.max(10, bid * 0.05) && !(atCap && bid < cap))) {
    await db().ref('adctl/target/' + id).update({ note: atCap ? (beOn ? '이익 상한 ' + cap + '원에 닿음 — 이보다 비싸면 팔릴수록 손해' : '상한 ' + cap + '원에 닿음 — 목표 순위가 안 나오면 상한을 올리세요') : '목표 근처 · ' + why, chk: now });
    return { id, skip: 'small', atCap };
  }
  const r = await putBid(api, T.kind, id, to);
  const done = { lastAdj: now, chk: now, note: (atCap ? '상한 ' + cap + '원까지만 · ' : '') + why };
  if (T.kind === 'keyword' && T.cur) done.base = T.cur;   /* 입찰가를 바꿨으니 여기부터 다시 잰다 */
  await db().ref('adctl/target/' + id).update(done);
  await writeLog({ email: 'auto' }, { kind: T.kind, id, act: 'bid', from: r.from, to: r.to,
    reason: '목표 ' + (T.dev === 'pc' ? 'PC' : '모바일') + ' ' + T.rank + '위 추적 · ' + why, ok: true, auto: true });
  return { id, from: r.from, to: r.to, atCap };
}
async function beCapOf(be, id) {
  const on = (await db().ref('adctl/config/beOn').once('value')).val();
  if (on === false || !be || !be.items || !be.items[id]) return null;
  return be.items[id][3];
}
async function applyTargets(api, S, rank, be) {
  const all = (await db().ref('adctl/target').once('value')).val() || {};
  const ids = Object.keys(all); if (!ids.length) return 0;
  const maxBid = await maxBidCfg(), shift = await hourShiftCfg(), now = Date.now(); let n = 0;
  for (const id of ids) {
    try { const r = await trackOne(api, S, rank, id, all[id], maxBid, now, shift, await beCapOf(be, id)); if (r.to != null) n++; }
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
  const shift = await hourShiftCfg(), be = (await db().ref('adctl/be').once('value')).val();
  const res = await pool(ids, 3, async (id) => {
    try { return await trackOne(api, S, rk, id, T, maxBid, now, shift, await beCapOf(be, id)); }
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
  try { applied = await trackOne(client(), S, rk, id, T, maxBid, Date.now(), await hourShiftCfg(), await beCapOf((await db().ref('adctl/be').once('value')).val(), id)); }
  catch (e) { await db().ref('adctl/target/' + id).update({ note: '오류: ' + String(e.message).slice(0, 120) }); throw new HttpsError('internal', e.message); }
  return { ok: true, applied };
});

/* ── 알림 — 픽앤톡과 같은 웹 푸시(FCM), 슈퍼관리자(대표님) 기기에만 ──
   토큰 위치: wms_sync/groups/{gid}/picktalk/fcmTokens/{token} = { uid, … } — 픽앤톡에서 알림을 허용한 기기.
   누르면 광고 관제 화면으로. 보낸 알림은 adctl/notify 에도 남긴다. */
async function notifyAdmins(title, body, tag) {
  const supers = Object.keys((await db().ref('superadmins').once('value')).val() || {});
  const gids = Object.keys((await db().ref('groups').once('value')).val() || {});
  const tokens = [];
  for (const gid of gids) {
    const m = (await db().ref('wms_sync/groups/' + gid + '/picktalk/fcmTokens').once('value')).val() || {};
    Object.keys(m).forEach((tok) => { if (m[tok] && supers.indexOf(m[tok].uid) >= 0 && tokens.indexOf(tok) < 0) tokens.push(tok); });
  }
  await db().ref('adctl/notify').push({ t: Date.now(), title, body, n: tokens.length });
  if (!tokens.length) { logger.warn('알림 받을 기기 없음 — 픽앤톡에서 알림 허용 필요'); return 0; }
  try {
    const r = await admin.messaging().sendEachForMulticast({
      notification: { title, body },
      data: { url: '/ad_control.html', kind: 'adctl' },
      webpush: { notification: { icon: '/icon.svg', badge: '/icon.svg', tag: tag || ('adctl-' + Date.now()), requireInteraction: true },
        fcmOptions: { link: 'https://makewon.com/ad_control.html' } },
      tokens
    });
    return r.successCount;
  } catch (e) { logger.error('알림 발송 실패', { e: e.message }); return 0; }
}

exports.adsNotifyTest = onCall(OPTS, async (req) => {
  await requireSuper(req);
  const n = await notifyAdmins('📣 광고 관제 알림 시험', '이 알림이 보이면 예산 80%·90%·소진 알림이 이 기기로 옵니다', 'adctl-test');
  return { ok: true, sent: n };
});

/* ── 하루 예산 지킴이 (10분마다) ──────────────────────────
   adctl/config/budget = { shop: 원, pl: 원 }  (쇼핑검색 · 파워링크, 0/없음 = 안 지킴)
   adctl/config/reopenHour = 0~23 (다음 날 다시 켜는 시각, 기본 9시)
   오늘 광고비(네이버 캠페인 통계 합)가
     80% · 90%  → 알림 한 번씩
     100% 이상  → 그 종류에서 지금 켜져서 돌고 있는 캠페인을 끈다(userLock) + 알림. 끈 목록은 adctl/budgetOff/{캠페인} = { date, tp, ts }
   다시 켜기: 끈 날 이후 reopenHour 가 되면 지킴이가 끈 캠페인만 다시 켠다 (대표님이 직접 끈 건 건드리지 않음).
             같은 날 예산을 올려 100% 아래가 되면 바로 다시 켠다.
   상태: adctl/budget/{날짜}/{shop|pl} = { spent, budget, pct, ts, a80, a90, a100 }
   주의: 네이버 통계는 몇 분~수십 분 늦게 잡혀서 끄는 시점에 이미 조금 넘을 수 있다 (10분 간격 + 통계 지연). */
const BTYPE = { SHOPPING: 'shop', WEB_SITE: 'pl' };
const BNAME = { shop: '쇼핑검색', pl: '파워링크' };
/* ── 시즌 · 자동 예산 (2026-10-22 대표님) ─────────────────
   시즌(어떤 행사든 같은 틀): adctl/config/peakDay = 'MM-DD'(기본 11-11),
     adctl/config/cutoff = { days:-1, hour:15, pct:50, rank:3 } — 피크 D-1 15시에 배송 마감 → 그 뒤 피크 날 끝까지
     하루 예산은 기본의 pct%, 목표 순위는 +rank (늦게 사면 제때 못 받으니 덜 민다). 피크 다음 날부터 원래대로.
   자동 증액: adctl/config/budgetAuto = { on, maxShop, maxPl } — 한도는 대표님이 직접 정하고 수시로 바꿈.
     오늘 쓸 예산(eff) = max(기본 예산, 오늘 예상 광고비 × 1.2) — 한도 안에서.
       오늘 예상 광고비 = 데이터랩 곡선으로 본 오늘 예상 검색 × 지난 7일 「검색 1회당 광고비」(종류별)
     소진 속도: 22시 전에 eff 의 85%를 썼고 오늘 매출이 본전 이상(매출 ÷ 광고비 ≥ 1 ÷ 남는 비율)이면 +25% (한도까지).
     하루 안에서는 eff 를 줄이지 않음(마감 때만 줄임). 자동 증액이 켜져 있으면 네이버 캠페인 하루 예산도 eff 에 맞춤
     (네이버 캠페인 자체 예산이 낮으면 우리가 올려도 네이버가 먼저 멈추므로).
   비즈머니: 1시간마다 잔액 확인 → adctl/bizmoney, 남은 돈이 오늘 예산 2일치보다 적으면 하루 한 번 알림. */
function seasonPhase(cfg, now) {
  const pk = cfg.peakDay || '11-11', C = Object.assign({ days: -1, hour: 15, pct: 50, rank: 3 }, cfg.cutoff || {});
  const today = kday(now), peak = today.slice(0, 4) + '-' + pk;
  const cutAt = Date.parse(addDays(peak, +C.days) + 'T' + String(+C.hour).padStart(2, '0') + ':00:00+09:00');
  const endAt = Date.parse(addDays(peak, 1) + 'T00:00:00+09:00');
  return { peak, C, after: now >= cutAt && now < endAt, cutAt };
}
async function forecastToday(cfg, today, typeOf) {
  const T = (await db().ref('adctl/trend').once('value')).val();
  if (!T || !T.groups || !T.groups.length) return null;
  const g = T.groups[0], sc = +g.scale || 0, y = +today.slice(0, 4), pk = cfg.peakDay || '11-11';
  const rAt = (d) => { const i = Math.round((Date.parse(d) - Date.parse(T.start)) / 864e5); return i >= 0 && i < g.r.length ? +g.r[i] : null; };
  const dOf = (Y, k) => addDays(Y + '-' + pk, k), kOf = (d) => Math.round((Date.parse(d) - Date.parse(y + '-' + pk)) / 864e5);
  const endK = kOf(T.end), kT = kOf(today);
  let a = 0, b = 0, b2 = 0;
  for (let k = endK - 6; k <= endK; k++) { a += rAt(dOf(y, k)) || 0; b += rAt(dOf(y - 1, k)) || 0; b2 += rAt(dOf(y - 2, k)) || 0; }
  const xs = [], v1 = rAt(dOf(y - 1, kT)), v2 = rAt(dOf(y - 2, kT));
  if (v1 && b) xs.push(v1 * Math.max(0.2, Math.min(5, a / b))); if (v2 && b2) xs.push(v2 * Math.max(0.2, Math.min(5, a / b2)));
  if (!xs.length || !sc) return null;
  const search = xs.reduce((s, x) => s + x, 0) / xs.length * sc;
  /* 지난 7일 종류별 광고비 ÷ 그날 검색 */
  const days = (await db().ref('adctl/day').orderByKey().startAt(addDays(today, -7)).endAt(addDays(today, -1)).once('value')).val() || {};
  const cost = { shop: 0, pl: 0 }; let srch = 0;
  Object.keys(days).forEach((d) => {
    const r0 = rAt(d); if (r0 == null) return; srch += r0 * sc;
    Object.keys(days[d] || {}).forEach((id) => { const t = typeOf[id]; if (t) cost[t] += +(days[d][id] || [])[2] || 0; });
  });
  if (!srch) return null;
  return { search: Math.round(search), need: { shop: Math.round(search * cost.shop / srch), pl: Math.round(search * cost.pl / srch) } };
}
async function budgetPlan(cfg, camps, spent, state, today, now, hh) {
  const B = cfg.budget || {}, A = cfg.budgetAuto || {}, ph = seasonPhase(cfg, now), out = { phase: ph.after ? 'cutoff' : 'normal' };
  const typeOf = {}; camps.forEach((c) => { const t = BTYPE[c.campaignTp]; if (t) typeOf[c.nccCampaignId] = t; });
  let fc = null; if (A.on) { try { fc = await forecastToday(cfg, today, typeOf); } catch (e) { logger.warn('예상 광고비 실패', { e: e.message }); } }
  const sales = +(((await db().ref('adctl/sales/' + today).once('value')).val()) || {}).amt || 0, tot = spent.shop + spent.pl;
  const m = profitRate(cfg), roasOK = !(m > 0) || tot < 10000 || sales / tot >= 1 / m;
  for (const t of ['shop', 'pl']) {
    const base = +B[t] || 0, max = +(t === 'shop' ? A.maxShop : A.maxPl) || 0, prev = +((state[t] || {}).eff) || 0;
    let eff = base, why = '기본 예산';
    if (base > 0 && ph.after) { eff = Math.round(base * (+ph.C.pct || 0) / 100 / 1000) * 1000; why = '배송 마감 뒤 ' + ph.C.pct + '%'; }
    else if (base > 0 && A.on && max > base) {
      if (fc && fc.need[t] * 1.2 > eff) { eff = Math.min(max, Math.ceil(fc.need[t] * 1.2 / 1000) * 1000); why = '오늘 예상 광고비 ' + fc.need[t].toLocaleString('ko-KR') + '원 × 1.2'; }
      if (prev > eff) { eff = prev; why = (state[t] || {}).why || why; }
      if (hh < 22 && spent[t] >= eff * 0.85 && eff < max) {
        if (roasOK) { eff = Math.min(max, Math.ceil(eff * 1.25 / 1000) * 1000); why = '빨리 소진 + 본전 넘음 → +25%'; }
        else why += ' · 빨리 소진 중이지만 오늘 매출이 본전 아래라 더 안 올림';
      }
    }
    out[t] = { base, eff, max, why };
  }
  out.search = fc ? fc.search : null; out.roasOK = roasOK;
  return out;
}
/* 네이버 캠페인 하루 예산을 맞춤 — 자동 증액이 켜져 있을 때 · 마감 뒤에만 (그 외엔 대표님이 네이버에서 정한 대로 둠) */
async function syncNaverBudget(api, camps, t, eff, reason) {
  const changed = [];
  for (const c of camps.filter((x) => BTYPE[x.campaignTp] === t && !x.userLock && String(x.status || '').toUpperCase() === 'ELIGIBLE')) {
    if (!c.useDailyBudget || +c.dailyBudget === eff || !(eff > 0)) continue;
    try {
      const cur = await api.get('/ncc/campaigns/' + c.nccCampaignId);
      const from = cur.dailyBudget; cur.dailyBudget = eff; cur.useDailyBudget = true;
      await api.put('/ncc/campaigns/' + c.nccCampaignId, { fields: 'budget' }, cur);
      await writeLog({ email: 'auto' }, { kind: 'campaign', id: c.nccCampaignId, act: 'budget', from, to: eff, reason: '네이버 캠페인 하루 예산 맞춤 · ' + reason, ok: true, auto: true });
      changed.push(c.name);
    } catch (e) { logger.warn('네이버 캠페인 예산 바꾸기 실패', { cid: c.nccCampaignId, e: e.message }); }
  }
  return changed;
}
async function setCampaignLock(api, cid, lock) {
  const cur = await api.get('/ncc/campaigns/' + cid);
  cur.userLock = lock;
  await api.put('/ncc/campaigns/' + cid, { fields: 'userLock' }, cur);
}
async function budgetCheck(trigger) {
  const now = Date.now(), today = kday(now), hh = kst(now).getUTCHours();
  const cfg = (await db().ref('adctl/config').once('value')).val() || {};
  const B = cfg.budget || {}, reopenHour = cfg.reopenHour != null ? +cfg.reopenHour : 9;
  const off = (await db().ref('adctl/budgetOff').once('value')).val() || {};
  if (!(+B.shop > 0) && !(+B.pl > 0) && !Object.keys(off).length) return { skip: 'no-budget' };
  const api = client();
  const camps = (await api.get('/ncc/campaigns')) || [];
  const s = await statsSummary(api, [camps.map((c) => c.nccCampaignId)], today, today);
  const spent = { shop: 0, pl: 0 };
  camps.forEach((c) => { const t = BTYPE[c.campaignTp]; if (t) spent[t] += (s[c.nccCampaignId] || [0, 0, 0])[2]; });
  const state = (await db().ref('adctl/budget/' + today).once('value')).val() || {};
  const up = {}, done = [];
  const who = { email: 'auto' };
  const plan = await budgetPlan(cfg, camps, spent, state, today, now, hh), A = cfg.budgetAuto || {};

  /* 0) 비즈머니 잔액 — 1시간마다, 오늘 예산 2일치보다 적으면 하루 한 번 알림 */
  try {
    const bm = (await db().ref('adctl/bizmoney').once('value')).val() || {};
    if (!bm.ts || now - bm.ts > 3600e3) {
      const r = await api.get('/billing/bizmoney');
      const amt = +((r && r.bizmoney) != null ? r.bizmoney : -1), need2 = 2 * ((plan.shop.eff || 0) + (plan.pl.eff || 0));
      up['adctl/bizmoney'] = { amt, ts: now, need2, alerted: bm.alerted || null };
      if (amt >= 0 && need2 > 0 && amt < need2 && bm.alerted !== today) {
        up['adctl/bizmoney'].alerted = today;
        await notifyAdmins('💳 비즈머니가 모자랄 수 있어요', '잔액 ' + amt.toLocaleString('ko-KR') + '원 — 오늘 예산 2일치(' + need2.toLocaleString('ko-KR') + '원)보다 적습니다. 바닥나면 광고가 모두 멈춰요.', 'adctl-bizmoney-' + today);
      }
    }
  } catch (e) { logger.warn('비즈머니 확인 실패', { e: e.message }); }

  /* 1) 지난날 예산으로 끈 캠페인 — 다시 켤 시각이 되면 켠다 */
  for (const cid of Object.keys(off)) {
    const o = off[cid];
    if (o.date < today && hh >= reopenHour) {
      try {
        await setCampaignLock(api, cid, false);
        up['adctl/budgetOff/' + cid] = null;
        await writeLog(who, { kind: 'campaign', id: cid, act: 'lock', from: true, to: false, reason: '예산 소진으로 껐던 캠페인 — ' + reopenHour + '시 다시 켬', ok: true, auto: true });
        done.push(['reopen', o.tp, cid]);
      } catch (e) { logger.warn('다시 켜기 실패', { cid, e: e.message }); }
    }
  }
  const reopened = done.filter((x) => x[0] === 'reopen');
  if (reopened.length) {
    const names = reopened.map((x) => (camps.find((c) => c.nccCampaignId === x[2]) || {}).name).filter(Boolean);
    await notifyAdmins('🟢 광고 다시 켬', reopened.length + '개 캠페인을 ' + reopenHour + '시에 다시 켰습니다 — ' + names.slice(0, 3).join(', '), 'adctl-reopen-' + today);
  }

  /* 2) 오늘 예산 */
  for (const t of ['shop', 'pl']) {
    const P = plan[t], bud = P.eff, st = Object.assign({}, state[t] || {}), prevEff = +st.eff || 0;
    st.spent = spent[t]; st.budget = bud; st.base = P.base; st.eff = P.eff; st.max = P.max || null; st.why = P.why; st.phase = plan.phase; st.ts = now;
    if (plan.search != null) st.search = plan.search;
    /* 자동 증액 켜짐 · 마감 뒤엔 네이버 캠페인 하루 예산도 맞춤 */
    if (bud > 0 && (A.on || plan.phase === 'cutoff')) {
      const ch = await syncNaverBudget(api, camps, t, bud, P.why);
      if (ch.length) st.naverSync = now;
    }
    if (bud > prevEff && prevEff > 0 && plan.phase !== 'cutoff') {
      await notifyAdmins('📈 ' + BNAME[t] + ' 하루 예산 자동 증액', prevEff.toLocaleString('ko-KR') + '원 → ' + bud.toLocaleString('ko-KR') + '원 (' + P.why + ', 한도 ' + (P.max || 0).toLocaleString('ko-KR') + '원)', 'adctl-' + t + '-auto-' + today + '-' + bud);
    }
    if (plan.phase === 'cutoff' && !st.cutNotified) {
      st.cutNotified = now;
      await notifyAdmins('🚚 배송 마감 — ' + BNAME[t] + ' 광고 줄임', '하루 예산 ' + P.base.toLocaleString('ko-KR') + '원 → ' + bud.toLocaleString('ko-KR') + '원 · 목표 순위 낮춤 (피크 날 끝까지)', 'adctl-' + t + '-cut-' + today);
    }
    st.pct = bud ? Math.round(spent[t] / bud * 1000) / 10 : null;
    if (bud > 0) {
      for (const thr of [80, 90]) {
        if (st.pct >= thr && !st['a' + thr]) {
          st['a' + thr] = now;
          await notifyAdmins('⚠️ ' + BNAME[t] + ' 광고비 ' + thr + '% 소진', '오늘 ' + spent[t].toLocaleString('ko-KR') + '원 / 예산 ' + bud.toLocaleString('ko-KR') + '원 (' + st.pct + '%)', 'adctl-' + t + '-' + thr + '-' + today);
        }
      }
      const mine = camps.filter((c) => BTYPE[c.campaignTp] === t);
      if (st.pct >= 100) {
        /* 지금 돌고 있는 캠페인만 끈다 */
        const run = mine.filter((c) => !c.userLock && String(c.status || '').toUpperCase() === 'ELIGIBLE');
        const offNow = [];
        for (const c of run) {
          try {
            await setCampaignLock(api, c.nccCampaignId, true);
            up['adctl/budgetOff/' + c.nccCampaignId] = { date: today, tp: t, ts: now, name: c.name };
            offNow.push(c.name);
            await writeLog(who, { kind: 'campaign', id: c.nccCampaignId, act: 'lock', from: false, to: true,
              reason: BNAME[t] + ' 하루 예산 ' + bud.toLocaleString('ko-KR') + '원 소진 (' + spent[t].toLocaleString('ko-KR') + '원) — 끔', ok: true, auto: true });
          } catch (e) { logger.warn('예산 끄기 실패', { cid: c.nccCampaignId, e: e.message }); }
        }
        if (offNow.length) {
          st.a100 = now; st.offN = (st.offN || 0) + offNow.length;
          await notifyAdmins('⛔ ' + BNAME[t] + ' 예산 소진 — 광고 끔', '오늘 ' + spent[t].toLocaleString('ko-KR') + '원 / 예산 ' + bud.toLocaleString('ko-KR') + '원 · ' + offNow.length + '개 캠페인 껐습니다 (내일 ' + reopenHour + '시 다시 켬)', 'adctl-' + t + '-100-' + today);
        }
      } else {
        /* 예산을 올려 100% 아래가 됐으면 오늘 끈 것은 바로 다시 켠다 */
        for (const cid of Object.keys(off)) {
          const o = off[cid];
          if (o.tp === t && o.date === today && up['adctl/budgetOff/' + cid] === undefined) {
            try {
              await setCampaignLock(api, cid, false);
              up['adctl/budgetOff/' + cid] = null;
              await writeLog(who, { kind: 'campaign', id: cid, act: 'lock', from: true, to: false, reason: BNAME[t] + ' 예산을 올려 다시 켬', ok: true, auto: true });
            } catch (e) { logger.warn('예산 올림 다시 켜기 실패', { cid, e: e.message }); }
          }
        }
      }
    }
    up['adctl/budget/' + today + '/' + t] = st;
  }
  up['adctl/budgetChk'] = { ts: now, trigger, spent };
  await db().ref().update(clean(up));
  return { ok: true, spent };
}

exports.adsBudgetGuard = onSchedule(Object.assign({ schedule: 'every 10 minutes', timeZone: 'Asia/Seoul' }, OPTS), async () => {
  try { await budgetCheck('schedule'); }
  catch (e) { logger.error('예산 지킴이 실패', { e: e.message }); await db().ref('adctl/budgetChk').update({ ts: Date.now(), err: String(e.message).slice(0, 300) }).catch(() => {}); }
});

/* 화면에서 예산을 저장한 직후 바로 한 번 점검 */
exports.adsBudgetNow = onCall(OPTS, async (req) => {
  await requireSuper(req);
  try { return await budgetCheck('manual'); }
  catch (e) { throw new HttpsError('internal', e.message); }
});

/* ── 스마트스토어 매출 받는 창구 ─────────────────────────
   커머스 API 는 커머스API센터에 등록한 IP 에서만 불러진다 → 등록한 컴퓨터(tools/store_agent)가
   10분마다 주문을 받아 하루 매출로 합친 뒤 여기로 보낸다. 이 함수는 네이버를 부르지 않고 저장만 한다.
   요청: POST { ts, host, days:{ 날짜:{ amt, paid, cancel, n, h:{HH:금액}, p:{상품번호:[수량,금액]}, settle, settleN, rows } } }  또는 { ts, host, err } (네이버에서 못 받음)
         헤더 X-Store-Sign = hex( HMAC-SHA256(NAVER_COMMERCE_CLIENT_SECRET, ts + "." + 본문) ) — 10분 안의 요청만
   저장: adctl/sales/{날짜} = { …, src:'store', ts }   (amt = 그날 결제 중 취소·반품 뺀 금액)
         adctl/storeStatus = { ts, ok, host, days:{ 날짜:[금액,건수] } } */
const { onRequest } = require('firebase-functions/v2/https');
const crypto = require('crypto');
const STORE_SECRET = defineSecret('NAVER_COMMERCE_CLIENT_SECRET');

function num(v) { const n = Math.round(+v); return Number.isFinite(n) && n >= 0 && n < 1e11 ? n : 0; }
function cleanDay(o) {
  const out = { amt: num(o.amt), paid: num(o.paid), cancel: num(o.cancel), n: num(o.n), h: {}, p: {}, src: 'store', ts: Date.now(),
    settle: num(o.settle), settleN: num(o.settleN), rows: num(o.rows) };   /* 네이버 정산 예정금액 — 실제 수수료 = amt − settle */
  Object.keys(o.h || {}).forEach((k) => { if (/^\d\d$/.test(k) && +k < 24) out.h[k] = num(o.h[k]); });
  Object.keys(o.p || {}).slice(0, 500).forEach((k) => {
    if (/^\d{1,20}$/.test(k) && Array.isArray(o.p[k])) out.p[k] = [num(o.p[k][0]), num(o.p[k][1])];
  });
  out.pn = {};   /* 상품번호별 상품명 */
  Object.keys(o.pn || {}).slice(0, 500).forEach((k) => { if (/^\d{1,20}$/.test(k)) out.pn[k] = String(o.pn[k]).replace(/[\u0000-\u001f]/g, '').slice(0, 60); });
  return out;
}

exports.adsStoreIngest = onRequest({ region: REGION, secrets: [STORE_SECRET], timeoutSeconds: 60, memory: '256MiB' }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('POST only'); return; }
  const raw = req.rawBody ? req.rawBody.toString('utf8') : '';
  const sign = String(req.get('X-Store-Sign') || '');
  let body = null; try { body = JSON.parse(raw); } catch (e) { /* 아래에서 거절 */ }
  const ts = body && +body.ts;
  if (!body || !ts || Math.abs(Date.now() - ts) > 10 * 60e3) { res.status(400).send('bad request'); return; }
  const want = crypto.createHmac('sha256', String(STORE_SECRET.value()).trim()).update(ts + '.' + raw).digest('hex');
  if (sign.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sign), Buffer.from(want))) { res.status(401).send('bad sign'); return; }

  if (body.err) {   /* 수집기가 네이버에서 못 받았을 때 — 화면에 실패로 보이게 */
    await db().ref('adctl/storeStatus').update({ ts: Date.now(), ok: false, host: String(body.host || '').slice(0, 40), err: String(body.err).slice(0, 300) });
    res.json({ ok: true }); return;
  }
  const today = kday(), oldest = addDays(today, -3), up = {}, got = {};
  Object.keys(body.days || {}).forEach((d) => {
    if (!/^\d{4}-\d\d-\d\d$/.test(d) || d < oldest || d > today) return;
    const o = cleanDay(body.days[d] || {});
    up['adctl/sales/' + d] = o; got[d] = [o.amt, o.n];
  });
  up['adctl/storeStatus'] = { ts: Date.now(), ok: true, host: String(body.host || '').slice(0, 40), days: got };
  await db().ref().update(clean(up));
  logger.info('adsStoreIngest', up['adctl/storeStatus']);
  res.json({ ok: true, days: got });
});
