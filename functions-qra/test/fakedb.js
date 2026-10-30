/* 시험용 메모리 DB — 함수가 쓰는 만큼만 firebase-admin database 를 흉내 냄 */
const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const split = (p) => String(p || '').split('/').filter(Boolean);

function fakeDb(seed){
  const state = { root: clone(seed) || {}, pushN: 0, failUpdate: false };

  function get(path){
    let cur = state.root;
    for (const k of split(path)){
      if (cur == null || typeof cur !== 'object') return null;
      cur = cur[k];
    }
    return cur === undefined ? null : clone(cur);
  }
  function set(path, val){
    const keys = split(path);
    if (!keys.length) { state.root = clone(val) || {}; return; }
    let cur = state.root;
    keys.slice(0, -1).forEach((k) => { if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {}; cur = cur[k]; });
    const last = keys[keys.length - 1];
    if (val === null || val === undefined) delete cur[last]; else cur[last] = clone(val);
  }
  const snap = (val, key) => ({ val: () => val, exists: () => val !== null, key,
    forEach: (fn) => { Object.keys(val || {}).forEach((k) => fn(snap(clone(val[k]), k))); } });

  function ref(path){
    return {
      key: split(path).slice(-1)[0],
      once: async () => snap(get(path)),
      set: async (v) => { set(path, v); },
      remove: async () => { set(path, null); },
      update: async (u) => {
        if (state.failUpdate) throw new Error('update failed');
        Object.keys(u).forEach((k) => set((path ? path + '/' : '') + k, u[k]));
      },
      push: () => ref(path + '/-P' + String(++state.pushN).padStart(4, '0')),
      orderByChild: (child) => ({
        equalTo: (v) => ({ once: async () => {
          const all = get(path) || {};
          const out = {};
          Object.keys(all).forEach((k) => { if (all[k] && all[k][child] === v) out[k] = all[k]; });
          return snap(Object.keys(out).length ? out : null);
        } }),
      }),
      /* 실제 SDK 처럼 캐시 없는 첫 실행은 null 로 돌고, 서버 값과 다르면 다시 돈다 */
      transaction: async (fn) => {
        const server = get(path);
        let res = fn(null);
        if (server !== null || res === undefined) {
          if (server === null && res === undefined) return { committed: false, snapshot: snap(null) };
          if (server !== null) res = fn(clone(server));
        }
        if (res === undefined) return { committed: false, snapshot: snap(server) };
        set(path, res);
        return { committed: true, snapshot: snap(get(path)) };
      },
    };
  }
  return { ref, get, set, state };
}

module.exports = { fakeDb };
