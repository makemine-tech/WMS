/* ============================================================
   AI 물류비서 — 주문 매칭 도움 (secretary_match.html 짝꿍, 브라우저·Node 공용, 2026-11-01)

   매칭은 사람이 한다(대표님 2026-11-01). 여기서는 실수하기 쉬운 상품명을 알려 주고 예상 상품을 앞에 놓을 뿐,
   상품과 수량을 정하지 않는다. 주의 유형은 이벗 기존 매칭 3,000줄에서 실제로 나온 것들이다.
============================================================ */
(function(root){
  'use strict';
  var COUNT = /(\d+)\s*(?:개|입|팩|pack|세트|set)/i;
  var LIMIT = 12;

  function countIn(s){
    var t = String(s || ''), m = t.match(COUNT) || t.match(/x\s*(\d+)/i) || t.match(/(\d+)\s*x(?:\s|$)/i);
    return m ? Number(m[1]) : null;
  }

  function warnings(name, opt){
    var n = String(name || ''), o = String(opt || ''), out = [], a = countIn(n), b = countIn(o);
    if (b != null && a != null && a !== b) out.push({ kind: 'option', text: '상품명은 ' + a + '개, 옵션은 ' + b + '개입니다. 옵션이 우선입니다.' });
    else if (b != null && a == null) out.push({ kind: 'option', text: '옵션에 수량 ' + b + '개가 있습니다. 주문수량과 곱해서 넣어 주세요.' });
    else if (a != null && a > 1 && !o) out.push({ kind: 'count', text: '상품명에 ' + a + '개가 있습니다. 주문수량과 곱해서 넣어 주세요.' });
    if (/1\s*\+\s*1|\d\s*pack/i.test(n + ' ' + o)) out.push({ kind: 'pack', text: '1+1 또는 묶음 상품입니다. 실제 나가는 수량을 확인해 주세요.' });
    if (/\s\+\s|세트|\bset\b|\d종/i.test(n)) out.push({ kind: 'set', text: o ? '세트 이름이어도 옵션에 고른 내용대로 매칭합니다. 옵션을 확인해 주세요.' : '세트 상품입니다. 구성품마다 따로 넣어 주세요.' });
    if (/증정/.test(n + ' ' + o)) out.push({ kind: 'gift', text: '증정품이 있습니다. 본품 외에 증정 상품도 넣어 주세요.' });
    return out;
  }

  /* 상품명·옵션의 낱말로 후보 순서만 매긴다. 광고 문구와 대괄호 꼬리표는 뺀다 */
  function tokens(name, opt){
    var s = (String(name || '') + ' ' + String(opt || '')).replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ').replace(/선택\s*:|수량\s*:|증정\s*:/g, ' ').replace(/[,+/:×]/g, ' ');
    var seen = {};
    return s.split(/\s+/).filter(function(t){
      if (t.length < 2 || COUNT.test(t) && !/ml|g$/i.test(t) || seen[t]) return false;
      seen[t] = true;
      return true;
    });
  }
  function squeeze(s){ return String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase(); }

  function candidates(name, opt, masters, query){
    var words = query ? String(query).split(/\s+/).filter(Boolean) : tokens(name, opt);
    return (masters || []).map(function(m){
      var hay = squeeze(m.name + ' ' + (m.nick || '') + ' ' + (m.opt || '')), score = 0;
      words.forEach(function(w){ if (hay.indexOf(squeeze(w)) >= 0) score += /\d/.test(w) ? 3 : 2; });
      return { m: m, score: score };
    }).filter(function(x){ return x.score > 0 && (!query || words.every(function(w){ return squeeze(x.m.name + ' ' + (x.m.nick || '') + ' ' + (x.m.opt || '')).indexOf(squeeze(w)) >= 0; })); })
      .sort(function(a, b){ return b.score - a.score || String(a.m.name).localeCompare(String(b.m.name), 'ko'); })
      .slice(0, query ? LIMIT * 3 : LIMIT).map(function(x){ return x.m; });
  }

  function itemKey(name, opt, qty){
    var s = name + '|' + opt + '|' + qty, h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return 'm' + h.toString(36) + s.length.toString(36);
  }

  /* 입력이 끝났는지. 수량을 비서가 판단하지 않고 빠진 것만 본다 */
  function draftReady(item, draft){
    var picks = (draft && draft.picks) || [];
    if (!picks.length || !picks.every(function(p){ return p.code && Number(p.qty) >= 1 && Number.isInteger(Number(p.qty)); })) return false;
    return !warnings(item.name, item.opt).length || !!(draft && draft.checked);
  }

  var API = { warnings: warnings, tokens: tokens, candidates: candidates, itemKey: itemKey, draftReady: draftReady, countIn: countIn };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.SECRETARY_MATCH = API;
})(typeof window !== 'undefined' ? window : this);
