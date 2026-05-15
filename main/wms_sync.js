/* ============================================================
   WMS Sync — Firebase Auth + Realtime Database 기반 PC 간 동기화

   동작 모드:
   - 그룹 모드 (옵션 B): wms.html과 동일 인증 — superadmin 또는
     userGroup/{uid} 멤버만 접근. 같은 그룹 멤버끼리 데이터 공유.
     데이터 경로: /wms_sync/groups/{gid}/{appName}/files/{fileKey}
   - 인증 안 됨 → 호출자가 location.replace('/index.html') 처리

   사용법:
     WMSync.init('star_coupang', { requireAuth:true });
     WMSync.onAuth(function(state){
       // state = { user, groupId, isAdmin, isReady } | { user:null, ... }
       if (!state.user) location.replace('/index.html');
     });
     WMSync.setFileKey('001_xlsx');  // 파일 변경 시
     WMSync.onRemoteChange(function(data){ ... });
     WMSync.push({ payload });
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
  var currentGroupId = null;
  var isAdminCache = false;
  var appName = null;
  var fileKey = null;
  var authCallbacks = [];
  var remoteCallbacks = [];
  var ref = null;
  var pushTimer = null;
  var pushPending = null;
  var lastLocalTs = 0;
  var lastRemoteTs = 0;
  var initialized = false;

  function init(name, opts) {
    if (initialized) return;
    appName = name;
    opts = opts || {};
    if (typeof firebase === 'undefined') {
      console.warn('[WMSync] firebase SDK 미로드');
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
      currentGroupId = null;
      isAdminCache = false;
      detachRef();
      if (!user) {
        emitAuth();
        return;
      }
      /* superadmin 우선 확인 */
      db.ref('superadmins/' + user.uid).get().then(function(adminSnap){
        if (adminSnap.exists()) {
          isAdminCache = true;
          /* 관리자는 wms.html에서 선택한 그룹 ID 사용 */
          var savedGid = localStorage.getItem('wms_adminGroupId');
          currentGroupId = savedGid || 'makechango'; /* 기본 그룹 */
          afterGroupResolved();
          return;
        }
        /* 일반 사용자 — userGroup 조회 */
        db.ref('userGroup/' + user.uid).get().then(function(gSnap){
          if (!gSnap.exists()) {
            /* 그룹 미등록 — 인증은 됐지만 권한 없음 */
            currentGroupId = null;
            emitAuth();
            return;
          }
          currentGroupId = gSnap.val();
          afterGroupResolved();
        }).catch(function(e){
          console.warn('[WMSync] userGroup 조회 실패:', e);
          emitAuth();
        });
      }).catch(function(e){
        console.warn('[WMSync] superadmins 조회 실패:', e);
        emitAuth();
      });
    });
  }

  function afterGroupResolved() {
    if (fileKey && currentGroupId) attachRef();
    emitAuth();
  }

  function emitAuth() {
    var state = {
      user: currentUser,
      groupId: currentGroupId,
      isAdmin: isAdminCache,
      isReady: true
    };
    authCallbacks.forEach(function(cb){
      try { cb(state); } catch(e) { console.error(e); }
    });
  }

  function setFileKey(key) {
    fileKey = key ? sanitizeKey(key) : null;
    detachRef();
    if (fileKey && currentUser && currentGroupId) attachRef();
  }

  /* Firebase 키로 안전한 문자열로 변환. '.' '/' '#' '$' '[' ']' 금지 */
  function sanitizeKey(s) {
    return String(s||'').replace(/[.#$/\[\]\s]+/g, '_').replace(/__+/g, '_').toLowerCase();
  }

  function getPath() {
    if (!currentGroupId || !appName || !fileKey) return null;
    return 'wms_sync/groups/' + currentGroupId + '/' + appName + '/files/' + fileKey;
  }

  function attachRef() {
    var path = getPath();
    if (!db || !path) return;
    ref = db.ref(path);
    lastRemoteTs = 0;
    ref.on('value', function(snap){
      var data = snap.val();
      if (!data) return;
      var remoteTs = +data.ts || 0;
      if (remoteTs <= lastRemoteTs) return;
      lastRemoteTs = remoteTs;
      if (remoteTs === lastLocalTs) return; /* echo */
      remoteCallbacks.forEach(function(cb){
        try { cb(data); } catch(e) { console.error(e); }
      });
    }, function(err){ console.error('[WMSync] 읽기 실패:', err); });
  }

  function detachRef() {
    if (ref) { try { ref.off(); } catch(e){} ref = null; }
    lastRemoteTs = 0;
  }

  function onAuth(cb) {
    authCallbacks.push(cb);
    if (initialized) {
      try { cb({ user: currentUser, groupId: currentGroupId, isAdmin: isAdminCache, isReady: true }); }
      catch(e){ console.error(e); }
    }
  }

  function onRemoteChange(cb) { remoteCallbacks.push(cb); }

  function signOut() {
    return auth ? auth.signOut() : Promise.resolve();
  }

  /* 그룹 안의 이 앱 파일 목록 — 다른 파일 작업 이어받기용 */
  function listFiles() {
    if (!currentGroupId || !appName || !db) return Promise.resolve([]);
    return db.ref('wms_sync/groups/' + currentGroupId + '/' + appName + '/files').once('value').then(function(s){
      var v = s.val(); if (!v) return [];
      return Object.keys(v).map(function(k){
        return { fileKey: k, ts: +(v[k].ts||0), fileName: (v[k].payload && v[k].payload.fileName) || k };
      }).sort(function(a,b){ return b.ts - a.ts; });
    });
  }

  /* 디바운싱 푸시 */
  function push(data) {
    if (!ref || !data) return;
    pushPending = Object.assign({}, data, { ts: Date.now(), _by: currentUser ? (currentUser.email || currentUser.uid) : 'sync' });
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function(){
      pushTimer = null;
      var payload = pushPending; pushPending = null;
      if (!ref || !payload) return;
      lastLocalTs = payload.ts; lastRemoteTs = payload.ts;
      ref.set(payload).catch(function(err){ console.error('[WMSync] 푸시 실패:', err); });
    }, 1000);
  }

  function pushNow(data) {
    if (!ref || !data) return;
    var payload = Object.assign({}, data, { ts: Date.now(), _by: currentUser ? (currentUser.email || currentUser.uid) : 'sync' });
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; pushPending = null; }
    lastLocalTs = payload.ts; lastRemoteTs = payload.ts;
    return ref.set(payload);
  }

  function pullOnce() {
    if (!ref) return Promise.resolve(null);
    return ref.once('value').then(function(s){ return s.val(); });
  }

  function clearRemote() {
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; pushPending = null; }
    lastLocalTs = Date.now(); lastRemoteTs = lastLocalTs;
    if (!ref) return Promise.resolve();
    return ref.remove();
  }

  /* 현재 파일의 원본 워크북(base64)을 별도 경로에 저장 — payload와 분리, 1회만 */
  function workbookPath() {
    if (!currentGroupId || !appName || !fileKey) return null;
    return 'wms_sync/groups/' + currentGroupId + '/' + appName + '/files/' + fileKey + '/workbook';
  }
  function saveWorkbook(b64) {
    var path = workbookPath();
    if (!db || !path || !b64) return Promise.resolve();
    return db.ref(path).set({ b64: b64, ts: Date.now() })
      .catch(function(err){ console.error('[WMSync] saveWorkbook 실패:', err); });
  }
  function loadWorkbook() {
    var path = workbookPath();
    if (!db || !path) return Promise.resolve(null);
    return db.ref(path).once('value').then(function(s){
      var v = s.val();
      return v && v.b64 ? v.b64 : null;
    }).catch(function(){ return null; });
  }

  function getUser() { return currentUser; }
  function getGroupId() { return currentGroupId; }
  function getFileKey() { return fileKey; }
  function isReady() { return initialized && !!auth; }
  function isSignedIn() { return !!currentUser; }
  function hasGroup() { return !!currentGroupId; }

  window.WMSync = {
    init: init,
    onAuth: onAuth,
    onRemoteChange: onRemoteChange,
    setFileKey: setFileKey,
    sanitizeKey: sanitizeKey,
    listFiles: listFiles,
    signOut: signOut,
    push: push,
    pushNow: pushNow,
    pullOnce: pullOnce,
    clearRemote: clearRemote,
    saveWorkbook: saveWorkbook,
    loadWorkbook: loadWorkbook,
    getUser: getUser,
    getGroupId: getGroupId,
    getFileKey: getFileKey,
    isReady: isReady,
    isSignedIn: isSignedIn,
    hasGroup: hasGroup
  };
})();
