import {
  TABS, EDITORIAL, OTHER, INTEREST_CATEGORIES, QUICK_SEARCHES, GOLD_QUERY, BIGKINDS_URL,
  GROUP_SIMILARITY, GROUP_MAX_HOURS, TOP_NEWS_COUNT,
} from './config.js';

const $ = id => document.getElementById(id);
const HOUR = 36e5;
const state = { articles: [], groups: [], tab: '오늘', query: '', showAll: false, loading: true };

const kstTime = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
const kstDate = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'long' });

// ---------- 데이터 ----------

async function loadNews() {
  state.loading = true;
  $('refresh').disabled = true;
  try {
    const res = await fetch('/api/news');
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    state.articles = data.articles || [];
    state.groups = groupArticles(state.articles.filter(a => a.category !== EDITORIAL));
    $('updated').textContent = `${kstTime.format(new Date(data.updatedAt))} 업데이트`;
    showNotice(data.failed?.length ? `일부 뉴스를 불러오지 못했습니다. (${data.failed.join(', ')})` : '');
  } catch {
    showNotice(state.articles.length
      ? '일부 뉴스를 불러오지 못했습니다. 이전 목록을 보여드립니다.'
      : '뉴스를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.');
  }
  state.loading = false;
  $('refresh').disabled = false;
  render();
}

async function loadGold() {
  const el = $('gold-value');
  try {
    const g = await (await fetch('/api/gold')).json();
    if (!g.ok) throw new Error();
    const up = g.changeRate >= 0;
    el.innerHTML = `1g ₩${g.price.toLocaleString('ko-KR')} <span class="${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(g.changeRate).toFixed(2)}%</span>`;
    $('gold').title = `${g.date.slice(4, 6)}/${g.date.slice(6)} 종가 · 금 관련 뉴스 보기`;
  } catch {
    el.textContent = '시세 연결 필요';
  }
}

function showNotice(text) {
  $('notice').textContent = text;
  $('notice').hidden = !text;
}

// ---------- 같은 사건 묶기 ----------
// 제목을 두 글자 조각(바이그램)으로 나눠 겹치는 비율(Jaccard)이 GROUP_SIMILARITY 이상이면
// 같은 사건으로 본다. 한국어는 조사가 붙어 단어 비교보다 두 글자 조각 비교가 정확하다.
// 예: "한국은행이 기준금리 동결" ↔ "한은, 기준금리 동결" → '기준','준금','금리','동결' 공유

function bigrams(title) {
  const text = title
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')   // [단독], (종합) 같은 꼬리표 제거
    .toLowerCase()
    .replace(/[^0-9a-z가-힣\s]/g, ' ');
  const set = new Set();
  for (const w of text.split(/\s+/)) for (let i = 0; i < w.length - 1; i++) set.add(w.slice(i, i + 2));
  return set;
}

function similarity(a, b) {
  let common = 0;
  for (const g of a) if (b.has(g)) common++;
  return common / (a.size + b.size - common || 1);
}

function groupArticles(articles) {
  const groups = [];
  for (const article of articles) {
    const grams = bigrams(article.title);
    const t = Date.parse(article.publishedAt) || null;
    const match = groups.find(g =>
      (!t || !g.time || Math.abs(g.time - t) <= GROUP_MAX_HOURS * HOUR) &&
      g.grams.some(other => similarity(other, grams) >= GROUP_SIMILARITY));
    if (match) { match.related.push(article); match.grams.push(grams); }
    else groups.push({ lead: article, related: [], grams: [grams], time: t });
  }
  return groups;
}

// 중요도 = 함께 보도한 언론사 수(가장 큼) + 최근성(0~1) + 관심 분야 가산(0.5)
function importance(group) {
  const sources = new Set([group.lead, ...group.related].map(a => a.source)).size;
  const hoursAgo = group.time ? (Date.now() - group.time) / HOUR : 12;
  const recency = Math.max(0, 1 - hoursAgo / 12);
  const interest = INTEREST_CATEGORIES.includes(group.lead.category) ? 0.5 : 0;
  return (sources - 1) * 2 + recency + interest;
}

