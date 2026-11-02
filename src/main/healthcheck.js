'use strict';
// healthcheck.js —— 渠道可用性健康探测
// 探测原则：只验证"入口可达性"（HTTP 有响应即视为服务存活），不使用、不验证任何密钥，
// 探测结果基于本机网络环境，供参考。

const DEFAULT_TIMEOUT = 8000;

function withTimeout(url, opts = {}, timeoutMs = DEFAULT_TIMEOUT) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, Object.assign({}, opts, { signal: ctrl.signal })).finally(() => clearTimeout(t));
}

function pickProbeUrl(ch) {
  if (ch.baseUrl) {
    // OpenAI 兼容服务探测 /models（无密钥会得到 401/403，也证明服务存活）
    return ch.baseUrl.replace(/\/+$/, '') + '/models';
  }
  return ch.signupUrl || ch.sourceUrl || null;
}

// 探测单个渠道，返回 { status, latency, httpStatus, detail }
async function probeChannel(ch) {
  const url = pickProbeUrl(ch);
  if (!url) return { status: 'unknown', detail: '无可探测地址' };
  const started = Date.now();
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await withTimeout(url, { method: 'GET', redirect: 'follow' });
      const latency = Date.now() - started;
      // 任何 HTTP 响应（含 401/403 反爬）都说明服务存活
      if (res.status < 500) {
        return { status: 'ok', latency, httpStatus: res.status, detail: `HTTP ${res.status}` };
      }
      if (attempt === 2) return { status: 'fail', latency, httpStatus: res.status, detail: `HTTP ${res.status}` };
    } catch (err) {
      if (attempt === 2) {
        const reason = err.name === 'AbortError' ? '连接超时' : (err.cause && err.cause.code) || err.message;
        return { status: 'fail', latency: Date.now() - started, httpStatus: null, detail: String(reason).slice(0, 120) };
      }
    }
    await new Promise(r => setTimeout(r, 800));
  }
  return { status: 'unknown', detail: '未执行' };
}

// 并发探测全部渠道（限制并发数）
async function checkAllChannels(channels, onEach, concurrency = 6) {
  const queue = channels.slice();
  const results = [];
  async function worker() {
    while (queue.length) {
      const ch = queue.shift();
      const r = await probeChannel(ch);
      results.push({ id: ch.id, ...r });
      if (onEach) try { onEach(ch, r); } catch (e) { /* 回调异常不中断 */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return results;
}

module.exports = { probeChannel, checkAllChannels };
