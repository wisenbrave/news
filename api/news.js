// /api/news — 언론사 RSS를 모아 "오늘(한국시간) 기사"의 제목·언론사·시간·링크만 돌려준다.
// 기사 본문은 저장하거나 전달하지 않는다.
import { CATEGORY_KEYWORDS, EDITORIAL, OTHER, EXCLUDE_TITLE_PREFIXES } from '../js/config.js';

// 언론사 추가는 여기에 한 줄만 추가하면 된다.
//   defaultCategory: 키워드로 분류되지 않을 때 쓸 분야
//   titleMatch: 이 글자가 제목에 있는 기사만 사용 (오피니언 피드에서 사설만 고를 때)
export const feedSources = [
  { name: '연합뉴스', url: 'https://www.yna.co.kr/rss/news.xml', defaultCategory: OTHER },
  { name: '조선일보', url: 'https://www.chosun.com/arc/outboundfeeds/rss/?outputType=xml', defaultCategory: OTHER },
  { name: '한겨레', url: 'https://www.hani.co.kr/rss/', defaultCategory: OTHER },
  { name: '경향신문', url: 'https://www.khan.co.kr/rss/rssdata/total_news.xml', defaultCategory: OTHER },
  { name: '동아일보', url: 'https://rss.donga.com/total.xml', defaultCategory: OTHER },
  { name: '한국경제', url: 'https://www.hankyung.com/feed/economy', defaultCategory: '경제·금융' },
  { name: '매일경제', url: 'https://www.mk.co.kr/rss/30100041/', defaultCategory: '경제·금융' },
  { name: '한국경제', url: 'https://www.hankyung.com/feed/it', defaultCategory: '과학·기술' },
  { name: '전자신문', url: 'https://rss.etnews.com/Section901.xml', defaultCategory: '과학·기술' },
  { name: '에듀프레스', url: 'https://www.edupress.kr/rss/allArticle.xml', defaultCategory: '교육' },
  { name: '교육플러스', url: 'https://www.edpl.co.kr/rss/allArticle.xml', defaultCategory: '교육' },
  { name: '한국대학신문', url: 'https://news.unn.net/rss/allArticle.xml', defaultCategory: '교육' },
  { name: '조선일보', url: 'https://www.chosun.com/arc/outboundfeeds/rss/category/opinion/?outputType=xml', defaultCategory: EDITORIAL, titleMatch: '[사설]' },
  { name: '한겨레', url: 'https://www.hani.co.kr/rss/opinion/', defaultCategory: EDITORIAL, titleMatch: '[사설]' },
  { name: '경향신문', url: 'https://www.khan.co.kr/rss/rssdata/opinion_news.xml', defaultCategory: EDITORIAL, titleMatch: '[사설]' },
  { name: '한국경제', url: 'https://www.hankyung.com/feed/opinion', defaultCategory: EDITORIAL, titleMatch: '[사설]' },
  // 중앙일보: rss.joins.com 피드가 빈 응답을 돌려줘 제외 (2026-10 확인)
  // { name: '중앙일보', url: 'https://rss.joins.com/joins_news_list.xml', defaultCategory: OTHER, disabled: true },
];

const FEED_TIMEOUT_MS = 6000;
const MAX_PER_FEED = 30;   // 언론사 피드 하나에서 쓰는 최대 기사 수
const MAX_TOTAL = 250;     // 시간이 있는 일반 기사 최대 수 (사설·날짜 없는 기사는 별도)
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
  const active = sources.filter(s => !s.disabled);
  const results = await Promise.allSettled(active.map(fetchFeed));
  const now = Date.now();
  const todayStart = Math.floor((now + KST) / (24 * HOUR)) * 24 * HOUR - KST; // 한국시간 오늘 00:00
  const editorialStart = todayStart - 9 * HOUR; // 사설은 전날 저녁(17~18시)에 미리 공개되므로 전날 15시부터 포함

  const failed = [];
  const seen = new Set();
  const news = [];
  const editorials = [];

  results.forEach((r, i) => {
    const src = active[i];
    if (r.status === 'rejected') {
      failed.push(src.name);
      console.warn(`[news] ${src.name} 실패: ${r.reason?.message}`);
      return;
    }
    for (const item of r.value.slice(0, MAX_PER_FEED)) {
      if (!item.title || !item.link || seen.has(item.link)) continue;
      if (src.titleMatch && !item.title.includes(src.titleMatch)) continue;
      if (EXCLUDE_TITLE_PREFIXES.some(p => item.title.startsWith(p))) continue;
      if (!/[가-힣]/.test(item.title)) continue; // 한글이 없는 제목 = 외국어판 기사 (예: 조선일보 일본어판)
      const category = classify(item.title, src.defaultCategory);
      const since = category === EDITORIAL ? editorialStart : todayStart;
      // 날짜가 없는 피드(예: 한겨레)는 최신 목록이므로 포함하되 시간은 비워 둔다.
      if (item.time !== null && (item.time < since || item.time > now + HOUR)) continue;
      seen.add(item.link);
      (category === EDITORIAL ? editorials : news).push({
        id: hash(item.link),
        title: item.title,
        source: src.name,
        publishedAt: item.time === null ? null : new Date(item.time).toISOString(),
        category,
        link: item.link,
      });
    }
  });

  const byTime = (a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || '');
  const dated = news.filter(a => a.publishedAt).sort(byTime).slice(0, MAX_TOTAL);
  const articles = [...dated, ...news.filter(a => !a.publishedAt), ...editorials.sort(byTime)];
  const okSources = [...new Set(active.filter((s, i) => results[i].status === 'fulfilled').map(s => s.name))];
  return { updatedAt: new Date(now).toISOString(), articles, sources: okSources, failed: [...new Set(failed)] };
}

async function fetchFeed(src) {
  const res = await fetch(src.url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OneulNews/1.0; RSS reader)' },
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFeed(await res.text());
}

// 아주 작은 RSS/Atom 파서: 제목·링크·날짜만 꺼낸다.
export function parseFeed(xml) {
  if (!/<(rss|feed|rdf:RDF)[\s>]/.test(xml)) throw new Error('RSS 형식이 아님');
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/(item|entry)>/g) || [];
  return blocks.map(b => ({
    title: tag(b, 'title'),
    link: tag(b, 'link') || (b.match(/<link[^>]*href="([^"]+)"/) || [])[1] || '',
    time: parseDate(tag(b, 'pubDate') || tag(b, 'dc:date') || tag(b, 'published') || tag(b, 'updated')),
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
