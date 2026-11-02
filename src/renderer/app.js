'use strict';
/* FreeAI Radar 前端逻辑：渠道广场 / SSE 实时推送 / 健康状态 / 设置 */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let state = null;            // /api/state 快照
let lastEventId = null;      // 用于推送流未读角标
let checking = false;        // 健康检查进行中
let countdownTimer = null;

const CAT_LABEL = { official: '官方免费层', credit: '注册送额度', keyless: '无需密钥', community: '社区网关' };
const REGION_LABEL = { intl: '国际', cn: '国内' };
const TRUST_LABEL = { official: '官方来源', community: '社区来源' };
const STATUS_LABEL = { ok: '可达', fail: '不可达', unknown: '未验证' };
const EVT_ICON = { source_update: '📡', release: '🚀', seed: '✅', health: '🩺', system: '⚙️' };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function toast(title, detail, warn) {
  const el = document.createElement('div');
  el.className = 'toast' + (warn ? ' warn' : '');
  el.innerHTML = `<b>${esc(title)}</b>${esc(detail || '')}`;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

// ---------- 渲染：渠道广场 ----------
function currentFilters() {
  return {
    q: $('#f-search').value.trim().toLowerCase(),
    category: $('#f-category').value,
    region: $('#f-region').value,
    keyless: $('#f-keyless').value,
    trust: $('#f-trust').value,
    sort: $('#f-sort').value
  };
}

function channelMatches(ch, f) {
  if (f.category && ch.category !== f.category) return false;
  if (f.region && ch.region !== f.region) return false;
  if (f.keyless === 'yes' && !ch.keyless) return false;
  if (f.keyless === 'no' && ch.keyless) return false;
  if (f.trust && ch.trust !== f.trust) return false;
  if (f.q) {
    const hay = [ch.name, ch.provider, ch.notes, (ch.models || []).join(' '), (ch.tags || []).join(' ')].join(' ').toLowerCase();
    if (!hay.includes(f.q)) return false;
  }
  return true;
}

function renderChannels() {
  if (!state) return;
  const f = currentFilters();
  let list = state.channels.filter(ch => channelMatches(ch, f));
  if (f.sort === 'status') {
    const rank = { ok: 0, unknown: 1, fail: 2 };
    list = list.slice().sort((a, b) => (rank[a.status] ?? 1) - (rank[b.status] ?? 1));
  } else if (f.sort === 'name') {
    list = list.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN'));
  }
  $('#ch-count').textContent = `共 ${list.length} / ${state.channels.length} 条`;
  $('#channel-grid').innerHTML = list.map(ch => {
    const models = ch.models || [];
    const shown = models.slice(0, 4);
    const more = models.length - shown.length;
    const tags = (ch.tags || []).map(t => `<span class="chip">${esc(t)}</span>`).join('');
    const updated = ch.updatedAt ? ` · 更新于 ${fmtTime(ch.updatedAt)}` : '';
    return `
    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-title">${esc(ch.name)}</div>
          <div class="card-provider">${esc(ch.provider)} · ${REGION_LABEL[ch.region] || ''} · ${TRUST_LABEL[ch.trust] || ''}${updated}</div>
        </div>
        <span class="dot ${esc(ch.status || 'unknown')}" title="${STATUS_LABEL[ch.status] || '未验证'}：${esc(ch.checkDetail || '')}"></span>
      </div>
      <div class="chips">
        <span class="chip cat-${esc(ch.category)}">${CAT_LABEL[ch.category] || ch.category}</span>
        <span class="chip">${ch.keyless ? '🆓 免注册' : '🔑 需领 Key'}</span>
        ${tags}
      </div>
      <div class="chips">${shown.map(m => `<span class="chip model">${esc(m)}</span>`).join('')}${more > 0 ? `<span class="chip more">+${more} 个模型</span>` : ''}</div>
      <div class="card-notes">${esc(ch.notes || '')}</div>
      <div class="card-foot">
        ${ch.signupUrl ? `<a class="btn ghost" href="${esc(ch.signupUrl)}" target="_blank" rel="noopener">${ch.keyless ? '🌐 访问' : '🔑 注册领取'}</a>` : ''}
        ${ch.sourceUrl ? `<a class="btn ghost" href="${esc(ch.sourceUrl)}" target="_blank" rel="noopener">📄 来源核实</a>` : ''}
        <button class="btn ghost" data-copy="${esc(ch.id)}">📋 复制接入信息</button>
      </div>
    </div>`;
  }).join('') || `<p class="muted">没有符合筛选条件的渠道。</p>`;

  $$('button[data-copy]').forEach(b => b.addEventListener('click', () => copyChannel(b.dataset.copy)));
}

function copyChannel(id) {
  const ch = state.channels.find(c => c.id === id);
  if (!ch) return;
  const text = [
    `【${ch.name}】(${CAT_LABEL[ch.category] || ch.category} / ${REGION_LABEL[ch.region] || ''})`,
    ch.baseUrl ? `接口地址: ${ch.baseUrl}` : '',
    ch.signupUrl ? `领取/访问: ${ch.signupUrl}` : '',
    ch.sourceUrl ? `来源核实: ${ch.sourceUrl}` : '',
    `模型: ${(ch.models || []).join(', ')}`,
    `说明: ${ch.notes || ''}`
  ].filter(Boolean).join('\n');
  navigator.clipboard.writeText(text).then(
    () => toast('已复制接入信息', ch.name),
    () => toast('复制失败', '请手动选择文本复制', true)
  );
}

// ---------- 渲染：推送流 ----------
function renderFeed() {
  if (!state) return;
  $('#event-list').innerHTML = state.events.map(e => `
    <li class="${esc(e.level || 'info')}">
      <div class="evt-title">${EVT_ICON[e.type] || '•'} ${esc(e.title)}
        ${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">查看 ↗</a>` : ''}
      </div>
      ${e.detail ? `<div class="evt-detail">${esc(e.detail)}</div>` : ''}
      <div class="evt-time">${fmtTime(e.time)}</div>
    </li>`).join('') || '<li class="muted">暂无事件</li>';
}

// ---------- 渲染：健康状态 ----------
function renderHealth() {
  if (!state) return;
  const cnt = { ok: 0, fail: 0, unknown: 0 };
  state.channels.forEach(c => { cnt[c.status || 'unknown'] = (cnt[c.status || 'unknown'] || 0) + 1; });
  $('#health-summary').innerHTML = `
    <div class="stat ok"><b>${cnt.ok}</b><span>✅ 入口可达</span></div>
    <div class="stat fail"><b>${cnt.fail}</b><span>❌ 不可达</span></div>
    <div class="stat unknown"><b>${cnt.unknown}</b><span>⚪ 未验证</span></div>`;
  $('#health-body').innerHTML = state.channels.map(ch => {
    const probe = ch.baseUrl || ch.signupUrl || ch.sourceUrl || '—';
    const cls = ch.status === 'ok' ? 'tag-ok' : ch.status === 'fail' ? 'tag-fail' : 'tag-unknown';
    return `<tr>
      <td>${esc(ch.name)}</td>
      <td class="url" title="${esc(probe)}">${esc(probe)}</td>
      <td class="${cls}">${STATUS_LABEL[ch.status || 'unknown']}${ch.lastHttp ? ` (HTTP ${esc(ch.lastHttp)})` : ''}</td>
      <td>${ch.latencyMs != null ? ch.latencyMs + ' ms' : '—'}</td>
      <td>${fmtTime(ch.lastChecked)}</td>
      <td class="muted">${esc(ch.checkDetail || '')}</td>
    </tr>`;
  }).join('');
}

// ---------- 渲染：监控源 & 关于 ----------
function renderSources() {
  if (!state) return;
  $('#about-sources').innerHTML = state.sources.map(s => {
    const st = s.state || {};
    const last = st.lastCheck ? `最近检查 ${fmtTime(st.lastCheck)}` : '尚未检查';
    const err = st.error ? ` · <span class="tag-fail">${esc(st.error)}</span>` : '';
    return `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>
      <span class="muted"> — ${last}${err}</span></li>`;
  }).join('');
}

function renderAbout() {
  if (!state) return;
  $('#about-version').textContent = `v${state.meta.version || '1.0.0'}`;
  $('#about-datadir').textContent = state.meta.dataDir || '';
  $('#foot-repo').href = 'https://github.com/ab12-hub/FreeAI-Radar';
}

// ---------- 顶栏状态 ----------
function renderPill() {
  const pill = $('#status-pill');
  if (!state) return;
  if (checking) { pill.className = 'pill busy'; pill.textContent = '🩺 健康检查进行中…'; return; }
  const next = state.nextRunAt;
  if (!next) { pill.className = 'pill'; pill.textContent = '⏳ 等待首次抓取…'; return; }
  pill.className = 'pill';
  pill.title = `上次抓取：${state.meta.lastRun ? fmtTime(state.meta.lastRun) : '—'}`;
  pill.dataset.next = next; // 由倒计时定时器更新文本
}

function tickCountdown() {
  const pill = $('#status-pill');
  if (!pill || !pill.dataset.next) return;
  const remain = Math.max(0, Math.floor((Number(pill.dataset.next) - Date.now()) / 1000));
  const m = String(Math.floor(remain / 60)).padStart(2, '0');
  const s = String(remain % 60).padStart(2, '0');
  pill.textContent = `⟳ 下次抓取 ${m}:${s}`;
}

// ---------- SSE ----------
function connectSSE() {
  const es = new EventSource('/api/events/stream');
  es.addEventListener('snapshot', e => { applyState(JSON.parse(e.data)); });
  es.addEventListener('push', e => {
    const evt = JSON.parse(e.data);
    toast(evt.title, evt.detail);
    bumpFeedBadge();
    refreshState();
  });
  es.addEventListener('channels', () => refreshState());
  es.addEventListener('sources', () => refreshState());
  es.addEventListener('schedule', () => refreshState());
  es.addEventListener('settings', () => refreshState());
  es.addEventListener('health-done', () => markCheckDone());
  es.onerror = () => { /* EventSource 自动重连 */ };
}

let refreshTimer = null;
function refreshState() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    try {
      const res = await fetch('/api/state');
      applyState(await res.json());
    } catch (e) { /* 服务重启中 */ }
  }, 250);
}

function bumpFeedBadge() {
  const badge = $('#feed-badge');
  const active = $('.tab.active')?.dataset.tab;
  if (active === 'feed') { badge.classList.add('hidden'); return; }
  let n = Number(badge.textContent || 0) + 1;
  badge.textContent = n;
  badge.classList.remove('hidden');
}

function applyState(s) {
  state = s;
  renderChannels();
  renderFeed();
  renderHealth();
  renderSources();
  renderAbout();
  renderPill();
  if ($('.tab.active')?.dataset.tab === 'feed') $('#feed-badge').classList.add('hidden');
}

// ---------- 交互 ----------
function bindUI() {
  $$('.tab').forEach(t => t.addEventListener('click', () => {
    $$('.tab').forEach(x => x.classList.remove('active'));
    $$('.panel').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    $('#tab-' + t.dataset.tab).classList.add('active');
    if (t.dataset.tab === 'feed') $('#feed-badge').classList.add('hidden');
  }));

  $$('.filters select, #f-search').forEach(el => {
    el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', renderChannels);
  });

  $('#btn-refresh').addEventListener('click', async () => {
    const btn = $('#btn-refresh');
    btn.disabled = true; btn.textContent = '⟳ 抓取中…';
    try {
      const r = await fetch('/api/refresh', { method: 'POST' }).then(r => r.json());
      toast('刷新完成', `检查 ${r.summary.checked} 个源，推送 ${r.summary.updated} 条更新`);
    } catch (e) {
      toast('刷新失败', String(e), true);
    } finally {
      btn.disabled = false; btn.textContent = '⟳ 立即刷新';
      refreshState();
    }
  });

  $('#btn-check').addEventListener('click', async () => {
    if (checking) return;
    checking = true;
    $('#btn-check').disabled = true;
    renderPill();
    try { await fetch('/api/check', { method: 'POST' }); toast('健康检查已启动', '结果将逐条实时更新'); }
    catch (e) { toast('启动失败', String(e), true); checking = false; $('#btn-check').disabled = false; renderPill(); }
  });

  // 设置弹窗
  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-close-settings').addEventListener('click', () => $('#modal-settings').classList.add('hidden'));
  $('#modal-settings').addEventListener('click', e => { if (e.target.id === 'modal-settings') $('#modal-settings').classList.add('hidden'); });

  $('#btn-save-settings').addEventListener('click', async () => {
    const patch = {
      intervalMinutes: Number($('#s-interval').value) || 30,
      webPort: Number($('#s-port').value) || 7766,
      lanAccess: $('#s-lan').checked,
      notifications: $('#s-notify').checked,
      autoLaunch: $('#s-autolaunch').checked,
      closeToTray: $('#s-closetray').checked,
      customSources: $('#s-custom').value.split('\n').map(x => x.trim()).filter(Boolean)
    };
    const tokenVal = $('#s-token').value.trim();
    if (tokenVal && tokenVal !== '******') patch.githubToken = tokenVal;
    try {
      const r = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }).then(r => r.json());
      $('#settings-hint').textContent = r.hint || '已保存';
      toast('设置已保存', r.hint || '');
      refreshState();
    } catch (e) { $('#settings-hint').textContent = '保存失败：' + e; }
  });

  $('#btn-export').addEventListener('click', () => { window.open('/api/export', '_blank'); });
}

function openSettings() {
  if (!state) return;
  const s = state.settings;
  $('#s-interval').value = s.intervalMinutes;
  $('#s-token').value = s.githubToken || '';
  $('#s-port').value = s.webPort;
  $('#s-lan').checked = !!s.lanAccess;
  $('#s-notify').checked = !!s.notifications;
  $('#s-autolaunch').checked = !!s.autoLaunch;
  $('#s-closetray').checked = !!s.closeToTray;
  $('#s-custom').value = (s.customSources || []).join('\n');
  $('#settings-hint').textContent = '';
  $('#modal-settings').classList.remove('hidden');
}

// 健康检查结束：由服务端 SSE 'health-done' 事件显式通知
function markCheckDone() {
  checking = false;
  $('#btn-check').disabled = false;
  renderPill();
  refreshState();
}

// ---------- 启动 ----------
async function init() {
  bindUI();
  connectSSE();
  countdownTimer = setInterval(tickCountdown, 1000);
  try {
    const res = await fetch('/api/state');
    applyState(await res.json());
  } catch (e) {
    toast('无法连接本地服务', '请稍候或重启应用', true);
  }
}

init();
