'use strict';
// aggregator.js —— 聚合引擎：定时抓取监控源、变更检测、生成推送事件
const { EventEmitter } = require('events');
const { BUILTIN_SOURCES, parseCustomSources, fetchCommits, fetchReleases } = require('./sources');

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function createAggregator(ctx) {
  // ctx: { store, bus, log, healthcheck }
  const bus = ctx.bus instanceof EventEmitter ? ctx.bus : new EventEmitter();
  let timer = null;
  let running = false;
  let nextRunAt = null;

  function allSources() {
    const settings = ctx.store.getSettings();
    return BUILTIN_SOURCES.concat(parseCustomSources(settings.customSources));
  }

  function schedule() {
    if (timer) clearInterval(timer);
    const minutes = clamp(Number(ctx.store.getSettings().intervalMinutes) || 30, 5, 720);
    timer = setInterval(() => { runOnce('scheduled').catch(() => {}); }, minutes * 60 * 1000);
    nextRunAt = Date.now() + minutes * 60 * 1000;
    ctx.log && ctx.log(`轮询已排程：每 ${minutes} 分钟`);
    bus.emit('schedule', { intervalMinutes: minutes, nextRunAt });
  }

  function getNextRunAt() { return nextRunAt; }

  async function runOnce(trigger = 'manual') {
    if (running) return { skipped: true, reason: '上一轮仍在执行' };
    running = true;
    const token = ctx.store.getSettings().githubToken || '';
    const summary = { checked: 0, updated: 0, errors: 0 };
    try {
      for (const src of allSources()) {
        const state = ctx.store.getSourceState(src.id) || {};
        try {
          summary.checked++;
          const commits = await fetchCommits(src.owner, src.repo, token);
          const latest = commits[0];
          if (latest && state.lastSha && latest.sha !== state.lastSha) {
            // 找出新增提交（最多提示 5 条）
            const oldIdx = commits.findIndex(c => c.sha === state.lastSha);
            const newOnes = oldIdx === -1 ? commits.slice(0, 3) : commits.slice(0, oldIdx);
            if (newOnes.length) {
              const first = newOnes[0];
              const evt = ctx.store.addEvent({
                type: 'source_update',
                level: 'info',
                title: `📡 ${src.label} 有 ${newOnes.length} 个新提交`,
                detail: first.subject + (newOnes.length > 1 ? `（另有 ${newOnes.length - 1} 条）` : ''),
                url: first.url
              });
              bus.emit('event', evt);
              summary.updated++;
            }
          }
          const patch = { lastSha: latest ? latest.sha : state.lastSha, lastSubject: latest ? latest.subject : state.lastSubject };
          // Release 监控
          try {
            const releases = await fetchReleases(src.owner, src.repo, token);
            const rel = releases[0];
            if (rel && state.lastReleaseId && rel.id !== state.lastReleaseId) {
              const evt = ctx.store.addEvent({
                type: 'release',
                level: 'info',
                title: `🚀 ${src.label} 发布新版本 ${rel.tag}`,
                detail: rel.name,
                url: rel.url
              });
              bus.emit('event', evt);
              summary.updated++;
            }
            if (rel) patch.lastReleaseId = rel.id;
          } catch (e) { /* 无 Release 的仓库视为正常 */ }
          ctx.store.setSourceState(src.id, Object.assign({}, state, patch, { error: null }));
          bus.emit('sources');
        } catch (err) {
          summary.errors++;
          ctx.store.setSourceState(src.id, Object.assign({}, state, { error: String(err.message || err).slice(0, 160) }));
          ctx.log && ctx.log(`[${src.id}] 抓取失败: ${err.message}`);
          bus.emit('sources');
        }
      }
      ctx.store.setMeta({ lastRun: new Date().toISOString() });
      bus.emit('state');
      return summary;
    } finally {
      running = false;
      schedule(); // 以最新设置为基准重新排程
    }
  }

  // 首次运行：导入内置精选渠道库
  function seedIfNeeded() {
    const meta = ctx.store.getMeta();
    if (meta.seeded) return { added: [], updated: [] };
    const seed = require('./seed/channels.json');
    const { added, updated } = ctx.store.upsertChannels(seed.channels || []);
    ctx.store.setMeta({ seeded: true, seedVersion: seed.version || 1 });
    const evt = ctx.store.addEvent({
      type: 'seed',
      level: 'info',
      title: `✅ 初始化完成：内置精选库导入 ${added.length} 条免费渠道`,
      detail: '每条渠道均附带官方来源链接，可在"健康状态"页一键验证可达性',
      url: ''
    });
    bus.emit('event', evt);
    return { added, updated };
  }

  return { runOnce, schedule, seedIfNeeded, getNextRunAt, isRunning: () => running };
}

module.exports = { createAggregator };
