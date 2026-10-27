/* ============================================================
   이지어드민 합포 분할 도우미 — 곡물도감 합포 분할(ez_split.html) 짝꿍 (2026-10-27)

   이지어드민 「일괄합포제외(DG00)」 화면이 열린 탭에서 즐겨찾기 버튼으로 실행한다.
     javascript:(function(){var s=document.createElement('script');s.src='https://makewon.com/ez_helper.js?v='+Date.now();document.head.appendChild(s);})();
   이지어드민 탭 안에서 돌기 때문에 대표님 로그인을 그대로 쓴다 (비밀번호·키 없음).
   합포 분할 페이지와 postMessage 로만 이야기한다 — 허용한 주소(ALLOW)에서 온 요청만 받는다.

   명령
     ping  → { ver, page }                       page = 'DG00' 이면 일괄합포제외 화면
     read  → { rows: [{ recv, seq, pack_seq, product_seq, product_id, name, options, qty, divided }], total }
             화면 표(#grid1)의 줄 전부. total = 이지어드민이 말하는 전체 줄 수 (다르면 일부만 읽힌 것)
     fill  { packs: [{ pack_seq, lines: [{ product_seq, product_id, qty, boxes: [{ no, qty }] }] }] }
             → { done: [pack_seq], skipped: [{ pack_seq, why }] }
             손으로 할 때와 같은 화면 조작: 줄 체크 + 수량 입력 → 「복수제외」 (박스 번호 1, 2, 3… 차례로)
             모든 상품이 박스에 들어가면 이지어드민이 박스 1 을 원래 송장으로 쓴다. 저장하지 않는다.
             채우기 직전에 묶음의 상품·수량을 다시 대조해서 다르면 건너뛴다. 이미 나뉜 묶음도 건너뛴다.
     reset { packs: [pack_seq] } → { done }      묶음별 「초기화」 (채운 것 되돌리기)
     commit { auto: true } → { error, fail_list }  「일괄합포제외」 실행 — 자동 확정 스위치를 켠 페이지만 보낸다.
             「제외실행」 버튼은 묶음마다 바로 저장되므로 절대 누르지 않는다.
============================================================ */
(function(){
  'use strict';
  if (!/(^|\.)ezadmin\.co\.kr$/.test(location.hostname)){ alert('이지어드민(ezadmin.co.kr) 탭에서 눌러 주세요.'); return; }
  var VER = '2026-10-27c';
  var old = window.__mkwEzHelper;
  if (old){
    if (old.ver === VER){ old.hello(); return; }
    old.stop();
  }
  var ALLOW = /^https:\/\/(www\.)?makewon\.com$|^https:\/\/makechango-wms\.(web\.app|firebaseapp\.com)$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
  var PAGE = 'https://makewon.com/ez_split.html';
  var $ = window.jQuery;

  /* ── 화면 오른쪽 아래 작은 상태 표시 ── */
  var box = document.createElement('div');
  box.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483647;background:#0d0f14;color:#e8eaf0;border:2px solid #4af0a8;'
    + 'border-radius:12px;padding:10px 14px;font:13px/1.6 "Noto Sans KR",sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.4);max-width:320px';
  box.innerHTML = '<b style="color:#4af0a8">📦 이지어드민 합포 분할 도우미</b> <span style="color:#6b7280;font-size:11px">' + VER + '</span><div id="mkwEzMsg">준비 중…</div>'
    + '<div style="margin-top:6px;font-size:11px;color:#6b7280">이 탭을 닫거나 다른 페이지로 옮기면 연결이 끊깁니다</div>';
  document.body.appendChild(box);
  function say(t){ var m = document.getElementById('mkwEzMsg'); if (m) m.textContent = t; }

  function isDG00(){ return /template=DG00/.test(location.search) && !!document.getElementById('grid1'); }
  function txt(el){ return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }   /* textContent: innerText 는 칸마다 화면 다시 계산이라 느림 */
  function cell(tr, c){ return tr.querySelector('td.' + c); }
  function gridRows(){ return Array.prototype.filter.call(document.querySelectorAll('#grid1 > tbody > tr'), function(tr){ return !!cell(tr, 'pack_seq'); }); }
  function span(tr){ var td = cell(tr, 'divide_pack_no'); return td && td.querySelector('span'); }
  function divided(tr){ var s = span(tr); return !!s && Number(s.getAttribute('total_qty')) > 0; }

  /* ── 읽기 ── */
  function cmdRead(){
    if (!isDG00()) throw new Error('일괄합포제외(DG00) 화면이 아닙니다');
    var recv = '', last = null;
    var rows = gridRows().map(function(tr){
      var p = txt(cell(tr, 'pack_seq'));
      if (p !== last){ last = p; recv = txt(cell(tr, 'recv_name')); }
      return { recv: recv, seq: txt(cell(tr, 'seq')), pack_seq: p, product_seq: txt(cell(tr, 'product_seq')), product_id: txt(cell(tr, 'product_id')),
               name: txt(cell(tr, 'product_name')), options: txt(cell(tr, 'options')), qty: txt(cell(tr, 'qty')), divided: divided(tr) };
    });
    var total = rows.length;
    try { if ($) total = Number($('#grid1').getGridParam('records')) || rows.length; } catch(e){}
    return { rows: rows, total: total };
  }

  /* ── 채우기 ── */
  function packRows(p){ return gridRows().filter(function(tr){ return txt(cell(tr, 'pack_seq')) === String(p); }); }
  function clickIn(tr, cls){ var b = tr.querySelector('.' + cls); if (!b) throw new Error(cls + ' 버튼 없음'); b.click(); }
  function fillPack(pk){
    var trs = packRows(pk.pack_seq);
    if (!trs.length) return '묶음 없음 (이지어드민에서 다시 검색됐거나 지워짐)';
    if (trs.some(divided)) return '이미 나뉨';
    if (trs.length !== pk.lines.length) return '상품 줄 수가 바뀜';
    var byTr = [];
    for (var i = 0; i < trs.length; i++){
      var tr = trs[i], ps = txt(cell(tr, 'product_seq'));
      var ln = pk.lines.filter(function(l){ return String(l.product_seq) === ps; })[0];
      if (!ln || String(ln.product_id) !== txt(cell(tr, 'product_id')) || Number(ln.qty) !== Number(txt(cell(tr, 'qty')))) return '상품·수량이 바뀜';
      byTr.push({ tr: tr, ln: ln });
    }
    var maxNo = 0;
    pk.lines.forEach(function(l){ l.boxes.forEach(function(b){ maxNo = Math.max(maxNo, b.no); }); });
    var alerted = null, oldAlert = window.alert;
    window.alert = function(m){ alerted = String(m); };
    try {
      for (var no = 1; no <= maxNo && !alerted; no++){
        byTr.forEach(function(x){
          var b = x.ln.boxes.filter(function(bx){ return bx.no === no; })[0];
          var chk = x.tr.querySelector('input.pack_checkbox'), q = x.tr.querySelector('input.pack_check_qty');
          if (!chk || !q) return;
          chk.checked = !!b;
          if (b){ q.value = String(b.qty); q.style.visibility = 'visible'; }
        });
        clickIn(trs[0], 'divide_pack_btn');
      }
    } finally { window.alert = oldAlert; }
    var ok = !alerted && byTr.every(function(x){ var s = span(x.tr); return s && Number(s.getAttribute('total_qty')) === Number(x.ln.qty); });
    if (!ok){ try { clickIn(trs[0], 'divide_reset_btn'); } catch(e){} return alerted ? '이지어드민: ' + alerted : '채운 수량이 맞지 않아 되돌림'; }
    return null;
  }
  function cmdFill(args){
    if (!isDG00()) throw new Error('일괄합포제외(DG00) 화면이 아닙니다');
    var done = [], skipped = [];
    (args.packs || []).forEach(function(pk){
      var why;
      try { why = fillPack(pk); } catch(e){ why = '오류: ' + e.message; }
      if (why) skipped.push({ pack_seq: pk.pack_seq, why: why }); else done.push(pk.pack_seq);
    });
    return { done: done, skipped: skipped };
  }
  function cmdReset(args){
    if (!isDG00()) throw new Error('일괄합포제외(DG00) 화면이 아닙니다');
    var done = [];
    (args.packs || []).forEach(function(p){ var trs = packRows(p); if (trs.length){ clickIn(trs[0], 'divide_reset_btn'); done.push(p); } });
    return { done: done };
  }

  /* ── 확정 (자동 확정 스위치를 켠 페이지만) ── 이지어드민 「일괄합포제외」 버튼을 누르고(확인창은 한 번만 통과) 서버 응답을 받아 돌려줌 */
  function cmdCommit(args){
    if (!args || args.auto !== true) throw new Error('자동 확정이 꺼져 있습니다');
    var btn = document.getElementById('divide_pack_all');
    if (!isDG00() || !btn || !$) throw new Error('일괄합포제외 버튼을 찾지 못했습니다');
    return new Promise(function(res, rej){
      var post = $.post, conf = window.confirm, t;
      function restore(){ $.post = post; window.confirm = conf; clearTimeout(t); }
      window.confirm = function(){ window.confirm = conf; return true; };
      /* 보내는 값이 객체든 serialize 문자열이든, 응답이 문자열이든 이미 객체(json)든 읽음.
         결과를 먼저 돌려준 뒤 이지어드민 콜백을 부름 — 콜백이 화면을 새로 그리거나 옮겨도 페이지는 「저장됨」을 받음 */
      function isDrop(d){ return d && (typeof d === 'string' ? /(^|&)action=drop_pack_all(&|$)/.test(d) : d.action === 'drop_pack_all'); }
      function parse(resp){
        if (resp && typeof resp === 'object') return resp;
        try { return JSON.parse(resp); } catch(e){}
        try { return eval('(' + resp + ')'); } catch(e){ return null; }
      }
      $.post = function(url, data, cb){
        if (isDrop(data)){
          var rest = Array.prototype.slice.call(arguments, 3);
          return post.apply($, [url, data, function(resp){
            restore();
            var r = parse(resp);
            if (r) res({ error: r.error, fail_list: r.fail_list || [] }); else rej(new Error('이지어드민 응답을 읽지 못했습니다 (저장됐을 수 있음 — 이지어드민 화면 확인)'));
            try { if (typeof cb === 'function') cb.apply(this, arguments); } catch(e){}
          }].concat(rest));
        }
        return post.apply($, arguments);
      };
      t = setTimeout(function(){ restore(); rej(new Error('TIMEOUT')); }, 180000);
      try { btn.click(); } catch(e){ restore(); rej(e); }
    });
  }

  var CMDS = { ping: function(){ return { ver: VER, page: isDG00() ? 'DG00' : '' }; }, read: cmdRead, fill: cmdFill, reset: cmdReset, commit: cmdCommit };
  var SAYS = { read: '주문 줄 읽는 중…', fill: '분할 채우는 중… (저장 안 함)', reset: '되돌리는 중…', commit: '일괄합포제외 실행 중…' };
  function onMsg(e){
    var m = e.data;
    if (!m || m.to !== 'ez-helper' || !ALLOW.test(e.origin)) return;
    var run = CMDS[m.cmd];
    if (!run) return;
    peer = e.source;
    if (SAYS[m.cmd]) say(SAYS[m.cmd]);
    Promise.resolve().then(function(){ return run(m.args || {}); }).then(function(data){
      e.source.postMessage({ from: 'ez-helper', id: m.id, ok: true, data: data }, e.origin);
      say(m.cmd === 'ping' ? (data.page ? '🟢 합포 분할 페이지와 연결됨' : '⚠️ 일괄합포제외(DG00) 화면으로 가 주세요') : '✔ 완료 — 🟢 연결됨');
    }, function(err){
      var msg = String((err && err.message) || err);
      e.source.postMessage({ from: 'ez-helper', id: m.id, ok: false, err: msg }, e.origin);
      say('⚠️ ' + msg);
    });
  }
  window.addEventListener('message', onMsg);

  /* 합포 분할 페이지 찾기: 이 탭을 연 창(opener) → 없으면 새로 열기 */
  var peer = null;
  function hello(){
    var target = null;
    try { if (window.opener && !window.opener.closed) target = window.opener; } catch(e){}
    if (!target) target = window.open(PAGE, 'mkw_ez_split');
    if (target){ target.postMessage({ from: 'ez-helper', cmd: 'ready', ver: VER }, '*'); say('합포 분할 페이지와 연결 중… (그쪽 화면에 🟢 이 뜨면 연결됨)'); }
    else say('⚠️ 팝업이 막혔습니다 — 주소창 오른쪽에서 팝업 허용 후 다시 눌러 주세요');
  }
  function stop(){ window.removeEventListener('message', onMsg); box.remove(); }
  window.__mkwEzHelper = { hello: hello, ver: VER, stop: stop, read: cmdRead, fill: cmdFill, reset: cmdReset, commit: cmdCommit };
  hello();
})();
