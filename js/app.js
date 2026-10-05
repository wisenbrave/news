import {
  TABS, EDITORIAL, OTHER, INTEREST_CATEGORIES, QUICK_SEARCHES, TODAY_KEYWORD_COUNT, KEYWORD_STOPWORDS, GOLD_URL, WEATHER_URL, BIGKINDS_URL,
  GROUP_SIMILARITY, GROUP_MAX_HOURS, EVIDENCE_SIMILARITY, EVIDENCE_LINK, TOP_NEWS_COUNT, TOP_NEWS_COUNT_WIDE,
} from './config.js';

const $ = id => document.getElementById(id);
const HOUR = 36e5;
const wide = matchMedia('(min-width: 1024px)'); // css/style.css의 PC 2단 기준과 같게
const topCount = () => (wide.matches ? TOP_NEWS_COUNT_WIDE : TOP_NEWS_COUNT);
const state = { articles: [], groups: [], keywords: [], outlets: {}, tab: '오늘', query: '', showAll: false, loading: true };

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
    state.outlets = data.outlets || {};
    // 사설·연합 헤드라인은 '이 이슈가 중요하다'는 근거로 뉴스 그룹에 연결된다
    const evidence = [
      ...state.articles.filter(a => a.category === EDITORIAL).map(a => ({ ...a, kind: 'editorial' })),
      ...(data.headlines || []).map(h => ({ ...h, kind: 'headline', source: '연합뉴스' })),
    ];
    state.groups = groupArticles(state.articles.filter(a => a.category !== EDITORIAL), evidence)
      .map(g => ({ ...g, rating: rate(g) }));
    state.keywords = todayKeywords(state.groups, state.articles.length);
    $('hot').innerHTML = '<span class="row-label">오늘의 핵심어</span>' +
      state.keywords.map(k => `<button type="button">${esc(k.label)}</button>`).join('');
    $('hot').hidden = !state.keywords.length;
    $('updated').textContent = `${kstTime.format(new Date(data.updatedAt))} 업데이트`;
    state.loadFailed = false; // 일부 언론사가 실패해도 따로 알리지 않고 받은 뉴스만 보여준다
  } catch {
    state.loadFailed = true;  // 이전 목록이 있으면 그대로 두고, 없을 때만 목록 자리에 안내
  }
  state.loading = false;
  $('refresh').disabled = false;
  render();
}

// ---------- 같은 사건 묶기 ----------
// 제목을 두 글자 조각(바이그램)으로 나눠 겹치는 비율이 GROUP_SIMILARITY 이상이면 같은 사건으로 본다.
// 한국어는 조사가 붙어 단어 비교보다 두 글자 조각 비교가 정확하다.
// 드문 조각일수록 무게를 크게 준다: 오늘 기사 몇 건에만 나오는 '해킹'·'차귀도'가 겹치는 것은
// 수십 건에 나오는 '대통'·'정부'가 겹치는 것보다 같은 사건이라는 강한 증거다. (검색엔진의 IDF와 같은 원리)

function bigrams(title) {
  const text = title
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')   // [단독], (종합) 같은 꼬리표 제거
    .toLowerCase()
    .replace(/[^0-9a-z가-힣\s]/g, ' ');
  const set = new Set();
  for (const w of text.split(/\s+/)) {
    for (let i = 0; i < w.length - 1; i++) {
      const g = w.slice(i, i + 2);
      if (!/^\d\d$/.test(g)) set.add(g); // '00','10' 같은 숫자 조각은 아무 기사에나 겹치므로 제외
    }
  }
  return set;
}

