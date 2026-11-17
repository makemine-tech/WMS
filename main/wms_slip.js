/* ═══════════════════════════════════════════════════════════
   📷 전표 촬영 관문 (창고관리 wms.html · 음성명령 wms_voice.html · 입출고관리 wms_inout.html 공통)
   · 입출고관리에서 「전표촬영 유」로 등록한 입고 파렛트(inQ 항목)는 slipNeed:true, rec:기록id 를 갖는다.
   · 적치하려 하면 WMSSlip.ask() 가 「전표사진을 촬영해주세요」 창을 띄운다.
     전표가 여러 장일 수 있어 촬영 → [📷 추가 촬영] 을 몇 번이고 하고, [✅ 촬영 완료 · 적치] 를 누르면 true 로 끝난다.
     사진은 긴 변 1600px 로 줄여 Storage inout_slip/{창고id}/{기록id}/ 에 올리고 inoutRecs/{창고id}/{기록id}/slips 에 남긴다.
     이미 찍어 둔 사진이 있으면(입출고관리 목록에서 미리 촬영) 바로 [완료] 를 누를 수 있다.
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
  var _seq=0;
  function upload(db, wid, rec, file, by){
    if(typeof firebase==='undefined'||!firebase.storage) return Promise.reject(new Error('사진 저장소 모듈이 없어요'));
    return shrink(file).then(function(blob){
      var t=Date.now(), path='inout_slip/'+wid+'/'+rec+'/'+t+'_'+(++_seq)+'.jpg';
      var ref=firebase.storage().ref(path);
      return ref.put(blob,{contentType:'image/jpeg'}).then(function(){ return ref.getDownloadURL(); }).then(function(url){
        var s={url:url, path:path, t:t, by:by||''};
        var k=db.ref('inoutRecs/'+wid+'/'+rec+'/slips').push().key;
        var u={}; u['slips/'+k]=s; u.slipDone=true; u.slipAt=t;
        return db.ref('inoutRecs/'+wid+'/'+rec).update(u).then(function(){ return s; });
      });
    });
  }
  /* 여러 장 차례로 올리기 → 올린 것 배열 */
  function uploadAll(db, wid, rec, files, by, onEach){
    var out=[], i=0;
    function next(){
      if(i>=files.length) return Promise.resolve(out);
      var f=files[i++];
      return upload(db,wid,rec,f,by).then(function(s){ out.push(s); if(onEach) onEach(s,out.length,files.length); return next(); });
    }
    return next();
  }

  /* 파일 고르기(폰은 카메라 바로) — 사용자 터치 안에서 불러야 열린다. multi=true 면 여러 장(사진첩) 허용 */
  function pickFiles(multi){
    return new Promise(function(res){
      var inp=document.createElement('input'); inp.type='file'; inp.accept='image/*';
      if(multi) inp.multiple=true; else inp.setAttribute('capture','environment');
      inp.style.cssText='position:fixed;left:-9999px;top:0;';
      document.body.appendChild(inp);
      var done=false; function fin(fs){ if(done)return; done=true; if(inp.parentNode) inp.parentNode.removeChild(inp); res(fs||[]); }
      inp.onchange=function(){ fin(inp.files?[].slice.call(inp.files):[]); };
      /* 취소하면 change 가 안 오는 브라우저가 있어 창 포커스로 마무리 */
      window.addEventListener('focus',function onF(){ window.removeEventListener('focus',onF); setTimeout(function(){ if(!inp.files||!inp.files.length) fin([]); },1200); });
      inp.click();
    });
  }
  function pickFile(){ return pickFiles(false).then(function(a){ return a[0]||null; }); }

  /* 「전표사진을 촬영해주세요」 창 — 찍고, 더 찍고, [완료] 면 true / 닫으면 false */
  function ask(o){
    o=o||{};
    var item=o.item||{}, db=o.db, wid=o.wid, rec=o.rec||item.rec;
    return new Promise(function(resolve){
      var ov=document.createElement('div');
      ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:100000;display:flex;align-items:center;justify-content:center;padding:18px;font-family:system-ui,-apple-system,"Malgun Gothic",sans-serif;';
      ov.innerHTML=
        '<div style="background:#141E33;border:2px solid #F59E0B;border-radius:16px;width:100%;max-width:380px;max-height:92vh;overflow:auto;padding:20px 16px;text-align:center;color:#E8EEF7;box-shadow:0 20px 60px rgba(0,0,0,.6)">'
        +'<div style="font-size:38px;line-height:1;margin-bottom:8px">📷</div>'
        +'<div style="font-size:18px;font-weight:800;color:#FBBF24;margin-bottom:6px">전표사진을 촬영해주세요</div>'
        +'<div style="font-size:13px;color:#CBD5E1;margin-bottom:4px">'+esc(item.name||'')+(item.exp?' · '+esc(item.exp):'')+'</div>'
        +'<div style="font-size:12px;color:#8597B0;margin-bottom:12px">전표가 여러 장이면 [추가 촬영]으로 모두 찍고<br>[촬영 완료]를 누르면 적치가 진행됩니다.</div>'
        +'<div data-th style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-bottom:8px"></div>'
        +'<div data-st style="font-size:12px;min-height:16px;margin-bottom:10px;color:#8597B0"></div>'
        +'<button data-go style="width:100%;background:#F59E0B;color:#111827;border:none;border-radius:10px;padding:14px;font-size:16px;font-weight:800;cursor:pointer;margin-bottom:8px">📷 전표 촬영</button>'
        +'<button data-al style="width:100%;background:rgba(245,158,11,.1);color:#FBBF24;border:1px solid rgba(245,158,11,.4);border-radius:10px;padding:10px;font-size:13px;font-weight:700;cursor:pointer;margin-bottom:8px">🖼 사진첩에서 여러 장 고르기</button>'
        +'<button data-ok style="width:100%;background:#059669;color:#fff;border:none;border-radius:10px;padding:14px;font-size:16px;font-weight:800;cursor:pointer;margin-bottom:8px;display:none">✅ 촬영 완료 · 적치</button>'
        +'<button data-x style="width:100%;background:rgba(255,255,255,.06);color:#8597B0;border:1px solid #26344F;border-radius:10px;padding:11px;font-size:13px;font-weight:700;cursor:pointer">나중에 (적치 안 함)</button>'
        +'</div>';
      document.body.appendChild(ov);
      var st=ov.querySelector('[data-st]'), th=ov.querySelector('[data-th]'), go=ov.querySelector('[data-go]'), al=ov.querySelector('[data-al]'),
          okb=ov.querySelector('[data-ok]'), x=ov.querySelector('[data-x]'), busy=false, have=0;
      function paint(){
        okb.style.display=have>0?'block':'none';
        go.textContent=have>0?'📷 추가 촬영':'📷 전표 촬영';
        if(have>0&&!busy){ st.style.color='#34D399'; st.textContent='✅ 전표 '+have+'장 등록됨 — 더 있으면 추가 촬영'; }
      }
      function thumb(url){ var im=document.createElement('img'); im.src=url; im.style.cssText='width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid #26344F'; th.appendChild(im); }
      /* 미리 찍어 둔 사진(입출고관리 목록에서 촬영)도 보여 주고 바로 완료 가능 */
      try{
        db.ref('inoutRecs/'+wid+'/'+rec+'/slips').get().then(function(s){
          var v=s.val()||{}; Object.keys(v).forEach(function(k){ if(v[k]&&v[k].url){ have++; thumb(v[k].url); } }); paint();
        }).catch(function(){});
      }catch(e){}
      function close(v){ if(ov.parentNode) ov.parentNode.removeChild(ov); resolve(v); }
      x.onclick=function(){ if(!busy) close(false); };
      okb.onclick=function(){ if(!busy&&have>0) close(true); };
      function take(multi){
        if(busy) return;
        pickFiles(multi).then(function(fs){
          if(!fs.length){ if(!have){ st.style.color='#8597B0'; st.textContent='사진이 선택되지 않았어요.'; } return; }
          busy=true; [go,al,okb].forEach(function(b){ b.disabled=true; b.style.opacity='.6'; });
          st.style.color='#8597B0'; st.textContent='사진 올리는 중… (0/'+fs.length+')';
          uploadAll(db, wid, rec, fs, o.by, function(s,n,tot){ have++; thumb(s.url); st.textContent='사진 올리는 중… ('+n+'/'+tot+')'; }).then(function(){
            busy=false; [go,al,okb].forEach(function(b){ b.disabled=false; b.style.opacity='1'; }); paint();
          }).catch(function(e){
            busy=false; [go,al,okb].forEach(function(b){ b.disabled=false; b.style.opacity='1'; }); paint();
            st.style.color='#F87171'; st.textContent='올리기 실패: '+((e&&e.message)||e);
          });
        });
      }
      go.onclick=function(){ take(false); };
      al.onclick=function(){ take(true); };
    });
  }

  window.WMSSlip={need:need, ask:ask, upload:upload, uploadAll:uploadAll, pickFile:pickFile, pickFiles:pickFiles};
})();
