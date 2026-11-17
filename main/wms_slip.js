/* ═══════════════════════════════════════════════════════════
   📷 전표 촬영 관문 (창고관리 wms.html · 음성명령 wms_voice.html · 입출고관리 wms_inout.html 공통)
   · 입출고관리에서 「전표촬영 유」로 등록한 입고 파렛트(inQ 항목)는 slipNeed:true, rec:기록id 를 갖는다.
   · 적치하려 하면 WMSSlip.ask() 가 「전표사진을 촬영해주세요」 창을 띄우고,
     사진을 줄여서 Storage inout_slip/{창고id}/{기록id}/ 에 올린 뒤
     inoutRecs/{창고id}/{기록id}/slips 에 남긴다. 성공하면 true 로 끝난다(호출한 쪽이 적치를 이어 감).
   · 같은 기록(품목 줄)의 다른 파렛트 slipNeed 를 끄는 건 호출한 쪽이 한다(각 페이지 저장 방식이 달라서).
   Firebase v8(namespaced) · v10 compat 모두에서 동작 (firebase.storage() 전역 사용)
   ═══════════════════════════════════════════════════════════ */
(function(){
  function need(item){ return !!(item && item.slipNeed===true && item.rec); }

  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }

  /* 사진 줄이기 — 긴 변 1600px JPEG */
  function shrink(file){
    return new Promise(function(res,rej){
      var url=URL.createObjectURL(file), img=new Image();
      img.onload=function(){
        var M=1600, w=img.naturalWidth, h=img.naturalHeight, r=Math.min(1, M/Math.max(w,h));
        var c=document.createElement('canvas'); c.width=Math.round(w*r); c.height=Math.round(h*r);
        c.getContext('2d').drawImage(img,0,0,c.width,c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function(b){ b?res(b):rej(new Error('사진 변환 실패')); },'image/jpeg',0.8);
      };
      img.onerror=function(){ URL.revokeObjectURL(url); rej(new Error('사진을 읽지 못했어요')); };
      img.src=url;
    });
  }

  /* 사진 한 장 올리고 기록에 남김 → {url,path,t,by} */
  function upload(db, wid, rec, file, by){
    if(typeof firebase==='undefined'||!firebase.storage) return Promise.reject(new Error('사진 저장소 모듈이 없어요'));
    return shrink(file).then(function(blob){
      var t=Date.now(), path='inout_slip/'+wid+'/'+rec+'/'+t+'.jpg';
      var ref=firebase.storage().ref(path);
      return ref.put(blob,{contentType:'image/jpeg'}).then(function(){ return ref.getDownloadURL(); }).then(function(url){
        var s={url:url, path:path, t:t, by:by||''};
        var k=db.ref('inoutRecs/'+wid+'/'+rec+'/slips').push().key;
        var u={}; u['slips/'+k]=s; u.slipDone=true; u.slipAt=t;
        return db.ref('inoutRecs/'+wid+'/'+rec).update(u).then(function(){ return s; });
      });
    });
  }

  /* 파일 고르기(폰은 카메라 바로) — 사용자 터치 안에서 불러야 열린다 */
  function pickFile(){
    return new Promise(function(res){
      var inp=document.createElement('input'); inp.type='file'; inp.accept='image/*'; inp.setAttribute('capture','environment');
      inp.style.cssText='position:fixed;left:-9999px;top:0;';
      document.body.appendChild(inp);
      var done=false; function fin(f){ if(done)return; done=true; if(inp.parentNode) inp.parentNode.removeChild(inp); res(f||null); }
      inp.onchange=function(){ fin(inp.files&&inp.files[0]); };
      /* 취소하면 change 가 안 오는 브라우저가 있어 창 포커스로 마무리 */
      window.addEventListener('focus',function onF(){ window.removeEventListener('focus',onF); setTimeout(function(){ if(!inp.files||!inp.files.length) fin(null); },1200); });
      inp.click();
    });
  }

  /* 「전표사진을 촬영해주세요」 창 — 올리면 true, 닫으면 false */
  function ask(o){
    o=o||{};
    var item=o.item||{}, db=o.db, wid=o.wid, rec=o.rec||item.rec;
    return new Promise(function(resolve){
      var ov=document.createElement('div');
      ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:100000;display:flex;align-items:center;justify-content:center;padding:18px;font-family:system-ui,-apple-system,"Malgun Gothic",sans-serif;';
      ov.innerHTML=
        '<div style="background:#141E33;border:2px solid #F59E0B;border-radius:16px;width:100%;max-width:360px;padding:22px 18px;text-align:center;color:#E8EEF7;box-shadow:0 20px 60px rgba(0,0,0,.6)">'
        +'<div style="font-size:40px;line-height:1;margin-bottom:8px">📷</div>'
        +'<div style="font-size:18px;font-weight:800;color:#FBBF24;margin-bottom:6px">전표사진을 촬영해주세요</div>'
        +'<div style="font-size:13px;color:#CBD5E1;margin-bottom:4px">'+esc(item.name||'')+(item.exp?' · '+esc(item.exp):'')+'</div>'
        +'<div style="font-size:12px;color:#8597B0;margin-bottom:16px">전표 촬영이 필요한 입고입니다.<br>사진을 등록하면 바로 적치가 진행됩니다.</div>'
        +'<div data-st style="font-size:12px;min-height:16px;margin-bottom:10px;color:#8597B0"></div>'
        +'<button data-go style="width:100%;background:#F59E0B;color:#111827;border:none;border-radius:10px;padding:14px;font-size:16px;font-weight:800;cursor:pointer;margin-bottom:8px">📷 전표 촬영</button>'
        +'<button data-x style="width:100%;background:rgba(255,255,255,.06);color:#8597B0;border:1px solid #26344F;border-radius:10px;padding:11px;font-size:13px;font-weight:700;cursor:pointer">나중에 (적치 안 함)</button>'
        +'</div>';
      document.body.appendChild(ov);
      var st=ov.querySelector('[data-st]'), go=ov.querySelector('[data-go]'), x=ov.querySelector('[data-x]'), busy=false;
      function close(v){ if(ov.parentNode) ov.parentNode.removeChild(ov); resolve(v); }
      x.onclick=function(){ if(!busy) close(false); };
      go.onclick=function(){
        if(busy) return;
        pickFile().then(function(f){
          if(!f){ st.textContent='사진이 선택되지 않았어요.'; return; }
          busy=true; go.disabled=true; go.style.opacity='.6'; st.style.color='#8597B0'; st.textContent='사진 올리는 중…';
          upload(db, wid, rec, f, o.by).then(function(){
            st.style.color='#34D399'; st.textContent='✅ 전표 등록 완료 — 적치합니다';
            setTimeout(function(){ close(true); },500);
          }).catch(function(e){
            busy=false; go.disabled=false; go.style.opacity='1';
            st.style.color='#F87171'; st.textContent='올리기 실패: '+((e&&e.message)||e);
          });
        });
      };
    });
  }

  window.WMSSlip={need:need, ask:ask, upload:upload, pickFile:pickFile};
})();
