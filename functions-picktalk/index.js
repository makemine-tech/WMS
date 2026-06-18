/* ===========================================================
   픽앤톡 알림 트리거
   /wms_sync/groups/{gid}/picktalk/logs/{logId} onCreate
   → 그룹의 fcmTokens 모두에게 FCM 푸시 발송 (등록자 본인 제외)
   → 무효 토큰 자동 삭제
=========================================================== */
const { onValueCreated, onValueUpdated } = require('firebase-functions/v2/database');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');

admin.initializeApp();

/* asia-southeast1 RTDB 인스턴스 (firebase.json 의 databaseURL 과 일치) */
const RTDB_INSTANCE = 'makechango-wms-default-rtdb';
const FUNC_REGION = 'asia-southeast1'; /* RTDB 와 동일 리전이 가장 빠름 */

/* ─── 본인에게 테스트 푸시 (디버깅용) ───
   클라이언트가 직접 호출 → 호출자(본인)의 토큰 전부에게 발송.
   알림 시스템 자체가 동작하는지 검증하기 위한 도구. */
exports.sendTestNotif = onCall(
  {
    region: FUNC_REGION,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', '로그인 필요');
    }
    /* 호출자가 속한 그룹 조회 */
    const groupSnap = await admin.database().ref('userGroup/' + uid).once('value');
    let gid = groupSnap.val();
    if (!gid) {
      /* superadmin 도 그룹 없을 수 있음 — adminGroupId 사용 가능하지만 단순화 위해 패스 */
      throw new HttpsError('failed-precondition', '그룹 미등록 — 관리자에게 초대 코드 요청');
    }
    /* 본인 uid 의 토큰만 모음 */
    const tokensSnap = await admin.database().ref(`/wms_sync/groups/${gid}/picktalk/fcmTokens`).once('value');
    const tokenMap = tokensSnap.val() || {};
    const myTokens = Object.keys(tokenMap).filter((tok) => {
      const m = tokenMap[tok] || {};
      return m.uid === uid;
    });
    if (!myTokens.length) {
      return { ok: false, reason: 'no_self_tokens', totalGroupTokens: Object.keys(tokenMap).length };
    }
    const message = {
      notification: {
        title: '🧪 픽앤톡 테스트',
        body: '알림 시스템이 정상 동작합니다 ✓',
      },
      data: {
        url: '/picktalk.html',
        kind: 'test',
      },
      webpush: {
        notification: {
          icon: '/icon.svg',
          badge: '/icon.svg',
          tag: 'picktalk-test-' + Date.now(),
        },
        fcmOptions: {
          link: 'https://makewon.com/picktalk.html',
        },
      },
      tokens: myTokens,
    };
    let response;
    try {
      response = await admin.messaging().sendEachForMulticast(message);
    } catch (err) {
      logger.error('테스트 발송 실패', err);
      throw new HttpsError('internal', '발송 실패: ' + (err && err.message || err));
    }
    logger.info('테스트 발송 결과', {
      uid,
      gid,
      total: myTokens.length,
      success: response.successCount,
      fail: response.failureCount,
    });
    /* 실패 토큰 디테일 */
    const errors = [];
    response.responses.forEach((r, i) => {
      if (!r.success && r.error) {
        errors.push({ token: myTokens[i].slice(0, 16) + '...', code: r.error.code, msg: r.error.message });
      }
    });
    return {
      ok: true,
      totalTokens: myTokens.length,
      success: response.successCount,
      fail: response.failureCount,
      errors: errors.slice(0, 5),
    };
  }
);

