/* ============================================================
   사은품 세팅 — 대상 계산 (secretary.html 짝꿍, 브라우저·Node 공용, 대표님 2026-11-08)

   설정 하나 = 기간(주문 결제일시 시작 ~ 종료) + 묶음출력 메모(모두 / aaa·hhh·mmm …) + 판매처(모두 / 고른 판매처) + 가격대 줄(이상 ~ 미만 → 사은품 매칭상품).
   금액 = 주문번호별 판매금액 합(주문 전체, 배송비 제외). 주문당 사은품은 하나(가장 높은 구간 하나).
   이미 사은품 줄이 있는 주문은 빼서 두 번 들어가지 않게 함.
   이벗에는 출력차수 × 가격대 묶음마다 사은품추가 「조건10」(주문번호 목록)으로 넣는다.
============================================================ */
(function(root){
  'use strict';
  var KST = '+09:00';

  /* 'YYYY-MM-DDTHH:mm' (화면 입력, 한국 시각) → ms */
  function kstMs(s){
    s = String(s || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) return NaN;
    return Date.parse(s + (s.length === 16 ? ':00' : '') + KST);
  }
  function num(v){ var n = Number(String(v == null ? '' : v).replace(/[,\s원]/g, '')); return isFinite(n) ? n : NaN; }

  /* 설정이 쓸 수 있는 모양인지. 틀린 곳을 글로 돌려줌 */
  function check(set){
    var why = [];
    if (!set) return ['설정이 없습니다'];
    var a = kstMs(set.start), b = kstMs(set.end);
    if (!isFinite(a) || !isFinite(b)) why.push('시작·종료 일시를 넣어 주세요');
    else if (a >= b) why.push('종료 일시가 시작보다 뒤여야 합니다');
    var memos = set.memos || [];
    if (!set.all && !memos.length) why.push('증정할 묶음출력을 고르세요');
    if (set.siteAll === false && !(set.sites || []).length) why.push('증정할 판매처를 고르세요');
    var tiers = set.tiers || [];
    if (!tiers.length) why.push('가격대를 하나 이상 넣어 주세요');
    tiers.forEach(function(t, i){
      var lo = num(t.min), hi = t.max === '' || t.max == null ? Infinity : num(t.max), n = (i + 1) + '번째 가격대';
      if (!isFinite(lo) || lo < 0) why.push(n + ': 시작 금액을 넣어 주세요');
      else if (!(hi > lo)) why.push(n + ': 끝 금액이 시작보다 커야 합니다');
      if (!(t.items || []).length) why.push(n + ': 사은품 상품을 고르세요');
      (t.items || []).forEach(function(it){ if (!it.seq || !it.code || !(Number(it.qty) >= 1)) why.push(n + ': 사은품 상품 수량을 확인해 주세요'); });
    });
    /* 가격대가 겹치면 어느 쪽인지 애매해짐 */
    var sorted = tiers.map(function(t){ return { lo: num(t.min), hi: t.max === '' || t.max == null ? Infinity : num(t.max) }; }).sort(function(x, y){ return x.lo - y.lo; });
    for (var i = 1; i < sorted.length; i++) if (sorted[i].lo < sorted[i - 1].hi) { why.push('가격대가 서로 겹칩니다'); break; }
    return why;
  }

  /* 종료 일시가 지난 설정은 쓰지 않고 지움 (대표님 2026-11-08: 한 번 세팅하면 종료일까지 그대로, 지나면 자동으로 사라짐) */
  function expired(set, now){ var b = kstMs(set && set.end); return isFinite(b) && now > b; }
  /* 판매처: siteAll 이 없으면(판매처 칸 생기기 전 설정) 모두 */
  function siteOk(set, site){ return set.siteAll !== false || (set.sites || []).map(String).indexOf(String(site)) >= 0; }
  function tierOf(set, amt){
    var best = -1, bestLo = -1;
    (set.tiers || []).forEach(function(t, i){
      var lo = num(t.min), hi = t.max === '' || t.max == null ? Infinity : num(t.max);
      if (amt >= lo && amt < hi && lo > bestLo) { best = i; bestLo = lo; }
    });
    return best;
  }
  function tierLabel(t){
    var lo = num(t.min), hi = t.max === '' || t.max == null ? null : num(t.max);
    return lo.toLocaleString('ko-KR') + '원 이상' + (hi == null ? '' : ' ~ ' + hi.toLocaleString('ko-KR') + '원 미만');
  }

  /* chasu = [{ date:'20261108', ivno:'1', cnt, memo, site, cust }], rows = 이벗 주문 줄 [{ no, hap, ivdate, ivno, odate, amt, gift }]
     → { groups:[{ key, ivdate, ivno, site, memo, tier, label, nos:[주문번호], haps:[묶음번호] }] — 이벗은 묶음마다 사은품 하나, skip:{ period, range, already }, orders } */
  function plan(set, chasu, rows){
    var pick = {}, out = { groups: [], skip: { period: 0, range: 0, already: 0, nodate: 0, site: 0 }, orders: 0, chasu: [] };
    var memos = (set.memos || []).map(function(m){ return String(m).trim(); });
    (chasu || []).forEach(function(c){
      if (set.all || memos.indexOf(String(c.memo || '').trim()) >= 0) { pick[c.date + '|' + c.ivno] = c; out.chasu.push({ ivno: c.ivno, memo: c.memo || '', cnt: c.cnt }); }
    });
    var a = kstMs(set.start), b = kstMs(set.end), orders = {}, order = [];
    (rows || []).forEach(function(r){
      var k = r.ivdate + '|' + r.ivno;
      if (!pick[k] || !r.no) return;
      var o = orders[r.no];
      if (!o) { o = orders[r.no] = { no: r.no, k: k, amt: 0, gift: false, odate: r.odate, hap: r.hap || r.no, site: r.site != null ? r.site : pick[k].site }; order.push(o); }
      if (r.gift) o.gift = true; else o.amt += Number(r.amt) || 0;
      if (!o.odate && r.odate) o.odate = r.odate;
    });
    var groups = {};
    order.forEach(function(o){
      out.orders++;
      if (!siteOk(set, o.site)) { out.skip.site++; return; }
      var t = Date.parse(o.odate);
      if (!isFinite(t)) { out.skip.nodate++; return; }
      if (t < a || t > b) { out.skip.period++; return; }
      var ti = tierOf(set, o.amt);
      if (ti < 0) { out.skip.range++; return; }
      if (o.gift) { out.skip.already++; return; }
      var c = pick[o.k], gk = c.ivno + '|' + ti;
      var g = groups[gk] || (groups[gk] = { key: gk, ivdate: c.date, ivno: c.ivno, site: c.site, memo: c.memo || '', tier: ti, label: tierLabel(set.tiers[ti]), nos: [], haps: [] });
      g.nos.push(o.no);
      if (g.haps.indexOf(o.hap) < 0) g.haps.push(o.hap);
    });
    out.groups = Object.keys(groups).map(function(k){ return groups[k]; }).sort(function(x, y){ return Number(x.ivno) - Number(y.ivno) || x.tier - y.tier; });
    return out;
  }
  /* 사람이 본 건수와 지금 계산이 같은지 (묶음 key → 건수) */
  function counts(p){ var o = {}; p.groups.forEach(function(g){ o[g.key] = g.haps.length; }); return o; }
  function sameCounts(a, b){
    var ka = Object.keys(a || {}).filter(function(k){ return a[k]; }).sort(), kb = Object.keys(b || {}).filter(function(k){ return b[k]; }).sort();
    return ka.length === kb.length && ka.every(function(k, i){ return k === kb[i] && Number(a[k]) === Number(b[k]); });
  }

  var api = { kstMs: kstMs, expired: expired, siteOk: siteOk, check: check, plan: plan, tierOf: tierOf, tierLabel: tierLabel, counts: counts, sameCounts: sameCounts };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SECRETARY_GIFT = api;
})(typeof self !== 'undefined' ? self : this);
