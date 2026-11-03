/* ============================================================
   이벗 반영 도우미 — 스타 3PL 반품입고관리(star_return.html) 짝꿍 (2026-10-24)

   이벗(https://ebut3pl.co.kr)에 로그인된 탭에서 즐겨찾기 버튼으로 실행한다.
     javascript:(function(){var s=document.createElement('script');s.src='https://makewon.com/ebut_helper.js?v='+Date.now();document.head.appendChild(s);})();
   이벗 탭 안에서 돌기 때문에 이벗 로그인을 그대로 쓴다 (비밀번호·API 키 없음).
   반품입고관리 페이지와 postMessage 로만 이야기한다 — 허용한 주소(ALLOW)에서 온 요청만 받는다.

   명령
     ping            → { ok, login }
     orders { cust, from, to } → { rows:[{no,name,qty,amt,siteName,fnsh,regDate,orderDate}], gifts:{주문번호:[매칭상품명]}, unmatched:[주문번호], total }  주문서목록 읽기(저장 없음)
     storeCheck  → { page, busy, newCnt, waitCnt }   주문서등록 화면에서 맨소레담공식스마트스토어 건수만 읽음 (AI 물류비서)
     storeGo     → { started, why, alerts }        주문확인 체크 후 주문가져오기 한 번. 이벗 확인창 문구가 맞을 때만 확인
     storeStatus → { done, lines, newCnt } · { lost }
     matchSave { name, opt, qty, picks:[{code,qty,name}] } → { ok, msg, alerts }  주문서매칭 창에서 사람과 같은 순서로 한 상품 매칭처리 (AI 물류비서)
     matchRead { cust, from, to, terms } → { items, masters, history }  미매칭 줄·마스터 상품·과거 매칭 읽기 / matchSearch { cust, text } → 마스터 상품 검색 (저장 없음)
     find  { orig, origDate }
           원송장으로 상담전용창 검색(/cs/cs200main_jdata, 발송일 기준, 이벗은 기간 최대 약 90일)
           → { orders:[{code,cust,custName,site,ret,rman,odate,ddate}], items:[{bopt,ordlist,name,nicn,opt,qty}], locas:{in,bad} }
           items 는 반품입고 팝업(/jsp/rtn/rtn101edit.jsp)을 숨은 창에 띄워 상품 줄을 읽은 것 (저장 안 함)
     save  { orig, origDate, rno, reco, memo, lines:[{bopt,ordlist,qty,q}] }   memo = 특이사항 → 팝업 메모 칸
           팝업을 숨은 창에 띄워 칸을 채우고 이벗 자체 저장(go_save → /rtn/rtn101save)을 부른다
           저장 직전에 같은 주문이 이미 반품처리됐는지 다시 확인한다
   정해진 값(대표님 2026-10-24): 반송사유 불량 있으면 402 상품불량·아니면 401 고객변심 / 완료구분 완료 /
     가용 → 00000_in · 불량 → 0000_불량존 / 나머지 칸은 팝업 기본값 / 스타인터내셔널(고객사 446)만
============================================================ */
(function(){
  'use strict';
  if (!/(^|\.)ebut3pl\.co\.kr$/.test(location.hostname)){ alert('이벗(ebut3pl.co.kr) 탭에서 눌러 주세요.'); return; }
  var VER = '2026-11-03e';
  /* 이미 도우미가 떠 있으면: 같은 버전은 그대로, 다른 버전은 끄고 새로 띄움 (2026-10-25 — 예전엔 옛 버전이 계속 남아 메모가 안 들어감)
     stop() 이 없는 아주 옛 버전(10-25a 이전)은 끌 수 없어 새로고침 안내 */
  var old = window.__mkwEbutHelper;
  if (old){
    if (old.ver === VER){ old.hello(); return; }
    if (typeof old.stop !== 'function'){ alert('이벗 도우미가 옛 버전(' + (old.ver || '?') + ')입니다.\n\n이 이벗 탭을 새로고침(F5)한 뒤 즐겨찾기 도우미를 다시 눌러 주세요.'); return; }
    old.stop();
  }
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

  /* 팝업 메모 칸 찾기: 상품 줄마다 있는 칸(이름이 여러 개)은 빼고, 이름에 메모·비고가 들어간 칸 → 없으면 하나뿐인 textarea */
  function findMemo(fm, N){
    var els = [].filter.call(fm.elements, function(e){
      return e.name && (e.tagName === 'TEXTAREA' || (e.tagName === 'INPUT' && /^(text|)$/i.test(e.type))) && N(e.name).length === 1 && !e.readOnly && !e.disabled; });
    var pick = function(re){ return els.filter(function(e){ return re.test(e.name) || re.test(e.id || ''); }); };
    var c = pick(/^RETURN_(MEMO|BIGO|ETC|REMARK|NOTE)/i);
    if (!c.length) c = pick(/MEMO|BIGO|REMARK|NOTE/i);
    if (!c.length) c = els.filter(function(e){ return e.tagName === 'TEXTAREA'; });
    return c.length === 1 ? c[0] : (c.filter(function(e){ return e.tagName === 'TEXTAREA'; })[0] || c[0] || null);
  }
  /* 이벗에 넣을 글자만 남김 (2026-10-26 첫 실반영 5건 실패 = 메모의 「📌」 이모지 — 이벗 서버가 이모지 같은 4바이트 글자를 못 받아
     success:false 만 돌려줌). 📌 → ※, 그 밖에 한글·영숫자·한자·흔한 문장부호·기호 밖의 글자는 지움 */
  function ebutText(v){
    return String(v == null ? '' : v).replace(/📌/g, '※').replace(/🚨/g, '!')
      .replace(/[^\u0009\u000A\u000D -~ -ÿᄀ-ᇿ‐-⁞←-⇿①-⓿■-◿　-〿㄰-㆏一-鿿가-힣＀-￯]/g, '')
      .replace(/\s{2,}/g, ' ').trim();
  }
  /* 저장 실패 진단(2026-10-26 첫 실반영 5건이 「실패했습니다.」만 받고 멈춤): 이벗에 보낸 값 중 머리 칸 전부 + 상품 줄 칸만 짧게 */
  function sent(data){
    try {
      var p = new URLSearchParams(typeof data === 'string' ? data : ''), head = [], rows = {};
      p.forEach(function(v, k){
        if (/^(boptcode|qty|qtytype|INOUTSTOCK_LOCA|ordbasic_ordlist)$/.test(k)) (rows[k] = rows[k] || []).push(v);
        else if (/^RETURN_|wah|DATE|LOCA|STATUS|GUBN/i.test(k)) head.push(k + '=' + v);
      });
      return head.join(' ') + ' | ' + Object.keys(rows).map(function(k){ return k + '[' + rows[k].join(';') + ']'; }).join(' ');
    } catch(e){ return '(못 읽음)'; }
  }
  function fieldNames(fm){ return [].map.call(fm.elements, function(e){ return e.name; }).filter(function(v, i, a){ return v && a.indexOf(v) === i; }).join(','); }

  /* 반영할 고객사: 스타 반품은 446, 화물 반품(?db=cargo)은 null = 제한 없음 (화면이 a.cust 로 보냄, 예전 화면은 안 보내므로 스타) */
  function custOf(a){ return a.cust === undefined ? STAR_CUST : a.cust; }
  function cmdFind(a){
    var orig = String(a.orig || '').replace(/\D/g, '');
    if (!orig) return Promise.reject(new Error('원송장 번호가 이상합니다'));
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
    if (!rno) return Promise.reject(new Error('반품 송장번호가 이상합니다'));
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
      /* 반송사유: 휴대폰에서 고른 것(a.reco, 기본 고객변심) — 안 고른 예전 기록은 불량 있으면 402 상품불량 · 없으면 401 고객변심 */
      fm.RETURN_RECO.value = /^40[1-4]$/.test(a.reco || '') ? a.reco : lines.some(function(l){ return l.q === '2'; }) ? '402' : '401';
      fm.RETURN_QTY.value = String(tot);
      /* 메모: 반품입고관리 「특이사항」(a.memo) → 팝업 메모 칸 (대표님 2026-10-25) — 칸 이름을 몰라 이름·모양으로 찾음, 못 찾으면 저장은 하되 memoMiss 로 알림 */
      var memoEl = null, memoCut = false, memo = ebutText(a.memo);
      if (memo){
        memoEl = findMemo(fm, N);
        if (memoEl){
          var mv = memoEl.value ? memoEl.value.trim() + ' / ' + memo : memo;
          if (memoEl.maxLength > 0 && mv.length > memoEl.maxLength){ mv = mv.slice(0, memoEl.maxLength); memoCut = true; }
          memoEl.value = mv;
        }
      }
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
          if (j && String(j.success) === 'true') end(res, { ok: true, codes: j.return_codes || '', ordlist: j.return_ordlist || '',
            memo: memo ? (memoEl ? (memoCut ? 'cut' : 'ok') : 'miss') : '', memoField: memoEl ? memoEl.name : '', fields: memo && !memoEl ? fieldNames(fm) : '' });
          else end(rej, new Error('이벗 저장 실패' + (alerts.length ? ' — ' + alerts.join(' / ') : '') + (xhr.status !== 200 ? ' (http ' + xhr.status + ')' : '')
            + ' ‖ 서버: ' + strip(xhr.responseText || '').replace(/\s+/g, ' ').slice(0, 300) + ' ‖ 보낸 값: ' + sent(s && s.data)));
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
    /* checked=false: 조회 자체가 실패해 로그인 여부를 모름 (전담비서가 구분, 기존 페이지는 login 만 봄) */
    return search('0000000000', ymd(new Date()), ymd(new Date())).then(function(){ return { ok: true, login: true, checked: true, ver: VER }; },
      function(e){ var isLogin = e.message === 'LOGIN'; return { ok: true, login: !isLogin, checked: isLogin, err: isLogin ? '' : e.message, ver: VER }; });
  }

  /* ── 주문서목록 읽기 (AI 물류비서 미리 보기, 저장 없음) ──
     화면의 조회와 같은 요청. VIEW_TYPE 1 = 주문 줄, 2 = 매칭 상품 포함(사은품 내용), 4 = 미매칭만.
     돌려주는 칸은 주문번호·상품명·금액 등이고 수령자·전화·주소는 담지 않는다 */
  var ORDER_PARAMS = 'site_code basic_prov basic_prov_name ORDLIST_BRAND ORDLIST_IVLEVEL ORDLIST_NO1 ORDLIST_OMAN ORDLIST_RMAN ORDLIST_TEL ORDLIST_FNSH ORDLIST_IVTRUE ORDLIST_GBN ORDLIST_MIYN ORDLIST_UPTYPE ORDLIST_NAME ORDLIST_MAT ORDLIST_DNO ORDLIST_SEQ ORDLIST_DOFC ORDLIST_IVAFYN BASIC_NAME_GBN BASIC_NAME_VAL BASIC_BRAND ORDADD_REYN ORDLIST_NAME_NOT ORDLIST_OPT1_NOT'.split(' ');
  function orderPage(view, a, page){
    var q = new URLSearchParams();
    ORDER_PARAMS.forEach(function(n){ q.set(n, ''); });
    var set = { VIEW_TYPE: view, ORDLIST_CUST: String(a.cust), DATE_GBN: 'ord_date', DATE1: a.from, DATE2: a.to, GROUP_VIEW_TYPE: '1', gridReload: 'true', rows: '2000', page: String(page), sidx: 'ordlist_code', sord: 'asc', _search: 'false', nd: String(Date.now()) };
    Object.keys(set).forEach(function(k){ q.set(k, set[k]); });
    return fetch('/site/site210main_jdata?' + q.toString(), { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
      .then(function(r){ return r.text(); }).then(function(t){
        if (!t) throw new Error('LOGIN');
        return JSON.parse(t);
      });
  }
  function orderAll(view, a){
    var all = [];
    return (function next(page){
      return orderPage(view, a, page).then(function(o){
        all = all.concat(o.rows || []);
        return page < Number(o.totalpages || 1) ? next(page + 1) : { rows: all, total: Number(o.totalrecords) || 0 };
      });
    })(1);
  }
  function plain(s){ return String(s == null ? '' : s).replace(/<[^>]+>/g, '').trim(); }
  function cmdOrders(a){
    if (!/^\d+$/.test(String(a.cust)) || !/^\d{4}-\d{2}-\d{2}$/.test(a.from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(a.to || '')) throw new Error('조회 조건이 올바르지 않습니다');
    return orderAll('1', a).then(function(main){
      return orderAll('2', a).then(function(withMatch){
        return orderAll('4', a).then(function(miss){
          var gifts = {};
          withMatch.rows.forEach(function(x){ if (plain(x.ordlist_name) === '사은품') (gifts[x.ordlist_no1] = gifts[x.ordlist_no1] || []).push(plain(x.basic_name)); });
          return { total: main.total, gifts: gifts, unmatched: miss.rows.map(function(x){ return x.ordlist_no1; }), ver: VER,
                   rows: main.rows.map(function(x){ return { no: x.ordlist_no1, name: plain(x.ordlist_name), qty: Number(x.ordlist_qty) || 0, amt: Number(x.ordlist_amt1) || 0,
                     siteName: plain(x.site_name), fnsh: String(x.ordlist_fnsh_ori), regDate: x.ordlist_date, orderDate: x.ordlist_cdate, ivDate: plain(x.ordlist_ivdate), dno: plain(x.ordlist_dno) ? 'Y' : '' }; }) };
        });
      });
    });
  }

  /* ── 자동 재로그인 ── 크롬이 비밀번호를 채워 둔 경우에만 로그인 버튼을 한 번 누름. 값을 읽어 보내거나 저장하지 않음.
     이 페이지 비밀번호 칸에는 HTML 기본값이 있어 그 값이면 채워진 것으로 치지 않음 */
  function cmdRelogin(){
    var pw = document.querySelector('input[type=password]');
    if (!pw) return { tried: false, why: '로그인 칸을 찾지 못함' };
    if (!pw.value || pw.value === pw.defaultValue) return { tried: false, why: '저장된 비밀번호가 채워지지 않음' };
    var form = pw.form || document, id = form.querySelector('input[type=text]');
    if (!id || !id.value) return { tried: false, why: '아이디가 채워지지 않음' };
    if (form.querySelector('input[name*=captcha i], input[name*=otp i]')) return { tried: false, why: '추가 인증이 필요함' };
    var btn = form.querySelector('button[type=submit]');
    if (!btn) return { tried: false, why: '로그인 버튼을 찾지 못함' };
    setTimeout(function(){ btn.click(); }, 300);
    return { tried: true };
  }

  /* 비서 화면에서 사람이 입력한 값으로 로그인 버튼을 한 번 누름. 값을 보관하거나 돌려주지 않음.
     알림창은 무인 탭을 멈추므로 띄우지 않음. 성공 여부는 헤드비서가 다시 열어 확인 */
  function setField(el, v){
    var proto = window.HTMLInputElement && el instanceof window.HTMLInputElement ? Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value') : null;
    if (el.focus) el.focus();
    if (proto && proto.set) proto.set.call(el, v); else el.value = v;
    if (el.dispatchEvent && window.Event) ['input', 'change'].forEach(function(n){ el.dispatchEvent(new window.Event(n, { bubbles: true })); });
    if (el.blur) el.blur();
  }
  function cmdLogin(args){
    var pw = document.querySelector('input[type=password]');
    if (!pw) return { tried: false, why: '로그인 칸을 찾지 못함' };
    var form = pw.form || document, id = form.querySelector('input[type=text]');
    if (!id) return { tried: false, why: '아이디 칸을 찾지 못함' };
    if (form.querySelector('input[name*=captcha i], input[name*=otp i]')) return { tried: false, why: '추가 인증이 있어 상시 컴퓨터에서 직접 로그인해 주세요' };
    var btn = form.querySelector('button[type=submit]');
    if (!btn) return { tried: false, why: '로그인 버튼을 찾지 못함' };
    setField(id, args.id); setField(pw, args.pw);
    window.alert = function(){};
    setTimeout(function(){ btn.click(); }, 300);
    return { tried: true };
  }

  /* 맨소래담 파일을 연동몰 엑셀등록 창과 같은 방식으로 한 번 보냄. 창의 기본 설정(중복 체크 주문번호 등)을 그대로 씀. 파일은 보관하지 않음 */
  var MENSO_UPLOAD = 'ORDLIST_CUST=2237&ORDLIST_SITE=16747&site_mcode=19&ORDLIST_BRAND=3023&site_name=' + encodeURIComponent('맨소래담_연동몰') + '&brand_name=' + encodeURIComponent('맨소레담아시아퍼시픽');
  function cmdUploadMenso(a){
    if (!a || !a.buffer || !a.name) throw new Error('파일이 없습니다');
    if (a.buffer.byteLength > 5 * 1024 * 1024) throw new Error('파일이 5MB 를 넘습니다');
    return fetch('/jsp/site/site213edit.jsp?' + MENSO_UPLOAD, { credentials: 'include' }).then(function(r){ return r.text(); }).then(function(html){
      var d = new DOMParser().parseFromString(html, 'text/html');
      var site = d.querySelector('input[name=ORDLIST_SITE]'), file = d.querySelector('input[name=xls_file]');
      if (!file || !site || site.value !== '16747') throw new Error('LOGIN');
      var fd = new FormData();
      Array.prototype.forEach.call(d.querySelectorAll('input,select,textarea'), function(e){
        if (!e.name) return;
        if (e.name === 'xls_file') { fd.append('xls_file', new File([a.buffer], a.name)); return; }
        if ((e.type === 'radio' || e.type === 'checkbox') && !e.checked) return;
        fd.append(e.name, e.value);
      });
      return fetch('/site/site212save?', { method: 'POST', body: fd, credentials: 'include' });
    }).then(function(r){
      return r.text().then(function(t){
        var alerts = [], m, re = /alert\(\s*["'`]([^"'`]{1,300})["'`]/g;
        while ((m = re.exec(t))) alerts.push(m[1]);
        var plain = t.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return { status: r.status, alerts: alerts.slice(0, 5), text: plain.slice(0, 400) };
      });
    });
  }

  /* ── 매칭 화면 자료 읽기 (AI 물류비서, 저장 없음) ── 미매칭 주문 줄 + 마스터 상품 + 비슷한 과거 매칭 */
  function masterSearch(cust, text){
    var q = new URLSearchParams({ GBN: '1', SEARCH_VALUE: text, GBN2: '', SEARCH_VALUE_OPT: '', SEARCH_VALUE_OPT2: '', CUST_CODE: String(cust), ORDER_TYPE: '', BOPTCODE_TRUE: '', BOPTCODE_NAME_MULTI: '', autogbn: '1', ORDLIST_CUST: '', ORDLIST_MAT: '', rows: '1000', page: '1', sidx: 'basic_name', sord: 'asc', _search: 'false', nd: String(Date.now()) });
    return fetch('/site/site217edit_right_jdata?' + q.toString(), { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
      .then(function(r){ return r.text(); }).then(function(t){
        if (!t) throw new Error('LOGIN');
        return (JSON.parse(t).rows || []).map(function(x){ return { code: String(x.boptcode_code), seq: String(x.basic_seq), name: plain(x.basic_name), nick: plain(x.basic_nicn), opt: plain(x.boptcode_name) }; });
      });
  }
  function matchHistory(cust, name){
    var q = new URLSearchParams({ SITE_CUST: String(cust), BMAT_NAME: name, BMAT_TRUE: 'Y', page: '1' });
    return fetch('/jsp/base/base106edit.jsp?' + q.toString(), { credentials: 'include' }).then(function(r){ return r.text(); }).then(function(h){
      var d = new DOMParser().parseFromString(h, 'text/html');
      return Array.prototype.filter.call(d.querySelectorAll('tr'), function(t){ return t.querySelector('input[name=bmat_delete_check]'); }).slice(0, 5).map(function(t){
        var c = Array.prototype.map.call(t.children, function(x){ return String(x.textContent || '').replace(/\s+/g, ' ').trim(); });
        return { name: c[4], opt: c[5], qty: Number(c[6]) || 0, master: c[8] };
      });
    });
  }
  function cmdMatchSearch(a){
    if (!/^\d+$/.test(String(a.cust)) || !String(a.text || '').trim()) throw new Error('검색어가 없습니다');
    return masterSearch(a.cust, String(a.text).trim());
  }
  function cmdMatchRead(a){
    var terms = (a.terms || []).slice(0, 12), masters = {}, i = 0;
    return orderAll('4', a).then(function(miss){
      var items = {};
      miss.rows.forEach(function(x){
        if (String(x.ordlist_fnsh_ori) === '2') return;
        var name = plain(x.ordlist_name), opt = plain(x.ordlist_opt1), qty = Number(x.ordlist_qty) || 0, k = name + '|' + opt + '|' + qty;
        var it = items[k] || (items[k] = { name: name, opt: opt, qty: qty, site: plain(x.site_name), orders: 0 });
        it.orders++;
      });
      var list = Object.keys(items).map(function(k){ return items[k]; });
      function nextTerm(){
        if (i >= terms.length) return Promise.resolve();
        return masterSearch(a.cust, terms[i++]).then(function(rows){ rows.forEach(function(m){ masters[m.code] = m; }); return nextTerm(); });
      }
      return nextTerm().then(function(){
        var names = list.map(function(x){ return x.name; }).filter(function(n, p, s){ return s.indexOf(n) === p; }).slice(0, 30), hist = {}, j = 0;
        function nextHist(){
          if (j >= names.length) return Promise.resolve();
          var n = names[j++];
          return matchHistory(a.cust, n).then(function(r){ hist[n] = r; return nextHist(); });
        }
        return nextHist().then(function(){ return { items: list, masters: Object.keys(masters).map(function(c){ return masters[c]; }), history: hist, ver: VER }; });
      });
    });
  }

  /* ── 맨소래담 스마트스토어 주문가져오기 (AI 물류비서, 사람이 건수를 보고 누른 한 번) ──
     이벗 함수(go_NewOrderInsert)를 그대로 부르고, 결과는 iframe1 에 뜸. 가져오는 동안 이벗이 ins_btn_yn 을 N 으로 둠 */
  var STORE = '14374', STORE_CUST = '2237', STORE_WAIT = 15000;
  function clean(v){ return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
  function storeCounts(){
    return fetch('/site/site230save_jdata?site_cust=' + STORE_CUST + '&site_code_sel=' + STORE, { credentials: 'include' }).then(function(r){ return r.text(); }).then(function(t){
      var j; try { j = JSON.parse(t); } catch (e) { throw new Error('LOGIN'); }
      var row = (j.rows || []).filter(function(x){ return String(x.site_code) === STORE; })[0];
      if (!row) throw new Error('판매처 건수를 받지 못했습니다');
      return { newCnt: String(row.newCnt), waitCnt: String(row.waitCnt) };
    });
  }
  function storeParts(){ return { link: document.querySelector('#btn_' + STORE + ' a'), box: document.getElementById('confirmYn' + STORE), ins: document.getElementById('ins_btn_yn'), frame: document.querySelector('iframe[name=iframe1]') }; }
  function cmdStoreCheck(){
    var p = storeParts();
    if (!p.link || !p.box || !p.ins) return { page: false };
    return storeCounts().then(function(c){ return { page: true, busy: p.ins.value !== 'Y', newCnt: c.newCnt, waitCnt: c.waitCnt }; });
  }
  function cmdStoreGo(){
    var p = storeParts();
    if (!p.link || !p.box || !p.ins || p.ins.value !== 'Y') return { started: false, why: '주문가져오기를 누를 수 없는 상태입니다', alerts: [] };
    var asked = [], alerts = [], keepC = window.confirm, keepA = window.alert;
    p.box.checked = true;
    /* 주문확인 체크(○)와 중복 경고가 든 바로 그 확인창만 받아들임 */
    window.confirm = function(m){ asked.push(String(m)); return /발주확인:○/.test(m) && /중복등록/.test(m); };
    window.alert = function(m){ alerts.push(clean(m).slice(0, 100)); };
    p.link.click();
    var end = Date.now() + STORE_WAIT;
    return new Promise(function(ok){
      (function tick(){
        if (p.ins.value === 'N' || Date.now() > end || alerts.length || (asked.length && !/발주확인:○/.test(asked[0]))) {
          window.confirm = keepC; window.alert = keepA;
          var started = p.ins.value === 'N';
          ok({ started: started, why: started ? '' : alerts[0] || (asked.length ? '이벗 확인창 문구가 달라 누르지 않았습니다' : '주문가져오기가 시작되지 않았습니다'), alerts: alerts });
          return;
        }
        setTimeout(tick, 200);
      })();
    });
  }
  /* 결과 화면 글은 고객 정보가 섞일 수 있어 짧은 건수 안내 줄만 돌려줌 */
  function safeLines(text){
    return String(text || '').split(/\n+/).map(clean).filter(function(l){ return l.length <= 40 && /\d+\s*건/.test(l) && !/\d{9,}|\d+-\d+-\d+|@/.test(l); }).slice(0, 8);
  }
  function cmdStoreStatus(){
    var p = storeParts(), d = null, pathName = '';
    if (!p.ins || !p.frame) return { lost: true };
    try { d = p.frame.contentDocument; pathName = p.frame.contentWindow.location.pathname; } catch (e) { d = null; }
    var done = p.ins.value === 'Y' || (/site231proc/.test(pathName) && !!d && d.readyState === 'complete');
    if (!done) return { done: false };
    var lines = d && d.body ? safeLines(d.body.innerText) : [];
    return storeCounts().then(function(c){ return { done: true, lines: lines, newCnt: c.newCnt }; }, function(){ return { done: true, lines: lines, newCnt: '' }; });
  }

  /* ── 주문 매칭 저장 (AI 물류비서, 사람이 확정하고 누른 상품만) ──
     이 탭에 연 주문서매칭 창(site217edit.jsp)에서 사람과 같은 순서: 왼쪽에서 그 주문 줄 선택 → 오른쪽에서 상품을 옵션코드로 찾아 추가 → 수량 → 매칭처리.
     맨소래담은 「상품코드+상품명+옵션명+수량」 방식이라 넣는 수량 합이 주문 수량과 다르면 「실주문수량과 매칭수량을 확인하지 않음」을 체크함 */
  var MATCH_CUST = '2237', MATCH_WAIT = 20000, MATCH_DAYS = 90;
  function norm(s){ return String(s == null ? '' : s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
  function ajaxDone(re){
    var $ = window.jQuery;
    return new Promise(function(ok, no){
      var t = setTimeout(function(){ $(document).off('ajaxComplete', on); no(new Error('이벗 응답 없음')); }, MATCH_WAIT);
      function on(e, x, s){ if (!re.test((s && s.url) || '')) return; clearTimeout(t); $(document).off('ajaxComplete', on); setTimeout(function(){ ok(x); }, 300); }
      $(document).on('ajaxComplete', on);
    });
  }
  function cmdMatchSave(a){
    var $ = window.jQuery, L = $ && $('#gridList_left'), G = $ && $('#gridList_right');
    if (!$ || !L.length || !G.length || typeof window.go_new !== 'function') throw new Error('이벗 주문서매칭 창이 아닙니다');
    var picks = (a.picks || []).filter(function(p){ return p.code && Number(p.qty) >= 1; });
    if (!a.name || !picks.length) throw new Error('매칭할 상품이 없습니다');
    var alerts = [], keepA = window.alert, keepC = window.confirm;
    function restore(){ window.alert = keepA; window.confirm = keepC; }
    window.alert = function(m){ alerts.push(norm(m).slice(0, 120)); };
    window.confirm = function(m){ return picks.length > 1 && /2개이상 선택/.test(String(m)); };
    var d = new Date(), from = new Date(d.getTime() - MATCH_DAYS * 864e5);
    function day(x){ return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); }
    if ($('#cust_code option[value=' + MATCH_CUST + ']').length) $('#cust_code').val(MATCH_CUST);
    $('#date1').val(day(from)); $('#date2').val(day(d));
    /* 이벗 왼쪽 검색은 + , ( ) 같은 기호가 든 긴 상품명을 못 찾음 (대표님 2026-11-03). 기호 앞까지 잘라 찾고, 없으면 검색어 없이 전부 불러와 같은 줄을 고름 */
    var cut = norm(a.name).replace(/\[[^\]]*\]/g, ' ').split(/[+,()\[\]\/%&]/)[0].trim();
    var queries = (cut.length >= 2 && cut !== norm(a.name) ? [cut] : cut.length >= 2 ? [cut] : []).concat(['']);
    function exact(){
      return L.jqGrid('getDataIDs').filter(function(id){
        var r = L.jqGrid('getRowData', id);
        return norm(r.ordlist_name_ori) === norm(a.name) && norm(r.ordlist_opt) === norm(a.opt) && Number(r.ordlist_qty) === Number(a.qty);
      });
    }
    function findLeft(i){
      $('#l_search_select').val('1'); $('#l_search_text').val(queries[i]);
      var done = ajaxDone(/site217edit_left_jdata/);
      window.go_search_left();
      return done.then(function(){
        var hit = exact();
        if (hit.length || i + 1 >= queries.length) return hit;
        return findLeft(i + 1);
      });
    }
    var left = findLeft(0);
    function addPick(i){
      if (i >= picks.length) return Promise.resolve();
      $('#r_search_select').val('7'); $('#r_search_text').val(picks[i].code); $('#r_search_opt').val(''); $('#r_search_opt2').val('');
      var right = ajaxDone(/site217edit_right_jdata/);
      window.go_search_right();
      return right.then(function(){
        if (G.jqGrid('getInd', String(picks[i].code)) === false) throw new Error('이벗 상품(옵션코드 ' + picks[i].code + ')을 찾지 못했습니다');
        var before = $('input[name=basic_seq]').length;
        G.jqGrid('setSelection', String(picks[i].code), true);
        if ($('input[name=basic_seq]').length !== before + 1) throw new Error('상품을 추가하지 못했습니다 ' + (alerts.slice(-1)[0] || ''));
        return addPick(i + 1);
      });
    }
    return left.then(function(hit){
      if (hit.length !== 1) throw new Error(hit.length ? '같은 주문 줄이 ' + hit.length + '개라 고르지 않았습니다' : '이벗 매칭 창에서 이 주문 줄을 찾지 못했습니다 (이미 매칭됐을 수 있음)');
      var auto = ajaxDone(/site217edit_right_jdata/).catch(function(){});
      L.jqGrid('setSelection', hit[0], false);
      window.onSelectRowLeft(hit[0]);
      return auto;
    }).then(function(){
      window.delete_right_list();
      return addPick(0);
    }).then(function(){
      var q = $('input[name=bmat_qty]');
      if (q.length !== picks.length) throw new Error('넣을 상품 수가 맞지 않습니다');
      var sum = 0;
      picks.forEach(function(p, i){ q.eq(i).val(String(Number(p.qty))); sum += Number(p.qty); });
      $('input:checkbox[name=qty_check]').prop('checked', sum !== Number($('#name1_qty').text()));
      $('input:checkbox[name=alert_check]').prop('checked', true);
      $('#result_msg').text('');
      var saved = ajaxDone(/\/site\/site217save(\?|$)/);
      window.go_new();
      return saved;
    }).then(function(x){
      /* 이벗 화면이 저장 뒤 결과 칸에 「메시지<br>success,…」 를 남김. 응답 글자를 직접 해석하지 않고 이것으로 판단 */
      var shown = norm($('#result_msg').text()), j = null;
      try { j = JSON.parse(x.responseText); } catch (e) { j = null; }
      var ok = /(^|[\s,>])success(,|$)/.test(shown) || (!!j && j.result === 'success');
      var msg = (j && norm(j.msg)) || norm(shown.split('<br>')[0]);
      restore();
      return { ok: ok, msg: msg.slice(0, 120) || (ok ? '' : '이벗 저장 결과를 확인하지 못했습니다'), alerts: alerts };
    }, function(e){
      restore();
      return { ok: false, msg: String(e.message || e) + (alerts.length ? ' · ' + alerts.join(' / ') : ''), alerts: alerts };
    });
  }

  var busy = 0;
  function onMsg(e){
    var m = e.data;
    if (!m || m.to !== 'ebut-helper' || !ALLOW.test(e.origin)) return;
    var run = m.cmd === 'find' ? cmdFind : m.cmd === 'save' ? cmdSave : m.cmd === 'ping' ? cmdPing : m.cmd === 'orders' ? cmdOrders : m.cmd === 'matchRead' ? cmdMatchRead : m.cmd === 'matchSearch' ? cmdMatchSearch : m.cmd === 'relogin' ? cmdRelogin : m.cmd === 'login' ? cmdLogin : m.cmd === 'uploadMenso' ? cmdUploadMenso : m.cmd === 'storeCheck' ? cmdStoreCheck : m.cmd === 'storeGo' ? cmdStoreGo : m.cmd === 'storeStatus' ? cmdStoreStatus : m.cmd === 'matchSave' ? cmdMatchSave : null;
    if (!run) return;
    peer = e.source; peerOrigin = e.origin;
    /* 마지막으로 연결된 반품 화면(스타/화물)을 기억 → 다음에 반품 화면 없이 도우미를 누르면 그 화면을 엶 */
    if (m.args && (m.args.db === 'cargo' || m.args.db === 'star')) try { localStorage.setItem('mkwRetDb', m.args.db); } catch(x){}
    busy++; if (m.cmd === 'uploadMenso') say('맨소래담 주문 등록 중… 창을 닫지 마세요'); else if (m.cmd === 'storeGo' || m.cmd === 'storeStatus') say('맨소래담 주문 가져오는 중… 창을 닫지 마세요'); else if (m.cmd === 'matchSave') say('주문 매칭 저장 중… 창을 닫지 마세요'); else if (m.cmd === 'relogin' || m.cmd === 'login') say('로그인 시도 중…'); else if (m.cmd === 'orders' || m.cmd === 'matchRead' || m.cmd === 'matchSearch') say('자료 읽는 중… (저장 안 함)'); else if (m.cmd !== 'ping') say(m.cmd === 'save' ? '이벗에 반품입고 저장 중… ' + (m.args && m.args.rno || '') : '원송장 주문 찾는 중…');
    Promise.resolve().then(function(){ return run(m.args || {}); }).then(function(data){
      e.source.postMessage({ from: 'ebut-helper', id: m.id, ok: true, data: data }, e.origin);
      if (m.cmd !== 'ping') say('✔ 완료 — 🟢 연결됨');
      else say(data.login ? '🟢 반품입고관리와 연결됨' : '⚠️ 이벗 로그아웃됨 — 다시 로그인한 뒤 도우미를 다시 눌러 주세요');
    }, function(err){
      var msg = String((err && err.message) || err);
      e.source.postMessage({ from: 'ebut-helper', id: m.id, ok: false, err: msg }, e.origin);
      say(msg === 'LOGIN' ? '⚠️ 이벗 로그아웃됨 — 다시 로그인한 뒤 도우미를 다시 눌러 주세요' : '⚠️ ' + msg);
    }).then(function(){ busy--; });
  }
  window.addEventListener('message', onMsg);

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
  var beat = setInterval(function(){ if (!busy) cmdPing().then(function(r){ if (!r.login) say('⚠️ 이벗 로그아웃됨 — 다시 로그인한 뒤 도우미를 다시 눌러 주세요'); }); }, 5 * 60 * 1000);

  /* 새 버전 도우미가 이 버전을 끌 때 씀 */
  function stop(){ window.removeEventListener('message', onMsg); clearInterval(beat); box.remove(); }
  window.__mkwEbutHelper = { hello: hello, ver: VER, stop: stop };
  hello();
})();
