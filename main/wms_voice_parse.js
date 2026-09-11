/* ============================================================
   WMS 음성 명령 해석기 — 음성 인식 문장 → 동작·상품·유통기한·수량·위치·층

   예) "서리태 십오 이칠공칠공삼 백이십오개 에이 십 3층 입고"
       → {action:'in', product:'서리태15', exp:'270703', qty:125, loc:{col:'A',row:10,lvl:3}}

   - 숫자: 한글(일·이·십·백…) / 영어(원·투·텐·에이틴…, one·ten…) / 아라비아 숫자 혼용
   - 위치: 알파벳(에이·비·씨… 또는 A) + 번호,  층: "층"/"단" 앞 숫자 (1층 = 맨 아래)
   - 상품: 등록된 상품 목록 중 가장 가까운 이름만 (목록 밖 이름은 받지 않음)
   - 유통기한: 6자리(YYMMDD)·8자리, 한 자리씩 읽기(이칠공칠공삼/이칠영칠영삼), "27년 7월 3일"
   - 동작: 입고 / 출고 / 뭐야·확인 / 이동 / 취소
   데이터 쓰기 없음. 브라우저(window.WMSVoice)·node(module.exports) 공용.
============================================================ */
(function(root){
  'use strict';

  var SINO_D={'영':0,'공':0,'빵':0,'일':1,'이':2,'삼':3,'사':4,'오':5,'육':6,'륙':6,'칠':7,'팔':8,'구':9};
  var SINO_U={'십':10,'백':100,'천':1000};
  var ENG_KO={'제로':0,'원':1,'투':2,'쓰리':3,'스리':3,'포':4,'파이브':5,'식스':6,'세븐':7,'에잇':8,'에이트':8,'나인':9,'텐':10,
    '일레븐':11,'트웰브':12,'써틴':13,'서틴':13,'포틴':14,'피프틴':15,'식스틴':16,'세븐틴':17,'에이틴':18,'나인틴':19,
    '트웬티':20,'투엔티':20,'써티':30,'서티':30,'포티':40,'피프티':50};
  var ENG_LAT={zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,
    thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50};
  var LET_KO={'에이':'A','비':'B','씨':'C','시':'C','디':'D','에프':'F','지':'G','쥐':'G','에이치':'H','에치':'H','아이':'I',
    '제이':'J','케이':'K','엘':'L','엠':'M','엔':'N','피':'P','큐':'Q','알':'R','에스':'S','티':'T','유':'U','브이':'V',
    '더블유':'W','엑스':'X','와이':'Y','제트':'Z'};
  var LET_SAY={A:'에이',B:'비',C:'씨',D:'디',E:'이',F:'에프',G:'지',H:'에이치',I:'아이',J:'제이',K:'케이',L:'엘',M:'엠',
    N:'엔',O:'오',P:'피',Q:'큐',R:'알',S:'에스',T:'티',U:'유',V:'브이',W:'더블유',X:'엑스',Y:'와이',Z:'제트'};
  /* 단독으로 말하면 알파벳인지 숫자인지 헷갈리는 소리: "이"=E 또는 2, "오"=O 또는 5 */
  var AMB={'이':{L:'E',n:2},'오':{L:'O',n:5}};
  var ACT={'입고':'in','출고':'out','뭐야':'what','뭐있어':'what','뭐있지':'what','뭐지':'what','뭐':'what','무엇':'what',
    '확인':'what','이동':'move','옮겨':'move','옮기기':'move','취소':'undo','되돌려':'undo','되돌리기':'undo'};
  var MARK={'층':'lvl','단':'lvl','개':'qty','박스':'qty','에서':'from','으로':'to','로':'to'};
  /* 해석에 쓰지 않고 건너뛰는 말 (알파벳·숫자로 잘못 읽히지 않게 긴 말 우선) */
  var IGNORE=['유통기한','유통','기한','까지','수량','위치','상품','제품','번지','번','칸','랙','파렛트','팔레트','에요','이요','요',
    '있어','있지','있나','있니','있는지','들어있어',
    '을','를','은','는','좀','해줘','해','주세요','줘','거','하나'];

  var DICT={}, MAXLEN=1;
  function addD(k,d){ DICT[k]=d; if(k.length>MAXLEN) MAXLEN=k.length; }
  Object.keys(ENG_KO).forEach(function(k){ addD(k,{t:'num',v:ENG_KO[k]}); });
  Object.keys(LET_KO).forEach(function(k){ addD(k,{t:'let',v:LET_KO[k]}); });
  Object.keys(ACT).forEach(function(k){ addD(k,{t:'act',v:ACT[k]}); });
  Object.keys(MARK).forEach(function(k){ addD(k,{t:'mark',v:MARK[k]}); });
  IGNORE.forEach(function(k){ addD(k,{t:'skip'}); });

  /* ── 숫자 도우미 ── */
  function toSino(n){
    if(n===0) return '영';
    var s='', u=[[1000,'천'],[100,'백'],[10,'십']];
    u.forEach(function(p){ var d=Math.floor(n/p[0]); if(d){ s+=(d>1?Object.keys(SINO_D).filter(function(k){return SINO_D[k]===d&&k!=='공'&&k!=='빵'&&k!=='륙';})[0]:'')+p[1]; n-=d*p[0]; } });
    if(n) s+=['','일','이','삼','사','오','육','칠','팔','구'][n];
    return s;
  }
  var DIGIT_KO=['공','일','이','삼','사','오','육','칠','팔','구'];
  function engKo(n){ for(var k in ENG_KO){ if(ENG_KO[k]===n) return k; } return null; }
  function numFromRun(run){
    if(/[십백천]/.test(run)){
      var total=0, cur=0;
      for(var i=0;i<run.length;i++){ var ch=run[i];
        if(SINO_U.hasOwnProperty(ch)){ total+=(cur||1)*SINO_U[ch]; cur=0; } else cur=SINO_D[ch]; }
      total+=cur;
      return {t:'num',v:total,s:String(total)};
    }
    var ds=run.split('').map(function(ch){ return SINO_D[ch]; }).join('');
    return {t:'num',v:parseInt(ds,10),s:ds,dg:true};
  }
  function validYMD(s){
    if(!/^\d{6}$/.test(s)) return false;
    var y=2000+ +s.slice(0,2), m=+s.slice(2,4), d=+s.slice(4,6);
    if(m<1||m>12||d<1) return false;
    return d<=new Date(y,m,0).getDate();
  }
  function colIndex(col){ var c=0; for(var i=0;i<col.length;i++) c=c*26+(col.charCodeAt(i)-64); return c-1; }
  function colName(c){ var s=String.fromCharCode(65+(c%26)); if(c>=26) s=String.fromCharCode(65+Math.floor(c/26)-1)+s; return s; }

  /* ── 문장 정리 ── */
  function prenorm(text){
    var t=String(text||'').toLowerCase();
    /* 27년 7월 3일 / 2027년 7월 3일 → 270703 */
    t=t.replace(/(\d{2,4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g,function(_,y,m,d){ return ' '+y.slice(-2)+('0'+m).slice(-2)+('0'+d).slice(-2)+' '; });
    /* 27.07.03 / 2027-07-03 → 270703 */
    t=t.replace(/(\d{2,4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/g,function(_,y,m,d){ return ' '+y.slice(-2)+('0'+m).slice(-2)+('0'+d).slice(-2)+' '; });
    return t;
  }
  function compactWithMap(t){ var c='', map=[]; for(var i=0;i<t.length;i++){ if(/[\s.,!?~·\-_\/()\[\]'"]/.test(t[i])) continue; c+=t[i]; map.push(i); } return {c:c,map:map}; }
  function compact(s){ return compactWithMap(String(s).toLowerCase()).c; }

  /* ── 상품 찾기: 등록 상품명(숫자는 한글·영어·자리읽기 변형 포함)을 문장에서 찾음 ── */
  function variants(name){
    var b=compact(name), out=[b];
    if(/\d/.test(b)){
      out.push(b.replace(/\d+/g,function(d){ return toSino(parseInt(d,10)); }));
      out.push(b.replace(/\d+/g,function(d){ return d.split('').map(function(x){ return DIGIT_KO[+x]; }).join(''); }));
      out.push(b.replace(/\d+/g,function(d){ var e=engKo(parseInt(d,10)); return e||d; }));
    }
    return out.filter(function(v,i){ return v && out.indexOf(v)===i; });
  }
  function lev(a,b){
    var m=a.length,n=b.length,d=[],i,j; if(!m) return n; if(!n) return m;
    for(i=0;i<=m;i++){ d[i]=[i]; } for(j=1;j<=n;j++) d[0][j]=j;
    for(i=1;i<=m;i++) for(j=1;j<=n;j++) d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
    return d[m][n];
  }
  function findProduct(t, products){
    var cm=compactWithMap(t), c=cm.c, best=null;
    (products||[]).forEach(function(name){
      variants(name).forEach(function(v){
        var at=c.indexOf(v);
        if(at>=0 && (!best || best.fuzzy || v.length>best.len)) best={name:name,start:at,len:v.length,fuzzy:false};
      });
    });
    if(!best) return {product:null, rest:t};
    var arr=t.split('');
    for(var k=best.start;k<best.start+best.len;k++) arr[cm.map[k]]=' ';
    return {product:best.name, fuzzy:false, rest:arr.join('')};
  }
  /* 정확히 못 찾았을 때(음성 인식 오타 1~2글자) — 숫자·알파벳·동작으로 안 읽힌 "남는 글자 묶음"만 상품명과 비교
     → 위치·숫자 부분을 상품으로 잘못 잡지 않음. 찾으면 해당 토큰을 소모 처리 */
  function fuzzyProductFromTokens(tk, products){
    var best=null;
    for(var i=0;i<tk.length;i++){
      if(tk[i].t!=='unk'||!/[가-힣]/.test(tk[i].v)) continue;
      var j=i, u='';
      while(j<tk.length&&tk[j].t==='unk'&&/[가-힣]/.test(tk[j].v)){ u+=tk[j].v; j++; }
      var cands=[{s:u,end:j}];
      if(j<tk.length&&tk[j].t==='num') cands.push({s:u+tk[j].s,end:j+1});
      cands.forEach(function(cd){
        if(cd.s.length<2) return;
        (products||[]).forEach(function(name){
          variants(name).forEach(function(v){
            if(v.length<2) return;
            var tol=v.length>=6?2:1, dd=lev(cd.s,v);
            if(dd<=tol&&dd<v.length&&(!best||dd<best.d||(dd===best.d&&cd.end-i>best.end-best.start))) best={name:name,start:i,end:cd.end,d:dd};
          });
        });
      });
      i=j-1;
    }
    if(!best) return null;
    for(var k=best.start;k<best.end;k++) tk[k]={t:'skip'};
    return best.name;
  }

  /* ── 낱말 → 토큰 ── */
  function tokenize(t){
    t=t.replace(/[.,!?~·\-_\/()\[\]'"]/g,' ')
       .replace(/([가-힣])([0-9a-z])/g,'$1 $2').replace(/([0-9a-z])([가-힣])/g,'$1 $2')
       .replace(/([a-z])(\d)/g,'$1 $2').replace(/(\d)([a-z])/g,'$1 $2');
    var out=[];
    t.split(/\s+/).filter(Boolean).forEach(function(w){
      if(/^\d+$/.test(w)){ out.push({t:'num',v:parseInt(w,10),s:w,dg:true}); return; }
      if(/^[a-z]+$/.test(w)){
        if(ENG_LAT.hasOwnProperty(w)){ out.push({t:'num',v:ENG_LAT[w],s:String(ENG_LAT[w])}); return; }
        if(w.length<=2){ out.push({t:'let',v:w.toUpperCase()}); return; }
        out.push({t:'unk',v:w}); return;
      }
      if(AMB.hasOwnProperty(w)){ out.push({t:'amb',v:w}); return; }
      var i=0, run='';
      function flush(){ if(run){ out.push(numFromRun(run)); run=''; } }
      while(i<w.length){
        var hit=null;
        for(var L=Math.min(MAXLEN,w.length-i);L>=1;L--){ var sub=w.substr(i,L); if(DICT[sub]){ hit={s:sub,d:DICT[sub]}; break; } }
        /* 한 글자 숫자(일·이·삼…)는 사전 단어보다 숫자 이어읽기를 우선 (단, 긴 사전 단어는 우선) */
        var ch=w[i], isNumCh=SINO_D.hasOwnProperty(ch)||SINO_U.hasOwnProperty(ch);
        if(hit && !(isNumCh && hit.s.length===1)){
          flush();
          if(hit.d.t==='num') out.push({t:'num',v:hit.d.v,s:String(hit.d.v)});
          else if(hit.d.t!=='skip') out.push({t:hit.d.t,v:hit.d.v});
          i+=hit.s.length; continue;
        }
        if(isNumCh){ run+=ch; i++; continue; }
        flush(); out.push({t:'unk',v:ch}); i++;
      }
      flush();
    });
    return out;
  }

  /* ── 해석 ── */
  function parse(text, opts){
    opts=opts||{};
    var cols=opts.cols||null;   /* 창고의 실제 열 문자 ['A','B',...] — "이"/"오"가 알파벳인지 판단 */
    var pre=prenorm(text);
    var fp=findProduct(pre, opts.products);
    var tk=tokenize(fp.rest);
    var R={text:String(text||''), action:null, product:fp.product, productFuzzy:false, exp:null, qty:null, loc:null, loc2:null, warn:[], leftovers:[]};
    if(!R.product&&opts.products&&opts.products.length){
      var fz=fuzzyProductFromTokens(tk, opts.products);
      if(fz){ R.product=fz; R.productFuzzy=true; }
    }
    tk=tk.filter(function(x){ return x.t!=='skip'; });

    /* 1) 한 자리 숫자가 띄어서 4개 이상 이어지면 붙임 (유통기한 한 자리씩 읽기). 단독 "이"/"오"도 이 줄 안이면 숫자 */
    function oneDigit(x){ return (x.t==='num'&&x.dg&&x.s.length===1)?x.s:(x.t==='amb'?String(AMB[x.v].n):null); }
    for(var i=0;i<tk.length;i++){
      if(oneDigit(tk[i])==null) continue;
      var j=i, s='';
      while(j<tk.length&&oneDigit(tk[j])!=null){ s+=oneDigit(tk[j]); j++; }
      if(j-i>=4) tk.splice(i,j-i,{t:'num',v:parseInt(s,10),s:s,dg:true});
      else i=j-1;
    }
    /* 2) "이"/"오" 단독 — 알파벳 앞자리면 E/O, 아니면 숫자 */
    tk.forEach(function(x,k){
      if(x.t!=='amb') return;
      var a=AMB[x.v], prev=tk[k-1], next=tk[k+1];
      var letterOk=!cols||cols.indexOf(a.L)>=0;
      if(prev&&prev.t==='let'){ tk[k]={t:'num',v:a.n,s:String(a.n),dg:true}; return; }
      if(letterOk&&next&&next.t==='num'){ tk[k]={t:'let',v:a.L}; return; }
      tk[k]={t:'num',v:a.n,s:String(a.n),dg:true};
    });
    var used=tk.map(function(){ return false; });
    function nextIdx(k){ return k+1<tk.length?k+1:-1; }
    function isMark(k,m){ return k>=0&&k<tk.length&&tk[k].t==='mark'&&tk[k].v===m; }

    /* 3) 동작 (마지막 동작 단어) */
    tk.forEach(function(x,k){ if(x.t==='act'){ R.action=x.v; used[k]=true; } });
    /* 4) 유통기한: 6·8자리 숫자 또는 년월일 세 숫자 */
    for(var e=0;e<tk.length;e++){
      var x=tk[e]; if(x.t!=='num'||used[e]) continue;
      var s6=x.s.length===8&&/^20/.test(x.s)?x.s.slice(2):x.s;
      if(x.dg&&(x.s.length===6||x.s.length===8)&&validYMD(s6)){ R.exp=s6; used[e]=true; break; }
    }
    if(!R.exp){
      for(var e2=0;e2+2<tk.length;e2++){
        var a1=tk[e2],a2=tk[e2+1],a3=tk[e2+2];
        if(a1.t==='num'&&a2.t==='num'&&a3.t==='num'&&!used[e2]&&!used[e2+1]&&!used[e2+2]&&!isMark(e2+3,'lvl')&&!isMark(e2+3,'qty')){
          var ys=('0'+a1.v).slice(-2)+('0'+a2.v).slice(-2)+('0'+a3.v).slice(-2);
          if(a1.v>=20&&a1.v<=60&&validYMD(ys)){ R.exp=ys; used[e2]=used[e2+1]=used[e2+2]=true; break; }
        }
      }
    }
    /* 5) 수량: 숫자 + 개/박스 */
    tk.forEach(function(x,k){
      if(x.t==='num'&&!used[k]&&isMark(k+1,'qty')&&R.qty==null){
        /* "원 투 파이브 개"처럼 한 자리씩 읽은 수량 → 125 */
        var b=k, ds=String(x.v);
        if(x.v<10){ while(b-1>=0&&tk[b-1].t==='num'&&!used[b-1]&&tk[b-1].v<10){ b--; ds=tk[b].v+ds; } }
        R.qty=parseInt(ds,10); for(var z=b;z<=k+1;z++) used[z]=true;
      }
    });
    /* 6) 위치: 알파벳 + 번호 (+ 숫자 층) */
    var locs=[];
    for(var p=0;p<tk.length;p++){
      if(tk[p].t!=='let'||used[p]) continue;
      var L={col:tk[p].v,row:null,lvl:null}; used[p]=true;
      var q=nextIdx(p);
      if(q>=0&&tk[q].t==='num'&&!used[q]){
        if(isMark(q+1,'lvl')){
          /* "A13층" 처럼 번호와 층이 붙어버린 경우 → A-1 3층 */
          if(tk[q].dg&&tk[q].s.length>=2){ L.row=parseInt(tk[q].s.slice(0,-1),10); L.lvl=+tk[q].s.slice(-1); used[q]=used[q+1]=true; R.warn.push('번호와 층이 붙어 들려 '+L.col+'-'+L.row+' '+L.lvl+'층으로 해석했어요'); }
        } else {
          L.row=tk[q].v; used[q]=true;
          var r2=nextIdx(q);
          if(r2>=0&&tk[r2].t==='num'&&!used[r2]&&isMark(r2+1,'lvl')){ L.lvl=tk[r2].v; used[r2]=used[r2+1]=true; }
        }
      }
      locs.push(L);
    }
    /* 층만 따로 말한 경우 (위치 뒤 "3층") */
    tk.forEach(function(x,k){
      if(x.t==='num'&&!used[k]&&isMark(k+1,'lvl')){
        var tgt=null; for(var z=locs.length-1;z>=0;z--){ if(locs[z].lvl==null){ tgt=locs[z]; break; } }
        if(tgt){ tgt.lvl=x.v; used[k]=used[k+1]=true; }
      }
    });
    /* 7) 남은 숫자 — 규칙상 빠진 칸 채우기 (경고와 함께) */
    var free=[]; tk.forEach(function(x,k){ if(x.t==='num'&&!used[k]) free.push(k); });
    if(locs.length&&locs[0].row!=null&&locs[0].lvl==null&&free.length){
      var f=free[0]; if(tk[f].v>=1&&tk[f].v<=9){ locs[0].lvl=tk[f].v; used[f]=true; free.shift(); R.warn.push('"층" 없이 말해 '+tk[f].v+'층으로 해석했어요'); }
    }
    if(R.action==='in'&&R.qty==null&&free.length===1){ var fq=free[0]; R.qty=tk[fq].v; used[fq]=true; free=[]; R.warn.push('"개" 없이 말해 수량 '+R.qty+'개로 해석했어요'); }
    R.loc=locs[0]||null; R.loc2=locs[1]||null;
    tk.forEach(function(x,k){
      if(used[k]) return;
      if(x.t==='num') R.leftovers.push(x.s);
      else if(x.t==='unk'&&/[가-힣a-z]/.test(x.v)) R.leftovers.push(x.v);
    });
    if(R.productFuzzy) R.warn.push('상품명이 정확히 들리지 않아 가장 비슷한 "'+R.product+'"(으)로 골랐어요');
    R.score=score(R);
    return R;
  }

  function score(R){
    var s=0;
    if(R.action) s+=3;
    if(R.loc&&R.loc.row!=null) s+=3;
    if(R.loc&&R.loc.lvl!=null) s+=2;
    if(R.action==='move'&&R.loc2&&R.loc2.row!=null) s+=3;
    if(R.product) s+=R.productFuzzy?1:2;
    if(R.exp) s+=2;
    if(R.qty!=null) s+=1;
    s-=R.leftovers.length;
    return s;
  }
  /* 음성 인식 후보 문장 여러 개 중 가장 잘 해석되는 것 선택 */
  function parseBest(alts, opts){
    var best=null;
    (alts||[]).forEach(function(t,i){ var r=parse(t,opts); r.altIndex=i; if(!best||r.score>best.score) best=r; });
    return best;
  }

  /* ── 음성 응답(TTS)용 말 만들기 ── */
  function sayLoc(L){ if(!L) return ''; return (LET_SAY[L.col]||L.col)+' '+L.row+'번'+(L.lvl!=null?' '+L.lvl+'층':''); }
  function sayExp(e){ if(!e||e.length!==6) return e?String(e):'유통기한 없음'; return '20'+e.slice(0,2)+'년 '+(+e.slice(2,4))+'월 '+(+e.slice(4,6))+'일'; }
  function locLabel(L){ if(!L) return ''; return L.col+'-'+L.row+(L.lvl!=null?' · '+L.lvl+'층':''); }
  function fmtExp(e){ return e&&e.length===6?'20'+e.slice(0,2)+'.'+e.slice(2,4)+'.'+e.slice(4,6):(e||''); }
  /* 확인 대답 판별 */
  function yesNo(text){
    var c=compact(text);
    if(/^(아니|아뇨|노|no|취소|안돼|틀려)/.test(c)||/아니/.test(c)) return 'no';
    if(/^(네|예|응|어|그래|맞아|확인|오케이|ok|좋아|넵|넹|yes|ㅇㅇ)/.test(c)) return 'yes';
    return null;
  }

  var API={parse:parse, parseBest:parseBest, sayLoc:sayLoc, sayExp:sayExp, locLabel:locLabel, fmtExp:fmtExp, yesNo:yesNo,
    colIndex:colIndex, colName:colName, validYMD:validYMD, variants:variants, _tokenize:tokenize};
  if(typeof module!=='undefined'&&module.exports) module.exports=API; else root.WMSVoice=API;
})(this);