exports.notifyPicktalkLog = onValueCreated(
  {
    ref: '/wms_sync/groups/{gid}/picktalk/logs/{logId}',
    instance: RTDB_INSTANCE,
    region: FUNC_REGION,
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (event) => {
    const gid = event.params.gid;
    const logId = event.params.logId;
    const log = event.data && event.data.val();
    if (!log) {
      logger.warn('log 비어있음', { gid, logId });
      return;
    }

    /* 그룹의 fcmTokens 가져오기 — 형식: /fcmTokens/{token}: {uid, by, ts, platform} */
    const tokensRef = admin.database().ref(`/wms_sync/groups/${gid}/picktalk/fcmTokens`);
    const tokensSnap = await tokensRef.once('value');
    const tokenMap = tokensSnap.val() || {};
    const allTokens = Object.keys(tokenMap);

    if (!allTokens.length) {
      logger.info('no tokens in group', { gid });
      return;
    }

    /* 그룹 멤버 전원에게 발송 — 등록자 본인 포함.
       이유: 등록한 본인도 "발송 잘 됐는지" 확인 가능, 다중 디바이스 사용자는
       다른 디바이스에서도 알림 받음, 운영 가시성 향상.
       페이지가 열려 있는 디바이스는 messaging.onMessage 가 토스트만 표시. */
    const targets = allTokens.slice();

    /* 작성자 이름 — members 매핑 우선, log.byName fallback */
    let writerName = log.byName || '';
    if (log.byUid) {
      try {
        const mSnap = await admin.database().ref(`/wms_sync/groups/${gid}/picktalk/members/${log.byUid}/name`).once('value');
        const mappedName = mSnap.val();
        if (mappedName && typeof mappedName === 'string') writerName = mappedName;
      } catch (e) { /* fallback to log.byName */ }
    }

    /* 알림 본문 작성 */
    const title = `${log.categoryIcon || '📋'} ${log.categoryName || '새 작업'}`;
    const bodyParts = [];
    if (log.title) bodyParts.push(log.title);
    if (writerName) bodyParts.push(`작성: ${writerName}`);
    const body = bodyParts.join(' · ') || '새 작업이 등록되었습니다';

    /* 다중 발송 (sendEachForMulticast — 최대 500개/호출) */
    const message = {
      notification: { title, body },
      data: {
        url: '/picktalk.html',
        logId: String(logId),
        gid: String(gid),
        categoryId: String(log.categoryId || ''),
      },
      webpush: {
        notification: {
          icon: '/icon.svg',
          badge: '/icon.svg',
          tag: `picktalk-${gid}-${logId}`,
          requireInteraction: false,
        },
        fcmOptions: {
          link: 'https://makewon.com/picktalk.html',
        },
      },
      tokens: targets,
    };

    let response;
    try {
      response = await admin.messaging().sendEachForMulticast(message);
    } catch (err) {
      logger.error('FCM 발송 실패', err);
      return;
    }
    logger.info('FCM 발송 결과', {
      gid,
      logId,
      total: targets.length,
      success: response.successCount,
      fail: response.failureCount,
    });

    /* 무효 토큰 정리 */
    const cleanup = {};
    response.responses.forEach((r, i) => {
      if (!r.success && r.error) {
        const code = r.error.code || '';
        if (
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-argument'
        ) {
          cleanup[`/wms_sync/groups/${gid}/picktalk/fcmTokens/${targets[i]}`] = null;
        }
      }
    });
    if (Object.keys(cleanup).length) {
      try {
        await admin.database().ref().update(cleanup);
        logger.info(`만료 토큰 ${Object.keys(cleanup).length}개 정리`);
      } catch (e) {
        logger.warn('토큰 정리 실패', e);
      }
    }
  }
);

/* ─── 편집 알림 ───
   editedAt 이 새로 갱신된 경우만 발송. 다른 update (상태 변경·보관 등) 는 무시. */
exports.notifyPicktalkEdit = onValueUpdated(
  {
    ref: '/wms_sync/groups/{gid}/picktalk/logs/{logId}',
    instance: RTDB_INSTANCE,
    region: FUNC_REGION,
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (event) => {
    const gid = event.params.gid;
    const logId = event.params.logId;
    const before = event.data && event.data.before && event.data.before.val();
    const after = event.data && event.data.after && event.data.after.val();
    if (!after) return; /* 삭제 이벤트는 무시 */

    /* editedAt 변경 시만 — 사용자가 명시적으로 편집한 경우 */
    const beforeEdit = (before && before.editedAt) || 0;
    const afterEdit = (after && after.editedAt) || 0;
    if (afterEdit <= beforeEdit) return;

    /* 토큰 가져오기 */
    const tokensSnap = await admin.database().ref(`/wms_sync/groups/${gid}/picktalk/fcmTokens`).once('value');
    const tokenMap = tokensSnap.val() || {};
    const targets = Object.keys(tokenMap);
    if (!targets.length) {
      logger.info('편집 알림 — 토큰 없음', { gid, logId });
      return;
    }

    /* 수정자 이름 — members 매핑 우선 (editedByUid 없으면 editedBy fallback) */
    let editorName = after.editedBy || '';
    /* editedByUid 가 저장돼 있으면 매핑 */
    const editorUid = after.editedByUid || after.byUid || null;
    if (editorUid) {
      try {
        const mSnap = await admin.database().ref(`/wms_sync/groups/${gid}/picktalk/members/${editorUid}/name`).once('value');
        const mappedName = mSnap.val();
        if (mappedName && typeof mappedName === 'string') editorName = mappedName;
      } catch (e) {}
    }

    /* 알림 본문 — 제목에 ✏️ 수정됨 prefix */
    const title = `✏️ 수정 · ${after.categoryIcon || '📋'} ${after.categoryName || '작업'}`;
    const bodyParts = [];
    if (after.title) bodyParts.push(after.title);
    if (editorName) bodyParts.push(`수정: ${editorName}`);
    const body = bodyParts.join(' · ') || '작업이 수정되었습니다';

    const message = {
      notification: { title, body },
      data: {
        url: '/picktalk.html',
        logId: String(logId),
        gid: String(gid),
        categoryId: String(after.categoryId || ''),
        kind: 'edit',
      },
      webpush: {
        notification: {
          icon: '/icon.svg',
          badge: '/icon.svg',
          tag: `picktalk-edit-${gid}-${logId}`,
          requireInteraction: false,
        },
        fcmOptions: {
          link: 'https://makewon.com/picktalk.html',
        },
      },
      tokens: targets,
    };

    let response;
    try {
      response = await admin.messaging().sendEachForMulticast(message);
    } catch (err) {
      logger.error('편집 알림 발송 실패', err);
      return;
    }
    logger.info('편집 알림 발송 결과', {
      gid,
      logId,
      total: targets.length,
      success: response.successCount,
      fail: response.failureCount,
    });

    /* 무효 토큰 정리 */
    const cleanup = {};
    response.responses.forEach((r, i) => {
      if (!r.success && r.error) {
        const code = r.error.code || '';
        if (
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/registration-token-not-registered'
        ) {
          cleanup[`/wms_sync/groups/${gid}/picktalk/fcmTokens/${targets[i]}`] = null;
        }
      }
    });
    if (Object.keys(cleanup).length) {
      try {
        await admin.database().ref().update(cleanup);
      } catch (e) {
        logger.warn('편집 알림 토큰 정리 실패', e);
      }
    }
  }
);

/* ===========================================================
   예약 알림 (스케줄) — 평일 저녁 19:00 / 아침 09:30 (Asia/Seoul)
   날짜(dateInt)가 지정된 미보관 로그를 스캔해 멘트형 푸시를 그룹 전원에게 발송.
   · 저녁(eve)  : 다음 영업일 일정 사전 알림 (금요일이면 월요일)
   · 아침(morn) : 당일 일정 재알림
   멘트 예) "20일 금요일 내일 출고 - 논산 파렛트발송요청 용경발송 일정이 있습니다. 확인하세요."
=========================================================== */
const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];

/* KST(UTC+9) 기준 날짜 파츠 — offsetDays 만큼 가감. (한국은 서머타임 없음 → +9 고정) */
function kstParts(offsetDays) {
  const d = new Date(Date.now() + 9 * 3600 * 1000 + (offsetDays || 0) * 86400 * 1000);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return { int: y * 10000 + m * 100 + day, dd: day, dow: d.getUTCDay() };
}

/* mode('eve'|'morn') → 대상 날짜 정보 { int, dd, dow, when } */
function reminderTarget(mode) {
  const today = kstParts(0);
  if (mode === 'morn') {
    return { int: today.int, dd: today.dd, dow: today.dow, when: '오늘' };
  }
  /* eve: 다음 영업일 — 금요일(5)이면 +3(월요일), 그 외 +1 */
  const off = today.dow === 5 ? 3 : 1;
  const t = kstParts(off);
  return { int: t.int, dd: t.dd, dow: t.dow, when: off === 1 ? '내일' : '다음 영업일' };
}

/* 로그 1건 → "업체 제목" 형태 텍스트 */
function reminderItemText(lg) {
  const v = Array.isArray(lg.vendorNames) ? lg.vendorNames.filter(Boolean).join('/') : '';
  const title = (lg.title || '').trim();
  return (v ? v + ' ' : '') + title;
}

/* 대상 로그 배열 → 멘트 본문 */
function buildReminderBody(target, logs) {
  /* 카테고리별 묶기 (등장 순서 유지) */
  const order = [];
  const byCat = {};
  logs.forEach((lg) => {
    const cat = lg.categoryName || '작업';
    if (!byCat[cat]) { byCat[cat] = []; order.push(cat); }
    const t = reminderItemText(lg);
    if (t) byCat[cat].push(t);
  });
  const segs = order.map((cat) => {
    const items = byCat[cat];
    return items.length ? `${cat} - ${items.join(' ')}` : cat;
  });
  const head = `${target.dd}일 ${DOW_KO[target.dow]}요일 ${target.when}`;
  return `${head} ${segs.join(' / ')} 일정이 있습니다. 확인하세요.`;
}

/* 무효(만료) 토큰 정리 */
async function cleanupReminderTokens(gid, tokens, responses) {
  const cleanup = {};
  responses.forEach((r, i) => {
    if (!r.success && r.error) {
      const code = r.error.code || '';
      if (
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-argument'
      ) cleanup[`/wms_sync/groups/${gid}/picktalk/fcmTokens/${tokens[i]}`] = null;
    }
  });
  if (Object.keys(cleanup).length) {
    try { await admin.database().ref().update(cleanup); }
    catch (e) { logger.warn('예약알림 토큰 정리 실패', e); }
  }
}

/* 한 그룹의 대상 로그를 모아 멘트 생성 — 대상 없으면 null */
async function buildGroupReminder(gid, target) {
  const logsSnap = await admin.database()
    .ref(`/wms_sync/groups/${gid}/picktalk/logs`)
    .orderByChild('dateInt').equalTo(target.int)
    .once('value');
  const logsObj = logsSnap.val() || {};
  const logs = Object.keys(logsObj)
    .map((k) => logsObj[k])
    .filter((lg) => lg && !lg.archived); /* 보관된 항목 제외 */
  if (!logs.length) return null;
  return { body: buildReminderBody(target, logs), count: logs.length };
}

/* 한 그룹에 예약알림 발송 */
async function sendGroupReminder(gid, mode, target) {
  const built = await buildGroupReminder(gid, target);
  if (!built) return { gid, skipped: 'no_logs' };

  const tokensSnap = await admin.database().ref(`/wms_sync/groups/${gid}/picktalk/fcmTokens`).once('value');
  const tokens = Object.keys(tokensSnap.val() || {});
  if (!tokens.length) return { gid, skipped: 'no_tokens' };

  const message = {
    notification: { title: `🔔 ${target.when} 일정 ${built.count}건`, body: built.body },
    data: { url: '/picktalk.html', gid: String(gid), kind: 'reminder', mode, dateInt: String(target.int) },
    webpush: {
      notification: {
        icon: '/icon.svg',
        badge: '/icon.svg',
        tag: `picktalk-reminder-${gid}-${target.int}-${mode}`,
        requireInteraction: false,
      },
      fcmOptions: { link: 'https://makewon.com/picktalk.html' },
    },
    tokens,
  };

  let response;
  try {
    response = await admin.messaging().sendEachForMulticast(message);
  } catch (err) {
    logger.error('예약알림 발송 실패', { gid, mode, err });
    return { gid, error: String((err && err.message) || err) };
  }
  await cleanupReminderTokens(gid, tokens, response.responses);
  logger.info('예약알림 발송', {
    gid, mode, dateInt: target.int, count: built.count,
    success: response.successCount, fail: response.failureCount,
  });
  return { gid, count: built.count, success: response.successCount, fail: response.failureCount };
}

/* 활성 그룹 전체를 돌며 예약알림 발송 */
async function runReminders(mode) {
  const target = reminderTarget(mode);
  /* 활성 그룹 = userGroup(uid→gid) 의 distinct gid (가볍게 그룹 목록 확보) */
  const ugSnap = await admin.database().ref('/userGroup').once('value');
  const ug = ugSnap.val() || {};
  const gids = Array.from(new Set(Object.values(ug).filter(Boolean)));
  logger.info('예약알림 시작', { mode, dateInt: target.int, groups: gids.length });
  await Promise.all(gids.map((gid) =>
    sendGroupReminder(gid, mode, target).catch((e) => {
      logger.warn('그룹 예약알림 처리 실패', { gid, e: String(e) });
    })
  ));
}

/* 평일 저녁 7시 — 다음 영업일 일정 사전 알림 */
exports.picktalkEveningReminder = onSchedule(
  { schedule: '0 19 * * 1-5', timeZone: 'Asia/Seoul', region: FUNC_REGION, memory: '256MiB', timeoutSeconds: 120 },
  async () => { await runReminders('eve'); }
);

/* 평일 아침 9시 30분 — 당일 일정 재알림 */
exports.picktalkMorningReminder = onSchedule(
  { schedule: '30 9 * * 1-5', timeZone: 'Asia/Seoul', region: FUNC_REGION, memory: '256MiB', timeoutSeconds: 120 },
  async () => { await runReminders('morn'); }
);

/* ─── 예약알림 미리보기 (발송 없음) ───
   호출자 그룹의 저녁/아침 멘트를 실제 데이터로 계산해 반환. 비개발자가 문구를 눈으로 확인하는 용도. */
exports.previewReminder = onCall(
  { region: FUNC_REGION, memory: '256MiB', timeoutSeconds: 30 },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', '로그인 필요');
    const gidSnap = await admin.database().ref('userGroup/' + uid).once('value');
    const gid = gidSnap.val();
    if (!gid) throw new HttpsError('failed-precondition', '그룹 미등록 — 관리자에게 초대 코드 요청');
    const out = { ok: true };
    for (const mode of ['eve', 'morn']) {
      const target = reminderTarget(mode);
      const built = await buildGroupReminder(gid, target);
      out[mode] = {
        dateInt: target.int,
        when: target.when,
        count: built ? built.count : 0,
        body: built ? built.body : null,
      };
    }
    return out;
  }
);
