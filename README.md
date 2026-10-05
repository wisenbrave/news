# 오늘뉴스

오늘 국내에서 무슨 일이 있었는지 5~10분 안에 훑어보고 닫는 개인용 뉴스 도구입니다.
언론사 RSS의 **제목·언론사·시간·링크만** 모아 보여주고, 기사 전문은 원문 언론사나 BIG KINDS에서 봅니다.

- 오늘의 주요 뉴스: 여러 언론사가 함께 보도한 사건을 묶어 먼저 보여줌
- 사설 / 경제·금융 / 과학·기술 탭, 즉시 검색, 빠른 검색어
- 사설은 언론사별로 정리
- KRX 금 시세(선택)
- 설치형 웹앱(PWA)

HTML·CSS·순수 JavaScript와 Vercel 서버리스 함수만 사용하며 npm 패키지가 없습니다.

## 실행 방법

Node.js 22 이상이 필요합니다.

```bash
npm run dev
```

브라우저에서 http://localhost:3000 을 엽니다. (`dev-server.js`는 로컬 확인용이며 배포에는 쓰이지 않습니다.)

**스마트폰에서 보기**: PC와 같은 와이파이에 연결한 뒤, 실행 화면에 나오는 `폰에서: http://192.168.x.x:3000` 주소를 폰 브라우저에 입력합니다.
(Windows 방화벽 허용 창이 뜨면 '개인 네트워크'를 허용) 늘 쓰려면 Vercel에 배포한 주소를 열고, 브라우저 메뉴의 **홈 화면에 추가**로 앱처럼 설치합니다.

## Vercel 배포 방법

1. 이 폴더를 GitHub 저장소에 올립니다.
2. vercel.com → Add New Project → 저장소 선택 → Framework Preset은 **Other** 그대로 → Deploy.

또는 CLI: `npm i -g vercel` 후 `vercel` (미리보기), `vercel --prod` (운영).

빌드 과정이 없습니다. `api/` 폴더의 파일이 자동으로 `/api/news`, `/api/gold`가 됩니다.

## RSS 추가 방법

`api/news.js`의 `feedSources`에 한 줄을 추가합니다.

```js
{ name: 'SBS', core: true, url: ['01', '02', '03', '07'].map(sbs) },   // 섹션 피드 여러 개는 배열로
{ name: '한국경제', url: 'https://www.hankyung.com/feed/economy', defaultCategory: '경제·금융' },
{ name: '조선일보', camp: '보수', url: chosun('opinion'), defaultCategory: '사설', titleMatch: '[사설]' },
```

- `url`: 연예·스포츠 등 흥행성 기사를 줄이려고 '전체' 대신 정치·경제·사회·국제 섹션 피드를 씁니다.
- `core`: 핵심 매체(종합지·통신·방송). 주요 뉴스 점수에서 1곳당 1점, 그 외 매체는 0.5점
- `camp`: 사설 논조 기준 `'보수'` / `'진보'`. 양쪽이 모두 다룬 이슈에 가산점
- `defaultCategory`: 제목 키워드로 분류되지 않을 때 쓰는 분야, `titleMatch`: 이 글자가 있는 기사만 사용
- 한 피드가 실패해도 나머지는 정상 표시됩니다.

## 오늘의 주요 뉴스 순위

클릭을 노린 기사보다 **편집국이 중요하다고 판단한 흔적**을 크게 봅니다(하루 전체 기준, `js/app.js`의 `rate`).

| 근거 | 점수 |
|---|---|
| 그 이슈를 사설로 다룬 신문사 | 1곳당 +3 |
| 연합뉴스 편집국 "이 시각 헤드라인" | +3 |
| 보수·진보 매체 모두 보도 | +2 |
| 보도한 언론사 | 핵심 매체 1점, 그 외 0.5점 |

같은 사건 기사는 제목 유사도로 묶고, 같은 주제의 사설이 걸친 기사 묶음은 한 이슈로 합칩니다. 각 뉴스에 근거가 표시됩니다(예: "사설 4곳 · 보수·진보 모두 보도 · 6개 언론사").

## 오늘의 핵심어 · 관심 기술 버튼

- **오늘의 핵심어** (자동, 매일 바뀜): 주요 뉴스 상위 이슈마다 대표 기사 제목에서, 여러 언론사가 함께 쓰고 오늘 다른 기사에는 드문 단어 2개를 뽑습니다. 누르면 그 이슈로 묶인 기사가 나옵니다. 어색한 단어가 보이면 `js/config.js`의 `KEYWORD_STOPWORDS`에 추가합니다.
- **관심 기술** (고정): `js/config.js`의 `QUICK_SEARCHES`에서 버튼 이름과 찾을 단어를 고칩니다.

## 카테고리 키워드 수정 방법

`js/config.js`의 `CATEGORY_KEYWORDS`를 고칩니다. '고병원성 AI'(조류인플루엔자)처럼 키워드가 다른 뜻으로 잘못 걸리는 경우는 `KEYWORD_EXCEPTIONS`에 그 단어를 추가합니다. 제목에 들어간 키워드가 가장 많은 분야로 분류되고,
동점이면 피드의 `defaultCategory`가 우선합니다. 같은 파일에서 빠른 검색어(`QUICK_SEARCHES`),
제외할 제목 꼬리표(`EXCLUDE_TITLE_PREFIXES`), 기사 묶기 기준(`GROUP_SIMILARITY`, `EVIDENCE_SIMILARITY`), 주요 뉴스 개수(`TOP_NEWS_COUNT`)도 바꿀 수 있습니다.

## BIG KINDS URL 수정 위치

`js/config.js`의 `BIGKINDS_URL` 한 곳입니다.
BIG KINDS는 현재 검색어를 URL로 넘기는 방식(`?query=`)을 지원하지 않아, 뉴스검색 페이지를 열고 검색어를 클립보드에 복사합니다.

## KRX API 설정 방법

1. [공공데이터포털](https://www.data.go.kr)에서 **금융위원회_일반상품시세정보** 활용신청 → 일반 인증키 발급
2. Vercel 프로젝트 → Settings → Environment Variables에 `DATA_GO_KR_SERVICE_KEY` 추가 후 재배포
   (로컬은 `.env.example`을 `.env`로 복사해 값 입력)

키가 없으면 상단에 "KRX 금 시세 연결 필요"로 표시되고 나머지 기능은 그대로 동작합니다. 시세는 전 영업일 종가(원/g)입니다.

## 프로젝트 구조

```
index.html              화면 뼈대
css/style.css           디자인
js/config.js            키워드·버튼·기준값 설정 (화면과 서버가 함께 사용)
js/app.js               검색·탭·기사 묶기·중요도 계산·화면 그리기
api/news.js             RSS 수집 (feedSources) → 오늘 기사 JSON, 5분 캐시
api/gold.js             KRX 금 시세 (공공데이터포털)
manifest.webmanifest    홈 화면 설치 정보
icons/                  앱 아이콘
dev-server.js           로컬 실행용 서버
vercel.json             Vercel 설정
```
