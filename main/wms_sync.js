/* ============================================================
   WMS Sync — Firebase Auth + Realtime Database 기반 PC 간 동기화

   사용법 (페이지에서):
     <script src="https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js"></script>
     <script src="https://www.gstatic.com/firebasejs/10.13.2/firebase-auth-compat.js"></script>
     <script src="https://www.gstatic.com/firebasejs/10.13.2/firebase-database-compat.js"></script>
     <script src="wms_sync.js"></script>
     <script>
       WMSync.init('star_coupang');
       WMSync.onAuth(function(user){ ...UI 갱신... });
       WMSync.onRemoteChange(function(data){ ...새 데이터 적용... });
       WMSync.push({ ts:Date.now(), ... });   // 디바운싱 됨
     </script>

   데이터 경로: /wms_sync/{uid}/{appName}
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

  var auth = null, db = null;
  var currentUser = null;
  var appName = null;
  var authCallbacks = [];
  var remoteCallbacks = [];
  var ref = null;
  var pushTimer = null;
  var pushPending = null;
  var lastLocalTs = 0;
  var lastRemoteTs = 0;
  var initialized = false;

  function init(name) {
    if (initialized) return;
    appName = name;
    if (typeof firebase === 'undefined') {
      console.warn('[WMSync] firebase SDK 미로드 — 오프라인 전용 모드');
      return;
    }
    try {
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      auth = firebase.auth();
      db = firebase.database();
    } catch(e) {
      console.error('[WMSync] init 실패:', e);
      return;
    }
    initialized = true;
    auth.onAuthStateChanged(function(user){
      currentUser = user;
      detachRef();
      if (user) attachRef();
      authCallbacks.forEach(function(cb){
        try { cb(user); } catch(e) { console.error(e); }
      });
    });
  }

  function attachRef() {
    if (!db || !currentUser || !appName) return;
    ref = db.ref('wms_sync/' + currentUser.uid + '/' + appName);
    ref.on('value', function(snap){
      var data = snap.val();
      if (!data) return;
      var remoteTs = +data.ts || 0;
      if (remoteTs <= lastRemoteTs) return; /* 같거나 오래된 데이터는 무시 */
      lastRemoteTs = remoteTs;
      /* 우리가 방금 푸시한 데이터(echo)면 무시 */
      if (remoteTs === lastLocalTs) return;
      remoteCallbacks.forEach(function(cb){
        try { cb(data); } catch(e) { console.error(e); }
      });
    }, function(err){
      console.error('[WMSync] 읽기 실패:', err);
    });
  }

  function detachRef() {
    if (ref) { try { ref.off(); } catch(e){} ref = null; }
    lastRemoteTs = 0;
  }

  function onAuth(cb) {
    authCallbacks.push(cb);
    /* 이미 초기화 + 콜백 발생한 상태면 즉시 호출 */
    if (initialized) {
      try { cb(currentUser); } catch(e) { console.error(e); }
    }
  }

  function onRemoteChange(cb) {
    remoteCallbacks.push(cb);
  }

  function signIn() {
    if (!auth) { alert('Firebase가 로드되지 않았습니다 — 인터넷 연결 확인 후 새로고침'); return; }
    var provider = new firebase.auth.GoogleAuthProvider();
    return auth.signInWithPopup(provider).catch(function(err){
      if (err.code === 'auth/popup-blocked') {
        alert('팝업이 차단되었습니다. 브라우저에서 팝업 허용 후 재시도해주세요.');
      } else if (err.code === 'auth/popup-closed-by-user') {
        /* 사용자가 닫음 — 무시 */
      } else {
        alert('로그인 실패: ' + (err.message || err.code));
      }
    });
  }

  function signOut() {
    if (!auth) return;
    return auth.signOut();
  }

  /* 디바운싱 푸시 — 1초 안에 여러 번 호출되면 마지막 데이터만 푸시 */
  function push(data) {
    if (!ref || !data) return;
    pushPending = Object.assign({}, data, { ts: Date.now(), _by: 'sync' });
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function(){
      pushTimer = null;
      var payload = pushPending;
      pushPending = null;
      if (!ref || !payload) return;
      lastLocalTs = payload.ts;
      lastRemoteTs = payload.ts; /* echo 무시 */
      ref.set(payload).catch(function(err){
        console.error('[WMSync] 푸시 실패:', err);
      });
    }, 1000);
  }

  /* 즉시 푸시 (디바운싱 무시) — 중요한 액션 직후 */
  function pushNow(data) {
    if (!ref || !data) return;
    var payload = Object.assign({}, data, { ts: Date.now(), _by: 'sync' });
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; pushPending = null; }
    lastLocalTs = payload.ts;
    lastRemoteTs = payload.ts;
    return ref.set(payload).catch(function(err){
      console.error('[WMSync] 푸시 실패:', err);
    });
  }

  /* 클라우드에서 한 번만 가져오기 (페이지 로드 직후 비교용) */
  function pullOnce() {
    if (!ref) return Promise.resolve(null);
    return ref.once('value').then(function(s){ return s.val(); });
  }

  /* 클라우드의 이 앱 데이터 삭제 — 작업 종료 후 정리 */
  function clearRemote() {
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; pushPending = null; }
    lastLocalTs = Date.now();
    lastRemoteTs = lastLocalTs; /* echo 무시 */
    if (!ref) return Promise.resolve();
    return ref.remove().catch(function(err){
      console.error('[WMSync] clearRemote 실패:', err);
    });
  }

  function getUser() { return currentUser; }
  function isReady() { return initialized && !!auth; }
  function isSignedIn() { return !!currentUser; }

  window.WMSync = {
    init: init,
    onAuth: onAuth,
    onRemoteChange: onRemoteChange,
    signIn: signIn,
    signOut: signOut,
    push: push,
    pushNow: pushNow,
    pullOnce: pullOnce,
    clearRemote: clearRemote,
    getUser: getUser,
    isReady: isReady,
    isSignedIn: isSignedIn
  };
})();
