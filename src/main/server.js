'use strict';
// server.js —— 内置 Web 端：Express + SSE 实时推送
// Electron 客户端窗口与浏览器访问的是同一个 Web 界面（单一代码库）
const path = require('path');
const express = require('express');

function createServer(ctx) {
  // ctx: { store, bus, aggregator, runHealthCheck, log }
  const app = express();
  const clients = new Set(); // SSE 连接
  const rendererDir = path.join(__dirname, '..', 'renderer');

  app.use(express.json());
  app.use(express.static(rendererDir));

  // 当前完整状态快照
  function snapshot() {
    const store = ctx.store;
    const settings = store.getSettings();
    return {
      channels: store.getChannels(),
      events: store.getEvents(200),
      sources: builtinWithState(ctx),
      settings: Object.assign({}, settings, { githubToken: settings.githubToken ? '******' : '' }),
      meta: Object.assign({ dataDir: store.dataDir, version: require('../../package.json').version }, store.getMeta()),
      nextRunAt: ctx.aggregator.getNextRunAt(),
      serverTime: Date.now()
    };
  }

  function builtinWithState(ctx) {
    const { BUILTIN_SOURCES, parseCustomSources } = require('./sources');
    const settings = ctx.store.getSettings();
    return BUILTIN_SOURCES.concat(parseCustomSources(settings.customSources)).map(s => Object.assign({}, s, {
      state: ctx.store.getSourceState(s.id)
    }));
  }

  // ---- REST API ----
  app.get('/api/state', (req, res) => res.json(snapshot()));

  app.post('/api/refresh', async (req, res) => {
    ctx.log && ctx.log('手动触发刷新');
    const summary = await ctx.aggregator.runOnce('manual');
    res.json({ ok: true, summary });
  });

  app.post('/api/check', async (req, res) => {
    ctx.log && ctx.log('手动触发健康检查');
    res.json({ ok: true, started: true });
    runHealthCheckBackground(ctx);
  });

  app.post('/api/settings', (req, res) => {
    const before = ctx.store.getSettings();
    const patch = req.body || {};
    const after = ctx.store.updateSettings(patch);
    busBroadcast('settings', { settings: Object.assign({}, after, { githubToken: after.githubToken ? '******' : '' }) });
    ctx.applySettings && ctx.applySettings(before, after);
    const portChanged = patch.webPort && Number(patch.webPort) !== Number(before.webPort);
    res.json({ ok: true, portChanged, hint: portChanged ? '端口已修改，重启应用后生效' : '' });
  });

  app.get('/api/export', (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="freeai-radar-export-${Date.now()}.json"`);
    res.send(ctx.store.exportAll());
  });

  // ---- SSE 实时推送 ----
  app.get('/api/events/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 5000\n\n');
    res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
  });

  function busBroadcast(eventName, payload) {
    for (const res of clients) {
      try { res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`); } catch (e) { clients.delete(res); }
    }
  }

  // bus 事件 → SSE / 通知
  ctx.bus.on('event', evt => busBroadcast('push', evt));
  ctx.bus.on('sources', () => busBroadcast('sources', { sources: builtinWithState(ctx) }));
  ctx.bus.on('channels', () => busBroadcast('channels', { channels: ctx.store.getChannels() }));
  ctx.bus.on('schedule', info => busBroadcast('schedule', info));

  function runHealthCheckBackground(context) {
    const { checkAllChannels } = require('./healthcheck');
    const channels = context.store.getChannels();
    checkAllChannels(channels, (ch, result) => {
      context.store.setChannelCheck(ch.id, result);
      context.bus.emit('channels'); // 逐条实时广播，前端即时更新
    }).then(results => {
      const ok = results.filter(r => r.status === 'ok').length;
      const evt = context.store.addEvent({
        type: 'health',
        level: 'info',
        title: `🩺 健康检查完成：${ok}/${results.length} 条渠道入口可达`,
        detail: '探测结果基于本机网络环境；被墙/下线的渠道会标记为不可达',
        url: ''
      });
      context.bus.emit('event', evt);
      context.bus.emit('channels');
      busBroadcast('health-done', { total: results.length, ok });
      context.log && context.log(`健康检查完成 ${ok}/${results.length}`);
    }).catch(err => context.log && context.log('健康检查失败: ' + err.message));
  }

  function start(port, host) {
    return new Promise((resolve, reject) => {
      const server = app.listen(port, host, () => resolve(server));
      server.on('error', reject);
    });
  }

  return { app, start, snapshot, broadcast: busBroadcast };
}

module.exports = { createServer };
