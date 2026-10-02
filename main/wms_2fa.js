/* ============================================================
   WMS 2차 인증 — 슈퍼관리자 숨김 메뉴 공용 (사이트 통계·정산관리 …)

   급여관리(payroll.html)와 **같은 2차 비밀번호**를 쓴다.
   payroll/vault 의 감싼 키(wrapPw)를 비밀번호로 풀어 보아 맞는지만 확인하고, 풀린 키는 바로 지운다.
   실패 잠금(payroll/lock: 5회 틀리면 15분)과 감사기록(payroll/audit)도 급여관리와 공유한다.
   비밀번호 분실 복구·변경은 급여관리 화면에서 한다.

   사용 (wms_access.js data-floor="3" 다음에):
     <script src="/wms_2fa.js"></script>
     WMS2FA.guard({
       page: 'settlement', title: '정산관리', icon: '🧾',
       onUnlock: function(){ ...본문 열기 },   // 인증될 때마다 호출
       onLock:   function(){ ...본문 비우기 }    // 잠길 때마다 호출
     });
     WMS2FA.lockNow()            — 지금 잠그기
     <span data-2fa-timer></span> — 남은 자동잠금 시간이 표시된다

   화면 잠금이다 — 데이터 자체를 이 비밀번호로 암호화하는 것은 급여관리뿐이다.
============================================================ */
(function(){
  'use strict';
  var ITER = 600000, MAX_FAILS = 5, LOCK_MIN = 15;
  var TE = new TextEncoder();
  var opt = null, unlocked = false, lastAct = Date.now(), tick = null, root = null;

  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function ub64(s){ var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function pref(p){ return firebase.database().ref('payroll/' + p); }
  function el(id){ return document.getElementById(id); }
  function user(){ return firebase.auth().currentUser; }

  function audit(ev){
    try { var u = user();
      pref('audit').push({ ev: ev, page: opt.page, t: firebase.database.ServerValue.TIMESTAMP, uid: u && u.uid, email: (u && u.email) || '' }); } catch (e) {}
  }

  /* ── 관문 화면 (페이지 위를 덮는다) ── */
  var CSS =
    '#w2fa{position:fixed;inset:0;z-index:2147483000;background:#0b0d12;color:#e6e9f0;display:flex;align-items:center;justify-content:center;padding:24px;font-family:"Noto Sans KR",system-ui,sans-serif}'
    + '#w2fa .bx{width:100%;max-width:420px;background:#141822;border:1px solid #2a3040;border-radius:16px;padding:28px 24px;text-align:center}'
    + '#w2fa .ic{font-size:40px;margin-bottom:10px}#w2fa .t{font-size:19px;font-weight:900;margin-bottom:6px}'
    + '#w2fa .s{font-size:12.5px;color:#8b94a8;line-height:1.75}'
    + '#w2fa input{width:100%;box-sizing:border-box;font-size:16px;padding:.7rem .8rem;margin:16px 0 10px;text-align:center;letter-spacing:.08em;color:#e6e9f0;background:#1c2331;border:1px solid #2a3040;border-radius:7px;font-family:inherit}'
    + '#w2fa input:focus{outline:none;border-color:#60a5fa}'
    + '#w2fa .m{font-size:12.5px;min-height:1.4em;margin:4px 0 10px;line-height:1.6}#w2fa .m.er{color:#f87171}#w2fa .m.wa{color:#fbbf24}'
    + '#w2fa button{width:100%;border:none;border-radius:8px;padding:.75rem;font-size:15px;font-weight:700;background:#60a5fa;color:#0b0d12;cursor:pointer;font-family:inherit}'
    + '#w2fa button:disabled{opacity:.45;cursor:not-allowed}'
    + '#w2fa a{display:inline-block;color:#8b94a8;font-size:12px;margin-top:12px}'
    + '#w2fa.hide{display:none}';

  function mount(){
    if (root) return;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    root = document.createElement('div'); root.id = 'w2fa';
    root.innerHTML = '<div class="bx"><div class="ic" id="w2faIc"></div><div class="t" id="w2faT"></div>'
      + '<div class="s" id="w2faS"></div><div id="w2faForm" style="display:none">'
      + '<input id="w2faPw" type="password" placeholder="2차 비밀번호" autocomplete="current-password">'
      + '<div class="m" id="w2faM"></div><button id="w2faBtn">잠금 해제</button>'
      + '<a href="/payroll.html">2차 비밀번호를 잊었어요 (급여관리에서 복구코드로 재설정)</a><br></div>'
      + '<a href="/index.html">홈으로</a></div>';
    document.body.appendChild(root);
    el('w2faPw').addEventListener('keydown', function(e){ if (e.key === 'Enter') unlock(); });
    el('w2faBtn').addEventListener('click', unlock);
  }
  function screen(icon, title, sub, form){
    mount(); root.classList.remove('hide');
    el('w2faIc').textContent = icon; el('w2faT').textContent = title; el('w2faS').innerHTML = sub;
    el('w2faForm').style.display = form ? '' : 'none';
    if (form) setTimeout(function(){ el('w2faPw').focus(); }, 30);
  }
  function msg(cls, t){ var e = el('w2faM'); if (!e) return; e.className = 'm ' + (cls || ''); e.textContent = t || ''; }

  function ask(){
    if (!window.crypto || !crypto.subtle){ screen('⚠️', opt.title, '이 브라우저는 암호화 기능(HTTPS)을 지원하지 않습니다.', false); return; }
    screen(opt.icon, opt.title, '2차 인증을 준비하는 중…', false);
    pref('vault').get().then(function(v){
      if (!v.exists()){
        screen('🛡️', '2차 비밀번호 설정 필요', '<b>' + esc(opt.title) + '</b> — 급여관리의 2차 비밀번호를 함께 씁니다.<br>'
          + '<a href="/payroll.html" style="color:#60a5fa">급여관리</a>에서 먼저 2차 비밀번호를 설정해 주세요.', false);
        return;
      }
      var u = user();
      screen('🔒', '2차 인증', esc((u && u.email) || '') + '<br><b>' + esc(opt.title) + '</b> — 2차 비밀번호가 필요합니다.<br>급여관리와 같은 비밀번호입니다.', true);
    }).catch(function(e){ screen('⚠️', opt.title, '확인 실패: ' + esc((e && (e.code || e.message)) || e), false); });
  }

  function unlock(){
    var pw = el('w2faPw').value;
    if (!pw){ msg('er', '비밀번호를 입력하세요'); return; }
    el('w2faBtn').disabled = true; msg('wa', '확인 중…');
    var vault;
    Promise.all([pref('vault').get(), pref('lock').get()]).then(function(r){
      vault = r[0].val(); var lk = r[1].val() || {};
      if (!vault) throw { message: '2차 비밀번호가 설정되어 있지 않습니다.' };
      if (lk.until && lk.until > Date.now()) throw { message: '연속 실패로 잠겼습니다. ' + Math.ceil((lk.until - Date.now()) / 60000) + '분 뒤 다시 시도하세요.' };
      return crypto.subtle.importKey('raw', TE.encode(pw), 'PBKDF2', false, ['deriveKey']).then(function(base){
        return crypto.subtle.deriveKey({ name:'PBKDF2', salt: ub64(vault.salt), iterations: vault.iter || ITER, hash:'SHA-256' }, base, { name:'AES-GCM', length:256 }, false, ['decrypt']);
      });
    }).then(function(kek){
      return crypto.subtle.decrypt({ name:'AES-GCM', iv: ub64(vault.wrapPw.iv), additionalData: TE.encode('payroll-dek') }, kek, ub64(vault.wrapPw.ct))
        .catch(function(){ throw { bad: true }; });
    }).then(function(buf){
      new Uint8Array(buf).fill(0);                 /* 확인만 하고 키는 버린다 */
      el('w2faPw').value = ''; msg('', '');
      pref('lock').set({ fails: 0 }); audit(opt.page + '-unlock');
      root.classList.add('hide'); unlocked = true; lastAct = Date.now(); startTimer();
      try { opt.onUnlock && opt.onUnlock(); } catch (e) { console.error(e); }
    }).catch(function(e){
      if (e && e.bad){
        return pref('lock').transaction(function(cur){
          cur = cur || {}; var f = (cur.fails || 0) + 1;
          return f >= MAX_FAILS ? { fails: 0, until: Date.now() + LOCK_MIN * 60000 } : { fails: f };
        }).then(function(r){
          var v = r.snapshot.val() || {}; audit(opt.page + '-unlock-fail');
          msg('er', v.until ? ('5회 틀려서 ' + LOCK_MIN + '분간 잠겼습니다.') : ('비밀번호가 틀렸습니다 (' + v.fails + '/' + MAX_FAILS + ')'));
        });
      }
      msg('er', (e && e.message) || String(e));
    }).then(function(){ el('w2faBtn').disabled = false; });
  }

  /* ── 무사용 자동잠금 ── */
  ['mousemove','keydown','click','touchstart','scroll'].forEach(function(ev){ window.addEventListener(ev, function(){ lastAct = Date.now(); }, { passive: true }); });
  function startTimer(){
    clearInterval(tick);
    tick = setInterval(function(){
      var left = (opt.autoLockMin || 10) * 60000 - (Date.now() - lastAct);
      if (left <= 0){ lockNow('무사용 자동잠금'); return; }
      var t = Math.floor(left / 60000) + ':' + String(Math.floor(left % 60000 / 1000)).padStart(2, '0');
      document.querySelectorAll('[data-2fa-timer]').forEach(function(x){ x.textContent = t; });
    }, 1000);
  }
  function lockNow(why){
    if (!opt) return;
    clearInterval(tick); unlocked = false;
    try { opt.onLock && opt.onLock(); } catch (e) { console.error(e); }
    ask(); msg('wa', why ? why + ' — 다시 인증하세요' : '');
  }

  /* wms_access.js 가 슈퍼관리자로 확인해 준 뒤에 2차 인증을 묻는다 */
  function guard(o){
    opt = o || {}; opt.title = opt.title || '이 페이지'; opt.icon = opt.icon || '🔐'; opt.page = opt.page || 'page';
    var go = function(){
      mount(); screen(opt.icon, opt.title, '슈퍼관리자 권한을 확인하는 중…', false);
      var t0 = Date.now();
      (function wait(){
        var A = window.WMSAccess;
        if (A && A.ready && A.level >= 3) { ask(); return; }
        if (Date.now() - t0 < 30000) setTimeout(wait, 150);
      })();
    };
    if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
  }

  window.WMS2FA = { guard: guard, lockNow: function(){ lockNow(''); }, isUnlocked: function(){ return unlocked; } };
})();
