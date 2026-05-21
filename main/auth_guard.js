/* ============================================================
   auth_guard.js — 페이지 진입 가드
   · 미로그인 → /wms_login.html?return=<현재경로> 로 리디렉션
   · 로그인됐지만 그룹/슈퍼관리자 권한 없음 → 동일 처리
   · 인증 확인 동안 body 를 숨겨 깜빡임/콘텐츠 노출 방지

   사용:
     <script src="/auth_guard.js"></script>
   페이지의 <head> 상단에 한 줄 추가만 하면 됩니다.

   wms_login.html / wms.html / star_coupang.html 와 동일 Firebase
   기본 앱을 사용해 로그인 세션을 공유합니다.
============================================================ */
(function(){
  'use strict';
  if (window.__wmsAuthGuardLoaded) return;
  window.__wmsAuthGuardLoaded = true;

  var FIREBASE_CONFIG = {
    apiKey:"AIzaSyAM2t9dvtStrXNam-YAiq19yD8FHwKpPmI",
    authDomain:"makechango-wms.firebaseapp.com",
    databaseURL:"https://makechango-wms-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId:"makechango-wms",
    storageBucket:"makechango-wms.firebasestorage.app",
    messagingSenderId:"333385336098",
    appId:"1:333385336098:web:94f07492421965ab32917b"
  };

  console.log('[auth_guard] loaded');

  /* 인증 확인 전까지 body 숨김 — 콘텐츠 깜빡임/노출 방지 */
  var STYLE_ID = '__wms_auth_guard_style';
  if (!document.getElementById(STYLE_ID)) {
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = 'html.__wms-auth-checking body{visibility:hidden!important}';
    (document.head || document.documentElement).appendChild(st);
  }
  document.documentElement.classList.add('__wms-auth-checking');

  function returnUrl() {
    return '/wms_login.html?return=' + encodeURIComponent(location.pathname + location.search + location.hash);
  }

  var settled = false;
  function pass(){
    if (settled) return;
    settled = true;
    clearTimeout(hardTimer);
    document.documentElement.classList.remove('__wms-auth-checking');
    console.log('[auth_guard] pass');
  }
  function fail(reason){
    if (settled) return;
    settled = true;
    clearTimeout(hardTimer);
    console.log('[auth_guard] redirect →', reason || '');
    window.location.replace(returnUrl());
  }

  /* 8초 안에 결판 안 나면 로그인 화면으로 — 안전 가드 */
  var hardTimer = setTimeout(function(){ fail('hard timeout'); }, 8000);

  function loadScript(src){
    return new Promise(function(resolve, reject){
      var s = document.createElement('script');
      s.src = src; s.async = false;
      s.onload = resolve;
      s.onerror = function(){ reject(new Error('script load: '+src)); };
      (document.head || document.documentElement).appendChild(s);
    });
  }

  function startCheck(){
    var firebase = window.firebase;
    if (!firebase || !firebase.auth) { fail('firebase SDK 미로드'); return; }

    /* 기본 앱 사용 — wms_login.html / wms_sync.js 와 세션 공유 */
    var app;
    try {
      if (firebase.apps && firebase.apps.length) {
        app = firebase.app(); /* 기존 기본 앱 재사용 */
      } else {
        app = firebase.initializeApp(FIREBASE_CONFIG);
      }
    } catch(e) {
      console.error('[auth_guard] init 실패:', e);
      fail('init 실패');
      return;
    }

    var auth, db;
    try {
      auth = firebase.auth(app);
      db   = firebase.database(app);
    } catch(e) {
      console.error('[auth_guard] auth/database 인스턴스 실패:', e);
      fail('auth instance 실패');
      return;
    }

    /* 3초까지 인증 상태 알림이 없으면 미로그인으로 간주 */
    var softTimer = setTimeout(function(){
      if (!settled && !auth.currentUser) fail('soft timeout · no user');
    }, 3000);

    auth.onAuthStateChanged(function(user){
      if (settled) return;
      if (!user) { clearTimeout(softTimer); fail('no user'); return; }
      console.log('[auth_guard] user:', user.email || user.uid);
      db.ref('superadmins/' + user.uid).get().then(function(snap){
        if (settled) return;
        if (snap.exists()) { clearTimeout(softTimer); pass(); return; }
        db.ref('userGroup/' + user.uid).get().then(function(g){
          if (settled) return;
          clearTimeout(softTimer);
          if (!g.exists()) { fail('no group'); return; }
          pass();
        }).catch(function(e){ if (!settled){ clearTimeout(softTimer); console.warn('[auth_guard] userGroup read 실패', e); fail('userGroup read 실패'); } });
      }).catch(function(e){ if (!settled){ clearTimeout(softTimer); console.warn('[auth_guard] superadmins read 실패', e); fail('superadmins read 실패'); } });
    });
  }

  if (typeof window.firebase !== 'undefined' && window.firebase.auth) {
    startCheck();
  } else {
    loadScript('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js')
      .then(function(){ return loadScript('https://www.gstatic.com/firebasejs/10.13.2/firebase-auth-compat.js'); })
      .then(function(){ return loadScript('https://www.gstatic.com/firebasejs/10.13.2/firebase-database-compat.js'); })
      .then(startCheck)
      .catch(function(e){ console.error('[auth_guard] SDK 로드 실패:', e); fail('SDK 로드 실패'); });
  }
})();