// ---------- 검색 ----------

function matches(article, terms) {
  const text = `${article.title} ${article.source} ${article.category}`.toLowerCase();
  return terms.every(t => t.length > 1
    ? text.includes(t)
    : new RegExp(`(^|[^가-힣a-z0-9])${t.replace(/\W/g, '\\$&')}([^가-힣a-z0-9]|$)`).test(text)); // 한 글자는 단독 단어만 (예: '금' ≠ '금리')
}

function searchTerms() {
  return state.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

// ---------- 화면 ----------

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const timeOf = a => (a.publishedAt ? kstTime.format(new Date(a.publishedAt)) : '');
const meta = (a, withCategory = true) =>
  [a.source, timeOf(a), withCategory && a.category !== OTHER ? a.category : ''].filter(Boolean).join(' · ');
const link = a => `<a class="title" href="${esc(a.link)}" target="_blank" rel="noopener">${esc(a.title)}</a>`;

function articleItem(a) {
  return `<li class="item">${link(a)}<div class="meta">${esc(meta(a))}</div></li>`;
}

function groupItem(g) {
  const related = g.related.length
    ? `<details><summary>관련 보도 ${g.related.length}개 <span class="meta">${esc([...new Set(g.related.map(a => a.source))].join(', '))}</span></summary><ul>${g.related.map(a =>
        `<li><a href="${esc(a.link)}" target="_blank" rel="noopener">${esc(a.title)}</a><span class="meta">${esc(meta(a, false))}</span></li>`).join('')}</ul></details>`
    : '';
  return `<li class="item">${link(g.lead)}<div class="meta">${esc(meta(g.lead))}</div>${related}</li>`;
}

function editorialView(list) {
  const bySource = new Map();
  for (const a of list) bySource.set(a.source, [...(bySource.get(a.source) || []), a]);
  return [...bySource].map(([source, items]) => `
    <section class="paper">
      <h3>${esc(source)}</h3>
      <ul class="list">${items.map(a => {
        const title = a.title.replace(/\s*\[사설\]\s*/, ' ').trim();
        return `<li class="item">${link({ ...a, title })}<div class="meta">${esc(timeOf(a))}
          <button class="mini" type="button" data-bk="${esc(title)}">BIG KINDS에서 더 검색</button></div></li>`;
      }).join('')}</ul>
    </section>`).join('');
}

function render() {
  const terms = searchTerms();
  const quickWords = QUICK_SEARCHES[state.query.trim()]; // 빠른 검색 버튼이면 연결된 단어 중 하나만 맞아도 표시
  const hit = a => !terms.length || (quickWords
    ? quickWords.some(w => matches(a, [w.toLowerCase()]))
    : matches(a, terms));
  const inTab = (a, tab) => (tab === '오늘' ? a.category !== EDITORIAL : a.category === tab);

  // 탭: 검색어가 있으면 검색 결과 수를 보여준다 (버튼은 그대로 두고 숫자만 바꿔 가로 스크롤 위치 유지)
  for (const b of $('tabs').children) {
    b.setAttribute('aria-pressed', b.dataset.tab === state.tab);
    b.lastChild.textContent = state.articles.filter(a => inTab(a, b.dataset.tab) && hit(a)).length;
  }

  const list = state.articles.filter(a => inTab(a, state.tab) && hit(a));
  const sourceCount = new Set(list.map(a => a.source)).size;
  let html;
  let heading = state.tab;
  $('show-all').hidden = true;

  if (state.tab === '오늘' && !terms.length) {
    const groups = state.showAll ? state.groups : [...state.groups].sort((a, b) => importance(b) - importance(a)).slice(0, TOP_NEWS_COUNT);
    heading = state.showAll ? '오늘 전체 뉴스' : '오늘의 주요 뉴스';
    html = groups.length ? `<ul class="list">${groups.map(groupItem).join('')}</ul>` : '';
    if (state.groups.length > TOP_NEWS_COUNT) {
      $('show-all').hidden = false;
      $('show-all').textContent = state.showAll ? '주요 뉴스만 보기' : `전체 오늘 뉴스 보기 (${list.length}건)`;
    }
  } else if (state.tab === EDITORIAL) {
    html = list.length ? editorialView(list) : '';
  } else {
    if (terms.length) heading = state.tab === '오늘' ? '검색 결과' : `${state.tab} 검색 결과`;
    html = list.length ? `<ul class="list">${list.map(articleItem).join('')}</ul>` : '';
  }

  $('heading').textContent = heading;
  $('summary').textContent = list.length ? `${list.length}건 · ${sourceCount}개 언론사` : '';
  $('list').innerHTML = html || `<p class="empty">${terms.length
    ? `"${esc(state.query.trim())}" 검색 결과가 없습니다.`
    : state.loading ? '뉴스를 불러오는 중…'
    : state.articles.length ? '아직 이 분야의 오늘 기사가 없습니다.' : '표시할 뉴스가 없습니다.'}</p>`;

  const q = state.query.trim();
  $('bigkinds').textContent = q ? `BIG KINDS에서 "${q}" 더 검색`
    : state.tab !== '오늘' ? `BIG KINDS에서 ${state.tab} 더 검색` : 'BIG KINDS 상세검색';
  $('clear').hidden = !state.query;
  $('quick').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.textContent === q));
}

