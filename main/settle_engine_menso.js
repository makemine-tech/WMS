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
    items: { 8: 'auto', 9: 'auto', 10: 'auto', 11: 'auto', 12: 'auto' }, sheets: {}, verified: {}, opt: {},
    ownSheets: /^(토탈배송비|스마트스토어배송|무신사|에이블리|화해|지그재그|기타)/,   /* 이 엔진이 채우는 시트 (이름 뒤 건수가 달마다 바뀜) */
    ruleList: [R('택배비 리스트에서 출력양식 「누락오배송」 줄은 청구 제외'), R('판매처 「맨소래담_연동몰」 = 이벗 전체주문목록 같은 송장번호의 주문자(무신사·에이블리·지그재그)로 바꿔 시트 나눔'),
      R('택배크기 기본 「극소」'), R('추가운임 = 이벗 주소가 제주인 송장 400'), R('시트 = 토탈배송비 + 판매처별(스마트스토어배송·무신사·에이블리·화해·지그재그·기타), 시트 이름 건수는 이번 달 건수')],
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
      });
    }
  };
})();
