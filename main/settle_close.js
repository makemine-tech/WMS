/* ============================================================
   정산관리 — 월 정산 마감확정 (대표님 2026-10-04)
   업체별이 아니라 그 달 전체를 한 번에: 화면 맨 위 「2026년 9월분 정산 마감확정」
     1) 그 달 업체가 모두 ⑤ 완료 확정됐는지 (이번 달 정산 없는 업체는 「이번 달 없음」으로 빼기)
     2) 무결성 = 그 달 원본 자료의 모든 건이 어느 업체 ✅ 확정본 안에 들어 있는지 — 업체 룰과 상관없이 실제 확정본에서 찾음
          · 이벗 택배비 리스트 / 이벗 전체주문목록 / 포인트나인크루 출고 ROW → 송장번호
          · 박스앤캔 택배비 발송·반품 → 등기번호
          · 쿠팡 발주서 → 발주번호
          · 화물·용차 청구서(확인 화면 금액) → 같은 줄에 날짜 + 금액(또는 합계·부가세 포함)
          · 입출고 화물관리 기록 → 그 업체 확정본에 그 날짜 줄
        남는 건은 판매처·업체별로 묶어서 → 「누락」이면 그 업체 정산을 고쳐 다시 확정, 「청구 대상 아님」이면 이유와 함께 제외(다음 달부터 같은 묶음 자동 제외)
     3) 모두 100% 면 🔒 마감확정 — settlement/close/{ym} = { at, by, total, used, ignored, vendors }
        되돌리기 = 마감 기록만 지움(업체 확정본은 그대로). 마감 뒤 업체 확정본이 바뀌면 「다시 검증 필요」 표시
   제외 묶음: settlement/closeIgnore/{원본종류}/{묶음키} = { label, why, ym, at }
   쓰는 전역: db, YM, BOX, ALLBOX, VENDORS, FREIGHT, CARGO, me, esc, $, toast, ymLabel, ftime, getBytes, WMS2FA, XLSX,
             samplesByVendor, vKey, sKey, doneOf, frFinal, frVendor, vendorMatcher, SETTLE_STMT
============================================================ */
var CLOSE = { ym: null, open: false, busy: false, msg: '', res: null, err: '' }, CLOSE_REC = {}, CLOSE_IGN = {}, CLOSE_SKIP = {};