// 유사도(가중 Jaccard) = 겹친 조각들의 무게 합 ÷ 두 제목 전체 조각의 무게 합.
// 앞서 처리한 기사 중 이 유사도가 기준 이상인 기사가 있으면 그 기사의 그룹에 넣고, 없으면 새 그룹을 만든다.
// 빠르게 하려고 '조각 → 그 조각이 나온 기사 목록'(색인)을 만들어, 조각을 하나라도 공유하는 기사끼리만 비교한다.
//
// evidence(사설·연합 헤드라인)는 새 그룹을 만들지 않고, 가장 비슷한 뉴스 그룹에 '중요하다는 근거'로 붙는다.
function groupArticles(articles, evidence = []) {
  const all = articles.map(a => bigrams(a.title));
  const df = new Map(); // 조각별로 몇 개 기사 제목에 나오는지
  for (const set of all) for (const g of set) df.set(g, (df.get(g) || 0) + 1);
  const maxWeight = Math.log(articles.length + 1); // 뉴스 제목에 한 번도 안 나온 조각
  const weight = new Map([...df].map(([g, n]) => [g, Math.log((articles.length + 1) / n)]));
  const sum = set => [...set].reduce((s, g) => s + (weight.get(g) ?? maxWeight), 0);
  const totals = all.map(sum);

  const groups = [];
  const groupOf = [];        // 기사 번호 → 그룹 번호
  const index = new Map();   // 조각 → 이미 처리한 기사 번호들
  articles.forEach((article, i) => {
    const t = Date.parse(article.publishedAt) || null;
    const common = new Map(); // 앞 기사 번호 → 겹친 조각 무게 합
    for (const g of all[i]) for (const j of index.get(g) || []) common.set(j, (common.get(j) || 0) + weight.get(g));

    let best = -1; // 조건을 만족하는 그룹 중 가장 먼저 만들어진 그룹
    for (const [j, c] of common) {
      const gi = groupOf[j];
      const time = groups[gi].time;
      if ((best === -1 || gi < best) && c / (totals[i] + totals[j] - c) >= GROUP_SIMILARITY &&
          (!t || !time || Math.abs(time - t) <= GROUP_MAX_HOURS * HOUR)) best = gi;
    }
    if (best === -1) { best = groups.length; groups.push({ lead: article, related: [], time: t }); }
    else groups[best].related.push(article);
    groupOf[i] = best;
    for (const g of all[i]) { if (!index.has(g)) index.set(g, []); index.get(g).push(i); }
  });

  // 사설·헤드라인 연결: 사설은 사건 하나가 아니라 이슈 전체를 다루므로, 사설 하나와 비슷한 뉴스 그룹들은
  // 같은 이슈의 조각으로 보고 하나로 합친다. 같은 주제를 다룬 사설끼리도 서로 잇는다.
  // (예: 'AI 해킹' 사설들이 '증권업계 긴장', '보안 100점 은행', '해킹 당한 금융사' 기사 묶음을 한 이슈로 모은다)
  // 번호 0~(그룹 수-1)은 뉴스 그룹, 그 뒤는 사설·헤드라인
  const root = [...groups, ...evidence].map((_, n) => n);
  const find = n => (root[n] === n ? n : (root[n] = find(root[n])));
  const join = (a, b) => { root[find(a)] = find(b); };
  const evGrams = evidence.map(item => bigrams(item.title));
  const evTotals = evGrams.map(sum);
  evidence.forEach((item, k) => {
    const common = new Map();
    for (const g of evGrams[k]) for (const j of index.get(g) || []) common.set(j, (common.get(j) || 0) + weight.get(g));
    for (const [j, c] of common) if (c / (evTotals[k] + totals[j] - c) >= EVIDENCE_SIMILARITY) join(groups.length + k, groupOf[j]);
    for (let m = 0; m < k; m++) {
      let c = 0;
      for (const g of evGrams[k]) if (evGrams[m].has(g)) c += weight.get(g) ?? maxWeight;
      if (c / (evTotals[k] + evTotals[m] - c) >= EVIDENCE_LINK) join(groups.length + k, groups.length + m);
    }
  });

  const merged = new Map(); // 대표 번호 → 합쳐진 이슈
  const issue = n => {
    if (!merged.has(find(n))) merged.set(find(n), { parts: [], evidence: [] });
    return merged.get(find(n));
  };
  groups.forEach((g, gi) => issue(gi).parts.push(g));
  evidence.forEach((item, k) => issue(groups.length + k).evidence.push(item));
  return [...merged.values()].filter(m => m.parts.length).map(m => { // 뉴스 없이 사설만 있는 주제는 제외
    // 가장 많은 언론사가 보도한 조각의 대표 기사를 전체 이슈의 대표 기사로
    m.parts.sort((a, b) => sourceCount(b) - sourceCount(a) || b.related.length - a.related.length);
    const [main, ...others] = m.parts;
    return { lead: main.lead, related: [...main.related, ...others.flatMap(p => [p.lead, ...p.related])], time: main.time, evidence: m.evidence };
  });
}

