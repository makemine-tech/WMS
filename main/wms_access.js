/* ============================================================
   WMS Access Gate — 페이지별 접근 권한 게이트 (슈퍼관리자 관리도구 연동)

   슈퍼관리자가 wms_admin.html 에서 페이지마다 요구 등급을 설정하면
   이 스크립트가 그 값을 읽어 접근을 통제한다.

   ── 등급 체계 (사용자 레벨) ──
     0  비회원      : 로그인 안 함 (누구나)
     1  일반회원    : 구글 로그인됨 (그룹 미가입)
     2  초대회원    : 초대코드로 그룹 가입 (userGroup 존재)
     3  슈퍼관리자  : superadmins 등록 (= 대표 본인)

   요구 레벨은 Firebase 의 pageAccess/{pageKey} 에 0~3 으로 저장된다.
   값이 없으면 0(공개)으로 간주. 단 data-floor 로 페이지별 최소 레벨을 강제할 수 있다.
     실효 요구 = max(설정값, data-floor)

   ── 사용법 ──
     <script src="/wms_access.js" data-page="star_coupang" data-floor="2"></script>
       data-page  : pageAccess 키 (생략 시 파일명에서 추정)
       data-floor : 이 페이지의 최소 요구 레벨 (생략 시 0)

   firebase SDK 가 이미 로드돼 있으면 그대로 쓰고, 없으면 자동 주입한다.
   부족하면 /wms_login.html?return=<현재경로> 로 보낸다.
============================================================ */
(function(){
  'use strict';

  var FIREBASE_CONFIG = {
    apiKey:"AIzaSyAM2t9dvtStrXNam-YAiq19yD8FHwKpPmI",
    authDomain:"makewon.com",
    databaseURL:"https://makechango-wms-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId:"makechango-wms",
    storageBucket:"makechango-wms.firebasestorage.app",
    messagingSenderId:"333385336098",
    appId:"1:333385336098:web:94f07492421965ab32917b"
  };

  var SDK_VER = "10.13.2";
  var LOGIN_PATH = "/wms_login.html";

  var thisScript = document.currentScript;
  var PAGE_KEY = (thisScript && thisScript.getAttribute('data-page')) || derivePageKey();
  var FLOOR = parseLevel(thisScript && thisScript.getAttribute('data-floor'), 0);

  /* 외부에서 결과를 참조할 수 있도록 전역 노출 */
  window.WMSAccess = { pageKey: PAGE_KEY, floor: FLOOR, required: null, level: null, ready: false };

  function derivePageKey(){
    var p = (location.pathname || '').replace(/\/+$/, '');
    var base = p.substring(p.lastIndexOf('/') + 1) || 'index';
    return base.replace(/\.html?$/i, '').toLowerCase();
  }
  function parseLevel(v, dflt){
    var n = parseInt(v, 10);
    return (isNaN(n) || n < 0 || n > 3) ? dflt : n;
  }
  function redirectToLogin(){
    var ret = LOGIN_PATH + '?return=' + encodeURIComponent(location.pathname + location.search);
    location.replace(ret);
  }

  /* firebase SDK 보장 — 없으면 compat 스크립트 순차 주입 */
  function ensureFirebase(cb){
    if (window.firebase && firebase.database && firebase.auth) { cb(); return; }
    var bases = [
      "https://www.gstatic.com/firebasejs/" + SDK_VER + "/firebase-app-compat.js",
      "https://www.gstatic.com/firebasejs/" + SDK_VER + "/firebase-auth-compat.js",
      "https://www.gstatic.com/firebasejs/" + SDK_VER + "/firebase-database-compat.js"
    ];
    (function loadSeq(i){
      if (i >= bases.length) { cb(); return; }
      var el = document.createElement('script');
      el.src = bases[i];
      el.onload = function(){ loadSeq(i + 1); };
      el.onerror = function(){ console.warn('[WMSAccess] SDK 로드 실패:', bases[i]); cb(); };
      document.head.appendChild(el);
    })(0);
  }

  function run(){
    if (typeof firebase === 'undefined' || !firebase.database) {
      console.warn('[WMSAccess] firebase 미가용 — 게이트 비활성');
      return;
    }
    try {
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    } catch (e) { /* 이미 초기화됨 */ }

    var db = firebase.database();

    db.ref('pageAccess/' + PAGE_KEY).get().then(function(snap){
      var configured = snap.exists() ? parseLevel(snap.val(), 0) : 0;
      var required = Math.max(configured, FLOOR);
      window.WMSAccess.required = required;

      if (required <= 0) { window.WMSAccess.level = 0; window.WMSAccess.ready = true; return; }

      var auth = firebase.auth();
      var decided = false;
      auth.onAuthStateChanged(function(user){
        if (decided) return;
        if (!user) { decided = true; window.WMSAccess.level = 0; redirectToLogin(); return; }

        db.ref('superadmins/' + user.uid).get().then(function(adminSnap){
          if (adminSnap.exists()) { decided = true; finish(3, required); return; }
          if (required <= 1) { decided = true; finish(1, required); return; }
          db.ref('userGroup/' + user.uid).get().then(function(gSnap){
            var lvl = gSnap.exists() ? 2 : 1;
            decided = true; finish(lvl, required);
          }).catch(function(e){ decided = true; console.warn('[WMSAccess] userGroup 조회 실패', e); redirectToLogin(); });
        }).catch(function(e){ decided = true; console.warn('[WMSAccess] superadmins 조회 실패', e); redirectToLogin(); });
      });

      function finish(level, req){
        window.WMSAccess.level = level;
        window.WMSAccess.ready = true;
        if (level < req) redirectToLogin();
      }
    }).catch(function(e){
      /* pageAccess 읽기 실패 — 보안상 floor 만이라도 적용 */
      console.warn('[WMSAccess] pageAccess 조회 실패', e);
      if (FLOOR > 0) {
        var auth = firebase.auth();
        auth.onAuthStateChanged(function(user){ if (!user) redirectToLogin(); });
      }
    });
  }

  ensureFirebase(run);
})();
