/* ============================================================
   WMS Vendor Projection — 업체별 재고 현황 요약본 생성기

   창고 원본(warehouses)은 그룹 멤버만 읽을 수 있으므로, 업체 담당자가
   직접 읽을 수 없다. 대신 창고앱(wms.html)이 멤버/관리자 권한으로
   현재 재고를 집계해 업체별로 분리한 요약본을 vendorStatus 에 써준다.
   업체 담당자는 vendor_status.html 에서 자기 업체 요약본만 읽는다.

   요약본에는 상품명·총수량·파렛트수만 담는다(유통기한·위치·타업체 제외).

   사용:
     WMSVendorProjection.sync(gid, whs, fbDb);  // whs 변경 시 호출 (디바운스됨)

   경로: vendorStatus/{gid}/{vendorId}/products/{productKey} = {name,totalQty,pallets}
         vendorStatus/{gid}/{vendorId}/updatedAt = ts
============================================================ */
(function(){
  'use strict';
  var timer=null;

  /* wms_vendors.html 의 keyOf 와 동일해야 함 (상품명 → 안전키) */
  function keyOf(name){ return String(name).replace(/[.#$/\[\]]/g,'_'); }

  /* 모든 창고 slots 합산 → {상품명:{totalQty,pallets,breakdown:[{qty,pallets}]}}
     breakdown = 파렛트당 적재수량별 분포 (적재구성이 다른 경우 세부내역용) */
  function aggregate(whs){
    var tmp={};
    (whs||[]).forEach(function(wh){
      if(!wh||!wh.cells) return;
      Object.keys(wh.cells).forEach(function(ck){
        var c=wh.cells[ck]; if(!c||!c.slots) return;
        Object.keys(c.slots).forEach(function(sk){
          var s=c.slots[sk]; if(!s||!s.name) return;
          var t=tmp[s.name]||(tmp[s.name]={totalQty:0,pallets:0,byQty:{}});
          var q=(+s.qty||0);
          t.totalQty += q;
          t.pallets  += 1;
          t.byQty[q] = (t.byQty[q]||0) + 1;
        });
      });
    });
    var out={};
    Object.keys(tmp).forEach(function(n){
      var t=tmp[n];
      var bd=Object.keys(t.byQty).map(function(q){ return { qty:+q, pallets:t.byQty[q] }; })
        .sort(function(a,b){ return b.qty - a.qty; });
      out[n]={ totalQty:t.totalQty, pallets:t.pallets, breakdown:bd };
    });
    return out;
  }

  function run(gid, whs, db){
    Promise.all([
      db.ref('vendorConfig/'+gid+'/map').get(),
      db.ref('vendorConfig/'+gid+'/vendors').get()
    ]).then(function(res){
      var map     = (res[0] && res[0].val()) || {};
      var vendors = (res[1] && res[1].val()) || {};
      var vids = Object.keys(vendors);
      if(vids.length===0) return;   /* 업체 없음 — 쓸 것 없음 */

      var agg = aggregate(whs);
      var byV = {}; vids.forEach(function(v){ byV[v]={}; });

      Object.keys(agg).forEach(function(name){
        var e = map[keyOf(name)];
        if(!e || !e.vendorId || !byV[e.vendorId]) return;   /* 미연결·삭제업체 skip */
        var a = agg[name];
        byV[e.vendorId][keyOf(name)] = { name:name, totalQty:a.totalQty, pallets:a.pallets, breakdown:a.breakdown };
      });

      var updates={}, now=Date.now();
      vids.forEach(function(v){
        var prods = byV[v];
        updates['vendorStatus/'+gid+'/'+v+'/products']  = Object.keys(prods).length ? prods : null;
        updates['vendorStatus/'+gid+'/'+v+'/updatedAt'] = now;
      });
      db.ref().update(updates).catch(function(e){ console.warn('[VendorProjection] 쓰기 실패', e); });
    }).catch(function(e){ console.warn('[VendorProjection] 설정 읽기 실패', e); });
  }

  function sync(gid, whs, db){
    if(!gid || !db) return;
    if(timer) clearTimeout(timer);
    timer = setTimeout(function(){ timer=null; run(gid, whs, db); }, 2000);
  }

  /* 관리자 미리보기(vendor_status.html)에서 재사용 — 창고 원본으로 즉시 계산 */
  window.WMSVendorProjection = { sync: sync, aggregate: aggregate, keyOf: keyOf };
})();
