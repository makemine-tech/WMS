/* ============================================================
   비젬 양식 엑셀을 맨소래담 / 박스앤캔 파일 2개로 나눔 (브라우저·Node 공용, 2026-11-03)

   고객 정보가 든 파일이라 화면 안에서만 계산한다. Firebase 로 보내거나 저장하지 않는다.
   판매처는 주문자이름 칸에 들어 있다. 맨소래담 판매처 3개와 정확히 같으면 맨소래담, 나머지는 박스앤캔.
   줄 내용과 칸 순서는 바꾸지 않는다.
============================================================ */
(function(root){
  'use strict';
  var COLUMN = '주문자이름', ADDRESS = '주소', HEAD_SCAN = 5;
  var MENSO_SITES = ['맨소래담-무신사', '지그재그_맨소래덤', '멘소래담_에이블리'];
  function text(v){ return String(v == null ? '' : v).trim(); }

  function split(rows){
    var at = -1, col = -1;
    for (var i = 0; i < Math.min(HEAD_SCAN, rows.length) && col < 0; i++) {
      col = (rows[i] || []).map(text).indexOf(COLUMN);
      if (col >= 0) at = i;
    }
    if (col < 0) throw new Error('「' + COLUMN + '」 칸을 찾지 못했습니다. 비젬 양식 파일이 맞는지 확인해 주세요.');
    var head = rows[at], addr = head.map(text).indexOf(ADDRESS);
    var noCol = head.map(text).indexOf('주문번호'), seen = {};
    var out = { head: head, menso: [], boxncan: [], bySite: {}, emptySite: 0, noAddress: { menso: 0, boxncan: 0 }, mensoOrders: 0 };
    rows.slice(at + 1).forEach(function(r){
      if (!(r || []).some(function(v){ return text(v) !== ''; })) return;   /* 빈 줄 */
      var site = text(r[col]), to = MENSO_SITES.indexOf(site) >= 0 ? 'menso' : 'boxncan';
      if (!site) out.emptySite++;
      var key = site || '(비어 있음)', s = out.bySite[key] || (out.bySite[key] = { name: key, count: 0, to: to });
      s.count++;
      out[to].push(r);
      if (to === 'menso' && noCol >= 0 && !seen[text(r[noCol])]) { seen[text(r[noCol])] = 1; out.mensoOrders++; }
      if (addr >= 0 && !text(r[addr])) out.noAddress[to]++;
    });
    out.sites = Object.keys(out.bySite).map(function(k){ return out.bySite[k]; }).sort(function(a, b){
      return a.to === b.to ? b.count - a.count : (a.to === 'menso' ? -1 : 1);
    });
    return out;
  }
  function fileName(kind, ymd){ return (kind === 'menso' ? '맨소래담' : '박스앤캔') + '_' + ymd + '.xlsx'; }

  var API = { split: split, fileName: fileName, MENSO_SITES: MENSO_SITES };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.BIZEM_SPLIT = API;
})(typeof window !== 'undefined' ? window : this);
