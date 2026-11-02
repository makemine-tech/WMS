/* ============================================================
   비젬 도우미 — AI 물류비서 짝꿍 (2026-11-03)

   비서가 연 탭에서 확장이 켠다. 대표님 로그인을 그대로 쓴다.
   허용한 주소(ALLOW)에서 온 요청만 받고, 지금은 읽기와 로그인 입력만 한다.
   주문수집·주문확정·삭제·양식다운로드 버튼은 누르지 않는다. 고객 정보를 읽지 않고 건수만 돌려준다.

   명령
     ping   → { login, checked, ver }
     counts → { unconfirmed, printWait }   주문확정 대기, 운송장인쇄 대기
     login  { id, pw } → { tried, why }    비서 화면에서 사람이 입력한 값으로 로그인 버튼을 한 번 누름
============================================================ */
(function(){
  'use strict';
  if (!/(^|\.)bizesm\.com$/.test(location.hostname)) return;
  var VER = '2026-11-03a';
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

  var CMDS = { ping: cmdPing, counts: cmdCounts, login: cmdLogin };
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
