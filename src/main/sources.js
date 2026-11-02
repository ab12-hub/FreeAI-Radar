'use strict';
// sources.js —— 实时监控源定义 + GitHub API 抓取
// 所有信息均来自公开、可溯源的 GitHub 仓库，软件只推送"哪里有更新、去哪核实"，
// 不抓取、不分发任何第三方私密 API Key。

const UA = 'FreeAI-Radar/1.0 (+https://github.com/ab12-hub/FreeAI-Radar)';

// 内置监控源：均为公开维护的免费 AI 渠道汇总仓库
const BUILTIN_SOURCES = [
  {
    id: 'awesome-freellm-apis',
    owner: 'open-free-llm-api',
    repo: 'awesome-freellm-apis',
    label: 'Awesome FreeLLM APIs（每日自动刷新，含中文版）',
    url: 'https://github.com/open-free-llm-api/awesome-freellm-apis'
  },
  {
    id: 'cool-ai-stuff',
    owner: 'zukixa',
    repo: 'cool-ai-stuff',
    label: 'Cool AI Stuff（社区免费 AI API 列表）',
    url: 'https://github.com/zukixa/cool-ai-stuff'
  },
  {
    id: 'free-for-life',
    owner: 'wdhdev',
    repo: 'free-for-life',
    label: 'Free For Life（免费服务资源大全）',
    url: 'https://github.com/wdhdev/free-for-life'
  }
];

// 解析自定义源："owner/repo" 字符串 → 源对象
function parseCustomSources(list) {
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const m = String(item || '').trim().match(/^([\w.-]+)\/([\w.-]+)$/);
    if (m) {
      out.push({
        id: `custom-${m[1]}-${m[2]}`,
        owner: m[1],
        repo: m[2],
        label: `${m[1]}/${m[2]}（自定义监控）`,
        url: `https://github.com/${m[1]}/${m[2]}`
      });
    }
  }
  return out;
}

function ghHeaders(token) {
  const h = {
    'User-Agent': UA,
    'Accept': 'application/vnd.github+json'
  };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

async function ghFetch(url, token, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: ghHeaders(token), signal: ctrl.signal });
    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
      const err = new Error('GitHub API 限额已用尽（未认证 60 次/小时），可在设置中填入 GitHub Token 提升限额');
      err.code = 'RATE_LIMIT';
      throw err;
    }
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${url}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// 拉取某仓库最近提交
async function fetchCommits(owner, repo, token, perPage = 5) {
  const data = await ghFetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=${perPage}`, token);
  return (Array.isArray(data) ? data : []).map(c => ({
    sha: c.sha,
    subject: (c.commit && c.commit.message ? c.commit.message.split('\n')[0] : '').slice(0, 120),
    date: c.commit && c.commit.author ? c.commit.author.date : null,
    author: c.commit && c.commit.author ? c.commit.author.name : '',
    url: (c.html_url || `https://github.com/${owner}/${repo}/commit/${c.sha}`)
  }));
}

// 拉取某仓库最近 Release
async function fetchReleases(owner, repo, token, perPage = 3) {
  const data = await ghFetch(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=${perPage}`, token);
  return (Array.isArray(data) ? data : []).map(r => ({
    id: r.id,
    tag: r.tag_name,
    name: r.name || r.tag_name,
    date: r.published_at,
    url: r.html_url
  }));
}

module.exports = { BUILTIN_SOURCES, parseCustomSources, fetchCommits, fetchReleases };
