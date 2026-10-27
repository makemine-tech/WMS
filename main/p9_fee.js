/* ============================================================
   포인트나인크루 포장비 — 정산관리(settle_engine_p9.js)와 곡물도감 합포 분할(ez_split.html)이 같이 씀
   settle_engine_p9.js 에 있던 두 함수를 그대로 옮김 (2026-10-27). 룰이 바뀌면 여기 한 곳만 고친다.
   H = 머리줄 상품명 배열(0번 자리는 비움), r = 같은 자리 수량 배열
============================================================ */
(function(){
  'use strict';
  /* ── 곡물도감 포장비 ── 박스 15입1·30입2·45입3·60입4, S·C·A팩·그래놀라(낱개/세트/10개포장)·Pack 각 1 */
  function gokFee(H, r){
    var soy = [], box = 0, pre = 0, nonSoy = false, extra = 0, g = {};
    H.forEach(function(h, i){ var q = +r[i] || 0; if (!i || !q) return;
      var m = h.match(/(15|30|45|60)입/);
      if (m){ var b = { 15: 1, 30: 2, 45: 3, 60: 4 }[m[1]]; soy.push({ q: q, b: b }); box += b * q; return; }
      if (/추가송장/.test(h)){ extra += q; return; }
      nonSoy = true;
      if (/^Granola/.test(h)){ g[h] = q; return; }
      if (/^[SCA] /.test(h)){ box += q; pre += q; return; }
      box += q; });                                                    /* Pack 구성 등: 박스 1, 소분 없음 */
    var gk = Object.keys(g);
    if (gk.length === 4 && gk.every(function(k){ return g[k] === 1; })){ box += 1; pre += 1; }
    else gk.forEach(function(k){ var q = g[k]; if (q === 1) box += 1; else { var p = Math.ceil(q / 10); box += p; pre += p; } });
    if (!soy.length && !nonSoy) return extra ? { fee: 300, pre: 0, kind: '추가송장', box: 0 } : { fee: 0, pre: 0, kind: '빈줄', box: 0 };
    if (!nonSoy && soy.length === 1){ var s = soy[0];
      if (s.q === 1) return { fee: s.b === 4 ? 1500 : 300, pre: 0, kind: s.b === 4 ? '60입단독' : '완박스', box: box };
      return { fee: box <= 3 ? 300 : 1500, pre: 0, kind: '같은상품' + box + '박스', box: box }; }   /* 같은 상품 3박스까지 = 30·45입 구성과 같아 기본포장 (2026-10-08) */
    /* 섞어 담기(믹스) = 박스 수로만: 2박스까지 1,000 · 3박스↑ 1,500. S팩도 1박스로 셈 (2026-10-08 업체 클레임 — 옛 「S팩 섞이면 1,500」 폐지) */
    return { fee: box <= 2 ? 1000 : 1500, pre: pre, kind: box <= 2 ? '합포1000' : '합포1500', box: box };
  }
  /* ── 오리진케어 포장비 ── 완제품 1개 300 · 1병 1~6 1000 / 7+ 1500 · OTG 1000 · OTG+1병 1000 · 추가송장 300 */
  function oriFee(H, r){
    var c = { 병: 0, OTG: 0, 완제품: 0, 추가: 0 };
    H.forEach(function(h, i){ var q = +r[i] || 0; if (!i || !q) return; c[/^1병/.test(h) ? '병' : /OTG/.test(h) ? 'OTG' : /추가송장/.test(h) ? '추가' : '완제품'] += q; });
    if (c.완제품 === 1 && !c.병 && !c.OTG && !c.추가) return { fee: 300, kind: '완박스' };
    if (c.OTG && c.병 && !c.완제품) return { fee: 1000, kind: 'OTG+1병' };
    if (c.OTG && !c.병 && !c.완제품) return { fee: 1000, kind: 'OTG' };
    if (c.병 && !c.OTG && !c.완제품) return c.병 <= 6 ? { fee: 1000, kind: '1병 1~6' } : { fee: 1500, kind: '1병 7+' };
    if (c.추가 && !c.병 && !c.OTG && !c.완제품) return { fee: 300, kind: '추가송장' };
    if (!c.병 && !c.OTG && !c.완제품 && !c.추가) return { fee: 0, kind: '빈줄' };
    return { fee: 1000, kind: '기타섞임' };
  }
  var api = { gokFee: gokFee, oriFee: oriFee };
  if (typeof window !== 'undefined') window.P9_FEE = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
