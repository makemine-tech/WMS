/* ============================================================
   메이크창고 전담비서 — 헤드비서 실행기 (secretary.html?run=1 짝꿍, 브라우저·Node 공용, 2026-11-01)

   명령을 받아 정해진 작업만 한다. Firebase 와 탭은 deps 로 받는다.
     deps.store    claimRunner·getRunner·claimCommand·setCommand·getJobs·setJob·getControl·setSite
     deps.openSite 사이트 탭을 열어 도우미 ping 응답을 돌려줌. 안 되면 throw
     deps.relogin  로그인 화면에서 크롬이 채운 값으로 로그인 버튼을 한 번 누름. { tried, why }. 비밀번호는 다루지 않음
     deps.ezPreview({ from, to }) 곡물도감 검색 후 secretary_ez.preview 결과를 돌려줌
     deps.ezPlan({ from, to })    같은 검색 후 { preview, pay, rows } 를 돌려줌. rows 에는 수령자가 있어 저장하지 않음
     deps.ezFill(pay)·deps.ezCommit()·deps.ezVerify(pay, rows) 일괄합포제외 채우기·저장·대조
   저장은 사람이 확인을 누른 ez_split 명령(runEzSplit)에서만 한다. 그 밖의 작업은 읽기 전용.
============================================================ */
(function(root){
  'use strict';
  var C = typeof module !== 'undefined' && module.exports ? require('./secretary_core.js') : root.SECRETARY_CORE;

  function createRunner(deps){
    var store = deps.store;
    var chain = Promise.resolve();

    async function claim(){
      var ok = await store.claimRunner(deps.runnerId, deps.info || {});
      if (!ok) return false;
      /* 앞 탭이 작업 중에 꺼졌으면 진행 중으로 남아 있음. 시동을 막지 않게 정리 */
      var jobs = (await store.getJobs()) || {};
      for (var k of Object.keys(jobs)) {
        if (!jobs[k] || jobs[k].state !== 'running') continue;
        await store.setJob(k, { state: 'interrupted', endedAt: deps.now(), notes: '헤드비서 탭이 다시 켜져 중단 처리' });
        if (jobs[k].cmd) await store.setCommand(jobs[k].cmd, { status: 'interrupted', doneAt: deps.now() });
      }
      return true;
    }

    async function readSite(site){
      try {
        var reply = await deps.openSite(site), r = C.siteState(site.id, reply);
        r.ver = (reply && reply.ver) || '';
        return r;
      } catch (e) {
        return { state: 'error', msg: String((e && e.message) || e), ver: '' };
      }
    }
    /* 로그인이 풀렸으면 재로그인을 한 번만 시도. 실패하면 로그인이 돌아올 때까지 다시 시도하지 않음(계정 잠김 방지) */
    var triedLogin = {}, whyLogin = {};
    async function checkOne(site){
      var r = await readSite(site);
      if (r.state === 'ok') { triedLogin[site.id] = false; whyLogin[site.id] = ''; }
      if (r.state === 'login' && deps.relogin && !triedLogin[site.id]) {
        triedLogin[site.id] = true;
        var tried = null;
        try { tried = await deps.relogin(site); } catch (e) { tried = { tried: false, why: String((e && e.message) || e) }; }
        whyLogin[site.id] = (tried && tried.why) || (tried && tried.tried ? '자동 재로그인 실패' : '');
        if (tried && tried.tried) {
          r = await readSite(site);
          if (r.state === 'ok') { triedLogin[site.id] = false; whyLogin[site.id] = ''; r.msg = '로그인 유지 (자동 재로그인)'; }
        }
      }
      if (r.state === 'login' && whyLogin[site.id]) r.msg = '로그인이 필요합니다 (' + whyLogin[site.id] + ')';
      r.checkedAt = deps.now();
      await store.setSite(site.id, r);
      return r;
    }
    async function checkSites(){
      var results = [];
      for (var site of C.SITES) {
        var r = await checkOne(site);
        results.push({ id: site.id, name: site.name, state: r.state, msg: r.msg });
      }
      return results;
    }
    /* 로그인 유지: 사이트를 주기적으로 열어 세션을 살리고 끊김을 먼저 찾음. 작업 중이거나 멈춤이면 건너뜀 */
    function keepAlive(){
      var run = chain.then(async function(){
        var control = await store.getControl();
        if (control && control.pause) return false;
        var jobs = (await store.getJobs()) || {};
        if (Object.keys(jobs).some(function(k){ return jobs[k] && jobs[k].state === 'running'; })) return false;
        await checkSites();
        return true;
      });
      chain = run.catch(function(){});
      return run;
    }

    async function runStart(id, cmd){
      var now = deps.now();
      var jobs = (await store.getJobs()) || {};
      var running = Object.keys(jobs).map(function(k){ return jobs[k]; }).find(function(j){ return j && j.state === 'running'; });
      var block = C.startBlock({ runner: await store.getRunner(), control: await store.getControl(), job: running, now: now });
      if (block) { await store.setCommand(id, { status: 'refused', why: block, doneAt: now }); return; }

      var date = C.kstDate(now);
      var key = C.jobKey('ez_daily', date, C.nextRound(jobs, 'ez_daily', date));
      var range = C.dateRange(cmd.from, now);
      await store.setJob(key, { state: 'running', recipe: 'ez_daily', trigger: 'start', by: cmd.by || '', at: now, cmd: id, from: range.from, to: range.to });
      try {
        await store.setCommand(id, { status: 'started', jobKey: key, startedAt: now });
        var results = await checkSites();
        var bad = results.filter(function(r){ return r.state !== 'ok'; });
        var sites = {};
        results.forEach(function(r){ sites[r.id] = { state: r.state, msg: r.msg }; });
        var notes = bad.map(function(r){ return r.name + ': ' + r.msg; });
        var ez = results.find(function(r){ return r.id === 'ezadmin'; });
        var stop = !ez || ez.state !== 'ok';   /* 이벗 문제는 이지어드민 비서를 막지 않고 알리기만 함 */
        var patch = { endedAt: 0, sites: sites };
        if (!stop) {
          await store.setCommand(id, { status: 'reading', jobKey: key });
          try {
            patch.preview = await deps.ezPreview(range);
            if (patch.preview.blockers.length) { stop = true; notes = notes.concat(patch.preview.blockers); }
          } catch (e) {
            stop = true;
            notes.push('주문 읽기 실패: ' + String((e && e.message) || e));
          }
        }
        patch.state = stop ? 'stopped' : 'done';
        patch.notes = notes.join(' / ');
        patch.endedAt = deps.now();
        await store.setJob(key, patch);
        await store.setCommand(id, { status: 'done', jobKey: key, doneAt: deps.now() });
      } catch (e) {
        /* 진행 중으로 남으면 다음 시동이 계속 막힌다 */
        await store.setJob(key, { state: 'interrupted', endedAt: deps.now(), notes: '점검 중 오류: ' + String((e && e.message) || e) }).catch(function(){});
        throw e;
      }
    }

    /* 일괄합포제외: 다시 읽어 확인한 자료와 같을 때만 채우고 저장한 뒤, 다시 검색해 대조. 자동 재시도 없음 */
    async function runEzSplit(id, cmd){
      var now = deps.now();
      var jobs = (await store.getJobs()) || {};
      var running = Object.keys(jobs).map(function(k){ return jobs[k]; }).find(function(j){ return j && j.state === 'running'; });
      var block = C.startBlock({ runner: await store.getRunner(), control: await store.getControl(), job: running, now: now }) || C.ezSplitRefuse(jobs, cmd.job);
      if (block) { await store.setCommand(id, { status: 'refused', why: block, doneAt: now }); return; }

      var src = jobs[cmd.job], date = C.kstDate(now), key = C.jobKey('ez_split', date, C.nextRound(jobs, 'ez_split', date));
      var range = { from: src.from, to: src.to }, limit = Number(cmd.limit) || 0, site = C.SITES.find(function(s){ return s.id === 'ezadmin'; }), filled = false;
      async function step(text){ await store.setJob(key, { step: text }); await store.setCommand(id, { status: 'started', jobKey: key, step: text }); }
      async function end(state, notes, result){
        var p = { state: state, notes: notes, step: '', endedAt: deps.now() };
        if (result) p.result = result;
        await store.setJob(key, p);
        await store.setCommand(id, { status: 'done', jobKey: key, doneAt: deps.now() });
      }
      /* 저장 전에 멈추면 채운 것은 화면을 새로 열어 버림 */
      async function discard(){ if (filled) { filled = false; await deps.openSite(site).catch(function(){}); } }
      await store.setJob(key, { state: 'running', recipe: 'ez_split', trigger: 'ez_split', by: cmd.by || '', at: now, cmd: id, src: cmd.job, from: range.from, to: range.to, limit: limit });
      try {
        await step('이지어드민 여는 중');
        var r = await checkOne(site);
        if (r.state !== 'ok') return await end('stopped', '이지어드민: ' + r.msg);
        await step('주문 다시 읽는 중');
        var plan = await deps.ezPlan(range), why = C.ezSplitBlock(src, plan.preview);
        if (why) return await end('stopped', why);
        var pay = limit ? plan.pay.slice(0, limit) : plan.pay;
        await step('채우는 중 ' + pay.length + '건');
        filled = true;
        var f = await deps.ezFill(pay), result = { target: pay.length, total: plan.pay.length, filled: f.done.length, skipped: f.skipped.length, skipList: f.skipped.slice(0, 20) };
        if (f.skipped.length || !f.done.length) { await discard(); return await end('stopped', '채우지 못한 묶음 ' + f.skipped.length + '건이 있어 저장하지 않았습니다', result); }
        var control = await store.getControl();
        if (control && control.pause) { await discard(); return await end('stopped', '전체 멈춤이라 저장하지 않았습니다', result); }

        await step('일괄합포제외 저장 중');
        filled = false;   /* 이제부터는 저장됐을 수 있어 버리지 않음 */
        var c;
        try { c = await deps.ezCommit(); }
        catch (e) { return await end('stopped', '일괄합포제외 실패: ' + String((e && e.message) || e) + '. 저장됐을 수 있으니 시동으로 확인해 주세요', result); }
        var bad = c.error != null && String(c.error) !== '0', failN = (c.fail_list || []).length;
        result.error = bad ? String(c.error) : ''; result.failN = failN; result.lock = c.lock == null ? -1 : c.lock;

        await step('결과 대조 중');
        var after;
        try { await deps.openSite(site); after = await deps.ezPlan(range); }
        catch (e) { return await end('stopped', '저장 후 대조를 못 했습니다: ' + String((e && e.message) || e) + '. 시동으로 확인해 주세요', result); }
        var v = deps.ezVerify(pay, after.rows);
        result.ok = v.ok.length; result.notApplied = v.notApplied.slice(0, 40); result.notAppliedN = v.notApplied.length; result.gone = v.gone.slice(0, 20); result.goneN = v.gone.length;
        if (bad || failN || v.notApplied.length) return await end('stopped', '확인 필요: 반영 ' + v.ok.length + '건 · 안 됨 ' + v.notApplied.length + '건' + (bad ? ' · 이지어드민 응답 ' + c.error : '') + (failN ? ' · 실패 목록 ' + failN + '건' : ''), result);
        await end('done', '', result);
        /* 다음 칸(남은 묶음 또는 송장출력)으로 넘어가게 새로 읽은 자료를 남김. 새로 생긴 확인거리가 없으면 확인을 이어 감 */
        var still = !C.ezSplitBlock({ preview: { splitPacks: after.preview.splitPacks, unseen: src.preview.unseen, flags: src.preview.flags } }, after.preview);
        var jobs2 = (await store.getJobs()) || {}, nextKey = C.jobKey('ez_daily', date, C.nextRound(jobs2, 'ez_daily', date));
        var next = { state: after.preview.blockers.length ? 'stopped' : 'done', recipe: 'ez_daily', trigger: 'ez_split', by: cmd.by || '', at: deps.now(), endedAt: deps.now(), from: range.from, to: range.to, preview: after.preview, notes: after.preview.blockers.join(' / ') };
        if (still && src.ack) next.ack = src.ack;
        await store.setJob(nextKey, next);
      } catch (e) {
        await discard();
        await end('stopped', '오류: ' + String((e && e.message) || e)).catch(function(){});
      }
    }

    /* 맨소래담: 이벗 로그인 점검 → 주문서목록 읽기 → 행사표로 사은품 대상 계산. 이벗에 쓰지 않음 */
    async function runMenso(id, cmd){
      var now = deps.now();
      var jobs = (await store.getJobs()) || {};
      var running = Object.keys(jobs).map(function(k){ return jobs[k]; }).find(function(j){ return j && j.state === 'running'; });
      var block = C.startBlock({ runner: await store.getRunner(), control: await store.getControl(), job: running, now: now });
      if (block) { await store.setCommand(id, { status: 'refused', why: block, doneAt: now }); return; }

      var date = C.kstDate(now);
      var key = C.jobKey('menso_read', date, C.nextRound(jobs, 'menso_read', date));
      var range = C.dateRange(cmd.from, now);
      await store.setJob(key, { state: 'running', recipe: 'menso_read', trigger: 'menso', by: cmd.by || '', at: now, cmd: id, from: range.from, to: range.to });
      try {
        await store.setCommand(id, { status: 'started', jobKey: key, startedAt: now });
        var r = await checkOne(C.SITES.find(function(s){ return s.id === 'ebut'; }));
        var patch = { state: 'stopped', endedAt: 0, notes: '' };
        if (r.state !== 'ok') patch.notes = '이벗: ' + r.msg;
        else {
          await store.setCommand(id, { status: 'reading', jobKey: key });
          try {
            patch.menso = await deps.mensoPreview(range);
            patch.notes = patch.menso.blockers.join(' / ');
            if (!patch.menso.blockers.length) patch.state = 'done';
          } catch (e) { patch.notes = '주문 읽기 실패: ' + String((e && e.message) || e); }
        }
        patch.endedAt = deps.now();
        await store.setJob(key, patch);
        await store.setCommand(id, { status: 'done', jobKey: key, doneAt: deps.now() });
      } catch (e) {
        await store.setJob(key, { state: 'interrupted', endedAt: deps.now(), notes: '오류: ' + String((e && e.message) || e) }).catch(function(){});
        throw e;
      }
    }

    /* 매칭 화면 자료: 이벗에서 읽어 secretary/match 에 둔다. 이벗에 쓰지 않음 */
    async function runMatch(id, cmd){
      var now = deps.now();
      if (C.runnerState(await store.getRunner(), now) !== 'on') { await store.setCommand(id, { status: 'refused', why: '상시 컴퓨터가 꺼져 있습니다', doneAt: now }); return; }
      await store.setCommand(id, { status: 'reading' });
      try {
        var ebut = C.SITES.find(function(s){ return s.id === 'ebut'; }), r = C.siteState('ebut', await deps.openSite(ebut));
        if (r.state !== 'ok') { await store.setCommand(id, { status: 'refused', why: '이벗: ' + r.msg, doneAt: deps.now() }); return; }
        if (cmd.type === 'match_search') {
          await store.setMatch('search/' + id, { text: cmd.text || '', rows: await deps.matchSearch(cmd.text || ''), at: deps.now() });
        } else {
          var data = await deps.matchRead(C.dateRange(cmd.from, now));
          data.readAt = deps.now();
          await store.setMatch('data', data);
        }
        await store.setCommand(id, { status: 'done', doneAt: deps.now() });
      } catch (e) {
        await store.setCommand(id, { status: 'refused', why: String((e && e.message) || e), doneAt: deps.now() });
      }
    }

    async function process(id, cmd){
      if (!(await store.claimCommand(id))) return;
      var now = deps.now();
      if (C.commandExpired(cmd, now)) { await store.setCommand(id, { status: 'expired', doneAt: now }); return; }
      if (cmd.type === 'start') return runStart(id, cmd);
      if (cmd.type === 'menso') return runMenso(id, cmd);
      if (cmd.type === 'ez_split') return runEzSplit(id, cmd);
      if (cmd.type === 'match_read' || cmd.type === 'match_search') return runMatch(id, cmd);
      await store.setCommand(id, { status: 'refused', why: '모르는 명령', doneAt: now });
    }

    /* 명령은 한 번에 하나씩. 실패해도 다음 명령을 막지 않음 */
    function handleCommand(id, cmd){
      var run = chain.then(function(){ return process(id, cmd); });
      chain = run.catch(function(){});
      return run;
    }

    return { claim: claim, checkSites: checkSites, handleCommand: handleCommand, keepAlive: keepAlive };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createRunner: createRunner };
  else root.SECRETARY_RUNNER = { createRunner: createRunner };
})(typeof window !== 'undefined' ? window : this);
