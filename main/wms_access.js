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

  /* 로그인은 되어 있는데 등급이 모자란 경우 — 로그인으로 보내면 로그인이 다시 이 페이지로 돌려보내
     무한 반복이 된다. 그래서 보내지 않고 이유를 화면에 띄운다. */
  function showDenied(level, required, err){
    window.WMSAccess.reason = (level < 0 ? ('확인 실패: ' + (err || '')) : ('등급 부족 (필요 ' + required + ' · 내 등급 ' + level + ')'));
    if (document.getElementById('wmsDeniedBox')) return;   /* 두 번 띄우지 않기 */
    var lv = ['비회원','로그인 회원','작업 그룹원','슈퍼관리자'];
    var failed = (level < 0);   /* -1 = 권한 확인 자체가 실패 */
    var box = document.createElement('div');
    box.id = 'wmsDeniedBox';
    box.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#0b0d12;color:#e6e9f0;'
      + 'display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;'
      + 'font-family:system-ui,-apple-system,sans-serif;';
    box.innerHTML =
      '<div style="max-width:440px">'
      + '<div style="font-size:44px;margin-bottom:14px">🔒</div>'
      + '<div style="font-size:19px;font-weight:800;margin-bottom:10px">' + (failed ? '권한을 확인하지 못했습니다' : '이 페이지를 볼 권한이 없습니다') + '</div>'
      + '<div style="font-size:13px;color:#8b94a8;line-height:1.85">'
      +   '페이지 <b style="color:#e6e9f0">' + PAGE_KEY + '</b><br>'
      +   '필요 등급 <b style="color:#e6e9f0">' + (lv[required] || required) + '</b><br>'
      +   '내 등급 <b style="color:#fbbf24">' + (failed ? '확인 실패' : (lv[level] || level)) + '</b><br><br>'
      +   (failed ? ('오류: <b style="color:#fca5a5">' + String(err || '알 수 없음').replace(/[<>]/g,'') + '</b><br>네트워크·로그인 상태를 확인한 뒤 새로고침해 주세요.')
                : '관리자에게 작업 그룹 등록 또는 등급 조정을 요청해 주세요.')
      + '</div>'
      + '<div style="margin-top:20px;display:flex;gap:8px;justify-content:center">'
      +   '<a href="/index.html" style="background:#1c2331;border:1px solid #2a3040;color:#e6e9f0;border-radius:8px;padding:9px 16px;font-size:13px;font-weight:700;text-decoration:none">홈으로</a>'
      +   '<a href="' + LOGIN_PATH + '" style="background:#2563eb;color:#fff;border-radius:8px;padding:9px 16px;font-size:13px;font-weight:700;text-decoration:none">다른 계정으로 로그인</a>'
      + '</div></div>';
    var put = function(){ document.body.appendChild(box); };
    if (document.body) put(); else document.addEventListener('DOMContentLoaded', put);
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

    var auth0 = firebase.auth();   /* 먼저 인증을 준비시킨다 */
    var db = firebase.database();

    db.ref('pageAccess/' + PAGE_KEY).get().then(function(snap){
      var configured = snap.exists() ? parseLevel(snap.val(), 0) : 0;
      var required = Math.max(configured, FLOOR);
      window.WMSAccess.required = required;

      if (required <= 0) { window.WMSAccess.level = 0; window.WMSAccess.ready = true; return; }

      var auth = auth0 || firebase.auth();
      var decided = false;
      auth.onAuthStateChanged(function(user){
        if (decided) return;
        /* 로그인 복원이 아직 안 끝난 상태에서 null 이 올 수 있다(특히 SDK 를 늦게 실은 페이지).
           바로 로그인으로 보내면 로그인 → 페이지 → 로그인 … 으로 무한 반복되므로 한 번 더 확인한다. */
        if (!user) {
          setTimeout(function(){
            if (decided) return;
            if (auth.currentUser) return;          /* 복원됨 — 다음 콜백이 처리 */
            decided = true; window.WMSAccess.level = 0; redirectToLogin();
          }, 1500);
          return;
        }

        /* 한 번 실패하면 잠깐 뒤 다시 — 페이지가 막 열렸을 때의 일시적 오류를 넘긴다 */
        function getOnce(path){
          return db.ref(path).get().catch(function(e1){
            return new Promise(function(res, rej){
              setTimeout(function(){ db.ref(path).get().then(res).catch(function(e2){ rej(e2 || e1); }); }, 900);
            });
          });
        }
        getOnce('superadmins/' + user.uid).then(function(adminSnap){
          if (adminSnap.exists()) { decided = true; finish(3, required); return; }
          if (required <= 1) { decided = true; finish(1, required); return; }
          getOnce('userGroup/' + user.uid).then(function(gSnap){
            var lvl = gSnap.exists() ? 2 : 1;
            decided = true; finish(lvl, required);
          }).catch(function(e){ decided = true; console.warn('[WMSAccess] userGroup 조회 실패', e);
            showDenied(-1, required, (e && (e.code || e.message)) || e); });
        }).catch(function(e){ decided = true; console.warn('[WMSAccess] superadmins 조회 실패', e);
          showDenied(-1, required, (e && (e.code || e.message)) || e); });
      });

      function finish(level, req){
        window.WMSAccess.level = level;
        window.WMSAccess.ready = true;
        /* 로그인 상태에서 등급이 모자라면 튕기지 않고 이유를 보여 준다 (무한 반복 방지) */
        if (level < req) showDenied(level, req);
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

  /* ── 방문 기록 (사이트 통계 site_stats.html 용) ──────────────────────
     stats/day/{KST날짜}/{페이지}/v·m·h/{시}  : 조회수 카운터 (+1 만 허용, 누구나)
     stats/uv/{KST날짜}/{페이지}/{방문자id}   : 순방문자 (브라우저당 하루 1번)
     stats/log/{KST날짜}/{push}               : 로그인 사용자의 조회 기록 (본인 uid 만)
     읽기는 슈퍼관리자만. 로컬 개발 서버에서는 기록하지 않는다. */
  function logVisit(){
    try {
      var host = location.hostname;
      if (!host || host === 'localhost' || host === '127.0.0.1' || /\.localhost$/.test(host) || location.protocol === 'file:') return;
      var db = firebase.database(), auth = firebase.auth();
      var inc = firebase.database.ServerValue.increment(1);
      var k = new Date(Date.now() + 9 * 3600e3).toISOString();     /* KST */
      var day = k.slice(0, 10), hh = k.slice(11, 13);
      var mob = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 1 : 0;
      var base = 'stats/day/' + day + '/' + PAGE_KEY + '/';
      var up = {}; up[base + 'v'] = inc; up[base + 'h/' + hh] = inc; if (mob) up[base + 'm'] = inc;
      db.ref().update(up).catch(function(){});

      var vid = null, seenKey = 'wms_uv_' + day + '_' + PAGE_KEY;
      try {
        vid = localStorage.getItem('wms_vid');
        if (!vid) { vid = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); localStorage.setItem('wms_vid', vid); }
        if (!localStorage.getItem(seenKey)) {
          db.ref('stats/uv/' + day + '/' + PAGE_KEY + '/' + vid).set(true)
            .then(function(){ try { localStorage.setItem(seenKey, '1'); } catch (e) {} }).catch(function(){});
        }
      } catch (e) { /* 저장소 막힌 브라우저 — 순방문자만 빠진다 */ }

      /* 로그인 상태는 복원이 늦게 올 수 있어 잠깐 기다린다 */
      var done = false;
      function writeUser(u){
        if (done || !u) return; done = true;
        db.ref('stats/log/' + day).push({
          p: PAGE_KEY, t: firebase.database.ServerValue.TIMESTAMP, u: u.uid,
          e: String(u.email || u.displayName || '').slice(0, 120),
          m: mob
        }).catch(function(){});
      }
      var off = auth.onAuthStateChanged(function(u){ if (u) { writeUser(u); off && off(); } });
      setTimeout(function(){ if (!done) { writeUser(auth.currentUser); } if (off) off(); }, 4000);
    } catch (e) { /* 통계 실패가 페이지 동작을 막으면 안 된다 */ }
  }

  ensureFirebase(function(){
    run();
    if (window.firebase && firebase.database && firebase.auth && firebase.apps && firebase.apps.length) logVisit();
  });
})();