// 대표 헤드라인 점수 — 클릭을 노린 기사보다 '편집국이 중요하다고 판단한 흔적'을 크게 본다. (하루 전체 기준)
//   사설로 다룬 신문사 1곳당 +3   신문사가 '오늘 가장 중요하다'고 공식적으로 고른 주제
//   연합뉴스 편집국 헤드라인 +3
//   보수·진보 매체 모두 보도 +2   한쪽 진영의 관심사가 아니라 모두가 다룰 수밖에 없는 사건
//   보도한 언론사 1곳당 핵심 매체(종합지·통신·방송) 1점, 그 외 0.5점
//   관심 분야(경제·과학) +0.3
function rate(group) {
  const outlet = name => state.outlets[name] || {};
  const papers = [...new Set(group.evidence.filter(e => e.kind === 'editorial').map(e => e.source))];
  const headline = group.evidence.some(e => e.kind === 'headline');
  const sources = [...new Set([group.lead, ...group.related].map(a => a.source))];
  const camps = new Set([...sources, ...papers].map(name => outlet(name).camp).filter(Boolean));
  const bothCamps = camps.has('보수') && camps.has('진보');
  const coverage = sources.reduce((sum, name) => sum + (outlet(name).core ? 1 : 0.5), 0);
  const score = papers.length * 3 + (headline ? 3 : 0) + (bothCamps ? 2 : 0) + coverage +
    (INTEREST_CATEGORIES.includes(group.lead.category) ? 0.3 : 0);
  const reasons = [
    papers.length && `사설 ${papers.length}곳`,
    headline && '연합 헤드라인',
    bothCamps && '보수·진보 모두 보도',
    sources.length > 1 && `${sources.length}개 언론사`,
  ].filter(Boolean);
  return { score, reasons, papers };
}

const sourceCount = group => new Set([group.lead, ...group.related].map(a => a.source)).size;

// ---------- 검색 ----------

function matches(article, terms) {
  const text = `${article.title} ${article.source} ${article.category}`.toLowerCase();
  return terms.every(t => {
    const pattern = t.replace(/\W/g, '\\$&');
    if (t.length === 1) return new RegExp(`(^|[^가-힣a-z0-9])${pattern}([^가-힣a-z0-9]|$)`).test(text); // 한 글자는 단독 단어만 (예: '금' ≠ '금리')
    if (/^[a-z0-9&]+$/.test(t)) return new RegExp(`(^|[^a-z])${pattern}([^a-z]|$)`).test(text); // 영문은 다른 영단어의 일부면 제외 (예: 'ms' ≠ 'items')
    return text.includes(t);
  });
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
  // 왜 주요 뉴스인지: 사설 n곳 · 연합 헤드라인 · 보수·진보 모두 보도 · n개 언론사
  const why = g.rating.reasons.length
    ? `<div class="why">${g.rating.reasons.map(r => `<span>${esc(r)}</span>`).join('')}</div>` : '';
  const editorials = g.evidence.filter(e => e.kind === 'editorial');
  const items = [...editorials, ...g.related];
  const related = items.length
    ? `<details><summary>관련 기사 ${g.related.length}건${editorials.length ? ` · 사설 ${editorials.length}건` : ''}</summary><ul>${items.map(a =>
        `<li><a href="${esc(a.link)}" target="_blank" rel="noopener">${esc(a.title)}</a><span class="meta">${esc(meta(a, false))}</span></li>`).join('')}</ul></details>`
    : '';
  return `<li class="item">${link(g.lead)}<div class="meta">${esc(meta(g.lead))}</div>${why}${related}</li>`;
}

