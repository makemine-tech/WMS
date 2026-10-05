/* ============================================================
   정산관리 — 스타인터내셔널(쿠팡대행) (2026-10-05 대표님 룰 · 2026-02 ~ 08 확정본 7개월 분석)
     작업 엑셀(📂 ⭐ 스타인터내셔널 작업 ROW) = 정산 기준. 작업 하나 = 거래명세표 한 묶음(날짜·줄) + 그 엑셀 내용 시트 하나.
       입고(검수완료 …)     입고검수 = 검수수량 × 100 · 사이즈컬러조사 = 품목(바코드 SKU) 수 × 1,000
       쿠팡출고(MMDD_쿠팡출고) 쿠팡출고 수량 × 450 · 쿠팡출고적재비 파렛트 × 8,000 · 밀크런파렛트 × 3,000 · 바코드 덧방 수량 × 120 (쿠팡출고엔 덧방이 같이)
       재고출고(본사이관 등)  이관출고박스수 = 박스바코드 종류 × 1,000
     날짜: 쿠팡출고·이관 = 파일 이름 MMDD, 입고 = STAR 재고관리에 입고된 날
     파렛트 = 입출고 화물관리 그날 스타 출고(밀크런) 파렛트 — 없으면 파일 이름 「N파렛트」, 둘이 다르면 특이사항
     엑셀 없는 STAR 입고가 엑셀 있는 출고로 나갔으면 = 실제 입고 작업 → STAR 기록으로 입고검수 줄(노란 칸) (9/17 아디다스 → 9/29 출고)
     컨테이너 까대기 = 화물관리 스타 입고 중 메모에 20피트·40피트·컨테이너 → 20피트 200,000 · 40피트 400,000 (대표님 기록이 우선 — 대표님이 따로 크로스 체크)
     공간비 = 지난달 그대로 · 용차비 = 화물 청구서 (용차비 시트 합계)
     재고 시트 = STAR 재고관리 말일 재고 (8/31 확정본과 428개 바코드 모두 일치)
   쓰는 것: ctx.BOX 의 star_row 파일, ctx.CARGO, ctx.STAR(없으면 SETTLE_STAR.load())
============================================================ */
(function(){
  'use strict';
  var E = window.SETTLE_ENGINES = window.SETTLE_ENGINES || {};
  var YEL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2B3' } };
  var R = function(t){ return { d: '2026-10-05', t: t }; };
  var P = { in: 100, survey: 1000, out: 450, load: 8000, milk: 3000, relabel: 120, box: 1000, ft20: 200000, ft40: 400000, vinyl: 300, urgent: 100000, urgentN: 4 };
  function txt(v){ if (v && v.richText) return v.richText.map(function(t){ return t.text; }).join(''); if (v && typeof v === 'object' && 'result' in v) return v.result == null ? '' : String(v.result); if (v && typeof v === 'object' && 'formula' in v) return ''; return v == null ? '' : String(v); }
  function ns(v){ return txt(v).replace(/\s+/g, ''); }
  function fml(c){ var v = c.value; if (v && typeof v === 'object' && v.formula) return v.formula; return null; }
  function isF(v){ return !!(v && typeof v === 'object' && (v.formula || v.sharedFormula)); }
  var clone = function(o){ return JSON.parse(JSON.stringify(o || {})); };
  var day = function(d){ return +String(d || '').slice(8, 10) || ''; };
  /* 달마다 대표님 컨테이너 기록 (대화창으로 받음 — 화물관리보다 우선) · what = 무슨 물건(AG·카톤·컨테이너번호, 카톡 대화로 확인), file = 그 입고 작업 엑셀 */
  var CONT = {
    '2026-09': [
      { date: '2026-09-02', memo: '40피트 파렛트 입고>>파렛트 재적재', what: 'AG-584·AG-555 잔스포츠·팩세이프·이스트팩 백팩 7,137개 (차량 인천99아5605)', file: '(검수완료)260806_EMA_잔스포츠, 팩세이프, 이스트팩 (AG-584, AG-555)_7,137.xlsx' },
      { date: '2026-09-03', memo: '20피트 컨테이너 까대기', what: 'AG-901 나이키 수영복 2,303개 172카톤 (미국 항공건 FNSLAX260226, 카톡상 9/2 하차)', file: '(검수완료)260825_블루오리진_나이키 수영복(AG-901)_2303_(컬러링).xlsx' },
      { date: '2026-09-15', memo: '40피트 파렛트 입고>>파렛트 재적재', what: 'AG-772 아디다스 운동화 4,606족 451카톤 (FGLHK2608065 · 컨 TEMU7695219)', file: '작업 엑셀 없음 — STAR 9/17 「0915_아디다시입고 전산업로드파일」 · 패킹리스트 PI131 4606pcs → 9/29 출고' },
      { date: '2026-09-30', memo: '20피트 컨테이너 까대기', what: 'AG-866 아디다스 골프 2,251개 (EGLV091600505702 · 컨 TCLU3786777 · 10:30)', file: '(검수요청)260930_MFL_아디다스 골프(AG-866)_2251.xlsx' },
      { date: '2026-09-30', memo: '20피트 컨테이너 까대기', what: 'AG-808 아디다스 2,957개 (ONEYPKGG45974600 · 컨 EITU0533106 · 11:00)', file: '(검수요청)260930_MFL_아디다스(AG-808)_2957.xlsx' }
    ]
  };
  var sheetName = function(n){ return String(n).replace(/\.[a-z0-9]+$/i, '').replace(/[\[\]:*?\/\\]/g, '').replace(/^\(검수완료\)/, '').slice(0, 31); };

  /* 파일 이름에서: N파렛트 · N박스 · 비닐포장 N · 긴급 · 택배 */
  function nameInfo(n){
    var s = String(n || ''), g = function(re){ var m = s.match(re); return m ? +m[1].replace(/,/g, '') : null; };
    return { pal: g(/(\d+)\s*파렛트/), box: g(/(\d+)\s*박스/), vinyl: g(/([\d,]+)\s*(?:개|장)?\s*비닐포장/) || (/비닐포장/.test(s) ? g(/비닐포장_?([\d,]+)/) : null),
      urgent: /긴급/.test(s), parcel: /택배/.test(s) };
  }

  /* 작업 → 거래명세표 줄 */
  function rowsOf(w){
    var L = [], add = function(name, spec, q, p, o){ L.push(Object.assign({ name: name, spec: spec, q: q, p: p }, o || {})); };
    if (w.kind === 'in'){
      add('입고검수', '검수수량', w.qty, P.in, { yq: w.noFile });
      add('사이즈컬러조사', '품목수량', w.sku, P.survey, { yq: w.noFile, note: '바코드(SKU) ' + w.sku + '종' });
    } else if (w.kind === 'po'){
      add('쿠팡출고 수량', '납품수량', w.qty, P.out);
      if (w.pal) { add('쿠팡출고적재비', '파렛트', w.pal, P.load, { yq: w.palWarn }); add('밀크런파렛트', '파렛트', w.pal, P.milk, { yq: w.palWarn }); }
      add('바코드 덧방', '수량', w.qty, P.relabel);
      if (w.ni.vinyl) add('비닐포장', '장', w.ni.vinyl, P.vinyl, { note: '파일 이름 「비닐포장 ' + w.ni.vinyl + '」 · 장당 ' + P.vinyl });
      if (w.ni.urgent) add('긴급작업 인건비', '인', P.urgentN, P.urgent, { yq: true, note: '파일 이름 「긴급」 — 기본 ' + P.urgentN + '인 × 1인 ' + P.urgent.toLocaleString() + ' (인원 다르면 수량 수정)' });
    } else if (w.kind === 'move'){
      add('이관출고박스수', '박스', w.boxes, P.box, { yq: true, note: '박스바코드 ' + w.boxes + '종 = 박스 수 · ' + w.qty + '개' });
    }
    return L;
  }

  function after(wb, ctx){
    var st = ctx.st, log = ctx.log, box = ctx.BOX || {}, YM = ctx.YM, won = ctx.won;
    var ids = Object.keys(box).filter(function(id){ return box[id].type === 'star_row'; }).sort(function(a, b){ return String(box[a].name).localeCompare(String(box[b].name), 'ko'); });
    var files = [], VM = window.vendorMatcher('스타인터내셔널', ['스타']);
    var Y = +YM.slice(0, 4), Mo = +YM.slice(5, 7), ND = new Date(Date.UTC(Y, Mo, 0)).getUTCDate(), END = YM + '-' + String(ND).padStart(2, '0');
    return ids.reduce(function(p, id){ return p.then(function(){ ctx.msg && ctx.msg(box[id].name + ' 읽는 중…'); return ctx.readBox(box[id]).then(function(x){ files.push({ id: id, name: box[id].name, wb: x }); }); }); }, Promise.resolve())
    .then(function(){ ctx.msg && ctx.msg('STAR 재고관리 기록 읽는 중…'); return ctx.STAR || window.SETTLE_STAR.load(); })
    .then(function(S){
      if (!files.length) log.push(['확인 필요', '⭐ 스타인터내셔널 작업 ROW 파일이 없음 — 파일함에 작업 엑셀(검수완료·쿠팡출고·본사이관)을 올리고 「이 업체 정산에 쓰는 파일」 체크 확인']);
      var C = window.SETTLE_STAR.compare(files, S.logs, S.orders, YM);
      var pairOf = {}; C.pairs.forEach(function(p){ pairOf[p.f.id] = p; });
      var cargo = (ctx.CARGO || []).filter(function(x){ return x && String(x.date || '').slice(0, 7) === YM && VM(x.vendor); });
      if (!ctx.CARGO) log.push(['확인 필요', '입출고 화물관리 기록을 못 읽어 파렛트·컨테이너 까대기를 못 채움']);
      var pl = function(x){ return (+x.aj || 0) + (+x.etc || 0); }, memo = function(x){ return String(x.memo || x.note || ''); };

      /* 1) 작업 목록 */
      var W = [], dup = [];
      C.files.forEach(function(f, i){
        if (!f.dir){ log.push(['확인 필요', '작업 엑셀 「' + f.name + '」 모양을 못 읽음 — 정산서에서 빠짐']); return; }
        /* 같은 작업 엑셀 두 번(다른 이름으로 다시 받은 발주서 등): 바코드·수량이 다른 파일에 다 들어 있으면 뺌 */
        var near = function(a, b){ return a && b && Math.abs(Date.parse(a) - Date.parse(b)) <= 2 * 864e5; };   /* 같은 작업 = 날짜 ±2일 (0929 축구공 60 은 0922 발주서에 같은 공이 있어도 다른 출고) */
        var inside = C.files.some(function(g, j){ if (j === i || g.dir !== f.dir || g.total < f.total || (g.total === f.total && j > i) || !near(f.date, g.date)) return false;
          return Object.keys(f.items).every(function(k){ return g.items[k] && g.items[k].qty >= f.items[k].qty; }); });
        if (inside){ dup.push(f.name); return; }
        var p = pairOf[f.id], ni = nameInfo(f.name), w = { f: f, wb: files[i].wb, name: f.name, qty: f.total, sku: Object.keys(f.items).length, ni: ni };
        if (f.dir === 'in'){ w.kind = 'in'; w.date = p ? p.b.d0 : f.date; }
        else if (f.kind === '쿠팡출고'){ w.kind = 'po'; w.date = f.date || (p && p.b.d0); }
        else { w.kind = 'move'; w.date = f.date || (p && p.b.d0); w.boxes = f.boxes || 0; }
        if (w.date && w.date.slice(0, 7) !== YM) log.push(['특이사항', '「' + f.name + '」 날짜 ' + w.date + ' — ' + YM + ' 가 아님 (그래도 넣음, 지난달 정산서에 이미 있었는지 확인)']);
        if (w.kind === 'po' && !(ni.parcel && !ni.pal)){
          var co = cargo.filter(function(x){ return x.kind === 'out' && x.date === w.date && /밀크런|쿠팡/.test(memo(x)); }), cp = co.reduce(function(s, x){ return s + pl(x); }, 0);
          w.pal = cp || ni.pal || 0;
          if (cp && ni.pal != null && cp !== ni.pal){ w.palWarn = true; log.push(['특이사항', w.date + ' 쿠팡출고 파렛트 — 화물관리 ' + cp + ' · 파일 이름 ' + ni.pal + ' → 화물관리 ' + cp + ' 로 넣음 (노란 칸)']); }
          if (!cp && !ni.pal){ w.palWarn = true; log.push(['확인 필요', w.date + ' 쿠팡출고 「' + f.name + '」 — 화물관리·파일 이름 모두 파렛트 수 없음']); }
          else if (!cp) log.push(['안내', w.date + ' 쿠팡출고 파렛트 ' + ni.pal + ' = 파일 이름 (화물관리 그날 스타 밀크런 출고 기록 없음)']);
        }
        if (p && p.diff.length) log.push(['특이사항', '「' + f.name + '」 엑셀 ' + f.total + ' vs STAR ' + p.b.total + ' (바코드 ' + p.diff.length + '개 다름) — 정산은 엑셀 수량. 파일함 ⭐ 묶음의 「🔍 엑셀 대비 STAR 점검」에서 바코드별 확인']);
        if (f.nameQty != null && f.nameQty !== f.total) log.push(['특이사항', '「' + f.name + '」 이름에 적은 수량 ' + f.nameQty + ' ≠ 엑셀 합계 ' + f.total + ' — 정산은 엑셀 합계 ' + f.total]);
        if (!p) log.push(['특이사항', '「' + f.name + '」 — STAR 재고관리에 같은 입출고 기록이 없음 (재고 반영 누락?)']);
        W.push(w);
      });
      if (dup.length) log.push(['안내', '다른 작업 엑셀에 이미 다 들어 있어 뺀 파일: ' + dup.join(', ')]);
      /* 엑셀 없는 STAR 변동 */
      C.starOnly.forEach(function(b){
        if (b.offset){ if (b.dir === 'in') log.push(['안내', b.d0 + ' 입고 ' + b.total + ' ↔ ' + b.offset.d0 + ' 출고 ' + b.offset.total + ' 바코드·수량 똑같음(' + (b.offset.note || b.note || '메모 없음') + ') — 임의 변동으로 보고 정산 안 함']); return; }
        if (b.dir === 'in' && b.usedBy && b.usedBy.length){
          W.push({ kind: 'in', noFile: true, b: b, name: b.name, date: b.d0, qty: b.total, sku: Object.keys(b.items).length, ni: {} });
          log.push(['특이사항', b.d0 + ' STAR 입고 ' + b.total + '개(「' + b.name + '」' + (b.note ? ' · ' + b.note : '') + ') — 작업 엑셀 없음. 이 물건이 ' + b.usedBy.map(function(u){ return '「' + u.name + '」 ' + u.qty + '개'; }).join(', ') + ' 로 출고 → 실제 입고 작업으로 입고검수·사이즈컬러조사 넣음 (노란 칸, 입고 검수 엑셀 만들어 두기)']);
          return; }
        log.push(['확인 필요', b.d0 + ' STAR ' + (b.dir === 'in' ? '입고' : '출고') + ' ' + b.total + '개 「' + b.name + '」' + (b.note ? ' (' + b.note + ')' : '') + ' — 작업 엑셀 없음: 실제 작업이면 청구 누락, 아니면 임의 변동 — 정산서에 안 넣음']);
      });
      W.sort(function(a, b){ return String(a.date).localeCompare(String(b.date)) || (a.kind === 'in' ? 0 : 1) - (b.kind === 'in' ? 0 : 1); });

      /* 2) 컨테이너 까대기 — 대표님 기록(CONT, 대화창으로 받음)이 우선, 없으면 화물관리. 둘 다 있으면 서로 빠진 것 특이사항 */
      var CK = cargo.filter(function(x){ return x.kind === 'in' && /피트|컨테이너|까대기/.test(memo(x)); }).sort(function(a, b){ return a.date.localeCompare(b.date) || (a.at || 0) - (b.at || 0); });
      var ftOf = function(s){ return /40\s*피트/.test(s) ? 40 : 20; };   /* 「40피트 파렛트 입고>>파렛트 재적재」처럼 까대기 문구가 없어도 컨테이너 입고면 같은 금액 (대표님 2026-10-05) */
      var K, mine = CONT[YM];
      if (mine){
        var left = CK.slice();
        K = mine.map(function(c){ var ft = ftOf(c.memo), i = -1;
          left.some(function(x, j){ if (x.date === c.date && ftOf(memo(x)) === ft){ i = j; return true; } return false; });
          var hit = i >= 0 ? left.splice(i, 1)[0] : null;
          if (!hit) log.push(['특이사항', c.date + ' 「' + c.memo + '」 (' + c.what + ') — 대표님 기록에만 있고 화물관리엔 없음 → 대표님 기록대로 넣음 (화물관리에도 적어 두기)']);
          return { date: c.date, name: ft + '피트까대기', spec: ft + '피트', q: 1, p: ft === 40 ? P.ft40 : P.ft20, note: c.date + ' · ' + c.what + (c.file ? ' · ' + c.file : '') + (hit ? '' : ' · 화물관리 기록 없음') }; });
        left.forEach(function(x){ log.push(['확인 필요', x.date + ' 화물관리 「' + memo(x) + '」 ' + pl(x) + '팔 — 대표님 기록에 없어 정산서에 안 넣음 (빠진 거면 대화창에 알려 주세요)']); });
        log.push(['자동 적용', '컨테이너 까대기 = 대표님 기록 ' + mine.length + '건 (화물관리 ' + CK.length + '건과 크로스 체크): ' + mine.map(function(c){ return c.date.slice(5) + ' ' + ftOf(c.memo) + '피트 ' + c.what.split(' ')[0]; }).join(' / ')]);
      } else K = CK.map(function(x){ var ft = ftOf(memo(x));
        return { date: x.date, name: ft + '피트까대기', spec: ft + '피트', q: 1, p: ft === 40 ? P.ft40 : P.ft20, note: x.date + ' · 화물관리 「' + memo(x) + '」 ' + pl(x) + '팔' }; });

      /* 3) 거래명세표 다시 쓰기 */
      var find = function(re, col){ var hit = 0; st.eachRow(function(row, r){ if (!hit && re.test(ns(row.getCell(col || 2).value))) hit = r; }); return hit; };
      var rSec = find(/^<택배쉽먼트>/), rSpace = find(/^<공간비/), rCont = find(/^<컨테이너입고>/), rYong = find(/^<용차비>/), rSub = find(/^소계$/, 8), rTot = find(/^합계$/, 7);
      if (!rSec || !rSpace || !rYong || !rSub || !rTot){ log.push(['확인 필요', '표본 거래명세표 모양이 달라(택배쉽먼트·공간비·용차비·소계·합계 줄) 자동으로 못 씀 — 지난달 그대로']); return W; }
      var cap = function(r){ var row = st.getRow(r), cs = []; for (var c = 1; c <= 22; c++){ var cell = row.getCell(c); cs.push([c, cell.value, clone(cell.style)]); } return { h: row.height, cs: cs }; };
      var parcel = [], rr = rSec + 1; while (/택배발송/.test(ns(st.getCell('B' + rr).value))) { parcel.push(cap(rr)); rr++; }
      var tWork = cap(find(/쿠팡출고|입고검수|바코드/) || rSec + 6), tBlank = cap(rSpace - 1), tSec = cap(rSec), tSpace = cap(rSpace), tCont = rCont ? cap(rCont) : null, tYong = cap(rYong);
      var kk = find(/까대기/); var tKk = kk ? cap(kk) : tWork;
      var last = rTot; st.eachRow(function(row, r){ if (r > last) row.eachCell(function(c){ if (c.value != null && c.value !== '') last = r; }); });
      var foot = []; for (var f0 = rSub; f0 <= last; f0++) foot.push(cap(f0));
      var footMerge = [], yongF = fml(st.getCell('H' + rYong));
      Object.keys(st._merges || {}).forEach(function(k){ var m = st._merges[k].model || st._merges[k]; if (m.top >= rSec) { if (m.top >= rSub) footMerge.push([m.top - rSub, m.left, m.bottom - rSub, m.right]); } });
      Object.keys(st._merges || {}).forEach(function(k){ var m = st._merges[k].model || st._merges[k]; if (m.top >= rSec){ try { st.unMergeCells(m.top, m.left, m.bottom, m.right); } catch (e) {} } });
      for (var r0 = rSec; r0 <= last + 40; r0++){ var row0 = st.getRow(r0); for (var c0 = 1; c0 <= 22; c0++){ var cc = row0.getCell(c0); cc.value = null; cc.style = {}; } }
      /* 한 줄 쓰기: T = 지난달 줄 모양(서식), keep = 지난달 값(내역·수량·단가)도 그대로 — 작업 줄은 값을 새로 씀 */
      var put = function(r, T, vals, yq, yp, keep){
        var row = st.getRow(r); if (T.h) row.height = T.h;
        T.cs.forEach(function(x){ var cell = row.getCell(x[0]); cell.style = clone(x[2]); cell.value = keep && [1, 2, 6, 7, 8].indexOf(x[0]) >= 0 && !isF(x[1]) ? x[1] : null; });
        Object.keys(vals || {}).forEach(function(c){ row.getCell(c).value = vals[c]; });
        try { st.mergeCells(r, 2, r, 5); } catch (e) {} try { st.mergeCells(r, 8, r, 10); } catch (e) {} try { st.mergeCells(r, 11, r, 14); } catch (e) {} try { st.mergeCells(r, 15, r, 17); } catch (e) {}
        var g = +txt(row.getCell(7).value) || 0, h = +txt(row.getCell(8).value) || 0;
        if (row.getCell(8).value && row.getCell(8).value.formula) h = +row.getCell(8).value.result || 0;
        row.getCell(11).value = { formula: 'H' + r + '*G' + r, result: g * h || 0 }; row.getCell(15).value = { formula: 'K' + r + '*0.1', result: Math.round(g * h * 0.1 * 100) / 100 || 0 };
        if (yq) row.getCell(7).fill = YEL; if (yp) row.getCell(8).fill = YEL;
        return g * h;
      };
      var r = rSec, supply = 0, first = rSec, lines = [];
      put(r++, tSec, {}, false, false, true);
      /* 택배쉽먼트 = 파일 이름 「택배쉽먼트 N박스」 → 택배발송(중) (대표님 2026-10-05: 9/29 축구공 3박스 = 중) */
      var pw = W.filter(function(w){ return w.kind === 'po' && w.ni.parcel && w.ni.box; }), pBox = pw.reduce(function(s, w){ return s + w.ni.box; }, 0);
      parcel.forEach(function(T){ var mid = /\(중\)/.test(ns(T.cs[1][1]));
        supply += put(r, T, mid && pBox ? { G: pBox, S: pw.map(function(w){ return day(w.date) + '일 ' + w.ni.box + '박스'; }).join(' · ') + ' (택배쉽먼트 = 중)' } : { G: 0 }, false, false, true); lines.push(r); r++; });
      if (pBox) log.push(['자동 적용', '택배쉽먼트 ' + pBox + '박스 → 택배발송(중) — ' + pw.map(function(w){ return '「' + w.name + '」'; }).join(', ') + ' (크기 다르면 그 줄로 옮기기)']);
      put(r++, tBlank, {});
      W.forEach(function(w){
        var L = rowsOf(w), md = String(w.date || '').slice(5).replace('-', '');
        /* 시트 이름 = 파일 이름 (입고는 「입고일MMDD_…」 — 8월 「0811_아디다스입고_…」처럼) */
        w.sheet = w.noFile ? sheetName(md + '_STAR입고_엑셀없음_' + w.qty + '족') : w.kind === 'in' ? sheetName(md + '_입고검수_' + String(w.name).replace(/^\(검수완료\)\d{6}_/, '')) : sheetName(w.name);
        L.forEach(function(x, i){ var v = { A: day(w.date), B: (i === 0 && w.kind === 'move' ? sheetName(w.name).replace(/^\d{4}_/, '') + ' ' : '') + x.name, F: x.spec, G: x.q, H: x.p };
          if (i === 0) v.S = w.sheet + (x.note ? ' · ' + x.note : ''); else if (x.note) v.S = x.note;
          supply += put(r, tWork, v, x.yq, x.yp || x.p == null); r++; });
        put(r++, tBlank, {});
      });
      supply += put(r++, tSpace, {}, false, false, true);
      put(r++, tBlank, {});
      if (tCont) put(r++, tCont, { G: null }, false, false, true);
      K.forEach(function(x){ supply += put(r++, tKk, { A: day(x.date), B: x.name, F: x.spec, G: x.q, H: x.p, S: x.note }, false, x.yp); });
      put(r++, tBlank, {});
      var yv = 0; if (yongF){ var m = yongF.match(/^'?([^'!]+)'?!([A-Z]+)(\d+)$/), ys = m && wb.getWorksheet(m[1]); if (ys){ var yc = ys.getCell(m[2] + m[3]); yv = +txt(yc.value) || (yc.value && +yc.value.result) || 0;
        if (!yv){ for (var q = 2; q < +m[3]; q++) yv += +txt(ys.getCell(m[2] + q).value) || 0; } } }
      supply += put(r++, tYong, { G: 1, H: yongF ? { formula: yongF, result: yv } : yv, S: '용차비 시트 참조' }, false, false, true);
      var lastItem = r; put(r++, tBlank, {});
      /* 소계·합계·그 아래 (지난달 모양 그대로 옮김) */
      var r1 = r, tax = Math.round(supply * 0.1);
      foot.forEach(function(T, i){ var row = st.getRow(r1 + i); if (T.h) row.height = T.h; T.cs.forEach(function(x){ var cell = row.getCell(x[0]); cell.style = clone(x[2]); cell.value = isF(x[1]) ? null : x[1]; }); });
      footMerge.forEach(function(m){ try { st.mergeCells(m[0] + r1, m[1], m[2] + r1, m[3]); } catch (e) {} });
      st.getCell('K' + r1).value = { formula: 'SUM(K' + first + ':N' + lastItem + ')', result: supply }; st.getCell('O' + r1).value = { formula: 'K' + r1 + '*0.1', result: tax };
      var rT = r1 + (rTot - rSub); st.getCell('H' + rT).value = { formula: 'SUM(K' + first + ':Q' + lastItem + ')', result: supply + tax };
      ['M6', 'N6', 'O6', 'P6'].forEach(function(a){ var c = st.getCell(a); if (fml(c)) c.value = { formula: 'H' + rT, result: supply + tax }; });
      for (var z = r1 + foot.length; z <= last + 40; z++){ var zr = st.getRow(z); for (var c3 = 1; c3 <= 22; c3++) zr.getCell(c3).value = null; }
      if (st.pageSetup && st.pageSetup.printArea) st.pageSetup.printArea = String(st.pageSetup.printArea).replace(/(\d+)$/, String(r1 + foot.length - 1));

      /* 4) 작업 내용 시트: 지난달 MMDD_… 시트 지우고 이번 달 작업 엑셀마다 한 시트 */
      var keep = [];
      wb.worksheets.slice().forEach(function(ws){ if (ws !== st && /^\d{4}_/.test(ws.name)) wb.removeWorksheet(ws.id); });
      W.forEach(function(w, i){
        var nm = w.sheet, n = 2; while (wb.getWorksheet(nm)) nm = w.sheet.slice(0, 28) + '(' + (n++) + ')'; w.sheet = nm;
        var ws = wb.addWorksheet(nm); ws.orderNo = 0.1 + i / 1000; keep.push(nm);
        var aoa;
        if (w.noFile){ aoa = [['박스바코드', '바코드', '품명', '품번', '사이즈', '수량', '메모']];
          var raw = []; Object.keys(S.logs).forEach(function(k){ var l = S.logs[k]; if (l && l.batchId && ('B:' + l.batchId) === w.b.id) raw.push(l); });
          raw.forEach(function(l){ aoa.push([l.box || '', String(l.barcode || ''), l.name || '', l.code || '', l.size || '', +l.qty || 0, l.note || '']); });
          ws.properties.tabColor = { argb: 'FFFFC000' };
        } else aoa = XLSX.utils.sheet_to_json(w.wb.Sheets[w.f.sheet || w.wb.SheetNames[0]], { header: 1, defval: '', raw: true }).filter(function(x){ return x.some(function(v){ return v !== '' && v != null; }); });
        aoa.forEach(function(x){ ws.addRow(x); });
        ws.getRow(1).font = { bold: true }; ws.columns.forEach(function(c, j){ c.width = j < 12 ? 14 : 10; });
        if (w.noFile){ ws.insertRow(1, ['STAR 재고관리 입고 기록 (작업 엑셀 없음 — 입고 검수 엑셀을 만들어 두세요) · ' + w.name]); ws.getRow(1).font = { bold: true, color: { argb: 'FFC00000' } }; }
      });
      /* 시트 순서: 거래명세표 → 작업 시트(날짜순) → 나머지 */
      st.orderNo = 0; var o = 1; W.forEach(function(w){ var s2 = wb.getWorksheet(w.sheet); if (s2) s2.orderNo = o++; });
      wb.worksheets.forEach(function(ws){ if (ws !== st && keep.indexOf(ws.name) < 0) ws.orderNo = 100 + ws.orderNo; });

      /* 5) 말일 재고 시트 ← STAR */
      var stk = wb.worksheets.filter(function(ws){ return /기준_재고$/.test(ws.name); })[0];
      if (stk){
        var G = window.SETTLE_STAR.stockAt(S.logs, END).sort(function(a, b){ var x = (a.m && a.m.brand) || '', y = (b.m && b.m.brand) || ''; return x.localeCompare(y, 'ko') || a.bc.localeCompare(b.bc); });
        var sty = []; stk.getRow(2).eachCell({ includeEmpty: true }, function(c, n){ sty[n] = clone(c.style); });
        for (var r5 = 2; r5 <= stk.rowCount; r5++){ stk.getRow(r5).eachCell(function(c){ c.value = null; }); }
        stk.name = END.slice(5).replace('-', '') + '기준_재고';
        stk.getCell('I1').value = '마감재고(' + END + ')';
        G.forEach(function(g, i){ var m = g.m || {}, row = stk.getRow(2 + i), bx = Object.keys(g.box).filter(function(k){ return g.box[k] > 0; });
          [bx.join(', '), g.bc, m.name || '', m.brand || '', m.code || '', m.color || '', m.size || '', m.origin || '', g.q, g.def].forEach(function(v, j){ var cell = row.getCell(j + 1); cell.value = v; if (sty[j + 1]) cell.style = sty[j + 1]; }); });
        log.push(['자동 적용', '재고 시트 「' + stk.name + '」 = STAR 재고관리 ' + END + ' 마감 ' + G.length + '바코드 · ' + won(G.reduce(function(s, g){ return s + g.q; }, 0)) + '개']);
      }

      for (var q2 = log.length - 1; q2 >= 0; q2--) if (/시트 「용차비」 — 제목이 안 맞는 열/.test(log[q2][1])) log.splice(q2, 1);   /* 결제방법·인수증 열은 원래 비어 있음 */
      /* 6) 요약 */
      var byK = { in: 0, po: 0, move: 0 }; W.forEach(function(w){ byK[w.kind]++; });
      log.push(['자동 적용', '작업 ' + W.length + '건 (입고 ' + byK.in + ' · 쿠팡출고 ' + byK.po + ' · 이관 ' + byK.move + ') → 거래명세표 날짜별 줄 + 작업 시트 ' + W.length + '개: ' + W.map(function(w){ return day(w.date) + '일 ' + (w.kind === 'in' ? '입고 ' : w.kind === 'po' ? '쿠팡출고 ' : '이관 ') + w.qty + (w.pal ? '·' + w.pal + '팔' : ''); }).join(' / ')]);
      if (!mine) log.push(['자동 적용', '컨테이너 까대기 ' + K.length + '건 ← 화물관리' + (K.length ? ': ' + K.map(function(x){ return day(x.date) + '일 ' + x.name; }).join(', ') : '') + ' (이 달 대표님 기록이 아직 없음 — 대화창으로 주시면 그게 우선)']);
      log.push(['자동 적용', '거래명세표 공급가 ' + won(supply) + ' · 세액 ' + won(tax) + ' · 포함가 ' + won(supply + tax) + ' (노란 칸 = 단가·수량 확인 — 비어 있는 단가는 0 으로 계산됨)']);
      return W;
    });
  }

  E['스타인터내셔널(쿠팡대행)'] = {
    needs: ['star_row', 'freight'], traceSkip: true,   /* 화물관리는 파렛트·까대기로, 화물 청구서는 용차비 시트로 이미 씀 */
    allAuto: true, items: {}, sheets: {}, verified: {},   /* 거래명세표 줄은 매달 작업마다 달라서 엔진이 통째로 다시 씀 */
    ownSheets: /^(\d{4}_.*|\d{4}기준_재고|쿠팡 택배쉽먼트)$/,
    opt: { checkSheet: false },
    ruleList: [
      R('작업 엑셀(📂 ⭐ 스타인터내셔널 작업 ROW) = 정산 기준 — 작업 하나 = 거래명세표 한 묶음(날짜·줄) + 그 엑셀 내용 시트 하나 (시트 이름 = 파일 이름)'),
      R('입고 = 입고검수 검수수량 × 100 + 사이즈컬러조사 품목(바코드 SKU) 수 × 1,000 · 날짜 = STAR 재고관리에 입고된 날'),
      R('쿠팡출고 = 쿠팡출고 수량 × 450 + 쿠팡출고적재비 파렛트 × 8,000 + 밀크런파렛트 × 3,000 + 바코드 덧방 수량 × 120 (쿠팡출고엔 덧방이 같이) · 날짜 = 파일 이름 MMDD'),
      R('파렛트 = 입출고 화물관리 그날 스타 밀크런 출고 — 없으면 파일 이름 「N파렛트」, 다르면 특이사항(노란 칸) · 택배쉽먼트는 파렛트 줄 없음'),
      R('본사이관 등 재고출고 = 이관출고박스수(박스바코드 종류) × 1,000 (노란 칸)'),
      { d: '2026-10-05', t: '택배쉽먼트(파일 이름 「택배쉽먼트 N박스」) = 쿠팡출고 수량·덧방 + 박스 수를 <택배쉽먼트> 택배발송(중) 3,500 으로 (파렛트 줄 없음)' },
      { d: '2026-10-05', t: '컨테이너 입고는 까대기 문구가 없어도(「40피트 파렛트 입고>>파렛트 재적재」 등) 20피트 200,000 · 40피트 400,000' },
      { d: '2026-10-05', t: '비닐포장 = 장당 300 (수량 = 파일 이름 「N장·N개 비닐포장」)' },
      { d: '2026-10-05', t: '긴급작업(파일 이름 「긴급」) = 4인 작업비 1인당 100,000 추가 → 400,000 (인원 수량은 노란 칸 — 다르면 수정)' },
      R('엑셀 없는 STAR 입고가 엑셀 있는 출고로 나갔으면 = 실제 입고 작업 → STAR 기록으로 입고검수·사이즈컬러조사(노란 칸) + 시트 · 바코드·수량 똑같은 입고→출고(재고제로화 등) = 임의 변동, 정산 안 함'),
      R('컨테이너 까대기 = 대표님 기록(달마다 대화창으로 받아 CONT 에 넣음, 무슨 물건·AG·작업 엑셀 함께)이 우선 · 화물관리와 크로스 체크해 한쪽에만 있으면 특이사항 · 대표님 기록이 없는 달은 화물관리 스타 입고 중 20피트·40피트·컨테이너 메모 → 20피트 200,000 · 40피트 400,000'),
      R('공간비 = 지난달 그대로 · 용차비 = 화물 청구서 스타인터내셔널 건(용차비 시트 합계)'),
      R('말일 재고 시트 = STAR 재고관리 말일 마감 재고 (바코드별, 박스·품명·브랜드·품번·컬러·사이즈·원산지·불량)')
    ],
    afterBuild: after
  };
})();
