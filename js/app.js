import {
  TABS, EDITORIAL, OTHER, INTEREST_CATEGORIES, QUICK_SEARCHES, GOLD_QUERY, BIGKINDS_URL,
  GROUP_SIMILARITY, GROUP_MAX_HOURS, EVIDENCE_SIMILARITY, EVIDENCE_LINK, TOP_NEWS_COUNT,
} from './config.js';

const $ = id => document.getElementById(id);
const HOUR = 36e5;
const state = { articles: [], groups: [], outlets: {}, tab: '오늘', query: '', showAll: false, loading: true };

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
//   관심 분야(경제·과학·교육) +0.3
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
    const groups = state.showAll ? state.groups : [...state.groups].sort((a, b) => b.rating.score - a.rating.score).slice(0, TOP_NEWS_COUNT);
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
