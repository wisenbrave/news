// /api/gold — KRX 금시장 시세 (공공데이터포털 '금융위원회_일반상품시세정보' API)
// 환경변수 DATA_GO_KR_SERVICE_KEY 가 없으면 { ok: false } 를 돌려주고 화면은 "시세 연결 필요"로 표시한다.
// 시세는 하루 1회 갱신되는 전 영업일 종가다.
const API_URL = 'https://apis.data.go.kr/1160100/service/GetGeneralProductInfoService/getGoldPriceInfo';

export async function GET() {
  const key = process.env.DATA_GO_KR_SERVICE_KEY;
  if (!key) return reply({ ok: false, reason: 'API 키 없음' }, 60);

  try {
    const since = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
    // 포털의 Encoding 키(이미 % 인코딩됨)와 Decoding 키 모두 받아들인다.
    const serviceKey = key.includes('%') ? key : encodeURIComponent(key);
    const url = `${API_URL}?serviceKey=${serviceKey}&resultType=json&numOfRows=100&beginBasDt=${since}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const items = [].concat(data?.response?.body?.items?.item || []);
    // '금 99.99_1Kg' 종목이 KRX 금시장 대표 시세 (가격 단위: 원/g)
    const latest = items
      .filter(it => /1\s*kg/i.test(it.itmsNm))
      .sort((a, b) => String(b.basDt).localeCompare(String(a.basDt)))[0];
    if (!latest) throw new Error('시세 데이터 없음');
    return reply({
      ok: true,
      price: Number(latest.clpr),
      changeRate: Number(latest.fltRt),
      date: latest.basDt,
    }, 3600);
  } catch (e) {
    console.warn('[gold]', e.message);
    return reply({ ok: false, reason: '시세 조회 실패' }, 300);
  }
}

function reply(body, maxAge) {
  return Response.json(body, { headers: { 'Cache-Control': `public, s-maxage=${maxAge}` } });
}