// BIG KINDS는 검색어를 URL로 받지 않으므로, 검색어를 복사해 두고 검색 페이지를 연다.
function openBigKinds(query) {
  const tip = $('bigkinds-tip');
  tip.hidden = true;
  if (query) {
    navigator.clipboard?.writeText(query).then(() => {
      tip.textContent = `"${query}" 복사됨 · BIG KINDS 검색창에 붙여넣으세요.`;
      tip.hidden = false;
    }, () => {});
  }
  window.open(BIGKINDS_URL, '_blank', 'noopener');
}

function setQuery(q) {
  state.query = q;
  $('q').value = q;
  render();
}

// ---------- 이벤트 ----------

$('today').textContent = kstDate.format(new Date());
$('quick').innerHTML = Object.keys(QUICK_SEARCHES).map(w => `<button type="button">${esc(w)}</button>`).join('');
$('tabs').innerHTML = TABS.map(tab => `<button type="button" data-tab="${tab}">${tab} <span></span></button>`).join('');

$('q').addEventListener('input', e => { state.query = e.target.value; render(); });
$('q').form.addEventListener('submit', e => { e.preventDefault(); $('q').blur(); }); // 폰 키보드의 '검색'을 누르면 키보드 닫기
$('clear').addEventListener('click', () => { setQuery(''); $('q').focus(); });
$('quick').addEventListener('click', e => {
  if (e.target.tagName === 'BUTTON') setQuery(state.query.trim() === e.target.textContent ? '' : e.target.textContent);
});
$('tabs').addEventListener('click', e => {
  const button = e.target.closest('button');
  if (!button) return;
  state.tab = button.dataset.tab;
  state.showAll = false;
  render();
  button.scrollIntoView({ block: 'nearest', inline: 'nearest' }); // 폰에서 잘린 탭을 누르면 화면 안으로
});
$('show-all').addEventListener('click', () => { state.showAll = !state.showAll; render(); });
$('refresh').addEventListener('click', loadNews);
$('gold').addEventListener('click', () => { state.tab = '오늘'; setQuery(GOLD_QUERY); });
$('bigkinds').addEventListener('click', () => openBigKinds(state.query.trim()));
$('list').addEventListener('click', e => {
  if (e.target.dataset.bk) openBigKinds(e.target.dataset.bk);
});

render();
loadNews();
loadGold();
