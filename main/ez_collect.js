/* 피킹이지 송장 자동수집 — 이지어드민 출력 폴더(C:\ez_PrintAgent\PdfFile\YYYY-MM-DD)의 PDF 를 그대로 가져옴
   ① 계산(폴더 이름·중복 막기·지울 파일)은 순수 함수 → tools/tests/ez_collect.test.js
   ② 폴더 접근은 브라우저 File System Access (크롬·엣지) — 고른 폴더는 이 PC IndexedDB 에 기억
   수집 기록(localStorage pkCollectLog) = { 날짜: { 이름|크기|수정시각: 수집시각 } } — 이 PC 폴더 기준 */
(function(root){
  var BUSY_MS = 15000;   /* 이지어드민이 아직 쓰는 중일 수 있는 파일 — 다음 수집으로 미룸 */

  function p2(n){ return (n < 10 ? '0' : '') + n; }
  function dayFolder(d){ return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
  function sig(f){ return f.name + '|' + f.size + '|' + f.lastModified; }
  function isPdf(f){ return /\.pdf$/i.test(f.name || ''); }

  /* files: [{name,size,lastModified}] · done: 그 날짜 수집 기록 → { take(만든 순), dup, busy, other } */
  function pickFiles(files, done, now){
    done = done || {};
    var r = { take: [], dup: [], busy: [], other: [] };
    files.forEach(function(f){
      if (!isPdf(f)) r.other.push(f);
      else if (done[sig(f)]) r.dup.push(f);
      else if (now - f.lastModified < BUSY_MS) r.busy.push(f);
      else r.take.push(f);
    });
    r.take.sort(function(a, b){ return (a.lastModified - b.lastModified) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); });
    return r;
  }
  function logAdd(log, day, files, at){
    var out = JSON.parse(JSON.stringify(log || {}));
    out[day] = out[day] || {};
    files.forEach(function(f){ out[day][sig(f)] = at; });
    return out;
  }
  function logFor(log, day){ return (log && log[day]) || {}; }
  function logDays(log){ return Object.keys(log || {}).sort(); }
  /* 초기화 때 지울 파일 — 수집 기록에 있는 것만 (수집 뒤 새로 쌓인 송장은 남김) */
  function toDelete(files, done){ return files.filter(function(f){ return isPdf(f) && done && done[sig(f)]; }); }

  var EZC = { BUSY_MS: BUSY_MS, dayFolder: dayFolder, sig: sig, pickFiles: pickFiles,
              logAdd: logAdd, logFor: logFor, logDays: logDays, toDelete: toDelete };

  if (typeof module !== 'undefined' && module.exports) { module.exports = EZC; return; }

  /* ───────── 브라우저: 폴더 기억·권한·읽기·지우기 ───────── */
  var LOG_KEY = 'pkCollectLog', DEL_KEY = 'pkCollectDelete';
  EZC.supported = function(){ return typeof root.showDirectoryPicker === 'function'; };
  EZC.loadLog = function(){ try { return JSON.parse(localStorage.getItem(LOG_KEY) || '{}') || {}; } catch(e){ return {}; } };
  EZC.saveLog = function(log){ try { localStorage.setItem(LOG_KEY, JSON.stringify(log || {})); } catch(e){} };
  /* 수집 끝나면 폴더 비우기 — 기본 켬 */
  EZC.deleteAfter = function(v){
    try {
      if (v === undefined) return localStorage.getItem(DEL_KEY) !== '0';
      localStorage.setItem(DEL_KEY, v ? '1' : '0');
    } catch(e){ return true; }
  };

  function idb(){
    return new Promise(function(res, rej){
      var r = indexedDB.open('pkCollect', 1);
      r.onupgradeneeded = function(){ r.result.createObjectStore('h'); };
      r.onsuccess = function(){ res(r.result); };
      r.onerror = function(){ rej(r.error); };
    });
  }
  function idbDo(mode, fn){
    return idb().then(function(db){
      return new Promise(function(res, rej){
        var tx = db.transaction('h', mode), rq = fn(tx.objectStore('h'));
        tx.oncomplete = function(){ res(rq && rq.result); };
        tx.onerror = function(){ rej(tx.error); };
      });
    });
  }
  EZC.getRoot = function(){ return idbDo('readonly', function(st){ return st.get('root'); }).catch(function(){ return null; }); };
  EZC.pickRoot = function(){
    return root.showDirectoryPicker({ id: 'ezPdf', mode: 'readwrite' }).then(function(h){
      return idbDo('readwrite', function(st){ return st.put(h, 'root'); }).then(function(){ return h; });
    });
  };
  EZC.perm = function(h){
    var o = { mode: 'readwrite' };
    return h.queryPermission(o).then(function(p){
      if (p === 'granted') return true;
      return h.requestPermission(o).then(function(p2){ return p2 === 'granted'; });
    }).catch(function(){ return false; });
  };
  /* 고른 폴더가 날짜 폴더 자체면 그대로, 아니면 그 안의 날짜 폴더 (없으면 null) */
  EZC.dayDir = function(h, day){
    if (h.name === day) return Promise.resolve(h);
    return h.getDirectoryHandle(day).catch(function(){ return null; });
  };
  EZC.list = function(dir){
    var out = [], it = dir.values();
    function next(){
      return it.next().then(function(r){
        if (r.done) return out;
        if (r.value.kind !== 'file') return next();
        return r.value.getFile().then(function(file){
          out.push({ name: file.name, size: file.size, lastModified: file.lastModified, file: file });
          return next();
        }, next);
      });
    }
    return next();
  };
  EZC.remove = function(dir, files){
    var ok = 0, fail = [];
    return files.reduce(function(p, f){
      return p.then(function(){ return dir.removeEntry(f.name).then(function(){ ok++; }, function(){ fail.push(f.name); }); });
    }, Promise.resolve()).then(function(){ return { ok: ok, fail: fail }; });
  };
  /* 초기화 — 기록된 모든 날짜 폴더에서 수집했던 파일만 지우고 기록 비움 */
  EZC.cleanupAll = function(){
    var log = EZC.loadLog(), days = logDays(log), sum = { ok: 0, fail: 0, noPerm: false };
    if (!days.length || !EZC.supported()) return Promise.resolve(sum);
    return EZC.getRoot().then(function(h){
      if (!h) return sum;
      return EZC.perm(h).then(function(ok){
        if (!ok) { sum.noPerm = true; return sum; }
        return days.reduce(function(p, day){
          return p.then(function(){
            return EZC.dayDir(h, day).then(function(dir){
              if (!dir) return;
              return EZC.list(dir).then(function(fs){ return EZC.remove(dir, toDelete(fs, logFor(log, day))); })
                .then(function(r){ sum.ok += r.ok; sum.fail += r.fail.length; });
            });
          });
        }, Promise.resolve()).then(function(){ if (!sum.fail) EZC.saveLog({}); return sum; });
      });
    }).catch(function(){ return sum; });
  };

  root.EZ_COLLECT = EZC;
})(typeof window !== 'undefined' ? window : this);
