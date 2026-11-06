/* ============================================================
   비젬 도우미 — AI 물류비서 짝꿍 (2026-11-03)

   비서가 연 탭에서 확장이 켠다. 대표님 로그인을 그대로 쓴다.
   허용한 주소(ALLOW)에서 온 요청만 받는다. 읽기, 로그인 입력, 사람이 확인한 주문수집과 주문확정(전체) 한 번씩만 한다.
   양식은 사람이 누른 등록 요청 때만 받아 실행 PC 메모리로만 넘긴다. 삭제 버튼은 누르지 않는다. 고객 정보와 쇼핑몰 계정 ID 를 읽지 않고 건수와 쇼핑몰 이름만 돌려준다.

   명령
     ping   → { login, checked, ver }
     counts → { unconfirmed, printWait }   주문확정 대기, 운송장인쇄 대기
     login  { id, pw } → { tried, why }    비서 화면에서 사람이 입력한 값으로 로그인 버튼을 한 번 누름
     collectCheck  → { malls, checked, from, to, opt }   주문서수집 화면을 열어 읽기만 함
     collectGo     → { started, why, alerts }   수집 버튼과 비젬 확인창을 한 번씩 누름. 쇼핑몰에 발주확인 처리되어 되돌릴 수 없음
     collectStatus → { done, malls } · { done:false, error } · { lost:true }
     confirmCheck  → { orders, invoices, status, hold }   주문서확정 화면을 열어 검색하고 건수만 읽음
     confirmGo { orders } → { started, why, alerts }     「조회된 운송장 전체 확정」과 비젬 확인창을 한 번씩 누름
     confirmStatus → { done } · { ask:true } · { error } · { lost:true }
     formCheck → { form, status, memo, downloaded }  운송장인쇄 화면을 열어 읽기만 함
     formPage { page } → { buffer }  양식 파일 내용. 비젬에 다운로드 기록이 남음
============================================================ */
(function(){
  'use strict';
  if (!/(^|\.)bizesm\.com$/.test(location.hostname)) return;
  var VER = '2026-11-06c';
  var old = window.__mkwBizemHelper;
  if (old) { if (old.ver === VER) { old.hello(); return; } old.stop(); }
  var ALLOW = /^https:\/\/(www\.)?makewon\.com$|^https:\/\/makechango-wms\.(web\.app|firebaseapp\.com)$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
  var COUNT_URL = '/api/WorkFlow/GetWorkflowOrderCounts';

  function passwordField(){ return document.querySelector('input[type=password]'); }
  /* 비젬 응답은 ([...]) 모양 */
  function parseCounts(text){
    var t = String(text).trim().replace(/^\(/, '').replace(/\)\s*;?$/, '');
    if (t.charAt(0) !== '[') throw new Error('LOGIN');
    var out = { unconfirmed: 0, printWait: 0 };
    JSON.parse(t).forEach(function(r){
      if (r.TRNSPRT_STTUS_SE === 'A10') out.unconfirmed = Number(r.CNT) || 0;
      if (r.TRNSPRT_STTUS_SE === 'B10') out.printWait = Number(r.CNT) || 0;
    });
    return out;
  }
  function cmdCounts(){
    return fetch(COUNT_URL, { credentials: 'include', headers: { Accept: 'application/json' } }).then(function(r){ return r.text(); }).then(parseCounts);
  }
  function cmdPing(){
    if (passwordField()) return { login: false, checked: true, ver: VER };
    return cmdCounts().then(function(){ return { login: true, checked: true, ver: VER }; },
      function(e){ var isLogin = e.message === 'LOGIN'; return { login: !isLogin, checked: isLogin, err: isLogin ? '' : e.message, ver: VER }; });
  }
  function setField(el, v){
    var proto = window.HTMLInputElement && el instanceof window.HTMLInputElement ? Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value') : null;
    if (el.focus) el.focus();
    if (proto && proto.set) proto.set.call(el, v); else el.value = v;
    if (el.dispatchEvent && window.Event) ['input', 'change'].forEach(function(n){ el.dispatchEvent(new window.Event(n, { bubbles: true })); });
    if (el.blur) el.blur();
  }
  /* 값을 보관하거나 돌려주지 않음. 알림창은 무인 탭을 멈추므로 띄우지 않음. 성공 여부는 헤드비서가 다시 열어 확인 */
  function cmdLogin(args){
    var pw = passwordField();
    if (!pw) return { tried: false, why: '로그인 칸을 찾지 못함' };
    var form = pw.form || document, id = form.querySelector('input[type=text]');
    if (!id) return { tried: false, why: '아이디 칸을 찾지 못함' };
    if (form.querySelector('input[name*=captcha i], input[name*=otp i]')) return { tried: false, why: '추가 인증이 있어 직접 로그인해 주세요' };
    var btn = document.getElementById('btnLogOn') || Array.prototype.filter.call(form.querySelectorAll('button,a,input[type=submit]'), function(b){ return /로그인/.test(b.textContent || b.value || ''); })[0];
    if (!btn) return { tried: false, why: '로그인 버튼을 찾지 못함' };
    setField(id, args.id); setField(pw, args.pw);
    window.alert = function(){};
    setTimeout(function(){ btn.click(); }, 300);
    return { tried: true };
  }

  /* 주문수집은 비젬 화면의 버튼을 그대로 눌러 비젬 자체 점검(기간·3분 제한·공지)을 모두 거침. 체크와 기간은 화면 값을 바꾸지 않음 */
  var COLLECT_MENU = 'REQ005MA', COLLECT_GO = 'btngetorderafterconfirm', POPUP = 'myframe', MODAL_TEXT = '#myModal .modal-body';
  var GRID_WAIT = 30000, CONFIRM_WAIT = 10000, START_WAIT = 15000, POLL = 200, SETTLE = 2000;
  var COL_NAME = 4, COL_LAST = 5, COL_STATUS = 6;
  function clean(v){ return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
  function sleep(ms){ return new Promise(function(ok){ setTimeout(ok, ms); }); }
  function waitFor(found, ms){
    var end = Date.now() + ms;
    return (function tick(){
      var v = found();
      if (v) return Promise.resolve(v);
      if (Date.now() >= end) return Promise.resolve(null);
      return sleep(POLL).then(tick);
    })();
  }
  function collectWin(){
    var f = document.getElementById('iframe_' + COLLECT_MENU), w = f && f.contentWindow;
    try { return w && w.document ? w : null; } catch (e) { return null; }
  }
  function readMalls(doc){
    var out = [];
    Array.prototype.forEach.call(doc.querySelectorAll('#grid1body tr'), function(tr){
      var cb = tr.querySelector('input[type=checkbox]');
      if (!cb) return;   /* 수집 미지원 줄 */
      var last = clean(tr.cells[COL_LAST].textContent).match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
      out.push({ name: clean(tr.cells[COL_NAME].textContent), checked: !!cb.checked, last: last ? last[0] : '', status: clean(tr.cells[COL_STATUS].textContent) });
    });
    return out;
  }
  function cmdCollectCheck(){
    if (!collectWin()) {
      if (typeof window.addTabReload !== 'function') throw new Error('비젬 메뉴를 찾지 못했습니다');
      window.addTabReload(COLLECT_MENU);
    }
    return waitFor(function(){ var w = collectWin(); return w && readMalls(w.document).length ? w : null; }, GRID_WAIT).then(function(w){
      if (!w) throw new Error('주문서수집 화면을 읽지 못했습니다');
      var d = w.document, malls = readMalls(d), opt = d.querySelector('input[name=getOpt]:checked');
      return { malls: malls, checked: malls.filter(function(m){ return m.checked; }).map(function(m){ return m.name; }),
               from: d.getElementById('txtstdt').value, to: d.getElementById('txtenddt').value, opt: opt ? opt.value : '' };
    });
  }
  function cmdCollectGo(){
    var w = collectWin(), d = w && w.document, btn = d && d.getElementById(COLLECT_GO);
    if (!btn || btn.disabled) return { started: false, why: '주문수집 버튼을 누를 수 없는 상태입니다', alerts: [] };
    var alerts = [];
    w.alert = function(m){ alerts.push(clean(m).slice(0, 100)); };
    btn.click();
    return waitFor(function(){
      var ok = d.getElementById('myConfirmModalOkBtn'), body = d.getElementById('myConfirmModalBody');
      return ok && body && /발주확인/.test(body.textContent) ? ok : null;
    }, CONFIRM_WAIT).then(function(ok){
      if (!ok) return { started: false, why: '비젬 확인창이 뜨지 않았습니다. 공지창이 떴을 수 있으니 실행 PC 의 비젬 탭을 확인해 주세요', alerts: alerts };
      var stale = d.querySelector(MODAL_TEXT);   /* 누르기 전부터 있던 안내창을 거절로 읽지 않음. 비젬은 새 안내 때 창을 새로 만듦 */
      ok.click();
      return waitFor(function(){
        var f = d.getElementById(POPUP);
        if (f && /cmdtype=getOrderAfterConfirm/.test(f.getAttribute('src') || '')) return { started: true, alerts: alerts };
        var m = d.querySelector(MODAL_TEXT);
        return m && m !== stale && clean(m.textContent) ? { started: false, why: clean(m.textContent).slice(0, 120), alerts: alerts } : null;
      }, START_WAIT).then(function(r){
        return r || { started: false, why: '수집이 시작됐는지 확인하지 못했습니다. 비젬에서 확인해 주세요', alerts: alerts };
      });
    });
  }
  function cmdCollectStatus(){
    var w = collectWin(), d = w && w.document, btn = d && d.getElementById(COLLECT_GO);
    if (!btn) return { lost: true };
    /* 비젬이 끝나면 진행창에서 parent.resetButton 을 불러 버튼을 풀고 표를 다시 읽음 */
    if (!btn.disabled) return sleep(SETTLE).then(function(){ return { done: true, malls: readMalls(d) }; });
    var f = d.getElementById(POPUP), popup = null;
    try { popup = f && f.contentWindow.document; } catch (e) { popup = null; }
    var m = popup && popup.querySelector(MODAL_TEXT);
    return m && clean(m.textContent) ? { done: false, error: clean(m.textContent).slice(0, 120) } : { done: false };
  }

  /* 주문확정: 화면 기본 조건(미확정, 보류 제외) 그대로 검색한 뒤 「조회된 운송장 전체 확정」. 확인창 문구가 다르면 누르지 않음 */
  var CONFIRM_MENU = 'REQ008MA', CONFIRM_ALL = '#btnAllOrderSave a', CONFIRM_TEXT = /전체 주문건을 주문확정/, CONFIRM_POPUP = 'iframe[name=myframeMid],#myframeMid';
  function menuWin(id){
    var f = document.getElementById('iframe_' + id), w = f && f.contentWindow;
    try { return w && w.document ? w : null; } catch (e) { return null; }
  }
  function cmdConfirmCheck(){
    if (!menuWin(CONFIRM_MENU)) {
      if (typeof window.addTabReload !== 'function') throw new Error('비젬 메뉴를 찾지 못했습니다');
      window.addTabReload(CONFIRM_MENU);
    }
    return waitFor(function(){ var w = menuWin(CONFIRM_MENU); return w && w.document.readyState === 'complete' && w.document.getElementById('btnSearch') && typeof w.cmdSearch === 'function' ? w : null; }, GRID_WAIT).then(function(w){
      if (!w) throw new Error('주문서확정 화면을 열지 못했습니다');
      return sleep(SETTLE).then(function(){
        var d = w.document, cnt = d.getElementById('ordercnt');
        cnt.value = '';
        d.getElementById('btnSearch').click();
        return waitFor(function(){ return cnt.value !== '' ? cnt : null; }, GRID_WAIT).then(function(found){
          if (!found) throw new Error('주문서확정 검색 결과를 읽지 못했습니다');
          var radio = d.querySelector('input[name=radiotrnsprtsttusse]:checked'), grp = d.getElementById('grpcnt');
          return { orders: Number(cnt.value) || 0, invoices: Number(grp && grp.value) || 0, status: radio ? radio.value : '', hold: d.getElementById('selresrveat').value };
        });
      });
    });
  }
  function cmdConfirmGo(args){
    var w = menuWin(CONFIRM_MENU), d = w && w.document, item = d && d.querySelector(CONFIRM_ALL), cnt = d && d.getElementById('ordercnt');
    if (!item || !cnt) return { started: false, why: '주문서확정 화면이 없습니다', alerts: [] };
    if (Number(cnt.value) !== Number(args.orders) || !Number(args.orders)) return { started: false, why: '건수가 달라졌습니다', alerts: [] };
    var alerts = [];
    w.alert = function(m){ alerts.push(clean(m).slice(0, 100)); };
    item.click();
    return waitFor(function(){
      var ok = d.getElementById('myConfirmModalOkBtn'), body = d.getElementById('myConfirmModalBody');
      return ok && body && CONFIRM_TEXT.test(body.textContent) ? ok : null;
    }, CONFIRM_WAIT).then(function(ok){
      if (!ok) return { started: false, why: '비젬 주문확정 확인창이 뜨지 않았습니다. 실행 PC 의 비젬 탭을 확인해 주세요', alerts: alerts };
      var stale = d.querySelector(MODAL_TEXT);
      ok.click();
      return waitFor(function(){
        if (d.querySelector(CONFIRM_POPUP)) return { started: true, alerts: alerts };
        var m = d.querySelector(MODAL_TEXT);
        return m && m !== stale && clean(m.textContent) ? { started: false, why: clean(m.textContent).slice(0, 120), alerts: alerts } : null;
      }, START_WAIT).then(function(r){
        return r || { started: false, why: '주문확정이 시작됐는지 확인하지 못했습니다. 비젬에서 확인해 주세요', alerts: alerts };
      });
    });
  }
  /* 진행창이 묻는 강제 확정·취소는 사람이 정함. 누르지 않고 내용도 옮기지 않음 */
  function cmdConfirmStatus(){
    var w = menuWin(CONFIRM_MENU), f = w && w.document.querySelector(CONFIRM_POPUP), p = null;
    if (!f) return { lost: true };
    try { p = f.contentWindow; if (!p.document) p = null; } catch (e) { p = null; }
    if (!p) return { done: false };
    if (p.isSuccess === true) return { done: true };
    if (p.document.querySelector('[onclick*="ForceConfirm"],[onclick*="CancleConfirm"]')) return { done: false, ask: true };
    var m = p.document.querySelector(MODAL_TEXT);
    return m && clean(m.textContent) ? { done: false, error: clean(m.textContent).slice(0, 120) } : { done: false };
  }

  /* 양식 받기: 비젬 함수가 만든 요청을 받아 같은 순서(DateCheck → 양식 요청)로 보내고, 파일을 저장하는 대신 내용을 돌려줌 */
  var FORM_MENU = 'REQ023MA', FORM_NAME = '0000_박스앤캔_코코나나양식';
  function cmdFormCheck(){
    if (!menuWin(FORM_MENU)) {
      if (typeof window.addTabReload !== 'function') throw new Error('비젬 메뉴를 찾지 못했습니다');
      window.addTabReload(FORM_MENU);
    }
    function option(d){ return Array.prototype.filter.call(d.getElementById('selexcelform') ? d.getElementById('selexcelform').options : [], function(o){ return clean(o.text) === FORM_NAME; })[0]; }
    return waitFor(function(){ var w = menuWin(FORM_MENU); return w && w.document.readyState === 'complete' && typeof w.excelFormDownload === 'function' && option(w.document) ? w : null; }, GRID_WAIT).then(function(w){
      if (!w) return { form: '' };
      return sleep(SETTLE).then(function(){
        var d = w.document, opt = option(d);
        d.getElementById('selexcelform').value = opt.value;
        return Promise.resolve(w.getWaybildwlddtCnt(opt.value)).then(function(n){
          return { form: clean(opt.text), status: d.getElementById('seltrnsprtsttusse').value, memo: Number(w.cmdCheckMsgConfirm()) || 0, downloaded: Number(n) || 0 };
        });
      });
    });
  }
  function cmdFormPage(args){
    var w = menuWin(FORM_MENU);
    if (!w || typeof w.excelFormDownload !== 'function') throw new Error('운송장인쇄 화면이 없습니다');
    var keep = w.downloadDateCheckExcelRequest, req = null;
    w.downloadDateCheckExcelRequest = function(url, param){ req = { url: url, param: param }; };
    w.pageNo = Number(args.page) || 1;
    try { w.excelFormDownload(); } finally { w.downloadDateCheckExcelRequest = keep; }
    if (!req) throw new Error('양식 요청을 만들지 못했습니다');
    return fetch('/api/TB_ORDER/DateCheck', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json;charset=utf-8' }, body: req.param }).then(function(r){
      if (!r.ok) throw new Error('비젬 날짜 확인 실패 ' + r.status);
      return fetch(req.url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'command=excel&data=' + encodeURIComponent(req.param) });
    }).then(function(r){
      if (!r.ok) throw new Error('비젬 양식 응답 ' + r.status);
      return r.arrayBuffer();
    }).then(function(buffer){ return { buffer: buffer }; });
  }

  /* 송장업로드 준비 조사 (2026-11-06): 송장 관련 메뉴를 열어 버튼·입력칸·표 제목만 읽음. 표 안 내용(고객 정보)은 읽지 않고 아무것도 누르지 않음 */
  var SURVEY_MENU = /^\[\d+\](운송장입력\(대량\)|발송검수|쇼핑몰운송장전송)$/;
  function surveyMenus(){
    var seen = {}, out = [];
    Array.prototype.forEach.call(document.querySelectorAll('[onclick*="addTab"],a[href*="addTab"]'), function(el){
      var src = String(el.getAttribute('onclick') || el.getAttribute('href') || ''), m = src.match(/addTab\w*\(\s*['"]([A-Za-z0-9_]+)['"]/);
      if (!m || seen[m[1]]) return;
      seen[m[1]] = true;
      out.push({ code: m[1], text: clean(el.textContent).slice(0, 30) });
    });
    return out;
  }
  /* 버튼이 부르는 비젬 함수의 코드(고객 정보 없음)만 읽음. 자동으로 누르기 전에 확인창·진행 방식을 알기 위함 */
  var SURVEY_FN = ['cmdsave', 'cmdSave', 'cmdAllSave', 'cmdWayBillCheckUp', 'cmdSend', 'cmdSendAll', 'cmdSendAllQueue', 'getSendSetup', 'selectChk', 'checkBoxClickAll', 'pagingSizeChange', 'cmdSearch', 'fnSearch', 'saveSelection', 'cmdCheckMsgConfirm', 'preCheckCheckedTableRowCnt', 'jsonsendForm', 'sendForm'];
  var SURVEY_BTN = ['btnSearch', 'btnWayBillCheckUp', 'btnSend', 'btnWbQueueSearch', 'chkall', 'btnGDPage', 'fileHdrycWaybil'];
  function surveySrc(d){
    var w = d.defaultView, out = {};
    SURVEY_FN.forEach(function(n){ try { if (typeof w[n] === 'function') out[n] = String(w[n]).slice(0, 4000); } catch (e) {} });
    SURVEY_BTN.forEach(function(id){
      var el = d.getElementById(id) || d.querySelector('[name=' + id + ']'), jq = w.jQuery;
      if (!el) return;
      try {
        var ev = jq && jq._data && jq._data(el, 'events'), list = [];
        if (ev) Object.keys(ev).forEach(function(t){ ev[t].forEach(function(h){ list.push(t + ': ' + String(h.handler).slice(0, 3000)); }); });
        if (el.onclick) list.push('onclick: ' + String(el.onclick).slice(0, 1500));
        if (el.onchange) list.push('onchange: ' + String(el.onchange).slice(0, 1500));
        if (list.length) out['#' + id] = list.join(' ||| ');
      } catch (e) {}
    });
    return out;
  }
  function surveyScreen(d){
    var lim = function(a, n){ return Array.prototype.slice.call(a, 0, n); };
    return {
      title: clean(d.title).slice(0, 40),
      buttons: lim(d.querySelectorAll('button,input[type=button],input[type=submit],a[onclick],[onclick]'), 120).map(function(el){
        return { tag: el.tagName.toLowerCase(), id: el.id || '', text: clean(el.textContent || el.value).slice(0, 30), onclick: String(el.getAttribute('onclick') || '').slice(0, 120) };
      }).filter(function(b){ return b.id || b.text || b.onclick; }),
      inputs: lim(d.querySelectorAll('input:not([type=hidden]):not([type=button]):not([type=submit]),select,textarea'), 80).map(function(el){
        var t = (el.getAttribute('type') || el.tagName).toLowerCase(), o = { type: t, id: el.id || '', name: el.name || '' };
        if (t === 'radio' || t === 'checkbox') o.checked = !!el.checked;
        if (el.tagName === 'SELECT') { o.selected = el.selectedIndex >= 0 ? clean(el.options[el.selectedIndex].text).slice(0, 30) : ''; o.options = lim(el.options, 15).map(function(op){ return clean(op.text).slice(0, 30); }); }
        return o;
      }),
      heads: lim(d.querySelectorAll('th,.ui-jqgrid-sortable,[role=columnheader]'), 60).map(function(el){ return clean(el.textContent).slice(0, 20); }).filter(Boolean),
      rows: d.querySelectorAll('tbody tr').length,
      src: surveySrc(d),
      frames: lim(d.querySelectorAll('iframe'), 10).map(function(f){ return f.id || f.name || ''; }),
      funcs: Object.keys(d.defaultView || {}).filter(function(k){ try { return typeof d.defaultView[k] === 'function' && /save|upload|send|insert|chk|check|trans|move|excel|file/i.test(k) && !/^on|^webkit/i.test(k); } catch (e) { return false; } }).slice(0, 60)
    };
  }
  function cmdSurvey(){
    var menus = surveyMenus(), want = menus.filter(function(m){ return SURVEY_MENU.test(m.text) || m.code === 'REQ014MA'; }).slice(0, 8);
    var screens = {};
    return want.reduce(function(p, m){
      return p.then(function(){
        if (!menuWin(m.code)) { try { window.addTabReload(m.code); } catch (e) { screens[m.code] = { err: '열지 못함' }; return; } }
        return waitFor(function(){ var w = menuWin(m.code); return w && w.document.readyState === 'complete' && w.document.body ? w : null; }, GRID_WAIT).then(function(w){
          if (!w) { screens[m.code] = { err: '화면이 안 열림' }; return; }
          return sleep(SETTLE).then(function(){ try { screens[m.code] = surveyScreen(w.document); } catch (e) { screens[m.code] = { err: String(e.message || e).slice(0, 80) }; } });
        });
      });
    }, Promise.resolve()).then(function(){ return { menus: menus.slice(0, 200), want: want, screens: screens, hash: location.hash }; });
  }
  var CMDS = { survey: cmdSurvey, formCheck: cmdFormCheck, formPage: cmdFormPage, ping: cmdPing, counts: cmdCounts, login: cmdLogin, collectCheck: cmdCollectCheck, collectGo: cmdCollectGo, collectStatus: cmdCollectStatus, confirmCheck: cmdConfirmCheck, confirmGo: cmdConfirmGo, confirmStatus: cmdConfirmStatus };
  function onMsg(e){
    var m = e.data;
    if (!m || m.to !== 'bizem-helper' || !ALLOW.test(e.origin)) return;
    if (!Object.prototype.hasOwnProperty.call(CMDS, m.cmd)) return;
    Promise.resolve().then(function(){ return CMDS[m.cmd](m.args || {}); }).then(function(data){
      e.source.postMessage({ from: 'bizem-helper', id: m.id, ok: true, data: data }, e.origin);
    }, function(err){
      e.source.postMessage({ from: 'bizem-helper', id: m.id, ok: false, err: String((err && err.message) || err) }, e.origin);
    });
  }
  window.addEventListener('message', onMsg);
  function hello(){ try { if (window.opener && !window.opener.closed) window.opener.postMessage({ from: 'bizem-helper', cmd: 'ready', ver: VER }, '*'); } catch (e) {} }
  function stop(){ window.removeEventListener('message', onMsg); }
  window.__mkwBizemHelper = { ver: VER, hello: hello, stop: stop, parseCounts: parseCounts, login: cmdLogin };
  hello();
})();
