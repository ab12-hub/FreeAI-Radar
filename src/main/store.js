'use strict';
// store.js —— JSON 持久化存储（渠道 / 推送事件 / 监控源状态 / 设置）
const fs = require('fs');
const path = require('path');

const EVENTS_MAX = 500;

const DEFAULT_SETTINGS = {
  intervalMinutes: 30,      // 监控轮询间隔（分钟）
  githubToken: '',          // 可选，提升 GitHub API 限额
  webPort: 7766,            // Web 端端口
  lanAccess: false,         // 是否允许局域网访问 Web 端
  notifications: true,      // 桌面推送通知
  autoLaunch: false,        // 开机自启
  closeToTray: true,        // 关闭窗口最小化到托盘
  customSources: []         // 自定义监控仓库，格式 ["owner/repo", ...]
};

function nowISO() { return new Date().toISOString(); }

class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'store.json');
    this.data = null;
  }

  load() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    let loaded = {};
    try {
      loaded = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (e) {
      // 首次运行或文件损坏：使用全新数据
    }
    this.data = Object.assign({
      channels: [],
      events: [],
      sources: {},
      settings: {},
      meta: { firstRun: nowISO(), lastRun: null, seeded: false, seedVersion: 0 }
    }, loaded);
    this.data.settings = Object.assign({}, DEFAULT_SETTINGS, loaded.settings || {});
    this.data.channels = Array.isArray(this.data.channels) ? this.data.channels : [];
    this.data.events = Array.isArray(this.data.events) ? this.data.events : [];
    this.data.sources = this.data.sources || {};
    return this.data;
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  // ---- 设置 ----
  getSettings() { return this.data.settings; }
  updateSettings(patch) {
    const s = this.data.settings;
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      if (k in patch) s[k] = patch[k];
    }
    if (Array.isArray(patch.customSources)) s.customSources = patch.customSources;
    this.save();
    return s;
  }

  // ---- 渠道 ----
  getChannels() { return this.data.channels; }
  findChannel(id) { return this.data.channels.find(c => c.id === id); }

  // 合并渠道：按 id 去重，新 id 直接入库，已存在且内容有变化则更新可变字段
  // 返回 { added: [...], updated: [...] }
  upsertChannels(list) {
    const added = [], updated = [];
    for (const ch of list) {
      if (!ch || !ch.id || !ch.name) continue;
      const idx = this.data.channels.findIndex(c => c.id === ch.id);
      if (idx === -1) {
        this.data.channels.push(Object.assign({ status: 'unknown', lastChecked: null, addedAt: nowISO() }, ch));
        added.push(ch);
      } else {
        const cur = this.data.channels[idx];
        const fresh = JSON.stringify(pickMutable(cur)) !== JSON.stringify(pickMutable(ch));
        if (fresh) {
          Object.assign(cur, ch, { status: cur.status, lastChecked: cur.lastChecked, addedAt: cur.addedAt });
          updated.push(cur);
        }
      }
    }
    if (added.length || updated.length) this.save();
    return { added, updated };
  }

  setChannelCheck(id, result) {
    const ch = this.findChannel(id);
    if (!ch) return;
    ch.status = result.status;        // ok | fail
    ch.lastChecked = nowISO();
    ch.lastHttp = result.httpStatus ?? null;
    ch.latencyMs = result.latency ?? null;
    ch.checkDetail = result.detail || '';
    this.save();
  }

  // ---- 推送事件 ----
  addEvent({ type, title, detail = '', url = '', level = 'info' }) {
    const evt = { id: 'e' + Date.now() + Math.random().toString(36).slice(2, 6), type, title, detail, url, level, time: nowISO() };
    this.data.events.unshift(evt);
    if (this.data.events.length > EVENTS_MAX) this.data.events.length = EVENTS_MAX;
    this.save();
    return evt;
  }
  getEvents(limit = 200) { return this.data.events.slice(0, limit); }

  // ---- 监控源状态 ----
  getSourceState(id) { return this.data.sources[id] || null; }
  setSourceState(id, state) {
    this.data.sources[id] = Object.assign({}, this.data.sources[id], state, { lastCheck: nowISO() });
    this.save();
  }

  // ---- 元信息 ----
  getMeta() { return this.data.meta; }
  setMeta(patch) { Object.assign(this.data.meta, patch); this.save(); }

  exportAll() {
    return JSON.stringify({ exportedAt: nowISO(), settings: this.data.settings, channels: this.data.channels, events: this.data.events, sources: this.data.sources }, null, 2);
  }
}

function pickMutable(ch) {
  const keys = ['name', 'provider', 'category', 'models', 'baseUrl', 'signupUrl', 'sourceUrl', 'notes', 'region', 'keyless', 'trust', 'tags'];
  const o = {};
  for (const k of keys) o[k] = ch[k] ?? null;
  return o;
}

module.exports = { Store, DEFAULT_SETTINGS };
