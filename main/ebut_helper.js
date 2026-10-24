/* ============================================================
   이벗 반영 도우미 — 스타 3PL 반품입고관리(star_return.html) 짝꿍 (2026-10-24)

   이벗(https://ebut3pl.co.kr)에 로그인된 탭에서 즐겨찾기 버튼으로 실행한다.
     javascript:(function(){var s=document.createElement('script');s.src='https://makewon.com/ebut_helper.js?v='+Date.now();document.head.appendChild(s);})();
   이벗 탭 안에서 돌기 때문에 이벗 로그인을 그대로 쓴다 (비밀번호·API 키 없음).
   반품입고관리 페이지와 postMessage 로만 이야기한다 — 허용한 주소(ALLOW)에서 온 요청만 받는다.

   명령
     ping            → { ok, login }
     find  { orig, origDate }
           원송장으로 상담전용창 검색(/cs/cs200main_jdata, 발송일 기준, 이벗은 기간 최대 약 90일)
           → { orders:[{code,cust,custName,site,ret,rman,odate,ddate}], items:[{bopt,ordlist,name,nicn,opt,qty}], locas:{in,bad} }
           items 는 반품입고 팝업(/jsp/rtn/rtn101edit.jsp)을 숨은 창에 띄워 상품 줄을 읽은 것 (저장 안 함)
     save  { orig, origDate, rno, reco, lines:[{bopt,ordlist,qty,q}] }
           팝업을 숨은 창에 띄워 칸을 채우고 이벗 자체 저장(go_save → /rtn/rtn101save)을 부른다
           저장 직전에 같은 주문이 이미 반품처리됐는지 다시 확인한다
   정해진 값(대표님 2026-10-24): 반송사유 불량 있으면 402 상품불량·아니면 401 고객변심 / 완료구분 완료 /
     가용 → 00000_in · 불량 → 0000_불량존 / 나머지 칸은 팝업 기본값 / 스타인터내셔널(고객사 446)만
============================================================ */
(function(){
  'use strict';
  if (!/(^|\.)ebut3pl\.co\.kr$/.test(location.hostname)){ alert('이벗(ebut3pl.co.kr) 탭에서 눌러 주세요.'); return; }
  if (window.__mkwEbutHelper){ window.__mkwEbutHelper.hello(); return; }

  var VER = '2026-10-24e';
  var ALLOW = /^https:\/\/(www\.)?makewon\.com$|^https:\/\/makechango-wms\.(web\.app|firebaseapp\.com)$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
  var PAGE = 'https://makewon.com/star_return.html';
  var STAR_CUST = '446';
  var LOCA_IN = '00000_in', LOCA_BAD = '0000_불량존';

  /* ── 화면 오른쪽 아래 작은 상태 표시 ── */
  var box = document.createElement('div');
  box.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483647;background:#0d0f14;color:#e8eaf0;border:2px solid #4af0a8;'
    + 'border-radius:12px;padding:10px 14px;font:13px/1.6 "Noto Sans KR",sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.4);max-width:320px';
  box.innerHTML = '<b style="color:#4af0a8">↩ 반품입고 이벗 도우미</b> <span style="color:#6b7280;font-size:11px">' + VER + '</span><div id="mkwHelperMsg">준비 중…</div>'
    + '<div style="margin-top:6px;font-size:11px;color:#6b7280">이 탭을 닫거나 다른 페이지로 옮기면 연결이 끊깁니다</div>';
  document.body.appendChild(box);
  function say(t){ var m = document.getElementById('mkwHelperMsg'); if (m) m.textContent = t; }

  /* ── 날짜 ── */
  function ymd(d){ return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function addDays(s, n){ var d = s ? new Date(s + 'T00:00:00') : new Date(); d.setDate(d.getDate() + n); return d; }
  function strip(v){ return String(v == null ? '' : v).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim(); }

  /* ── 상담전용창 검색 (조회 버튼이 보내는 것과 같은 칸 — 칸이 빠지면 이벗이 0건을 돌려줌) ── */
  function search(dno, d1, d2){
    var p = { ORDLIST_CUST:'', ORDLIST_SITE:'', ORDLIST_BRAND:'', ORDLIST_IVLEVEL:'', ORDLIST_ADDR:'', ORDLIST_NO1:'', ORDLIST_NO2:'', ORDLIST_NO3:'',
      ORDLIST_OMAN:'', ORDLIST_OID:'', ORDLIST_RMAN:'', ORDLIST_TEL:'', ORDLIST_FNSH:'', ORDLIST_IVTRUE:'', ORDLIST_GBN:'', DATE_GBN:'ord_ddate',
      DATE1:d1, DATE2:d2, ORDLIST_MAT:'', ORDLIST_NAME:'', ORDLIST_OPT1:'', ORDLIST_DNO:dno, ORDLIST_OVERSEAYN:'', DATE_OLD:'false', BASIC_FINISH2:'',
      BASIC_FDATE:'', matInfoYn:'N', ORDLIST_NO1_MULTI:'', ORDLIST_RMAN_MULTI:'', BASIC_NAME:'', gridReload:'true', _search:'false',
      rows:'100', page:'1', sidx:'ordlist_code', sord:'asc' };
    return fetch('/cs/cs200main_jdata?' + new URLSearchParams(p), { credentials: 'same-origin' }).then(function(r){ return r.text(); }).then(function(t){
      var j; try { j = JSON.parse(t); } catch(e){ throw new Error(/</.test(t) ? 'LOGIN' : '이벗 검색 응답이 비어 있음'); }   /* HTML 이면 로그아웃 화면 */
      return (j.rows || []).filter(function(r){ return String(r.ordlist_dno || '').replace(/<[^>]+>/g, '').replace(/\D/g, '') === dno; });
    });
  }
  /* 원송장 접수일 앞뒤 → 없으면 최근 90일 → 그 앞 90일 */
  function findOrders(orig, origDate){
    var wins = [];
    if (origDate) wins.push([ymd(addDays(origDate, -4)), ymd(addDays(origDate, 4))]);
    wins.push([ymd(addDays(null, -89)), ymd(new Date())]);
    wins.push([ymd(addDays(null, -179)), ymd(addDays(null, -90))]);
    var i = 0;
    function next(){
      if (i >= wins.length) return Promise.resolve([]);
      var w = wins[i++];
      return search(orig, w[0], w[1]).then(function(rows){ return rows.length ? rows : next(); });
    }
    return next().then(function(rows){
      return rows.map(function(r){ return { code: String(r.ordlist_code), cust: String(r.ordlist_cust || ''), custName: strip(r.cust_name), site: String(r.ordlist_site || ''),
        ret: strip(r.return_gubn_han) || '-', rman: strip(r.ordlist_rman), odate: strip(r.ordlist_date).slice(0, 10), ddate: strip(r.ordlist_ivpdate || '').slice(0, 10) }; });
    });
  }

  /* ── 반품입고 팝업을 숨은 창(iframe)에 띄움 — 이벗 「반품입고」 버튼이 여는 주소 그대로 ── */
  function openPopup(orders){
    var f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;left:-10000px;top:0;width:1000px;height:700px;border:0';
    var q = new URLSearchParams({ Status: 'I', RETURN_ORDLISTS: orders.map(function(o){ return o.code; }).join(','),
      RETURN_CUSTS: orders.map(function(o){ return o.cust + ','; }).join(''), RETURN_GUBN: '1',
      ORDLIST_SITES: orders.map(function(o){ return o.site + ','; }).join('') });
    return new Promise(function(res, rej){
      var t = setTimeout(function(){ f.remove(); rej(new Error('팝업 열기 시간 초과')); }, 20000);
      f.onload = function(){
        clearTimeout(t);
        var w = f.contentWindow, d = f.contentDocument;
        if (!d || !d.getElementById('form1') || typeof w.go_save !== 'function'){ f.remove(); rej(new Error('LOGIN')); return; }
        res(f);
      };
      f.src = '/jsp/rtn/rtn101edit.jsp?' + q;
      document.body.appendChild(f);
    });
  }
  function readItems(f){
    var d = f.contentDocument, N = function(n){ return d.getElementsByName(n); };
    var cbs = N('boptcode'), out = [];
    for (var i = 0; i < cbs.length; i++){
      out.push({ i: i, bopt: cbs[i].value, ordlist: (N('ordbasic_ordlist')[i] || {}).value || '', name: (N('basic_name')[i] || {}).value || '',
        nicn: ((N('basic_nicn')[i] || {}).value || '').trim(), opt: (N('boptcode_name')[i] || {}).value || '', qty: +((N('qty')[i] || {}).value || 0) || 0 });
    }
    return out;
  }
  function locaValue(sel, name){
    for (var i = 0; i < sel.options.length; i++){ if (sel.options[i].text.trim().indexOf(name) === 0) return sel.options[i].value; }
    return '';
  }
  function readLocas(f){
    var s = f.contentDocument.getElementsByName('INOUTSTOCK_LOCA')[0];
    return s ? { in: locaValue(s, LOCA_IN), bad: locaValue(s, LOCA_BAD) } : { in: '', bad: '' };
  }

  /* 반영할 고객사: 스타 반품은 446, 화물 반품(?db=cargo)은 null = 제한 없음 (화면이 a.cust 로 보냄, 예전 화면은 안 보내므로 스타) */
  function custOf(a){ return a.cust === undefined ? STAR_CUST : a.cust; }
  function cmdFind(a){
    var orig = String(a.orig || '').replace(/\D/g, '');
    if (orig.length < 10) return Promise.reject(new Error('원송장 번호가 이상합니다'));
    return findOrders(orig, a.origDate).then(function(orders){
      if (!orders.length) return { orders: [], items: [], locas: {} };
      var cust = custOf(a), open = orders.filter(function(o){ return (!cust || o.cust === cust) && o.ret === '-'; });
      if (!open.length) return { orders: orders, items: [], locas: {} };
      return openPopup(open).then(function(f){
        var r = { orders: orders, items: readItems(f), locas: readLocas(f) };
        f.remove(); return r;
      });
    });
  }

  function cmdSave(a){
    var lines = (a.lines || []).filter(function(l){ return +l.qty > 0; });
    if (!lines.length) return Promise.reject(new Error('입고할 상품이 없습니다'));
    var rno = String(a.rno || '').replace(/\D/g, '');
    if (rno.length < 10) return Promise.reject(new Error('반품 송장번호가 이상합니다'));
    var want = {}; lines.forEach(function(l){ want[l.ordlist] = 1; });
    /* 저장 직전에 다시 검색 — 그새 누가 손으로 반품처리했으면 멈춤 (두 번 들어가면 재고가 두 번 오름) */
    return findOrders(String(a.orig || '').replace(/\D/g, ''), a.origDate).then(function(orders){
      var tgt = orders.filter(function(o){ return want[o.code]; });
      if (tgt.length !== Object.keys(want).length) throw new Error('이벗에서 주문을 다시 찾지 못했습니다');
      var cust = custOf(a); if (cust && tgt.some(function(o){ return o.cust !== cust; })) throw new Error('스타인터내셔널 주문이 아닙니다');
      var done = tgt.filter(function(o){ return o.ret !== '-'; });
      if (done.length) throw new Error('ALREADY:' + done.map(function(o){ return o.ret; }).join(','));
      return openPopup(tgt);
    }).then(function(f){
      var w = f.contentWindow, d = f.contentDocument, fm = d.form1, N = function(n){ return d.getElementsByName(n); };
      var locas = readLocas(f), items = readItems(f), tot = 0, partial = false, used = {};
      try { items.forEach(function(it){
        var l = null;
        for (var k = 0; k < lines.length; k++){ if (!used[k] && lines[k].bopt === it.bopt && lines[k].ordlist === it.ordlist){ l = lines[k]; used[k] = 1; break; } }
        var cb = N('boptcode')[it.i];
        if (!l){ cb.checked = false; partial = true; return; }
        var q = Math.min(+l.qty, it.qty || +l.qty);
        if (q < it.qty) partial = true;
        cb.checked = true;
        N('qtytype')[it.i].value = l.q === '2' ? '2' : '1';
        N('qty')[it.i].value = String(q);
        /* 적치로케이션: 로케이션 관리 계정(스타)만 칸이 있음 — 화물 쪽 이벗 계정은 칸 자체가 없어 건너뜀 (대표님 2026-10-24) */
        var ls = N('INOUTSTOCK_LOCA')[it.i];
        if (ls){
          var loc = l.q === '2' ? locas.bad : locas.in;
          if (!loc) throw new Error('적치로케이션 「' + (l.q === '2' ? LOCA_BAD : LOCA_IN) + '」 을 팝업 목록에서 못 찾음');
          ls.value = loc;
          if (w.jQuery) w.jQuery(ls).trigger('chosen:updated');
        }
        tot += q;
      }); } catch(err){ f.remove(); throw err; }
      if (Object.keys(used).length !== lines.length){ f.remove(); throw new Error('팝업 상품 줄과 맞지 않는 상품이 있습니다'); }
      /* 입고창고(창고·로케이션 관리 회원사는 필수) = 로케이션 값 「창고,존,로케이션」의 창고 — 스타4물류(김포) 263 (2026-10-24 첫 실반영이 「입고창고를 선택하세요」로 멈춰서 추가) */
      var wahSel = d.getElementById('inoutstock_wah');
      if (wahSel && N('INOUTSTOCK_LOCA').length){   /* 창고 칸도 로케이션 관리 계정에만 — 없으면 건너뜀 */
        var wah = String(locas.in || locas.bad || '').split(',')[0];
        if (!wah || ![].some.call(wahSel.options, function(o){ return o.value === wah; })){ f.remove(); throw new Error('입고창고(' + (wah || '?') + ')를 팝업 목록에서 못 찾음'); }
        wahSel.value = wah;
      }
      fm.RETURN_DNO.value = rno;
      /* 택배사: 우체국(기본) = 142, 그 밖은 팝업 목록에서 이름으로 찾음 — 없으면 멈춤 (엉뚱한 택배사로 들어가지 않게) */
      var cr = String(a.courier || '우체국'), dofc = '';
      if (cr === '우체국') dofc = '142';
      else [].forEach.call(fm.RETURN_DOFC.options, function(o){ if (!dofc && o.value && o.text.replace(/\s/g, '').indexOf(cr.replace(/대한통운|택배|\s/g, '')) >= 0) dofc = o.value; });
      if (!dofc){ f.remove(); throw new Error('이벗 택배사 목록에 「' + cr + '」이(가) 없습니다 — 이벗 기초정보에 추가하거나 ✋ 수동 완료'); }
      fm.RETURN_DOFC.value = dofc;
      fm.RETURN_RECO.value = lines.some(function(l){ return l.q === '2'; }) ? '402' : '401';
      fm.RETURN_QTY.value = String(tot);
      [].forEach.call(N('RETURN_MALLYN'), function(r){ r.checked = (r.value === (partial ? '2' : '1')); });   /* 전량/부분입고 */
      [].forEach.call(N('RETURN_FNSH'), function(r){ r.checked = (r.value === '1'); });                      /* 완료 */
      return new Promise(function(res, rej){
        var alerts = [], fin = false;
        function end(fn, v){ if (fin) return; fin = true; clearTimeout(t1); setTimeout(function(){ f.remove(); }, 500); fn(v); }
        w.alert = function(m){ alerts.push(String(m)); };
        w.confirm = function(){ return false; };
        try { w.opener = { gridReload: function(){} }; } catch(e){}
        w.close = function(){};
        w.jQuery(w.document).ajaxComplete(function(ev, xhr, s){
          if (!/rtn101save/.test((s && s.url) || '')) return;
          var j = null; try { j = JSON.parse(xhr.responseText); } catch(e){}
          if (j && String(j.success) === 'true') end(res, { ok: true, codes: j.return_codes || '', ordlist: j.return_ordlist || '' });
          else end(rej, new Error('이벗 저장 실패' + (alerts.length ? ' — ' + alerts.join(' / ') : '') + (xhr.status !== 200 ? ' (http ' + xhr.status + ')' : '')));
        });
        var t1 = setTimeout(function(){ end(rej, new Error(alerts.length ? '이벗 확인 메시지: ' + alerts.join(' / ') : '이벗 저장 응답 없음 — 이벗 반품내역에서 확인 필요')); }, 25000);
        w.go_save();
        /* 입력 검사에 걸리면 서버로 안 보내고 alert 만 뜸 */
        setTimeout(function(){ if (!fin && alerts.length) end(rej, new Error('이벗 입력 검사: ' + alerts.join(' / '))); }, 3000);
      });
    });
  }

  function cmdPing(){
    /* 없는 송장으로 정식 검색 — 칸이 빠지면 이벗이 빈 응답을 줘서 로그인 여부를 못 가림 */
    return search('0000000000', ymd(new Date()), ymd(new Date())).then(function(){ return { ok: true, login: true, ver: VER }; },
      function(e){ return { ok: true, login: e.message !== 'LOGIN', ver: VER }; });
  }

  var busy = 0;
  window.addEventListener('message', function(e){
    var m = e.data;
    if (!m || m.to !== 'ebut-helper' || !ALLOW.test(e.origin)) return;
    var run = m.cmd === 'find' ? cmdFind : m.cmd === 'save' ? cmdSave : m.cmd === 'ping' ? cmdPing : null;
    if (!run) return;
    peer = e.source; peerOrigin = e.origin;
    /* 마지막으로 연결된 반품 화면(스타/화물)을 기억 → 다음에 반품 화면 없이 도우미를 누르면 그 화면을 엶 */
    if (m.args && (m.args.db === 'cargo' || m.args.db === 'star')) try { localStorage.setItem('mkwRetDb', m.args.db); } catch(x){}
    busy++; if (m.cmd !== 'ping') say(m.cmd === 'save' ? '이벗에 반품입고 저장 중… ' + (m.args && m.args.rno || '') : '원송장 주문 찾는 중…');
    Promise.resolve().then(function(){ return run(m.args || {}); }).then(function(data){
      e.source.postMessage({ from: 'ebut-helper', id: m.id, ok: true, data: data }, e.origin);
      if (m.cmd !== 'ping') say('✔ 완료 — 🟢 연결됨');
      else say(data.login ? '🟢 반품입고관리와 연결됨' : '⚠️ 이벗 로그아웃됨 — 다시 로그인한 뒤 도우미를 다시 눌러 주세요');
    }, function(err){
      var msg = String((err && err.message) || err);
      e.source.postMessage({ from: 'ebut-helper', id: m.id, ok: false, err: msg }, e.origin);
      say(msg === 'LOGIN' ? '⚠️ 이벗 로그아웃됨 — 다시 로그인한 뒤 도우미를 다시 눌러 주세요' : '⚠️ ' + msg);
    }).then(function(){ busy--; });
  });

  /* 반품입고관리 창 찾기: 이 탭을 연 창(opener) → 없으면 반품입고관리를 새로 열기 */
  var peer = null, peerOrigin = '*';
  function hello(){
    var target = null;
    try { if (window.opener && !window.opener.closed) target = window.opener; } catch(e){}
    var dbm = 'star'; try { dbm = localStorage.getItem('mkwRetDb') || 'star'; } catch(x){}
    if (!target) target = window.open(PAGE + (dbm === 'cargo' ? '?db=cargo' : ''), 'mkw_ret_' + dbm);
    if (target){ target.postMessage({ from: 'ebut-helper', cmd: 'ready', ver: VER }, '*'); say('반품입고관리와 연결 중… (그쪽 화면에 🟢 이 뜨면 연결됨)'); }
    else say('⚠️ 팝업이 막혔습니다 — 주소창 오른쪽에서 팝업 허용 후 다시 눌러 주세요');
  }
  /* 5분마다 가볍게 조회 — 이벗 자동 로그아웃(한동안 안 쓰면) 막기 */
  setInterval(function(){ if (!busy) cmdPing().then(function(r){ if (!r.login) say('⚠️ 이벗 로그아웃됨 — 다시 로그인한 뒤 도우미를 다시 눌러 주세요'); }); }, 5 * 60 * 1000);

  window.__mkwEbutHelper = { hello: hello, ver: VER };
  hello();
})();
