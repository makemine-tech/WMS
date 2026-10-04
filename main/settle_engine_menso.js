/* ============================================================
   정산관리 — 멘소래담 (2026-10-03 대표님 9월 확정본·배송비 원본·초안 3개 비교로 정한 룰)
     · 택배비 리스트(멘소래담 배송비 내보내기)에서 출력양식 「누락오배송」 줄은 빼고(청구 제외)
     · 판매처명 「맨소래담_연동몰」 줄은 이벗 전체주문목록에서 같은 송장번호의 「주문자」(맨소래담-무신사·멘소래담_에이블리·지그재그_맨소래덤)로 바꿈
     · 택배크기는 기본 「극소」
     · 추가운임 = 이벗 주소가 제주인 송장 400 (공통 shipSheetFinish)
     · 시트: 토탈배송비(전부) + 판매처별 스마트스토어배송·무신사·에이블리·화해·지그재그·기타 — 시트 이름 뒤 건수를 이번 달 건수로(예: 무신사_669건)
     · 거래명세표 택배발송(극소) = 토탈배송비 택배크기 COUNTIF, 항공비 = 추가운임 있는 줄 수
============================================================ */
(function(){
  'use strict';
  var E = window.SETTLE_ENGINES = window.SETTLE_ENGINES || {};
  var R = function(t){ return { d: '2026-10-03', t: t }; };
  function ns(v){ if (v && v.richText) v = v.richText.map(function(t){ return t.text; }).join(''); return String(v == null ? '' : v).replace(/\s+/g, ''); }
  /* 판매처 → 시트 이름 앞부분 */
  var GROUPS = [['스마트스토어배송', /스마트스토어/], ['무신사', /무신사/], ['에이블리', /에이블리/], ['화해', /화해/], ['지그재그', /지그재그/], ['기타', /.*/]];

  E['멘소래담'] = {
    /* 18 스마트스토어 관리 · 19 솔루션비용 · 20 외부몰 관리 = 매달 같은 금액(지난달 그대로)
       8 택배발송(극소) · 12 항공비 = 9월 배송비 원본으로 돌려 9월 확정본과 줄 단위 일치(2026-10-03) */
    items: { 8: 'auto', 9: 'auto', 10: 'auto', 11: 'auto', 12: 'auto', 18: 'fixed', 19: 'fixed', 20: 'fixed' }, sheets: {}, verified: { 8: true, 9: true, 10: true, 11: true, 12: true }, opt: {},
    ownSheets: /^(토탈배송비|스마트스토어배송|무신사|에이블리|화해|지그재그|기타|\d{4}_전산재고)/,   /* 이 엔진이 채우는 시트 (이름 뒤 건수·앞 날짜가 달마다 바뀜) */
    verifiedSheets: /^(토탈배송비|스마트스토어배송|무신사|에이블리|화해|지그재그|기타)/,   /* 9월 확정본과 줄 단위 일치 확인 */
    ruleList: [R('택배비 리스트에서 출력양식 「누락오배송」 줄은 청구 제외'), R('판매처 「맨소래담_연동몰」 = 이벗 전체주문목록 같은 송장번호의 주문자(무신사·에이블리·지그재그)로 바꿔 시트 나눔'),
      R('택배크기 기본 「극소」'), R('추가운임 = 이벗 주소가 제주인 송장 400'), R('시트 = 토탈배송비 + 판매처별(스마트스토어배송·무신사·에이블리·화해·지그재그·기타), 시트 이름 건수는 이번 달 건수'),
      { d: '2026-10-04', t: '스마트스토어 관리 300,000 · 솔루션비용 50,000 · 외부몰 관리 200,000 = 매달 그대로' },
      { d: '2026-10-04', t: '전산재고 시트 = 이번 달 이벗 재고현황 통째로(상품명 순), 시트 이름은 말일(예: 0930_전산재고)' }],
    afterBuild: function(wb, ctx){
      var st = ctx.st, log = ctx.log, box = ctx.BOX || {};
      var ids = function(t){ return Object.keys(box).filter(function(id){ return box[id].type === t; }); };
      var read = function(t){ return ids(t).reduce(function(p, id){ return p.then(function(acc){ ctx.msg && ctx.msg(box[id].name + ' 읽는 중…'); return ctx.readBox(box[id]).then(function(x){ acc.push(x); return acc; }); }); }, Promise.resolve([])); };
      var orderer = {};
      return read('ebut_orders').then(function(F){
        F.forEach(function(x){ var a = XLSX.utils.sheet_to_json(x.Sheets[x.SheetNames[0]], { header: 1, defval: '' }); if (!a.length) return;
          var H = a[0].map(ns), iN = H.indexOf('송장번호'), iB = H.indexOf('주문자'); if (iN < 0 || iB < 0) return;
          a.slice(1).forEach(function(r){ var v = String(r[iN] || '').trim(); if (v && r[iB]) orderer[v] = String(r[iB]).trim(); }); });
        return read('ebut_shiplist');
      }).then(function(F){
        if (!F.length){ log.push(['확인 필요', '택배비 리스트(멘소래담 배송비)가 파일함에 없어 배송비 시트를 못 채움 — 올리고 초안 다시 받기']); return; }
        var head = null, rows = [], drop = 0, moved = 0, seen = {};
        F.forEach(function(x){ x.SheetNames.forEach(function(n){ var a = XLSX.utils.sheet_to_json(x.Sheets[n], { header: 1, defval: '' }); if (!a.length) return;
          var H = a[0].map(ns); if (H.indexOf('택배크기') < 0) return; head = head || a[0].map(String);
          var iS = H.indexOf('판매처명'), iO = H.indexOf('출력양식'), iV = H.indexOf('송장번호'), iZ = H.indexOf('택배크기');
          a.slice(1).forEach(function(r){ if (!r.some(function(v){ return v !== ''; })) return;
            var sv = String(r[iS] || ''), ov = String(r[iO] || '');
            if (!/맨소|멘소|맨소래덤/.test(sv + ov)) return;                       /* 섞인 내보내기면 멘소래담 줄만 */
            if (/누락오배송/.test(ov)){ drop++; return; }
            var k = String(r[iV]) + '\u0001' + String(r[4] || ''); if (seen[k]) return; seen[k] = 1;
            r = r.slice();
            if (/연동몰/.test(sv)){ var o = orderer[String(r[iV] || '').trim()]; if (o){ r[iS] = o; moved++; } }
            if (iZ >= 0 && !String(r[iZ] || '').trim()) r[iZ] = '극소';
            rows.push(r); }); }); });
        if (!head){ log.push(['확인 필요', '택배비 리스트에서 택배크기 열을 못 찾음']); return; }
        var H = head.map(ns), iS = H.indexOf('판매처명'), left = rows.filter(function(r){ return /연동몰/.test(r[iS]); }).length;
        /* 토탈 + 판매처별 시트 */
        var names = wb.worksheets.map(function(w){ return w.name; }), byPre = function(pre){ return names.filter(function(n){ return n.indexOf(pre) === 0; })[0]; };
        var made = [];
        var tot = byPre('토탈배송비'); if (tot){ replaceSheet(wb, tot, head, rows); made.push([tot, null]); }
        var used = {};
        GROUPS.forEach(function(g){ var sn = byPre(g[0]); if (!sn) return;
          var part = rows.filter(function(r, i){ if (used[i]) return false; var hit = g[0] === '기타' ? true : g[1].test(String(r[iS])); if (hit) used[i] = 1; return hit; });
          replaceSheet(wb, sn, head, part);
          var nn = g[0] + '_' + part.length + '건', w = wb.getWorksheet(sn); if (w && sn !== nn && !wb.getWorksheet(nn)) w.name = nn;
          made.push([nn, part.length]); });
        log.push(['자동 적용', '배송비 ' + rows.length + '건 (누락오배송 ' + drop + '건 제외 · 연동몰 ' + moved + '건 → 이벗 주문자로) · 택배크기 기본 극소 · 시트 ' + made.filter(function(m){ return m[1] != null; }).map(function(m){ return m[0]; }).join(' · ')]);
        if (left) log.push(['특이사항', '판매처 「맨소래담_연동몰」 ' + left + '건은 이벗 주문목록에서 주문자를 못 찾아 그대로(기타 시트) — 확인']);
        /* 추가운임·건수 수식 (토탈 기준) */
        return made.reduce(function(p, m, i){ return p.then(function(){ return window.shipSheetFinish(wb, m[0], i === 0 ? st : null, ctx, { noSizeYellow: true }); }); }, Promise.resolve());
      }).then(function(){
        /* 전산재고 = 이번 달 이벗 재고현황 통째로, 이름은 말일 MMDD_전산재고 */
        var sn = wb.worksheets.map(function(w){ return w.name; }).filter(function(n){ return /^\d{4}_전산재고$/.test(n); })[0]; if (!sn) return;
        var Y = +ctx.YM.slice(0, 4), M = +ctx.YM.slice(5, 7), nn = ('0' + M).slice(-2) + ('0' + new Date(Date.UTC(Y, M, 0)).getUTCDate()).slice(-2) + '_전산재고';
        return read('ebut_stock').then(function(F){
          if (!F.length){ log.push(['확인 필요', '이벗 재고현황이 파일함에 없어 「' + sn + '」 시트는 지난달 그대로 — 올리고 초안 다시 받기']); return; }
          var best = null;
          F.forEach(function(x){ x.SheetNames.forEach(function(n){ var a = XLSX.utils.sheet_to_json(x.Sheets[n], { header: 1, defval: '' });
            for (var i = 0; i < Math.min(a.length, 12); i++) if (a[i].map(ns).indexOf('가용재고수량') >= 0){ var r = a.slice(i + 1).filter(function(r){ return r.some(function(v){ return v !== ''; }); }); if (!best || r.length > best.rows.length) best = { head: a[i].map(String), rows: r }; break; } }); });
          if (!best){ log.push(['확인 필요', '이벗 재고현황에서 가용재고수량 제목줄을 못 찾아 「' + sn + '」 시트는 지난달 그대로']); return; }
          var iP = best.head.map(ns).indexOf('상품명');   /* 상품명 순 (2026-10-01 9월분 만들 때 룰) */
          if (iP >= 0) best.rows.sort(function(a, b){ return String(a[iP]).localeCompare(String(b[iP]), 'ko'); });
          replaceSheet(wb, sn, best.head, best.rows);
          var w = wb.getWorksheet(sn); if (w && sn !== nn && !wb.getWorksheet(nn)) w.name = nn;
          log.push(['자동 적용', '시트 「' + nn + '」 ← 이벗 재고현황 ' + best.rows.length + '품목']);
        });
      }).then(function(){
        /* 반품비 — 고르는 룰 미정: 8월 박스앤캔 반품 시트 맨소래담 15건 중 확정본은 10건만 청구 (2026-10-04 대표님께 질문 중) */
        return read('bnc_courier').then(function(F){
          var n = 0; F.forEach(function(x){ var w = x.Sheets['반품']; if (!w) return; XLSX.utils.sheet_to_json(w, { header: 1, defval: '' }).forEach(function(r){ if (/맨소|멘소/.test(String(r[2]))) n++; }); });
          log.push(['특이사항', '반품비 시트는 지난달 그대로 — 고르는 룰 미정' + (F.length ? ' (이번 달 박스앤캔 반품 시트에 맨소래담 ' + n + '건)' : ' (박스앤캔 택배비 파일 없음)')]);
        });
      });
    }
  };
})();
