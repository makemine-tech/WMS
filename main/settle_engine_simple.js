/* ============================================================
   정산관리 — 단순 업체들 (settle_engines.js 와 같은 형식) · 2026-10-03 대표님 설명
     엠에스컴퍼니   사입업체 — 발주가 있을 때만. 이벗 판매처 「제주맥주_박스앤캔」 중 수령자·주문자가 엠에스컴퍼니인 주문
                    제주누보 캔 × 1,500 + 택배 송장 × 2,727.3 (VAT 별도 = 3,000 VAT 포함) — 5~8월 정산서와 같은 단가
     다슈코리아     이벗 사용료 300,000 (VAT 별도)만 — 보관비·작업 줄은 0 (기록이 생기면 화물 흔적·특이사항으로)
   모든 업체 공통 화물 흔적 찾기는 settle_build.js traceCargo
============================================================ */
(function(){
  'use strict';
  var E = window.SETTLE_ENGINES = window.SETTLE_ENGINES || {};
  var R = function(t){ return { d: '2026-10-03', t: t }; };
  function nsp(v){ return String(v == null ? '' : (v.richText ? v.richText.map(function(t){ return t.text; }).join('') : v)).replace(/\s+/g, ''); }

  /* 이벗 주문목록들에서 조건에 맞는 줄 (같은 줄 중복 제거) */
  function ebut(ctx, keep){
    var box = ctx.BOX || {}, ids = Object.keys(box).filter(function(id){ return box[id].type === 'ebut_orders'; });
    if (!ids.length) return Promise.resolve(null);
    var out = [], seen = {};
    return ids.reduce(function(p, id){ return p.then(function(){ ctx.msg && ctx.msg(box[id].name + ' 읽는 중…'); return ctx.readBox(box[id]).then(function(xwb){
      var a = XLSX.utils.sheet_to_json(xwb.Sheets[xwb.SheetNames[0]], { header: 1, defval: '' }); if (!a.length) return;
      var H = a[0].map(nsp), col = function(n){ return H.indexOf(n); };
      var c = { s: col('판매처'), to: col('수령자'), by: col('주문자'), n: col('송장번호'), m: col('매칭수량'), q: col('수량'), p: col('상품명'), d: col('등록일') };
      a.slice(1).forEach(function(r){ var o = { seller: String(r[c.s]).trim(), to: String(r[c.to] || ''), by: String(r[c.by] || ''), inv: String(r[c.n] || '').trim(), m: +r[c.m] || 0, q: +r[c.q] || 0, p: String(r[c.p] || ''), d: String(r[c.d] || '').slice(0, 10) };
        if (!keep(o)) return; var k = r.join('\u0001'); if (seen[k]) return; seen[k] = 1; out.push(o); });
    }); }); }, Promise.resolve()).then(function(){ return out; });
  }
  var cansOf = function(o){ if (o.m > 0) return o.m; if (/---\s*\d+\s*개\s*\$/.test(o.p)) return o.q; var x = o.p.match(/(\d+)\s*(캔|개)/); return x ? +x[1] * (o.q || 1) : o.q; };

  E['엠에스컴퍼니_계산서미발행'] = {
    items: { 16: 'auto', 17: 'auto' }, sheets: {}, verified: { 16: true, 17: true }, opt: {},
    ruleList: [R('사입업체 — 발주가 있을 때만 청구: 이벗 판매처 「제주맥주_박스앤캔」 중 수령자·주문자가 엠에스컴퍼니인 주문 (8월 10건 240캔 = 정산서와 일치)'),
      R('제주누보 355ml = 캔 수 × 1,500 · 택배비 = 송장 수 × 2,727.3 (둘 다 VAT 별도, 택배는 3,000 VAT 포함)'), R('발주가 없는 달은 0원 — 특이사항으로 알림')],
    afterBuild: function(wb, ctx){
      var st = ctx.st, log = ctx.log, won = ctx.won;
      return ebut(ctx, function(o){ return /박스앤캔/.test(o.seller) && /엠에스/.test(o.to + o.by); }).then(function(L){
        if (!L){ log.push(['확인 필요', '파일함에 이벗 전체주문목록이 없어 엠에스컴퍼니 발주를 찾지 못했습니다']); return; }
        var cans = L.reduce(function(s, o){ return s + cansOf(o); }, 0), inv = {}; L.forEach(function(o){ if (o.inv) inv[o.inv] = 1; });
        var n = Object.keys(inv).length;
        st.getCell('M16').value = cans; st.getCell('M17').value = n;
        if (!L.length) log.push(['특이사항', '이번 달 엠에스컴퍼니 발주가 없습니다 — 0원 (보내지 않아도 되는지 확인)']);
        log.push(['자동 적용', '엠에스컴퍼니 발주 ' + L.length + '줄 · 송장 ' + n + '건 · ' + cans + '캔 → 제주누보 ' + won(cans * 1500) + ' + 택배 ' + won(n * 2727.3) + ' = 공급가 ' + won(cans * 1500 + n * 2727.3) + ' · 포함가 ' + won((cans * 1500 + n * 2727.3) * 1.1)]);
      });
    }
  };

  E['다슈코리아'] = {
    items: { 10: 'auto', 12: 'auto', 13: 'auto', 14: 'auto', 17: 'fixed' }, sheets: { '작업포장비': 'skip', '보관비': 'skip' }, verified: { 17: true }, opt: {},
    ruleList: [R('이벗 사용료 300,000 (VAT 별도)만 매달 청구'), R('보관비·다슈벤딩번들·묶음수축필름·해외배송 작업은 0 — 화물·입출고 기록에 다슈 흔적이 생기면 특이사항으로')],
    afterBuild: function(wb, ctx){
      var st = ctx.st, log = ctx.log;
      [10, 12, 13, 14].forEach(function(r){ st.getCell('G' + r).value = null; });
      log.push(['자동 적용', '이벗 사용료 300,000 (VAT 별도) → 포함가 330,000 · 보관비·작업 0']);
    }
  };
})();
