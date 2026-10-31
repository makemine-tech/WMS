/* 피킹이지 🛟 백업함 — 지워지거나 덮어써질 송장 PDF 를 이 PC 에 따로 보관 (2026-10-29)
   ① 자동수집으로 가져온 PDF (폴더에서 지우기 전 원본 그대로)
   ② 전체 초기화·교체 직전의 작업 (PDF + 송장 목록 + 인쇄완료 기록)
   ③ 새 작업이 들어와 밀려난 이 PC 캐시 PDF (다른 PC 가 초기화해도 여기 남음)
   보관: IndexedDB 'pk_backup' — meta(목록) / buf(PDF) 분리, 최근 KEEP 개 · KEEP_DAYS 일 (송장 PDF 는 하루를 넘길 일이 없어 하루 지나면 지움, 2026-10-31)
   계산(정리 대상 고르기)은 순수 함수 → tools/tests/pk_backup.test.js */
(function(root){
  var KEEP = 10, KEEP_DAYS = 1, DAY = 86400000;

  /* metas: [{id, ts}] → 지울 id 목록 (최신 KEEP 개 안 + KEEP_DAYS 일 안만 남김) */
  function pruneIds(metas, now){
    var s = (metas || []).slice().sort(function(a, b){ return (b.ts || 0) - (a.ts || 0); });
    return s.filter(function(m, i){ return i >= KEEP || (now - (m.ts || 0)) > KEEP_DAYS * DAY; })
            .map(function(m){ return m.id; });
  }
  /* 캐시 키 'J1761234567890_파일이름' → 만든 시각 */
  function jobKeyTs(key){ var m = /^J(\d{12,})/.exec(String(key || '')); return m ? +m[1] : 0; }

  var PKB = { KEEP: KEEP, KEEP_DAYS: KEEP_DAYS, pruneIds: pruneIds, jobKeyTs: jobKeyTs };
  if (typeof module !== 'undefined' && module.exports) { module.exports = PKB; return; }

  /* ───────── 브라우저: IndexedDB ───────── */
  function open(){
    return new Promise(function(res, rej){
      if (!root.indexedDB) { rej(new Error('no-idb')); return; }
      var r = indexedDB.open('pk_backup', 1);
      r.onupgradeneeded = function(){ r.result.createObjectStore('meta', { keyPath: 'id' }); r.result.createObjectStore('buf'); };
      r.onsuccess = function(){ res(r.result); };
      r.onerror = function(){ rej(r.error); };
    });
  }
  function tx(stores, mode, fn){
    return open().then(function(db){
      return new Promise(function(res, rej){
        var t = db.transaction(stores, mode), out = fn(t);
        t.oncomplete = function(){ res(out && out.result !== undefined ? out.result : out); };
        t.onerror = function(){ rej(t.error); };
        t.onabort = function(){ rej(t.error); };
      });
    });
  }

  PKB.list = function(){
    return tx(['meta'], 'readonly', function(t){ return t.objectStore('meta').getAll(); })
      .then(function(a){ return (a || []).sort(function(x, y){ return (y.ts || 0) - (x.ts || 0); }); })
      .catch(function(){ return []; });
  };
  PKB.getBuf = function(id){
    return tx(['buf'], 'readonly', function(t){ return t.objectStore('buf').get(id); }).catch(function(){ return null; });
  };
  PKB.del = function(id){
    return tx(['meta', 'buf'], 'readwrite', function(t){ t.objectStore('meta').delete(id); t.objectStore('buf').delete(id); }).catch(function(){});
  };
  /* item: { kind, label, buf, invCount?, snap?, src? } — src 가 같은 백업이 이미 있으면 건너뜀 */
  /* 기한 지난 백업 지우기 — 페이지를 열 때마다 (백업을 새로 안 만드는 날에도 비워지게) */
  PKB.prune = function(){
    return PKB.list().then(function(metas){
      var gone = pruneIds(metas, Date.now());
      if (!gone.length) return 0;
      return tx(['meta', 'buf'], 'readwrite', function(t){
        gone.forEach(function(g){ t.objectStore('meta').delete(g); t.objectStore('buf').delete(g); });
      }).then(function(){ return gone.length; });
    }).catch(function(){ return 0; });
  };
  PKB.add = function(item){
    if (!item || !item.buf || !item.buf.byteLength) return Promise.resolve(null);
    return PKB.list().then(function(metas){
      if (item.src && metas.some(function(m){ return m.src === item.src; })) return null;
      var now = Date.now(), id = 'B' + now + '_' + Math.random().toString(36).slice(2, 6);
      var meta = { id: id, ts: now, kind: item.kind || '', label: item.label || '', size: item.buf.byteLength,
                   invCount: item.invCount || 0, src: item.src || '', snap: item.snap || null };
      var gone = pruneIds(metas.concat([meta]), now);
      return tx(['meta', 'buf'], 'readwrite', function(t){
        t.objectStore('meta').put(meta); t.objectStore('buf').put(item.buf, id);
        gone.forEach(function(g){ t.objectStore('meta').delete(g); t.objectStore('buf').delete(g); });
      }).then(function(){ return id; });
    }).catch(function(e){ console.warn('[pk_backup] 저장 실패', e); return null; });
  };

  root.PK_BACKUP = PKB;
})(typeof window !== 'undefined' ? window : this);
