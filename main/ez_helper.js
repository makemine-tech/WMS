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
     printPrep { from, to } → { token, count, dates, shops, printer, template, problems }
             송장출력(S700)을 이 탭 안 보이는 창틀로 열어 양식·즉시출력·공급처·발주일·프린터를 맞추고 검색 + 전체 체크. 출력은 안 누른다.
     printGo { confirm: true, token, count } → { started }  준비한 그대로일 때만 「송장출력」을 한 번 누름. token 은 한 번만 쓴다.
     printStatus → { waiting, complete, err, cancel, change, errRows, busy, alerts }
============================================================ */
(function(){
  'use strict';
  if (!/(^|\.)ezadmin\.co\.kr$/.test(location.hostname)){ alert('이지어드민(ezadmin.co.kr) 탭에서 눌러 주세요.'); return; }
  var VER = '2026-10-31b';
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

  /* ── 검색 ── 공급처(이름이 정확히 같은 것)·발주일을 넣고 「검색(F2)」 → 이지어드민 로딩 표시(#load_grid1)가 사라지면 읽음
     공급처·날짜 말고 다른 검색 조건은 화면에 있던 그대로 둔다 */
  function cmdSearch(args){
    if (!isDG00()) throw new Error('일괄합포제외(DG00) 화면이 아닙니다');
    var sel = document.getElementById('str_supply_code'), btn = document.getElementById('search'), ld = document.getElementById('load_grid1');
    var sd = document.querySelector('input[name=start_date]'), ed = document.querySelector('input[name=end_date]'), dt = document.getElementById('date_type');
    if (!sel || !btn || !sd || !ed) throw new Error('검색 칸을 찾지 못했습니다');
    var name = String(args.supplier || '곡물도감'), opt = null;
    for (var i = 0; i < sel.options.length; i++) if (String(sel.options[i].text).trim() === name) opt = sel.options[i];
    if (!opt) throw new Error('공급처 「' + name + '」를 이지어드민 목록에서 찾지 못했습니다');
    /* 발주일 기간: from~to (예전 페이지는 date 하루) */
    var from = String(args.from || args.date || ''), to = String(args.to || args.date || ''), ymd = /^\d{4}-\d{2}-\d{2}$/;
    if (!ymd.test(from) || !ymd.test(to)) throw new Error('발주일이 올바르지 않습니다');
    if (from > to) throw new Error('시작일이 끝일보다 늦습니다');
    sel.value = opt.value;
    if (dt) dt.value = 'collect_date';
    sd.value = from; ed.value = to;
    var limit = Number(args.ms) || 90000, t0 = Date.now(), shown = false;
    function loading(){ return !!ld && window.getComputedStyle(ld).display !== 'none'; }
    return new Promise(function(res, rej){
      btn.click();
      (function wait(){
        if (loading()) shown = true;
        /* 로딩 표시가 한 번 보였다 사라졌거나, 1.5초가 지나도록 안 보였으면 끝난 것으로 봄 */
        if (!loading() && (shown || Date.now() - t0 > 1500)){ try { res(cmdRead()); } catch(e){ rej(e); } return; }
        if (Date.now() - t0 > limit){ rej(new Error('검색이 ' + Math.round(limit / 1000) + '초 안에 끝나지 않았습니다')); return; }
        setTimeout(wait, 200);
      })();
    });
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

  /* ── 확정 ── 페이지의 「일괄합포제외 실행」 버튼(confirm:true) 또는 자동 확정 스위치(auto:true)일 때만.
     lockUnpack 이면 이지어드민 「자동합포금지」 칸을 켠 뒤 실행 → 나눈 주문이 새 주문 수집 때 다시 합쳐지지 않음 (대표님 2026-10-27)
     이지어드민 「일괄합포제외」 버튼을 누르고(확인창은 한 번만 통과) 서버 응답을 받아 돌려줌 */
  function cmdCommit(args){
    if (!args || (args.auto !== true && args.confirm !== true)) throw new Error('자동 확정이 꺼져 있습니다');
    var btn = document.getElementById('divide_pack_all');
    if (!isDG00() || !btn || !$) throw new Error('일괄합포제외 버튼을 찾지 못했습니다');
    var lock = document.getElementById('auto_lock_unpack');
    if (args.lockUnpack){
      if (!lock || lock.type !== 'checkbox') throw new Error('이지어드민 「자동합포금지」 칸을 찾지 못해 실행하지 않았습니다');
      lock.checked = true;
    }
    var sentLock = null;
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
          var m = typeof data === 'string' ? data.match(/(?:^|&)auto_lock_unpack=(\d)/) : null;
          sentLock = m ? Number(m[1]) : (data.auto_lock_unpack != null ? Number(data.auto_lock_unpack) : null);
          return post.apply($, [url, data, function(resp){
            restore();
            var r = parse(resp);
            if (r) res({ error: r.error, fail_list: r.fail_list || [], lock: sentLock, raw: String(typeof resp === 'string' ? resp : JSON.stringify(resp)).slice(0, 500) });
            else rej(new Error('이지어드민 응답을 읽지 못했습니다 (저장됐을 수 있음 — 이지어드민 화면 확인): ' + String(resp).slice(0, 200)));
            try { if (typeof cb === 'function') cb.apply(this, arguments); } catch(e){}
          }].concat(rest));
        }
        return post.apply($, arguments);
      };
      t = setTimeout(function(){ restore(); rej(new Error('TIMEOUT')); }, 180000);
      try { btn.click(); } catch(e){ restore(); rej(e); }
    });
  }

  /* ── 송장출력 (S700) ── 일괄합포제외 탭을 떠나면 도우미가 꺼지므로 같은 탭 안 창틀로 열어 조종한다 (2026-10-31)
     출력은 printGo 한 번뿐 · 그 안의 확인창은 「송장을 출력하시겠습니까?」 그대로일 때만 통과 (재출력 문구가 붙으면 거절) */
  var P_TEMPLATE = '우체국택배_곡물도감/셀시오스', P_SUPPLIER = '곡물도감', P_PRINTER = /BIXOLON\s*SLP/i;
  var P = { panel: null, win: null, token: '', count: 0, started: false, alerts: [], arm: false };
  function printAsk(msg){ return String(msg || '').trim() === '송장을 출력하시겠습니까?'; }
  function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
  function pGone(){ if (P.panel) P.panel.remove(); P.panel = null; P.win = null; P.token = ''; }
  function pOpen(){
    if (P.started) return Promise.reject(new Error('이미 출력 중입니다 — 끝난 뒤 다시 해 주세요'));
    pGone();
    P.alerts = []; P.arm = false;
    var panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;left:2%;top:2%;width:96%;height:86%;z-index:2147483646;background:#fff;border:2px solid #4af0a8;border-radius:10px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.5)';
    panel.innerHTML = '<div style="height:30px;line-height:30px;padding:0 12px;background:#0d0f14;color:#4af0a8;font:700 13px \'Noto Sans KR\',sans-serif">🖨 도우미가 조종하는 송장출력 화면 — 끝날 때까지 이 탭을 닫지 마세요</div>';
    var fr = document.createElement('iframe');
    fr.style.cssText = 'width:100%;height:calc(100% - 30px);border:0';
    P.panel = panel;
    panel.appendChild(fr);
    document.body.appendChild(panel);
    return new Promise(function(res, rej){
      var t = setTimeout(function(){ rej(new Error('송장출력 화면이 열리지 않았습니다')); }, 40000);
      fr.onload = function(){
        clearTimeout(t);
        var w = fr.contentWindow;
        /* 창틀 안 알림은 멈추지 않게 기록만, 확인창은 printGo 가 켠 때 + 정해진 문구만 통과 */
        w.alert = function(m){ P.alerts.push(String(m).slice(0, 300)); };
        w.confirm = function(m){
          var ok = P.arm && printAsk(m);
          P.arm = false;
          P.alerts.push((ok ? '확인: ' : '거절: ') + String(m).slice(0, 300));
          return ok;
        };
        P.win = w;
        res(w);
      };
      fr.src = 'template35.htm?template=S700';
    });
  }
  function pWaitReady(w){
    var t0 = Date.now();
    return (function loop(){
      var d = w.document;
      if (w.jQuery && d.getElementById('print_btn') && d.getElementById('search') && d.getElementById('template_type') && w.jQuery('#grid1').getDataIDs) return Promise.resolve();
      if (Date.now() - t0 > 30000) return Promise.reject(new Error('송장출력 화면에서 버튼을 찾지 못했습니다'));
      return sleep(200).then(loop);
    })();
  }
  function pSelect(w, sel, name){
    if (!sel) throw new Error(name + ' 칸을 찾지 못했습니다');
    var opt = Array.prototype.filter.call(sel.options, function(o){ return String(o.text).trim() === name; })[0];
    if (!opt) throw new Error('「' + name + '」를 이지어드민 목록에서 찾지 못했습니다');
    w.jQuery(sel).val(opt.value).trigger('change');
    if (sel.value !== opt.value) throw new Error('「' + name + '」 선택이 안 됐습니다');
  }
  /* 지금 화면이 정한 조건인지 — 준비와 출력 직전에 똑같이 본다 */
  function pSettings(w){
    var d = w.document, bad = [], form = d.querySelector('form[section="0"]');
    function picked(s){ return s && s.selectedIndex >= 0 ? String(s.options[s.selectedIndex].text).trim() : ''; }
    if (picked(d.getElementById('template_type')) !== P_TEMPLATE) bad.push('송장 양식이 ' + P_TEMPLATE + ' 가 아닙니다');
    if (!d.getElementById('pre_print') || !d.getElementById('pre_print').checked) bad.push('즉시출력(선발번)이 체크되지 않았습니다');
    if (picked(d.getElementById('str_supply_code')) !== P_SUPPLIER) bad.push('공급처가 ' + P_SUPPLIER + ' 가 아닙니다');
    if (!d.getElementById('use_single_print') || !d.getElementById('use_single_print').checked) bad.push('다중 프린터 출력이 켜져 있습니다');
    if (d.getElementById('new_number') && d.getElementById('new_number').checked) bad.push('새 송장번호 발급이 켜져 있습니다');
    if (d.getElementById('use_range') && d.getElementById('use_range').checked) bad.push('범위 출력이 켜져 있습니다');
    if (!P_PRINTER.test(picked(d.getElementById('ezAgentPrinters')))) bad.push('프린터가 BIXOLON SLP 가 아닙니다');
    if (!form) { bad.push('검색 칸을 찾지 못했습니다'); return bad; }
    if (form.querySelector('[name=status]').value !== '1') bad.push('상태가 접수가 아닙니다');
    if (picked(form.querySelector('[name=dateType]')) !== '발주일') bad.push('날짜 기준이 발주일이 아닙니다');
    ['str_shop_code', 'shop_group', 's_group_id', 'tag_string', 'hwaju', 'user_area', 'cs'].forEach(function(n){
      var s = form.querySelector('select[name=' + n + ']');
      if (s && s.selectedIndex > 0) bad.push('다른 검색 조건이 걸려 있습니다 (' + n + ')');
    });
    var str = form.querySelector('[name=string]');
    if (str && String(str.value).trim()) bad.push('검색어가 들어 있습니다');
    ['part_trans_only', 'hold_only', 'print_only_priority', 'except_user_area', 'except_order_tag'].forEach(function(n){
      var c = form.querySelector('input[name=' + n + ']');
      if (c && c.checked) bad.push('다른 검색 체크가 켜져 있습니다 (' + n + ')');
    });
    return bad;
  }
  function pRows(w){
    var g = w.jQuery('#grid1'), names = g.jqGrid('getGridParam', 'colNames') || [], model = g.jqGrid('getGridParam', 'colModel') || [];
    function col(n){ var i = names.indexOf(n); return i >= 0 && model[i] ? model[i].name : ''; }
    var cSt = col('상태'), cDt = col('발주일'), cShop = col('판매처'), cNo = col('송장번호');
    return g.getDataIDs().map(function(id){
      return { id: id, status: String(g.getCell(id, cSt) || '').trim(), date: String(g.getCell(id, cDt) || '').trim().slice(0, 10),
               shop: String(g.getCell(id, cShop) || '').trim(), no: String(g.getCell(id, cNo) || '').replace(/&nbsp;/g, '').trim() };
    });
  }
  function pRowProblems(rows){
    var bad = [], st = rows.filter(function(r){ return r.status !== '접수'; }).length, no = rows.filter(function(r){ return r.no; }).length;
    if (!rows.length) bad.push('출력할 주문이 없습니다 (0건)');
    if (st) bad.push('접수 상태가 아닌 주문 ' + st + '건 — 재출력이 될 수 있습니다');
    if (no) bad.push('송장번호가 이미 있는 주문 ' + no + '건');
    return bad;
  }
  function cmdPrintPrep(args){
    var ymd = /^\d{4}-\d{2}-\d{2}$/, from = String(args.from || ''), to = String(args.to || ''), w;
    if (!ymd.test(from) || !ymd.test(to) || from > to) return Promise.reject(new Error('발주일이 올바르지 않습니다'));
    return pOpen().then(function(win){ w = win; return pWaitReady(w); }).then(function(){
      var d = w.document, $w = w.jQuery, form = d.querySelector('form[section="0"]');
      if (!form) throw new Error('검색 칸을 찾지 못했습니다');
      pSelect(w, d.getElementById('template_type'), P_TEMPLATE);
      pSelect(w, d.getElementById('str_supply_code'), P_SUPPLIER);
      $w(d.getElementById('pre_print')).prop('checked', true).trigger('change');
      form.querySelector('[name=start_date]').value = from;
      form.querySelector('[name=end_date]').value = to;
      form.querySelector('[name=start_hour]').value = '00';
      form.querySelector('[name=end_hour]').value = '23';
      /* 검색: 이지어드민이 누르자마자 #zb_waiting 을 켜고, 끝나면 끈다 */
      var btn = d.getElementById('search'), wait = d.getElementById('zb_waiting'), t0 = Date.now();
      if (!btn || btn.getAttribute('order') !== '0') throw new Error('불러오기 검색 버튼을 찾지 못했습니다');
      btn.click();
      return (function loop(){
        if (wait && w.getComputedStyle(wait).visibility === 'hidden') return Promise.resolve();
        if (Date.now() - t0 > 90000) return Promise.reject(new Error('검색이 90초 안에 끝나지 않았습니다'));
        return sleep(200).then(loop);
      })();
    }).then(function(){
      /* 이지에이전트가 프린터 목록을 늦게 줄 수 있어 잠깐 기다림 */
      var sel = w.document.getElementById('ezAgentPrinters'), t0 = Date.now();
      return (function loop(){
        if (sel && sel.options.length) return Promise.resolve();
        if (Date.now() - t0 > 15000) return Promise.resolve();
        return sleep(300).then(loop);
      })();
    }).then(function(){
      var d = w.document, problems = [], sel = d.getElementById('ezAgentPrinters'), hit = [];
      if (sel) hit = Array.prototype.filter.call(sel.options, function(o){ return P_PRINTER.test(o.text); });
      if (hit.length === 1) w.jQuery(sel).val(hit[0].value).trigger('change');
      else problems.push(hit.length ? 'BIXOLON SLP 프린터가 ' + hit.length + '개입니다' : '프린터 목록에 BIXOLON SLP 가 없습니다 — 이지에이전트가 켜져 있는지 확인해 주세요');
      var rows = pRows(w), g = w.jQuery('#grid1'), cb = d.getElementById('cb_grid1');
      if (rows.length && g.jqGrid('getGridParam', 'selarrrow').length !== rows.length && cb){
        if (cb.checked) cb.click();
        cb.click();
      }
      if (g.jqGrid('getGridParam', 'selarrrow').length !== rows.length) problems.push('전체 체크가 되지 않았습니다');
      problems = problems.concat(pSettings(w).filter(function(b){ return !/프린터가 BIXOLON/.test(b) || hit.length === 1; }), pRowProblems(rows));
      var shops = {}, dates = rows.map(function(r){ shops[r.shop] = (shops[r.shop] || 0) + 1; return r.date; }).filter(Boolean).sort();
      /* 합포 묶음은 다른 날 발주가 섞여 기간 밖 날짜가 나올 수 있음 (실제 10-24~31 검색에 10-23 3건) → 막지 않고 확인창에 알림 */
      var outside = dates.filter(function(x){ return x < from || x > to; }).length;
      if (P.alerts.length) problems.push('이지어드민 알림: ' + P.alerts.join(' / '));
      P.count = rows.length;
      P.token = problems.length ? '' : 'T' + Date.now();
      return { token: P.token, count: rows.length, outside: outside, dates: dates.length ? [dates[0], dates[dates.length - 1]] : [], shops: shops,
               printer: hit.length === 1 ? String(hit[0].text).trim() : '', template: P_TEMPLATE, problems: problems };
    });
  }
  function cmdPrintGo(args){
    var w = P.win;
    if (!args || args.confirm !== true || !args.token || args.token !== P.token || !w) throw new Error('송장출력 준비가 끝나지 않았습니다');
    P.token = '';   /* 한 번만 */
    var rows = pRows(w), bad = pSettings(w).concat(pRowProblems(rows)), sel = w.jQuery('#grid1').jqGrid('getGridParam', 'selarrrow');
    if (rows.length !== Number(args.count) || sel.length !== rows.length) bad.push('확인한 건수와 지금 화면의 건수가 다릅니다');
    if (bad.length) throw new Error('출력하지 않았습니다 — ' + bad.join(' / '));
    P.arm = true;
    P.started = true;
    try { w.document.getElementById('print_btn').click(); } catch(e){ P.arm = false; P.started = false; throw e; }
    if (P.arm){ P.arm = false; P.started = false; throw new Error('출력하지 않았습니다 — 이지어드민 확인창이 뜨지 않았습니다' + (P.alerts.length ? ': ' + P.alerts.join(' / ') : '')); }
    var last = P.alerts[P.alerts.length - 1] || '';
    if (/^거절/.test(last)){ P.started = false; throw new Error('출력하지 않았습니다 — 예상과 다른 확인창: ' + last); }
    return { started: true };
  }
  function cmdPrintStatus(){
    var w = P.win;
    if (!w) throw new Error('송장출력 화면이 닫혔습니다');
    var d = w.document;
    function num(id){ var e = d.getElementById(id); return e ? Number(String(e.textContent).replace(/[^\d]/g, '')) || 0 : 0; }
    var wait = d.getElementById('zb_waiting'), st = { waiting: num('waiting'), complete: num('complete'), err: num('err'), cancel: num('cancel'), change: num('state_change'),
      errRows: w.jQuery('#grid2').getDataIDs ? w.jQuery('#grid2').getDataIDs().length : 0,
      busy: !!wait && w.getComputedStyle(wait).visibility !== 'hidden', alerts: P.alerts.slice(-5) };
    return st;
  }
  function cmdPrintEnd(){ P.started = false; return { ok: true }; }

  var CMDS = { ping: function(){ return { ver: VER, page: isDG00() ? 'DG00' : '' }; }, read: cmdRead, search: cmdSearch, fill: cmdFill, reset: cmdReset, commit: cmdCommit,
               printPrep: cmdPrintPrep, printGo: cmdPrintGo, printStatus: cmdPrintStatus, printEnd: cmdPrintEnd };
  var SAYS = { search: '곡물도감 검색 중… (이지어드민 화면이 잠깐 바뀝니다)', read: '주문 줄 읽는 중…', fill: '분할 채우는 중… (저장 안 함)', reset: '되돌리는 중…', commit: '일괄합포제외 실행 중…',
               printPrep: '송장출력 준비 중… (출력은 아직 안 함)', printGo: '송장출력 실행 중…' };
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
  function stop(){ pGone(); window.removeEventListener('message', onMsg); box.remove(); }
  window.__mkwEzHelper = { hello: hello, ver: VER, stop: stop, read: cmdRead, search: cmdSearch, fill: cmdFill, reset: cmdReset, commit: cmdCommit,
                           printAsk: printAsk, printRowProblems: pRowProblems, printPrep: cmdPrintPrep, printGo: cmdPrintGo, printStatus: cmdPrintStatus };
  hello();
})();
