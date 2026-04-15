// KOSCOM 테스트베드 전종목 수집 스크립트
// 실행: node fetch-stocks.js
// 결과: stocks.json 생성

const https = require('https');
const fs = require('fs');

// 섹터 매핑 — 종목명 키워드로 자동 분류
function guessSector(name) {
  const n = name;
  if (/삼성전자|하이닉스|반도체|이오테크|리노공|HPSP|주성엔|원익|동진쎄|유진테크|테크윙|솔브레인|티씨케이|파크시스|심텍|대덕전/.test(n)) return '반도체';
  if (/에코프로|삼성SDI|LG에너지|LG화학|포스코퓨처|엘앤에프|나노신소재|천보|코스모신|더블유씨|에코프로비/.test(n)) return '2차전지';
  if (/바이오|제약|메디|셀트리온|삼성바이오|유한양행|한미약품|종근당|녹십자|대웅|HLB|알테오젠|펩트론|휴젤|파마리|클래시스|씨젠|오스코텍|덴티움|오스템|케어젠/.test(n)) return '바이오';
  if (/한화에어로|LIG넥스|현대로템|한국항공우주|한화시스템|이노스페이스|방산|퍼스텍|빅텍|스페코|쎄트렉|AP위성/.test(n)) return '방산';
  if (/NAVER|카카오|크래프톤|넷마블|NCSoft|넥슨|펄어비스|위메이드|컴투스|더블유게임|셀바스AI|하이브|에스엠|JYP|YG엔터|와이지/.test(n)) return 'IT';
  if (/현대차|기아|현대모비스|현대위아|HL만도|한온시스|현대글로/.test(n)) return '자동차';
  if (/KB금융|신한지주|하나금융|우리금융|삼성생명|삼성화재|메리츠|키움증권|대신증권|카카오뱅크|카카오페이/.test(n)) return '금융';
  if (/POSCO|포스코|고려아연|OCI|SKC|한화솔루션|롯데케미칼|효성첨단/.test(n)) return '소재';
  if (/두산로보틱스|레인보우로보틱스|티로보틱스|뉴로메카|로보티즈|에스피지/.test(n)) return '로봇';
  if (/삼성중공업|현대중공업|한화오션|HD한국조선/.test(n)) return '조선';
  if (/HMM|팬오션|대한항공|아시아나/.test(n)) return '해운·항공';
  if (/현대건설|GS건설|DL이앤씨|삼성엔지니어링/.test(n)) return '건설';
  if (/LG전자|삼성전기|LG이노텍|LG디스플레이/.test(n)) return '전자';
  if (/SK텔레콤|KT|LG유플/.test(n)) return '통신';
  if (/아모레|LG생활|CJ제일|오리온|이마트|신세계|롯데쇼핑|현대백화점|F&F|한섬/.test(n)) return '소비';
  if (/KODEX|TIGER|KBSTAR|HANARO|ARIRANG|KOSEF|SOL |ACE /.test(n)) return 'ETF';
  return '기타';
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      },
      timeout: 15000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch(e) {
          reject(new Error('JSON 파싱 실패: ' + data.slice(0, 100)));
        }
      });
    }).on('error', reject).on('timeout', () => reject(new Error('타임아웃')));
  });
}

async function fetchMarket(mktTpCd, mktName) {
  const url = `https://testbed.koscom.co.kr/gateway/v1/market/stocks/lists?infoTpCd=01&mktTpCd=${mktTpCd}`;
  console.log(`\n[${mktName}] 수집 중... ${url}`);
  
  const data = await fetchJson(url);
  
  if (!data.isuLists || !Array.isArray(data.isuLists)) {
    console.log('응답 구조:', JSON.stringify(data).slice(0, 200));
    throw new Error(`${mktName} 응답 구조 오류`);
  }
  
  console.log(`[${mktName}] ${data.isuLists.length}개 종목 수신`);
  return data.isuLists;
}

async function main() {
  console.log('=== KOSCOM 전종목 수집 시작 ===\n');
  
  let kospi = [], kosdaq = [];
  
  // 코스피 수집
  try {
    kospi = await fetchMarket('1', '코스피');
  } catch(e) {
    console.error('코스피 수집 실패:', e.message);
  }
  
  // 코스닥 수집
  try {
    kosdaq = await fetchMarket('2', '코스닥');
  } catch(e) {
    console.error('코스닥 수집 실패:', e.message);
  }

  if (kospi.length === 0 && kosdaq.length === 0) {
    console.error('\n❌ 수집 실패 — API 접근이 차단되었거나 인증이 필요합니다.');
    console.log('\n대안: 기존 stocks.json 유지');
    process.exit(1);
  }

  // JSON 변환 및 중복 제거
  const seen = new Set();
  const stocks = [];

  // 코스피 처리
  for (const s of kospi) {
    const code = s.isuSrtCd?.trim();
    const name = (s.isuKorAbbrv || s.isuKorNm || '').trim();
    if (!code || !name || seen.has(code)) continue;
    seen.add(code);
    stocks.push({
      n: name,
      s: code + '.KS',
      m: 'KOSPI',
      c: guessSector(name)
    });
  }

  // 코스닥 처리
  for (const s of kosdaq) {
    const code = s.isuSrtCd?.trim();
    const name = (s.isuKorAbbrv || s.isuKorNm || '').trim();
    if (!code || !name || seen.has(code)) continue;
    seen.add(code);
    stocks.push({
      n: name,
      s: code + '.KQ',
      m: 'KOSDAQ',
      c: guessSector(name)
    });
  }

  // 결과 출력
  const kospiCount = stocks.filter(s => s.m === 'KOSPI').length;
  const kosdaqCount = stocks.filter(s => s.m === 'KOSDAQ').length;
  
  console.log('\n=== 수집 결과 ===');
  console.log(`코스피: ${kospiCount}개`);
  console.log(`코스닥: ${kosdaqCount}개`);
  console.log(`합계:   ${stocks.length}개`);

  // 섹터별 분포
  const sectors = {};
  stocks.forEach(s => { sectors[s.c] = (sectors[s.c] || 0) + 1; });
  console.log('\n섹터 분포:');
  Object.entries(sectors).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => {
    console.log(`  ${k}: ${v}개`);
  });

  // 파일 저장
  fs.writeFileSync('stocks.json', JSON.stringify(stocks));
  console.log('\n✅ stocks.json 저장 완료');
  console.log('파일 크기:', (fs.statSync('stocks.json').size / 1024).toFixed(1) + ' KB');
}

main().catch(e => {
  console.error('\n❌ 오류:', e.message);
  process.exit(1);
});