function editorialView(list) {
  const bySource = new Map();
  for (const a of list) bySource.set(a.source, [...(bySource.get(a.source) || []), a]);
  return [...bySource].map(([source, items]) => `
    <section class="paper">
      <h3>${esc(source)}</h3>
      <ul class="list">${items.map(a => {
        const title = a.title.replace(/\s*\[사설\]\s*/, ' ').trim();
        const lead = a.excerpt ? `<p class="excerpt">${esc(a.excerpt)}</p>` : '';
        const time = timeOf(a) ? `<div class="meta">${esc(timeOf(a))}</div>` : '';
        return `<li class="item">${link({ ...a, title })}${lead}${time}</li>`;
      }).join('')}</ul>
    </section>`).join('');
}

// ---------- 오늘의 핵심어 ----------
// 주요 뉴스 상위 이슈마다 대표 기사 제목의 단어 중, 그 이슈를 다룬 언론사 여러 곳이 쓰고(공통)
// 오늘 다른 기사에는 드문(특징) 단어 2개를 고른다. 누르면 그 이슈로 묶인 기사를 보여준다.
const JOSA = /(으로|에서|에게|까지|부터|이라|라며|에도|처럼|보다|와의|과의|의|은|는|이|가|을|를|에|도|로|와|과|만|서|엔)$/;
const VERB = /(다|해|해야|하라|말라|라며|하고|하는|했던|하며|한다|된다|될까|나|까|죠|요|며|고|던|는)$/; // 서술어는 제외
const STOPWORDS = new Set(KEYWORD_STOPWORDS);

function titleWords(title) {
  return [...new Set(title.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').split(/[^0-9A-Za-z가-힣]+/)
    .map(w => (w.length > 2 ? w.replace(JOSA, '') : w))
    .filter(w => w.length >= 2 && !/^\d/.test(w) && !STOPWORDS.has(w) && !(w.length > 2 && VERB.test(w))))];
}

function todayKeywords(groups, articleCount) {
  const df = new Map(); // 단어별로 오늘 몇 개 기사 제목에 나오는지
  for (const g of groups) for (const a of [g.lead, ...g.related]) for (const w of titleWords(a.title)) df.set(w, (df.get(w) || 0) + 1);
  const used = new Set();
  const keywords = [];
  for (const g of [...groups].sort((a, b) => b.rating.score - a.rating.score)) {
    if (keywords.length >= TODAY_KEYWORD_COUNT) break;
    const articles = [g.lead, ...g.related];
    const sources = new Set(articles.map(a => a.source));
    if (sources.size < 2) continue; // 한 언론사만 다룬 기사는 '오늘의 핵심'으로 보지 않음
    const cover = new Map(); // 단어별로 이 이슈를 다룬 언론사 몇 곳이 썼는지
    for (const s of sources) {
      for (const w of new Set(articles.filter(a => a.source === s).flatMap(a => titleWords(a.title)))) cover.set(w, (cover.get(w) || 0) + 1);
    }
    const lead = titleWords(g.lead.title);
    const best = lead.filter(w => (cover.get(w) || 0) >= 2 && !used.has(w))
      .map(w => [w, (cover.get(w) / sources.size) * Math.log(articleCount / df.get(w)) * (w.length >= 3 ? 1.2 : 1)])
      .sort((x, y) => y[1] - x[1]).slice(0, 2).map(x => x[0])
      .sort((x, y) => lead.indexOf(x) - lead.indexOf(y)); // 제목에 나오는 순서대로
    if (!best.length) continue;
    best.forEach(w => used.add(w));
    keywords.push({ label: best.join(' '), ids: new Set(articles.map(a => a.id)) });
  }
  return keywords;
}

// 이슈 묶음이 어느 분야 탭에 속하는지: 대표 기사의 분야이거나, 묶인 기사 절반 이상이 그 분야
function groupInTab(group, tab) {
  const all = [group.lead, ...group.related];
  return group.lead.category === tab || all.filter(a => a.category === tab).length * 2 >= all.length;
}

