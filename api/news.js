// /api/news — 언론사 RSS를 모아 "오늘(한국시간) 기사"의 제목·언론사·시간·링크만 돌려준다.
// 기사 본문은 저장하거나 전달하지 않는다.
import { CATEGORY_KEYWORDS, EDITORIAL, OTHER, EXCLUDE_TITLE_PREFIXES } from '../js/config.js';

// 언론사 추가는 여기에 한 줄만 추가하면 된다.
//   url: 피드 주소 (여러 개면 배열) — 흥행성 기사를 줄이려고 '전체' 대신 정치·경제·사회·국제 섹션 피드를 쓴다
//   defaultCategory: 키워드로 분류되지 않을 때 쓸 분야
//   titleMatch: 이 글자가 제목에 있는 기사만 사용 (오피니언 피드에서 사설만 고를 때)
//   core: 핵심 매체(종합일간지·통신·방송) — 주요 뉴스 점수에서 1점, 그 외 매체는 0.5점
//   camp: 사설 논조 기준 '보수' / '진보' — 양쪽이 모두 다룬 사건에 가산점
const yna = s => `https://www.yna.co.kr/rss/${s}.xml`;
const chosun = s => `https://www.chosun.com/arc/outboundfeeds/rss/category/${s}/?outputType=xml`;
const sbs = id => `https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=${id}&plink=RSSREADER`;

export const feedSources = [
  { name: '연합뉴스', core: true, url: ['politics', 'northkorea', 'economy', 'industry', 'society', 'international'].map(yna) },
  { name: '조선일보', core: true, camp: '보수', url: ['politics', 'national', 'international', 'economy'].map(chosun) },
  { name: '동아일보', core: true, camp: '보수', url: ['politics', 'national', 'international', 'economy'].map(s => `https://rss.donga.com/${s}.xml`) },
  { name: '한겨레', core: true, camp: '진보', url: ['politics', 'society', 'international', 'economy'].map(s => `https://www.hani.co.kr/rss/${s}/`) },
  { name: '경향신문', core: true, camp: '진보', url: ['politic_news', 'society_news', 'kh_world', 'economy_news'].map(s => `https://www.khan.co.kr/rss/rssdata/${s}.xml`) },
  { name: 'SBS', core: true, url: ['01', '02', '03', '07'].map(sbs) },
  { name: '세계일보', core: true, url: ['politic', 'society'].map(s => `https://www.segye.com/Articles/RSSList/segye_${s}.xml`) },
  { name: '뉴시스', url: ['politics', 'society', 'economy', 'international'].map(s => `https://newsis.com/RSS/${s}.xml`) },
  { name: '오마이뉴스', url: 'http://rss.ohmynews.com/rss/ohmynews.xml' },
  { name: '한국경제', url: 'https://www.hankyung.com/feed/economy', defaultCategory: '경제·금융' },
  { name: '매일경제', url: 'https://www.mk.co.kr/rss/30100041/', defaultCategory: '경제·금융' },
  { name: '한국경제', url: 'https://www.hankyung.com/feed/it', defaultCategory: '과학·기술' },
  { name: '전자신문', url: 'https://rss.etnews.com/Section901.xml', defaultCategory: '과학·기술' },
  { name: '에듀프레스', url: 'https://www.edupress.kr/rss/allArticle.xml', defaultCategory: '교육' },
  { name: '교육플러스', url: 'https://www.edpl.co.kr/rss/allArticle.xml', defaultCategory: '교육' },
  { name: '한국대학신문', url: 'https://news.unn.net/rss/allArticle.xml', defaultCategory: '교육' },
  // 사설: 신문사가 '오늘 가장 중요하다'고 공식적으로 고른 주제 → 주요 뉴스의 가장 강한 근거로 쓴다
  { name: '조선일보', camp: '보수', url: chosun('opinion'), defaultCategory: EDITORIAL, titleMatch: '[사설]' },
  { name: '한겨레', camp: '진보', url: 'https://www.hani.co.kr/rss/opinion/', defaultCategory: EDITORIAL, titleMatch: '[사설]' },
  { name: '경향신문', camp: '진보', url: 'https://www.khan.co.kr/rss/rssdata/opinion_news.xml', defaultCategory: EDITORIAL, titleMatch: '[사설]' },
  { name: '한국경제', url: 'https://www.hankyung.com/feed/opinion', defaultCategory: EDITORIAL, titleMatch: '[사설]' },
  { name: '서울경제', url: 'https://www.sedaily.com/rss/opinion', defaultCategory: EDITORIAL, titleMatch: '[사설]' },
  { name: '세계일보', url: 'https://www.segye.com/Articles/RSSList/segye_opinion.xml', defaultCategory: EDITORIAL, titleMatch: '[사설]' },
  // 제외 (2026-10 확인): 중앙일보·MBC·뉴스1 빈 피드, JTBC 날짜 오류, 노컷뉴스 미래 시각, 국민일보 날짜 없음, 동아 사설 피드 빈 응답,
  // 아시아경제·서울경제 전체 피드는 하루 수백 건의 다량 생산 기사라 주요 뉴스 판단을 흐려 제외
];

