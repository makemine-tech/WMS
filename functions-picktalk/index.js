/* ===========================================================
   픽앤톡 알림 트리거
   /wms_sync/groups/{gid}/picktalk/logs/{logId} onCreate
   → 그룹의 fcmTokens 모두에게 FCM 푸시 발송 (등록자 본인 제외)
   → 무효 토큰 자동 삭제
=========================================================== */
const { onValueCreated } = require('firebase-functions/v2/database');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');

admin.initializeApp();

/* asia-southeast1 RTDB 인스턴스 (firebase.json 의 databaseURL 과 일치) */
const RTDB_INSTANCE = 'makechango-wms-default-rtdb';
const FUNC_REGION = 'asia-southeast1'; /* RTDB 와 동일 리전이 가장 빠름 */

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

    /* 등록자 자신 제외 (uid 또는 by 매칭) */
    const senderUid = log.byUid || null;
    const senderBy = log.by || null;
    const targets = allTokens.filter((tok) => {
      const m = tokenMap[tok] || {};
      if (senderUid && m.uid === senderUid) return false;
      if (senderBy && m.by === senderBy) return false;
      return true;
    });

    if (!targets.length) {
      logger.info('등록자 본인만 토큰 보유 — 발송 안 함', { gid, logId });
      return;
    }

    /* 알림 본문 작성 */
    const title = `${log.categoryIcon || '📋'} ${log.categoryName || '새 작업'}`;
    const bodyParts = [];
    if (log.title) bodyParts.push(log.title);
    if (log.byName) bodyParts.push(`작성: ${log.byName}`);
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
