/* 정산관리 서버 함수 */
exports.epostReturnOrigin = require('./epost').epostReturnOrigin;
exports.epostReturnStage = require('./epost').epostReturnStage;
/* 반품 검수 알바용 링크(로그인 없이) */
exports.retKioskJoin = require('./kiosk').retKioskJoin;
/* 전담비서 상시 컴퓨터 생존 감시 */
exports.secretaryWatch = require('./secretary_watch_fn').secretaryWatch;