// 연합뉴스 편집국이 고른 헤드라인: 이 제목의 기사 설명(description) 첫 줄이 그 시각의 톱 헤드라인이다.
const HEADLINE_DIGEST = '이 시각 헤드라인';

const FEED_TIMEOUT_MS = 6000;
// 피드를 끝까지 써야 아침 기사까지 겹쳐 '여러 언론사가 다룬 사건'을 찾을 수 있다.
const MAX_PER_FEED = 150;  // 언론사 피드 하나에서 쓰는 최대 기사 수
const MAX_TOTAL = 900;     // 시간이 있는 일반 기사 최대 수 (사설·날짜 없는 기사는 별도)
const CACHE_MS = 5 * 60 * 1000;
const KST = 9 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

let cache = null; // { at, body } — 같은 서버 인스턴스에서 5분간 재사용

export async function GET() {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    cache = { at: Date.now(), body: await collectNews(feedSources) };
  }
  return Response.json(cache.body, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=300' },
  });
}

export async function collectNews(sources) {
  // 주소가 여러 개인 언론사는 피드별로 나눠 받는다 (하나가 실패해도 나머지는 사용)
  const active = sources.filter(s => !s.disabled).flatMap(s => [].concat(s.url).map(url => ({ ...s, url })));
  const results = await Promise.allSettled(active.map(fetchFeed));
  const now = Date.now();
  const todayStart = Math.floor((now + KST) / (24 * HOUR)) * 24 * HOUR - KST; // 한국시간 오늘 00:00
  const ymd = t => new Date(t + KST).toISOString().slice(0, 10).replace(/-/g, '');
  const today = ymd(todayStart);              // 예: 20261005
  const yesterday = ymd(todayStart - 24 * HOUR);
  const editorialStart = todayStart - 9 * HOUR; // 사설은 전날 저녁(17~18시)에 미리 공개되므로 전날 15시부터 포함

  const failed = [];
  const seen = new Set();
  const news = [];
  const editorials = [];
  const headlines = [];

  results.forEach((r, i) => {
    const src = active[i];
    if (r.status === 'rejected') {
      failed.push(src.name);
      console.warn(`[news] ${src.name} 실패 (${src.url}): ${r.reason?.message}`);
      return;
    }
    for (const item of r.value.slice(0, MAX_PER_FEED)) {
      if (!item.title || !item.link || seen.has(item.link)) continue;
      if (item.title.includes(HEADLINE_DIGEST)) {
        const top = item.summary.match(/■\s*([^■]+)/); // 설명의 첫 '■ 제목'
        if (top && item.time >= todayStart && !headlines.some(h => h.title === top[1].trim())) {
          headlines.push({ title: top[1].trim(), publishedAt: new Date(item.time).toISOString() });
        }
        continue;
      }
      if (src.titleMatch && !item.title.includes(src.titleMatch)) continue;
      if (EXCLUDE_TITLE_PREFIXES.some(p => item.title.startsWith(p))) continue;
      if (!/[가-힣]/.test(item.title)) continue; // 한글이 없는 제목 = 외국어판 기사 (예: 조선일보 일본어판)
      const category = classify(item.title, src.defaultCategory);
      const since = category === EDITORIAL ? editorialStart : todayStart;
      if (item.time !== null && (item.time < since || item.time > now + HOUR)) continue;
      // 날짜가 없는 피드(한겨레)는 기사 사진 주소의 날짜(/2026/1005/)로 오늘 기사인지 판단한다.
      // (사설은 전날 저녁에 공개되므로 어제 날짜까지 허용)
      if (item.time === null && item.day && item.day !== today && !(category === EDITORIAL && item.day === yesterday)) continue;
      seen.add(item.link);
      (category === EDITORIAL ? editorials : news).push({
        id: hash(item.link),
        title: item.title,
        source: src.name,
        publishedAt: item.time === null ? null : new Date(item.time).toISOString(),
        category,
        link: item.link,
        // 사설은 RSS에 공식으로 들어 있는 첫 문단(약 200자)을 함께 전달한다. 전문은 가져오지 않는다.
        ...(category === EDITORIAL && item.summary ? { excerpt: excerpt(item.summary) } : {}),
      });
    }
  });

  const byTime = (a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || '');
  const dated = news.filter(a => a.publishedAt).sort(byTime).slice(0, MAX_TOTAL);
  const articles = [...dated, ...news.filter(a => !a.publishedAt), ...editorials.sort(byTime)];
  const okSources = [...new Set(active.filter((s, i) => results[i].status === 'fulfilled').map(s => s.name))];
  // 화면의 주요 뉴스 점수에 쓰는 언론사 정보 (핵심 매체 여부·논조)
  const outlets = {};
  for (const s of sources) outlets[s.name] = { core: !!(outlets[s.name]?.core || s.core), camp: outlets[s.name]?.camp || s.camp || null };
  return {
    updatedAt: new Date(now).toISOString(), articles, headlines, outlets,
    sources: okSources, failed: [...new Set(failed)].filter(name => !okSources.includes(name)),
  };
}