function render() {
  const terms = searchTerms();
  const quickWords = QUICK_SEARCHES[state.query.trim()]; // 빠른 검색 버튼이면 연결된 단어 중 하나만 맞아도 표시
  const issue = state.keywords.find(k => k.label === state.query.trim()); // 오늘의 핵심어면 그 이슈의 기사도 표시
  const hit = a => !terms.length || (quickWords
    ? quickWords.some(w => matches(a, [w.toLowerCase()]))
    : issue?.ids.has(a.id) || matches(a, terms));
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

  if (state.tab !== EDITORIAL && !terms.length) {
    // '오늘'과 분야 탭 모두 같은 이슈 묶음·중요도 점수로 주요 뉴스를 먼저 보여준다
    const tabGroups = state.tab === '오늘' ? state.groups : state.groups.filter(g => groupInTab(g, state.tab));
    const groups = state.showAll ? tabGroups : [...tabGroups].sort((a, b) => b.rating.score - a.rating.score).slice(0, topCount());
    const name = state.tab === '오늘' ? '오늘' : state.tab;
    heading = state.showAll ? `${name} 전체 뉴스` : state.tab === '오늘' ? '오늘의 주요 뉴스' : `${name} 주요 뉴스`;
    html = groups.length ? `<ul class="list">${groups.map(groupItem).join('')}</ul>` : '';
    if (tabGroups.length > topCount()) {
      $('show-all').hidden = false;
      $('show-all').textContent = state.showAll ? '주요 뉴스만 보기' : `전체 ${name} 뉴스 보기 (${list.length}건)`;
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
    : state.articles.length ? '아직 이 분야의 오늘 기사가 없습니다.'
    : state.loadFailed ? '뉴스를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.' : '표시할 뉴스가 없습니다.'}</p>`;

  const q = state.query.trim();
  $('bigkinds').textContent = q ? `BIG KINDS에서 "${q}" 더 검색`
    : state.tab !== '오늘' ? `BIG KINDS에서 ${state.tab} 더 검색` : 'BIG KINDS 상세검색';
  $('clear').hidden = !state.query;
  document.querySelectorAll('#hot button, #quick button').forEach(b => b.setAttribute('aria-pressed', b.textContent === q));
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

// 다크·화이트 모드 전환 (기본 화이트, 고른 모드는 이 기기에 기억)
function applyTheme(theme) {
  const dark = theme === 'dark';
  if (dark) document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  $('theme').textContent = dark ? '☀' : '☾';
  $('theme').setAttribute('aria-label', dark ? '화이트 모드로 바꾸기' : '다크 모드로 바꾸기');
  $('theme').title = dark ? '화이트 모드' : '다크 모드';
  document.querySelector('meta[name="theme-color"]').content = dark ? '#0b0b0c' : '#ffffff';
}
applyTheme(document.documentElement.dataset.theme);
$('theme').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem('theme', next); } catch { /* 저장이 막힌 브라우저에서는 이번 방문에만 적용 */ }
});

$('today').textContent = kstDate.format(new Date());
$('gold').href = GOLD_URL;
$('weather').href = WEATHER_URL;
$('quick').innerHTML = '<span class="row-label">관심 기술</span>' + Object.keys(QUICK_SEARCHES).map(w => `<button type="button">${esc(w)}</button>`).join('');
$('tabs').innerHTML = TABS.map(tab => `<button type="button" data-tab="${tab}">${tab} <span></span></button>`).join('');

$('q').addEventListener('input', e => { state.query = e.target.value; render(); });
$('q').form.addEventListener('submit', e => { e.preventDefault(); $('q').blur(); }); // 폰 키보드의 '검색'을 누르면 키보드 닫기
$('clear').addEventListener('click', () => { setQuery(''); $('q').focus(); });
for (const row of ['hot', 'quick']) {
  $(row).addEventListener('click', e => {
    if (e.target.tagName === 'BUTTON') setQuery(state.query.trim() === e.target.textContent ? '' : e.target.textContent);
  });
}
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
$('bigkinds').addEventListener('click', () => openBigKinds(state.query.trim()));

wide.addEventListener('change', render); // 창 크기를 바꾸면 보여줄 개수도 다시 맞춤
render();
loadNews();
