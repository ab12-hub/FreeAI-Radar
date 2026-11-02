'use strict';
// dev-server.js —— 无 Electron 的纯 Web 模式（开发/验证用）
// 用法: node src/main/dev-server.js [端口]
const path = require('path');
const { EventEmitter } = require('events');
const { Store } = require('./store');
const { createAggregator } = require('./aggregator');
const { createServer } = require('./server');

const port = Number(process.argv[2]) || 7766;
const store = new Store(path.join(__dirname, '..', '..', 'data'));
store.load();

const bus = new EventEmitter();
const ctx = { store, bus, log: m => console.log('[radar]', m), aggregator: null, applySettings: null };

ctx.aggregator = createAggregator(ctx);
ctx.aggregator.seedIfNeeded();

createServer(ctx).start(port, '127.0.0.1').then(() => {
  console.log(`[radar] Web 端已启动: http://127.0.0.1:${port}/`);
  setTimeout(() => ctx.aggregator.runOnce('startup').catch(e => console.error(e.message)), 2000);
  ctx.aggregator.schedule();
}).catch(err => {
  console.error('[radar] 启动失败:', err.message);
  process.exit(1);
});