async function fetchFeed(src) {
  const res = await fetch(src.url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OneulNews/1.0; RSS reader)' },
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFeed(await res.text());
}

// 아주 작은 RSS/Atom 파서: 제목·링크·날짜와 RSS 요약문(summary)을 꺼낸다.
export function parseFeed(xml) {
  if (!/<(rss|feed|rdf:RDF)[\s>]/.test(xml)) throw new Error('RSS 형식이 아님');
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/(item|entry)>/g) || [];
  return blocks.map(b => ({
    title: tag(b, 'title'),
    link: tag(b, 'link') || (b.match(/<link[^>]*href="([^"]+)"/) || [])[1] || '',
    time: parseDate(tag(b, 'pubDate') || tag(b, 'dc:date') || tag(b, 'published') || tag(b, 'updated')),
    summary: tag(b, 'description') || tag(b, 'content:encoded'),
    day: (b.match(/\/(20\d\d)\/(\d{4})\//) || []).slice(1).join('') || null, // 사진 주소 속 날짜 (날짜 없는 피드용)
  }));
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  if (!m) return '';
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// RSS 요약문을 최대 200자로 자르고, 사설의 일부일 뿐임을 항상 '…'로 표시
const EXCERPT_MAX = 200;
function excerpt(text) {
  // 경향신문 등은 요약 앞에 사진 설명이 붙는다 ('…하고 있다. 연합뉴스 본문…') → 사진 출처 표시 뒤부터 사용
  const credit = text.slice(0, 200).match(/(연합뉴스|뉴시스|뉴스1|자료사진|로이터|(?<![A-Za-z])(?:AFP|AP|EPA)(?![A-Za-z]))(\.\s*|\s+|(?=[가-힣]))/);
  if (credit) text = text.slice(credit.index + credit[0].length);
  const t = text.length > EXCERPT_MAX ? text.slice(0, EXCERPT_MAX).replace(/\s*\S*$/, '') : text; // 단어 중간에서 자르지 않음
  return t.replace(/(\.{3}|…|·+|\s)+$/, '') + ' …'; // 언론사가 붙인 '···' 등은 정리
}

function parseDate(s) {
  if (!s) return null;
  // "2026-10-05 14:30:00"처럼 시간대가 없는 값은 한국시간으로 본다.
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s)) s = s.replace(' ', 'T') + '+09:00';
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

// 제목 키워드로 분야를 정한다. 키워드가 가장 많이 맞는 분야, 동점이면 언론사 섹션(defaultCategory) 우선.
export function classify(title, defaultCategory = OTHER) {
  if (defaultCategory === EDITORIAL || title.includes('[사설]')) return EDITORIAL;
  let best = defaultCategory;
  let bestScore = 0;
  for (const [category, words] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = words.filter(w => hasWord(title, w)).length;
    if (category === defaultCategory) score += 0.5;
    if (score > bestScore) [best, bestScore] = [category, score];
  }
  return best;
}

function hasWord(text, word) {
  if (!/^[A-Za-z]+$/.test(word)) return text.includes(word);
  return new RegExp(`(?<![A-Za-z])${word}(?![A-Za-z])`).test(text);
}

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}
