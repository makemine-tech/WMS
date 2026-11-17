/* ═══════════════════════════════════════════════════════════
   👤 아이디별 권한 — 관리도구(wms_admin.html) 세 번째 탭
   · 아이디 목록 = wmsUsers(로그인 때 wms_access.js 가 남김) + userGroup + superadmins 를 합친 것
   · 등급 = 슈퍼관리자(superadmins) / 관리자(userGroup=메인 그룹) / 초대(userGroup=다른 그룹) / 일반(그룹 없음)
     → 등급을 바꾸면 userGroup 을 바꾼다 (슈퍼관리자 지정은 Firebase 콘솔에서만)
   · 메뉴별 체크 = userAccess/{uid}/{pageKey} : true 허용 / false 막음 / 없음 = 등급대로
     (wms_access.js 게이트가 페이지 열 때 읽음)
   wms_admin.html 의 전역(db, LEVELS, LV_NAME, REGISTRY, effective, findItem, esc, toast)을 쓴다.
   ═══════════════════════════════════════════════════════════ */
(function(){
  var MAIN_GID='makechango';
  var D=null;          /* {users:{uid:{...}}, groups:[gid], access:{uid:{key:bool}}} */
  var FLT='all', Q='';
  var OPEN=null;       /* 펼친 uid */
  var CSS_DONE=false;

  function css(){
    if(CSS_DONE) return; CSS_DONE=true;
    var st=document.createElement('style');
    st.textContent=
      '.uflt{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;}'
      +'.uflt button{background:rgba(255,255,255,.04);color:#94A3B8;border:1px solid #334155;border-radius:20px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;}'
      +'.uflt button.on{color:#fff;border-color:#3B82F6;background:rgba(59,130,246,.18);}'
      +'.urow{display:flex;align-items:center;gap:10px;padding:10px 12px;background:rgba(255,255,255,.03);border:1px solid #334155;border-radius:10px;margin-bottom:7px;cursor:pointer;flex-wrap:wrap;}'
      +'.urow:hover{border-color:#3B82F6;}'
      +'.urow.open{border-color:#3B82F6;background:rgba(59,130,246,.08);border-radius:10px 10px 0 0;margin-bottom:0;}'
      +'.urow img,.urow .av{width:30px;height:30px;border-radius:50%;flex-shrink:0;background:#334155;display:flex;align-items:center;justify-content:center;font-size:14px;}'
      +'.urow .um{flex:1;min-width:160px;}'
      +'.urow .ue{font-size:13px;font-weight:700;word-break:break-all;}'
      +'.urow .us{font-size:11px;color:#64748B;margin-top:1px;}'
      +'.ovc{font-size:10px;font-weight:800;padding:2px 7px;border-radius:6px;background:rgba(245,158,11,.14);color:#FBBF24;border:1px solid rgba(245,158,11,.35);}'
      +'.udet{border:1px solid #3B82F6;border-top:none;border-radius:0 0 10px 10px;padding:12px;margin-bottom:10px;background:rgba(15,23,42,.6);}'
      +'.udet h4{font-size:12px;font-weight:800;color:#94A3B8;margin:4px 0 8px;}'
      +'.lvsel{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:12px;}'
      +'.lvsel button{background:rgba(255,255,255,.04);color:#CBD5E1;border:1px solid #334155;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;}'
      +'.lvsel button.on.l3{background:#0891B2;border-color:#0891B2;color:#fff;}'
      +'.lvsel button.on.l2{background:#7C3AED;border-color:#7C3AED;color:#fff;}'
      +'.lvsel button.on.l1{background:#2563EB;border-color:#2563EB;color:#fff;}'
      +'.lvsel select{background:#0B1220;color:#E2E8F0;border:1px solid #334155;border-radius:8px;padding:7px 8px;font-size:12px;font-family:inherit;}'
      +'.mtbl{border:1px solid #334155;border-radius:8px;overflow:hidden;}'
      +'.mg{background:#1E293B;padding:8px 12px;font-size:12px;font-weight:800;display:flex;align-items:center;gap:8px;border-top:1px solid #334155;}'
      +'.mg:first-child{border-top:none;}'
      +'.mi{display:flex;align-items:center;gap:8px;padding:7px 12px 7px 14px;border-top:1px solid #1E293B;font-size:13px;flex-wrap:wrap;}'
      +'.mi.sub{padding-left:30px;}'
      +'.mi label{display:flex;align-items:center;gap:8px;cursor:pointer;flex:1;min-width:160px;}'
      +'.mi input,.mg input{width:17px;height:17px;accent-color:#3B82F6;cursor:pointer;}'
      +'.mi input:disabled{cursor:not-allowed;opacity:.5;}'
      +'.req{font-size:10px;font-weight:700;color:#64748B;}'
      +'.ovt{font-size:10px;font-weight:800;border-radius:5px;padding:1px 6px;}'
      +'.ovt.y{background:rgba(16,185,129,.15);color:#34D399;}'
      +'.ovt.n{background:rgba(239,68,68,.15);color:#F87171;}'
      +'.fw{font-size:10px;color:#FBBF24;}'
      +'.uact{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;}';
    document.head.appendChild(st);
  }

  function lvOfUser(u){ return u.super?4:(u.gid===MAIN_GID?3:(u.gid?2:1)); }
  function lvName(l){ return ['비회원','일반','초대','관리자','슈퍼관리자'][l]; }
  function when(t){ if(!t) return '접속 기록 없음'; var d=new Date(t), p=function(n){return (n<10?'0':'')+n;}; return '최근 '+d.getFullYear()+'.'+p(d.getMonth()+1)+'.'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes()); }

  function load(){
    var box=document.getElementById('viewUsers');
    box.innerHTML='<div class="mini">불러오는 중…</div>';
    return Promise.all([
      db.ref('wmsUsers').get().catch(function(e){ return {val:function(){return null;},_e:e}; }),
      db.ref('userGroup').get().catch(function(e){ return {val:function(){return null;},_e:e}; }),
      db.ref('superadmins').get().catch(function(){ return {val:function(){return null;}}; }),
      db.ref('userAccess').get().catch(function(){ return {val:function(){return null;}}; }),
      db.ref('groups').get().catch(function(){ return {val:function(){return null;}}; })
    ]).then(function(r){
      var wu=r[0].val()||{}, ug=r[1].val()||{}, sa=r[2].val()||{}, ua=r[3].val()||{}, gs=r[4].val()||{};
      var users={};
      function u(uid){ return users[uid]||(users[uid]={uid:uid}); }
      Object.keys(wu).forEach(function(uid){ var x=wu[uid]||{}; var o=u(uid); o.email=x.email||''; o.name=x.name||''; o.photo=x.photo||''; o.last=x.last||0; });
      Object.keys(ug).forEach(function(uid){ u(uid).gid=ug[uid]; });
      Object.keys(sa).forEach(function(uid){ var o=u(uid); o.super=true; if(sa[uid]&&typeof sa[uid]==='object'&&!o.email) o.email=sa[uid].email||''; });
      D={users:users, groups:Object.keys(gs).sort(), access:ua, warn:(r[0]._e||r[1]._e)?('목록 일부를 못 읽었어요(보안 규칙 배포 전일 수 있음): '+((r[0]._e||r[1]._e).message||'')):''};
      render();
    });
  }

  function list(){
    var arr=Object.keys(D.users).map(function(k){ return D.users[k]; });
    arr.forEach(function(x){ x.lv=lvOfUser(x); x.nov=Object.keys(D.access[x.uid]||{}).length; });
    return arr.sort(function(a,b){ return (b.lv-a.lv)||((b.last||0)-(a.last||0))||String(a.email).localeCompare(String(b.email)); });
  }

  function render(){
    css();
    var box=document.getElementById('viewUsers'); if(!box||!D) return;
    var all=list(), cnt={all:all.length,4:0,3:0,2:0,1:0};
    all.forEach(function(x){ cnt[x.lv]++; });
    var shown=all.filter(function(x){
      if(FLT!=='all' && String(x.lv)!==FLT) return false;
      if(Q){ var h=(x.email+' '+x.name+' '+(x.gid||'')+' '+x.uid).toLowerCase(); if(h.indexOf(Q)<0) return false; }
      return true;
    });
    var h='<div class="note-box">👤 <b>아이디별 권한</b><br>'
      +'· 등급은 <b>슈퍼관리자 › 관리자(메인 그룹 직원) › 초대(업체 그룹) › 일반(로그인만)</b> 순서입니다.<br>'
      +'· 아이디를 누르면 등급을 바꾸고, 메뉴마다 체크해서 <b>그 아이디만</b> 열거나 막을 수 있어요. 체크를 기본과 다르게 바꾼 메뉴엔 <span class="ovt y">개별 허용</span> <span class="ovt n">개별 막음</span> 표시가 붙습니다.<br>'
      +'· 목록에는 한 번이라도 로그인한 아이디가 나옵니다(새 사람은 처음 로그인한 뒤부터).</div>'
      +(D.warn?'<div class="warn-box">'+esc(D.warn)+'</div>':'')
      +'<div class="uflt">'
        +[['all','전체'],['4','슈퍼관리자'],['3','관리자'],['2','초대'],['1','일반']].map(function(f){ return '<button class="'+(FLT===f[0]?'on':'')+'" onclick="WAU.flt(\''+f[0]+'\')">'+f[1]+' '+cnt[f[0]]+'</button>'; }).join('')
        +'<button onclick="WAU.reload()" title="다시 불러오기">↻</button>'
      +'</div>'
      +'<input class="search" type="search" placeholder="🔍 이메일 · 이름 · 그룹 검색" value="'+esc(Q)+'" oninput="WAU.q(this.value)" id="wauQ"/>'
      +'<div id="wauList">'+shown.map(rowHtml).join('')+(shown.length?'':'<div class="mini">해당하는 아이디가 없어요.</div>')+'</div>';
    box.innerHTML=h;
  }
  function rowHtml(x){
    var av=x.photo?'<img src="'+esc(x.photo)+'" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'">':'<div class="av">👤</div>';
    var o=OPEN===x.uid;
    return '<div class="urow'+(o?' open':'')+'" onclick="WAU.toggle(\''+x.uid+'\')">'+av
      +'<div class="um"><div class="ue">'+esc(x.email||x.name||x.uid)+'</div>'
      +'<div class="us">'+esc(x.name||'')+(x.gid?' · 그룹 '+esc(x.gid):'')+' · '+when(x.last)+'</div></div>'
      +(x.nov?'<span class="ovc">개별 권한 '+x.nov+'</span>':'')
      +'<span class="lvb lv'+x.lv+'">'+lvName(x.lv)+'</span>'
      +'</div>'+(o?detHtml(x):'');
  }

  /* 이 아이디가 이 페이지를 볼 수 있나 — 개별 권한 우선 */
  function allowed(x, it){
    var req=effective(it), ov=(D.access[x.uid]||{})[it.key];
    if(x.lv>=4) return {ok:true, ov:null, req:req, pub:req<=0};
    if(req<=0) return {ok:true, ov:null, req:req, pub:true};
    if(ov===true||ov===false) return {ok:ov, ov:ov, req:req};
    return {ok:x.lv>=req, ov:null, req:req};
  }

  function detHtml(x){
    var sup=x.lv>=4;
    var h='<div class="udet" onclick="event.stopPropagation()">';
    h+='<div class="mini" style="margin-bottom:8px">uid <code style="color:#7DD3FC">'+esc(x.uid)+'</code></div>';
    h+='<h4>등급</h4>';
    if(sup){
      h+='<div class="mini" style="margin-bottom:12px">🛡️ 슈퍼관리자 — 모든 메뉴가 열려 있어요. 슈퍼관리자 지정·해제는 Firebase 콘솔에서만 할 수 있습니다.</div>';
    }else{
      var others=D.groups.filter(function(g){ return g!==MAIN_GID; });
      var gsel='<select id="wauG" onclick="event.stopPropagation()">'+others.map(function(g){ return '<option value="'+esc(g)+'"'+(x.gid===g?' selected':'')+'>'+esc(g)+'</option>'; }).join('')+'</select>';
      h+='<div class="lvsel">'
        +'<button class="l3'+(x.lv===3?' on':'')+'" onclick="WAU.setLv(\''+x.uid+'\',3)">관리자 (메인 그룹)</button>'
        +'<button class="l2'+(x.lv===2?' on':'')+'" onclick="WAU.setLv(\''+x.uid+'\',2)">초대 (업체 그룹)</button>'+(others.length?gsel:'<span class="mini">다른 그룹 없음</span>')
        +'<button class="l1'+(x.lv===1?' on':'')+'" onclick="WAU.setLv(\''+x.uid+'\',1)">일반 (그룹 없음)</button>'
      +'</div>';
    }
    h+='<h4>메뉴권한 <span class="mini" style="font-weight:600">— 체크 = 열림</span></h4><div class="mtbl">';
    REGISTRY.forEach(function(g, gi){
      var its=g.items.filter(function(it){ return !it.locked; });
      if(!its.length) return;
      var st=its.map(function(it){ return allowed(x,it); });
      var allOn=st.every(function(a){ return a.ok; }), someOn=st.some(function(a){ return a.ok; });
      var editable=its.some(function(it,i){ return !st[i].pub; });
      h+='<div class="mg"><input type="checkbox"'+(allOn?' checked':'')+(sup||!editable?' disabled':'')+' data-ind="'+(someOn&&!allOn?1:0)+'" onclick="WAU.grp(\''+x.uid+'\','+gi+',this.checked)">'+esc(g.group)+'</div>';
      its.forEach(function(it,i){
        var a=st[i], sub=/^\s*└/.test(it.label);
        var tag=a.ov===true?'<span class="ovt y">개별 허용</span>':(a.ov===false?'<span class="ovt n">개별 막음</span>':'');
        var fw=(a.ov===true&&(it.floor||0)>x.lv)?'<span class="fw">⚠ 데이터 권한이 모자라 화면이 비어 보일 수 있어요</span>':'';
        h+='<div class="mi'+(sub?' sub':'')+'"><label><input type="checkbox"'+(a.ok?' checked':'')+((sup||a.pub)?' disabled':'')
          +' onclick="WAU.set(\''+x.uid+'\',\''+it.key+'\',this.checked)">'+esc(String(it.label).replace(/^[\s└]+/,''))+'</label>'
          +(a.pub?'<span class="req">공개 페이지</span>':'<span class="req">기본 '+LV_NAME[a.req]+'</span>')+tag+fw+'</div>';
      });
    });
    h+='</div>';
    if(!sup) h+='<div class="uact"><button class="btn-sm ghost" onclick="WAU.reset(\''+x.uid+'\')">↺ 개별 권한 모두 지우기 (등급 기본값으로)</button></div>';
    h+='</div>';
    return h;
  }
  function afterRender(){
    document.querySelectorAll('#viewUsers input[data-ind="1"]').forEach(function(el){ el.indeterminate=true; });
  }

  function setOv(uid, key, val){
    var x=D.users[uid]; if(!x) return Promise.resolve();
    var it=findItem(key); if(!it) return Promise.resolve();
    var base=x.lv>=effective(it);            /* 등급대로면 어떻게 되나 */
    var nv=(val===base)?null:val;            /* 기본과 같으면 개별 권한 지움 */
    D.access[uid]=D.access[uid]||{};
    if(nv===null) delete D.access[uid][key]; else D.access[uid][key]=nv;
    return db.ref('userAccess/'+uid+'/'+key).set(nv);
  }

  window.WAU={
    open:function(){ if(!D) load().then(afterRender).catch(function(e){ document.getElementById('viewUsers').innerHTML='<div class="mini" style="color:#F87171">불러오기 실패: '+esc(e.message)+'</div>'; }); else { render(); afterRender(); } },
    reload:function(){ D=null; WAU.open(); },
    flt:function(f){ FLT=f; render(); afterRender(); },
    q:function(v){ Q=String(v||'').trim().toLowerCase(); var c=document.getElementById('wauQ'), pos=c?c.selectionStart:0; render(); afterRender(); var n=document.getElementById('wauQ'); if(n){ n.focus(); try{ n.setSelectionRange(pos,pos); }catch(e){} } },
    toggle:function(uid){ OPEN=(OPEN===uid)?null:uid; render(); afterRender(); },
    set:function(uid,key,val){
      setOv(uid,key,val).then(function(){ toast((val?'✅ 열었어요':'🚫 막았어요')+' · '+key); }).catch(function(e){ toast('저장 실패: '+e.message); })
        .then(function(){ render(); afterRender(); });
    },
    grp:function(uid,gi,val){
      var g=REGISTRY[gi]; if(!g) return;
      var ps=g.items.filter(function(it){ return !it.locked && effective(it)>0; }).map(function(it){ return setOv(uid,it.key,val); });
      Promise.all(ps).then(function(){ toast((val?'✅ 모두 열었어요 · ':'🚫 모두 막았어요 · ')+g.group); }).catch(function(e){ toast('저장 실패: '+e.message); })
        .then(function(){ render(); afterRender(); });
    },
    reset:function(uid){
      var x=D.users[uid]; if(!x) return;
      if(!Object.keys(D.access[uid]||{}).length){ toast('개별 권한이 없어요'); return; }
      if(!confirm((x.email||uid)+'\n개별 권한을 모두 지우고 등급 기본값으로 돌릴까요?')) return;
      db.ref('userAccess/'+uid).remove().then(function(){ D.access[uid]={}; toast('기본값으로 돌렸어요'); render(); afterRender(); }).catch(function(e){ toast('실패: '+e.message); });
    },
    setLv:function(uid,lv){
      var x=D.users[uid]; if(!x||x.super) return;
      var gid=lv===3?MAIN_GID:(lv===2?((document.getElementById('wauG')||{}).value||''):null);
      if(lv===2&&!gid){ toast('업체 그룹을 먼저 만들어 주세요'); return; }
      if(lv===x.lv&&(lv!==2||gid===x.gid)) return;
      var msg=lv===3?'관리자(메인 그룹 makechango)로 바꿀까요?\n메이크창고 직원 권한이 됩니다.':(lv===2?'초대(업체 그룹 '+gid+')로 바꿀까요?\n그 그룹 창고만 보게 됩니다.':'일반(그룹 없음)으로 바꿀까요?\n창고관리에 더는 들어올 수 없게 됩니다.');
      if(!confirm((x.email||uid)+'\n\n'+msg)) return;
      db.ref('userGroup/'+uid).set(gid).then(function(){ x.gid=gid||undefined; toast('등급을 바꿨어요 → '+lvName(lv)); render(); afterRender(); }).catch(function(e){ toast('실패: '+e.message); });
    }
  };
})();