/* ───────── 검사 본체 (화면과 분리 — Node 에서도 돌림) ───────── */
var SETTLE_CLOSE = (function(){
  function ns(v){ return String(v == null ? '' : v).replace(/\s+/g, ''); }
  function serialDate(n){ return new Date(Math.round((n - 25569) * 864e5)).toISOString().slice(0, 10); }
  /* 칸 값 → 찾기용 글자들 (숫자·날짜·송장번호 모양을 같은 모양으로) */
  function toks(v, out){
    if (v == null || v === '') return;
    if (typeof v === 'number'){
      if (!isFinite(v)) return;
      if (Math.abs(v - Math.round(v)) < 1e-6){ var r = Math.round(v); out.push(String(r)); if (r > 40000 && r < 60000) out.push(serialDate(r)); }
      else { out.push(String(Math.round(v))); out.push(v.toFixed(2)); }
      return;
    }
    if (v instanceof Date){ out.push(v.toISOString().slice(0, 10)); return; }
    var s = ns(v); if (!s) return; out.push(s);
    var d = s.match(/^(\d{4})[-.\/년](\d{1,2})[-.\/월](\d{1,2})/); if (d) out.push(d[1] + '-' + ('0' + d[2]).slice(-2) + '-' + ('0' + d[3]).slice(-2));
    var g = s.replace(/[^\d]/g, ''); if (g.length >= 8 && g !== s) out.push(g);
    if (/^-?[\d,]+(\.\d+)?$/.test(s)) out.push(String(Math.round(+s.replace(/,/g, ''))));
  }
  function keyOf(v){ var t = []; toks(v, t); return t; }

  /* 확정본들 → 전체 글자 집합 + 줄 단위(화물·입출고 맞추기용) */
  function indexFinals(finals){
    var all = new Set(), rows = [];
    finals.forEach(function(f){
      f.wb.SheetNames.forEach(function(sn){
        var a = XLSX.utils.sheet_to_json(f.wb.Sheets[sn], { header: 1, defval: '', raw: true });
        a.forEach(function(r){ var t = []; r.forEach(function(v){ toks(v, t); }); if (!t.length) return; t.forEach(function(x){ all.add(x); }); rows.push({ f: f, set: new Set(t) }); });
      });
    });
    return { all: all, rows: rows };
  }
  /* 원본 시트에서 제목줄(need 글자를 모두 가진 줄) 찾아 [제목, 줄들] */
  function table(wb, need, sheetRe){
    var out = [];
    wb.SheetNames.forEach(function(n){ if (sheetRe && !sheetRe.test(n)) return;
      var a = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: true });
      for (var i = 0; i < Math.min(a.length, 12); i++){ var h = a[i].map(ns); if (need.every(function(k){ return h.indexOf(k) >= 0; })){ out.push({ sheet: n, head: h, rows: a.slice(i + 1) }); break; } } });
    return out;
  }
  var SRC = [
    { type: 'ebut_shiplist', label: '이벗 택배비 리스트', key: '송장번호', need: ['송장번호', '택배크기'], grp: ['판매처명', '출력양식'] },
    { type: 'ebut_orders',   label: '이벗 전체주문목록', key: '송장번호', need: ['송장번호', '고객사'], grp: ['고객사', '판매처'] },
    { type: 'p9_row',        label: '포인트나인크루 출고 ROW', key: '송장번호', need: ['송장번호', '관리번호'], grp: null },
    { type: 'bnc_courier',   label: '박스앤캔 택배비 · 발송', key: '등기번호', need: ['등기번호', '발송인명'], grp: ['발송인명'], sheet: /발송/ },
    { type: 'bnc_courier',   label: '박스앤캔 택배비 · 반품', key: '등기번호', need: ['등기번호', '고객명'], grp: ['고객명'], sheet: /반품/ },
    { type: 'coupang_po',    label: '쿠팡 발주서', key: '발주번호', need: ['발주번호', '물류센터'], grp: null }
  ];
  /* in = { finals:[{name, vendor, wb}], sources:[{type, name, wb}], freight:[{d, amt, etc, vendor, item}], cargo:[{date, kind, vendor, aj, etc}], ignore:{src:{gk:{why}}} }
     → { groups:[{src, label, gk, name, total, miss, sample[], ign}], total, used, ignored, missing } */
  function check(inp){
    var IX = indexFinals(inp.finals), G = {}, ign = inp.ignore || {};
    var add = function(src, label, name, hit, sample){
      var gk = (src + '|' + (name || '(이름 없음)')).replace(/[.#$\/\[\]]/g, '_');
      var g = G[gk] || (G[gk] = { src: src, label: label, gk: gk, name: name || '(이름 없음)', total: 0, miss: 0, sample: [] });
      g.total++; if (!hit){ g.miss++; if (g.sample.length < 30) g.sample.push(sample); } };
    var seen = {};
    (inp.sources || []).forEach(function(s){
      SRC.forEach(function(D){ if (D.type !== s.type) return;
        table(s.wb, D.need, D.sheet).forEach(function(T){
          var iK = T.head.indexOf(D.key), gi = (D.grp || []).map(function(c){ return T.head.indexOf(c); }).filter(function(i){ return i >= 0; })[0];
          T.rows.forEach(function(r){ var k = ns(r[iK]); if (!k || /합계|소계/.test(k)) return;
            var kk = keyOf(r[iK]), uk = D.label + '|' + kk[kk.length - 1]; if (seen[uk]) return; seen[uk] = 1;   /* 같은 번호 여러 줄(주문 여러 개) = 한 건 */
            var hit = kk.some(function(t){ return IX.all.has(t); });
            add(D.label, D.label, gi != null && gi >= 0 ? String(r[gi] || '').trim() : s.name, hit, k); });
        }); });
    });
    /* 화물·용차 청구서: 같은 줄에 날짜 + 금액(합계·부가세 포함) */
    (inp.freight || []).forEach(function(r){
      var d = keyOf(r.d)[1] || keyOf(r.d)[0], a = Math.round(+r.amt || 0), e = Math.round(+r.etc || 0), amts = [a, a + e, Math.round(a * 1.1), Math.round((a + e) * 1.1)].map(String);
      var hit = !a || IX.rows.some(function(x){ return x.set.has(d) && amts.some(function(m){ return x.set.has(m); }); });
      add('화물·용차 청구서', '화물·용차 청구서', r.vendor, hit, r.d + ' ' + (r.from || '') + (r.to ? '→' + r.to : '') + ' ' + a.toLocaleString('ko-KR') + '원');
    });
    /* 입출고 화물관리: 그 업체 확정본에 그 날짜 줄 */
    var KN = { parcel: '택배출고', in: '입고', out: '출고', ret: '반품양품화', etc: '기타' };
    (inp.cargo || []).forEach(function(c){
      var d = String(c.date || '').slice(0, 10), vs = String(c.vendor || '').split(',').map(function(v){ return v.trim(); }).filter(Boolean);
      vs.forEach(function(v){
        var mine = inp.finals.filter(function(f){ return window.vendorMatcher(f.vendor)(v) || window.vendorMatcher(v)(f.vendor); });
        var hit = mine.length && IX.rows.some(function(x){ return mine.indexOf(x.f) >= 0 && x.set.has(d); });
        add('입출고 화물관리', '입출고 화물관리', v + ' · ' + (KN[c.kind] || c.kind || ''), !!hit, d + ' 파렛트 ' + ((+c.aj || 0) + (+c.etc || 0)) + (mine.length ? '' : ' (이 업체 확정본 없음)'));
      });
    });
    var groups = Object.keys(G).map(function(k){ var g = G[k]; g.ign = ((ign[sKeyC(g.src)] || {})[sKeyC(g.name)]) || null; return g; });
    return summarize(groups);
  }
  function sKeyC(s){ return String(s || '').replace(/[.#$\/\[\]]/g, '_') || '_'; }
  function summarize(groups){
    var t = 0, u = 0, ig = 0, mi = 0;
    groups.forEach(function(g){ t += g.total; if (g.ign){ ig += g.miss; u += g.total - g.miss; } else { u += g.total - g.miss; mi += g.miss; } });
    return { groups: groups, total: t, used: u, ignored: ig, missing: mi, pct: t ? Math.floor((u + ig) / t * 1000) / 10 : 100 };
  }
  return { check: check, summarize: summarize, sKeyC: sKeyC, SRC: SRC };
})();

/* ───────── 화면 ───────── */
function closeRecOf(ym){ return CLOSE_REC[ym] || null; }
function monthVendors(ym){   /* 이 달 정산 대상 업체 = 표본이 있는 모든 업체 */
  var g = samplesByVendor(), skip = CLOSE_SKIP[ym] || {};
  return Object.keys(g).sort(function(a, b){ return a.localeCompare(b, 'ko'); }).map(function(n){ var k = vKey(n); return { name: n, vk: k, done: doneOf(k, ym), skip: !!skip[k] }; });
}
function closeChanged(ym){   /* 마감 뒤 업체 확정본이 바뀌었나 */
  var c = closeRecOf(ym); if (!c) return false;
  return Object.keys(VENDORS).some(function(k){ var d = doneOf(k, ym); return d && d.at && c.at && d.at > c.at; });
}
function closeBarHtml(){
  if (!YM) return '';
  var c = closeRecOf(YM), lab = ymLabel(YM);
  if (c){
    var chg = closeChanged(YM);
    return '<div class="closebar done' + (chg ? ' warn' : '') + '"><span class="cb-ic">🔒</span><div class="cb-t"><b>' + esc(lab) + ' 정산 마감확정</b>'
      + '<small>' + esc(ftime(c.at)) + ' · 무결성 100% (원본 ' + (c.total || 0).toLocaleString() + '건 · 확정본에 있음 ' + (c.used || 0).toLocaleString() + ' · 청구 대상 아님 ' + (c.ignored || 0).toLocaleString() + ') · 업체 ' + (c.vendors || 0) + '곳'
      + (chg ? ' · <b style="color:#fbbf24">⚠️ 마감 뒤 업체 확정본이 바뀜 — 다시 검증 필요</b>' : '') + '</small></div>'
      + '<button class="btn" onclick="closeToggle()">' + (CLOSE.open ? '접기' : '다시 검증') + '</button><button class="btn r" onclick="closeUndo()">마감 되돌리기</button></div>'
      + (CLOSE.open ? closePanelHtml() : '');
  }
  var V = monthVendors(YM), done = V.filter(function(v){ return v.done || v.skip; }).length;
  return '<div class="closebar"><span class="cb-ic">📅</span><div class="cb-t"><b>' + esc(lab) + ' 정산 마감</b>'
    + '<small>업체 완료 확정 ' + done + ' / ' + V.length + ' · 다 끝나면 무결성 검증(원본 자료가 모두 어느 확정본에 들어갔는지) → 100% 면 마감확정</small></div>'
    + '<button class="btn p" onclick="closeToggle()">' + (CLOSE.open ? '접기' : '마감 검증 ▸') + '</button></div>'
    + (CLOSE.open ? closePanelHtml() : '');
}
function renderCloseBar(){ var el = $('closeBar'); if (el) el.innerHTML = closeBarHtml(); }
function closeToggle(){ CLOSE.open = !CLOSE.open; if (CLOSE.ym !== YM){ CLOSE.res = null; CLOSE.err = ''; CLOSE.ym = YM; } renderCloseBar(); }

function closePanelHtml(){
  var V = monthVendors(YM), left = V.filter(function(v){ return !v.done && !v.skip; }), c = closeRecOf(YM);
  var vh = '<div class="cp-sec"><div class="cp-h">① 업체 완료 확정 <span class="dim">' + (V.length - left.length) + ' / ' + V.length + '</span></div>'
    + (left.length ? '<div class="sm" style="margin:.2rem 0 .4rem;color:#fbbf24">아직 확정 안 된 업체 ' + left.length + '곳 — 확정하거나, 이번 달 정산이 없으면 「이번 달 없음」</div>' : '<div class="sm" style="color:var(--g)">✔ 모든 업체 확정 (또는 이번 달 없음)</div>')
    + '<div class="cp-vs">' + V.map(function(v){
        return '<span class="cp-v ' + (v.done ? 'ok' : v.skip ? 'sk' : 'no') + '">' + (v.done ? '✅' : v.skip ? '➖' : '⏳') + ' ' + esc(v.name)
          + (v.done ? '' : ' <a href="javascript:void 0" onclick="closeSkip(\'' + esc(v.vk) + '\',' + (v.skip ? 'false' : 'true') + ')">' + (v.skip ? '되돌림' : '이번 달 없음') + '</a>') + '</span>'; }).join('') + '</div></div>';
  var R = CLOSE.res && CLOSE.ym === YM ? CLOSE.res : null;
  var rh = '<div class="cp-sec"><div class="cp-h">② 무결성 검증 <span class="dim">원본 자료가 모두 어느 업체 확정본에 들어갔는지</span></div>';
  if (CLOSE.busy) rh += '<div class="sm">⏳ ' + esc(CLOSE.msg) + '</div>';
  else if (CLOSE.err) rh += '<div class="sm" style="color:#f87171">검증 실패: ' + esc(CLOSE.err) + '</div><button class="btn" onclick="closeRun()">다시 검증</button>';
  else if (!R) rh += '<button class="btn p" onclick="closeRun()">🔍 검증 시작</button> <span class="sm dim">확정본과 원본을 모두 열어 봅니다 (1~2분)</span>';
  else {
    var S = SETTLE_CLOSE.summarize(R.groups.map(function(g){ g.ign = ((CLOSE_IGN[SETTLE_CLOSE.sKeyC(g.src)] || {})[SETTLE_CLOSE.sKeyC(g.name)]) || null; return g; }));
    var miss = S.groups.filter(function(g){ return g.miss && !g.ign; }).sort(function(a, b){ return b.miss - a.miss; }), ig = S.groups.filter(function(g){ return g.miss && g.ign; });
    var bySrc = {}; S.groups.forEach(function(g){ var b = bySrc[g.src] || (bySrc[g.src] = { t: 0, m: 0 }); b.t += g.total; if (!g.ign) b.m += g.miss; });
    rh += '<div class="cp-pct" style="color:' + (S.pct >= 100 ? 'var(--g)' : '#fbbf24') + '">' + S.pct + '<small>%</small></div>'
      + '<div class="sm">원본 ' + S.total.toLocaleString() + '건 · 확정본에 있음 ' + S.used.toLocaleString() + ' · 청구 대상 아님 ' + S.ignored.toLocaleString() + ' · <b style="color:' + (S.missing ? '#f87171' : 'var(--g)') + '">남음 ' + S.missing.toLocaleString() + '</b>'
      + ' <span class="dim">· 확정본 ' + R.nFinals + '개 · 검증 ' + esc(ftime(R.at)) + '</span> <button class="btn" style="padding:.2rem .6rem" onclick="closeRun()">다시 검증</button></div>'
      + '<div class="sm dim" style="margin:.3rem 0 .5rem">' + Object.keys(bySrc).map(function(k){ return esc(k) + ' ' + (bySrc[k].t - bySrc[k].m).toLocaleString() + '/' + bySrc[k].t.toLocaleString(); }).join(' · ') + '</div>'
      + (R.noFile.length ? '<div class="sm" style="color:#fbbf24">⚠️ 원본 파일을 못 읽음: ' + esc(R.noFile.join(', ')) + '</div>' : '')
      + (miss.length ? '<div class="cp-h" style="margin-top:.6rem">남은 것 ' + miss.length + '묶음 <span class="dim">— 누락이면 그 업체 정산을 고쳐 다시 확정, 아니면 「청구 대상 아님」</span></div>' + miss.map(closeGrpHtml).join('') : '<div class="sm" style="color:var(--g);margin-top:.4rem">✔ 남은 것 없음</div>')
      + (ig.length ? '<details style="margin-top:.5rem"><summary class="sm dim" style="cursor:pointer">청구 대상 아님으로 뺀 묶음 ' + ig.length + '개</summary>' + ig.map(closeGrpHtml).join('') + '</details>' : '');
    R.S = S;
  }
  rh += '</div>';
  var okV = !left.length, okR = R && R.S && R.S.missing === 0;
  var fh = '<div class="cp-sec" style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap">'
    + '<button class="btn p" ' + (okV && okR ? '' : 'disabled') + ' onclick="closeConfirm()">🔒 ' + esc(ymLabel(YM)) + ' 정산 마감확정</button>'
    + '<span class="sm dim">' + (okV && okR ? '업체 확정 완료 · 무결성 100% — 마감할 수 있습니다' : !okV ? '확정 안 된 업체가 남아 있습니다' : !R ? '무결성 검증을 먼저 하세요' : '남은 것을 모두 처리하면 마감할 수 있습니다') + '</span></div>';
  return '<div class="closepanel">' + vh + rh + (c ? '' : fh) + '</div>';
}
function closeGrpHtml(g){
  var gk = esc(g.gk);
  return '<details class="cp-g' + (g.ign ? ' ig' : '') + '"><summary><b>' + esc(g.src) + '</b> · ' + esc(g.name) + ' <span class="pill">' + g.miss.toLocaleString() + (g.total !== g.miss ? ' / ' + g.total.toLocaleString() : '') + '건</span>'
    + (g.ign ? ' <span class="sm dim">청구 대상 아님: ' + esc(g.ign.why || '') + '</span>' : '')
    + '<span style="margin-left:auto"></span>' + (g.ign ? '<button class="btn" style="padding:.15rem .55rem" onclick="event.preventDefault();closeIgnore(\'' + gk + '\',false)">빼기 취소</button>'
      : '<button class="btn" style="padding:.15rem .55rem" onclick="event.preventDefault();closeIgnore(\'' + gk + '\',true)">청구 대상 아님</button>') + '</summary>'
    + '<div class="sm dim" style="padding:.3rem .2rem .5rem;line-height:1.7">' + g.sample.map(esc).join(' · ') + (g.miss > g.sample.length ? ' … 외 ' + (g.miss - g.sample.length) + '건' : '') + '</div></details>';
}
function closeIgnore(gk, on){
  var R = CLOSE.res; if (!R) return; var g = R.groups.filter(function(x){ return x.gk === gk; })[0]; if (!g) return;
  var ref = db.ref('settlement/closeIgnore/' + SETTLE_CLOSE.sKeyC(g.src) + '/' + SETTLE_CLOSE.sKeyC(g.name));
  if (!on){ if (confirm('「' + g.src + ' · ' + g.name + '」 제외를 취소할까요?')) ref.set(null); return; }
  var why = prompt('「' + g.src + ' · ' + g.name + '」 ' + g.miss + '건을 청구 대상 아님으로 뺍니다.\n다음 달부터 같은 묶음은 자동으로 빠집니다.\n\n이유 (예: 내부 발송, 샘플, 다른 업체 정산에서 처리):', '');
  if (why == null) return;
  ref.set({ label: g.src + ' · ' + g.name, why: why.trim() || '(이유 없음)', ym: YM, at: firebase.database.ServerValue.TIMESTAMP, by: (me && me.email) || '' });
}
function closeSkip(vk, on){ db.ref('settlement/closeSkip/' + YM + '/' + vk).set(on ? true : null); }

function closeRun(){
  if (CLOSE.busy) return;
  var ym = YM; CLOSE.ym = ym; CLOSE.busy = true; CLOSE.err = ''; CLOSE.res = null;
  var msg = function(t){ CLOSE.msg = t; renderCloseBar(); };
  var dec = function(m){ return getBytes(m.path).then(function(ab){ return WMS2FA.decrypt(m.path, m.iv, ab); }).then(function(b){ return XLSX.read(b, { type: 'array', dense: true }); }); };
  var box = ALLBOX[ym] || {}, fin = Object.keys(box).filter(function(id){ var m = box[id]; return m.type === 'statement' && m.final && !m.superseded; });
  var srcTypes = {}; SETTLE_CLOSE.SRC.forEach(function(d){ srcTypes[d.type] = 1; });
  var srcIds = Object.keys(box).filter(function(id){ return srcTypes[box[id].type]; }), finals = [], sources = [], noFile = [], i = 0;
  var n = fin.length + srcIds.length;
  fin.reduce(function(p, id){ return p.then(function(){ msg('확정본 여는 중 ' + (++i) + '/' + n + ' — ' + box[id].name);
    return dec(box[id]).then(function(wb){ finals.push({ name: box[id].name, vendor: SETTLE_STMT.vendorFromFile(box[id].name), wb: wb }); }).catch(function(){ noFile.push(box[id].name); }); }); }, Promise.resolve())
  .then(function(){ return srcIds.reduce(function(p, id){ return p.then(function(){ msg('원본 여는 중 ' + (++i) + '/' + n + ' — ' + box[id].name);
    return dec(box[id]).then(function(wb){ sources.push({ type: box[id].type, name: box[id].name, wb: wb }); }).catch(function(){ noFile.push(box[id].name); }); }); }, Promise.resolve()); })
  .then(function(){
    msg('맞춰 보는 중…');
    var fr = []; Object.keys((FREIGHT || {})[ym] || {}).forEach(function(fid){ var F = FREIGHT[ym][fid] || {}, ch = F.chk || {};
      (F.rows || []).forEach(function(r, k){ fr.push({ d: r.d, from: r.from, to: r.to, amt: frFinal(r, ch[k]), etc: r.etc, vendor: frVendor(r, ch[k]) }); }); });
    var cg = (typeof CARGO !== 'undefined' && CARGO && CARGO.rows) ? CARGO.rows.filter(function(r){ return String(r.date || '').slice(0, 7) === ym; }) : [];
    return new Promise(function(res){ setTimeout(res, 30); }).then(function(){
      var R = SETTLE_CLOSE.check({ finals: finals, sources: sources, freight: fr, cargo: cg, ignore: CLOSE_IGN });
      R.nFinals = finals.length; R.noFile = noFile; R.at = Date.now(); CLOSE.res = R;
      if (!finals.length) CLOSE.err = ymLabel(ym) + ' 완료 확정본이 없습니다';
    });
  }).catch(function(e){ CLOSE.err = (e && (e.code || e.message)) || String(e); console.error(e); })
    .then(function(){ CLOSE.busy = false; renderCloseBar(); });
}
function closeConfirm(){
  var R = CLOSE.res, S = R && R.S, V = monthVendors(YM);
  if (!S || S.missing) return;
  if (!confirm(ymLabel(YM) + ' 정산을 마감확정할까요?\n\n업체 확정 ' + V.filter(function(v){ return v.done; }).length + '곳 · 원본 ' + S.total.toLocaleString() + '건 무결성 100%')) return;
  db.ref('settlement/close/' + YM).set({ at: firebase.database.ServerValue.TIMESTAMP, by: (me && me.email) || '', total: S.total, used: S.used, ignored: S.ignored,
    vendors: V.filter(function(v){ return v.done; }).length, skip: CLOSE_SKIP[YM] || null })
    .then(function(){ CLOSE.open = false; toast('🔒 ' + ymLabel(YM) + ' 정산 마감확정'); });
}
function closeUndo(){
  if (!confirm(ymLabel(YM) + ' 정산 마감확정을 되돌릴까요?\n\n업체별 완료 확정본은 그대로 두고 「마감」 기록만 지웁니다. 다시 검증해서 마감할 수 있습니다.')) return;
  db.ref('settlement/close/' + YM).set(null).then(function(){ CLOSE.open = true; toast('↺ ' + ymLabel(YM) + ' 마감을 되돌렸습니다'); });
}
function closeListen(){
  db.ref('settlement/close').on('value', function(s){ CLOSE_REC = s.val() || {}; renderCloseBar(); });
  db.ref('settlement/closeIgnore').on('value', function(s){ CLOSE_IGN = s.val() || {}; renderCloseBar(); });
  db.ref('settlement/closeSkip').on('value', function(s){ CLOSE_SKIP = s.val() || {}; renderCloseBar(); });
}
