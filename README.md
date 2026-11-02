# 📡 FreeAI Radar（AI 免费渠道雷达）

> 实时监控并推送可免费使用 AI 大模型的渠道情报 —— 官方免费层 / 注册送额度 / 免密钥公开接口 / 高信誉社区网关。
> 桌面客户端 + Web 端双形态，完全本地运行，每条信息可溯源。

一个完全本地运行的 **AI 大模型免费渠道雷达**：持续监控公开、可溯源的免费渠道情报源（GitHub 上的活跃汇总仓库），把「哪里能免费、合法地用上大模型」实时推送到你的桌面和浏览器。

## ✨ 功能特性

- **🧭 渠道广场**：内置 24+ 条人工核实的免费渠道（每条附官方来源链接），支持按类型 / 地区 / 是否需要注册 / 信任级别 / 关键词筛选，一键复制 OpenAI 兼容接入信息。
- **⚡ 实时推送流**：定时（默认 30 分钟，可调至 5 分钟）监控多个 GitHub 情报源，源更新即通过 **桌面通知 + 应用时间线 + Web SSE** 三路推送。
- **🩺 健康检查**：一键探测所有渠道入口可达性（✅ 可达 / ❌ 不可达 / ⚪ 未验证），失效渠道一目了然，结果基于本机网络环境。
- **🖥️ 双形态**：Electron 桌面客户端（托盘常驻、开机自启、关闭最小化）与浏览器 Web 端（`http://127.0.0.1:7766`，可开放局域网访问）共用同一界面。
- **🔒 真实可靠**：只聚合**渠道信息**（去哪里免费领取自己的 Key），**不收集、不分发任何第三方私密 API Key**；每条数据强制携带官方来源链接 + 最近验证时间 + 健康探测状态。
- **📦 数据本地化**：全部数据仅存于本机数据目录，可一键导出 JSON 备份。

## 📥 安装

前往 [Releases](https://github.com/ab12-hub/FreeAI-Radar/releases) 下载：

| 文件 | 说明 |
|---|---|
| `FreeAI-Radar-Setup-1.0.0.exe` | Windows 安装版（NSIS 向导，可选安装目录，创建桌面/开始菜单快捷方式） |
| `FreeAI-Radar-Portable-1.0.0.zip` | 便携版（解压即用，免安装，适合 U 盘携带） |

便携版：解压后运行 `FreeAI Radar.exe`；追加 `--web` 参数可无窗口运行（纯 Web 服务模式）。

## 🚀 使用

1. 启动后自动加载内置精选渠道库，点击卡片上的「🔑 注册领取」到官方页面免费获取自己的 API Key。
2. 「⟳ 立即刷新」手动抓取所有监控源；「🩺 一键体检」验证渠道可达性。
3. 在「⚙ 设置」中：调整轮询间隔（5-720 分钟）、填入 GitHub Token（未认证限额 60 次/小时，认证后 5000 次/小时）、添加自定义监控仓库（每行 `owner/repo`）、开启开机自启与桌面通知。
4. 浏览器访问 `http://127.0.0.1:7766` 即是 Web 端（与客户端界面一致）；开启「允许局域网访问」后手机等其他设备也能打开。

### 内置监控情报源

- [open-free-llm-api/awesome-freellm-apis](https://github.com/open-free-llm-api/awesome-freellm-apis) —— 每日自动刷新的免费 LLM API 目录（453+ 模型，含中文版）
- [zukixa/cool-ai-stuff](https://github.com/zukixa/cool-ai-stuff) —— 社区免费 AI API 列表
- [wdhdev/free-for-life](https://github.com/wdhdev/free-for-life) —— 免费服务资源大全

### 内置渠道类型

| 类型 | 说明 | 例子 |
|---|---|---|
| 官方免费层 | 厂商官方提供的永久免费额度 | Groq、Gemini API、GitHub Models、Cerebras、GLM-Flash |
| 注册送额度 | 新用户赠送的免费 tokens | 硅基流动、阿里百炼、火山方舟、Together AI |
| 无需密钥 | 公开免费接口，零门槛直接调 | Pollinations.AI |
| 社区网关 | 社区维护的免费聚合接口（标注风险） | cool-ai-stuff 列表收录的服务 |

## 🛠️ 从源码构建

```bash
git clone https://github.com/ab12-hub/FreeAI-Radar.git
cd FreeAI-Radar
npm install          # 国内网络已配置 npmmirror 镜像（.npmrc）
npm run icon         # 生成应用图标（可选，仓库已含成品）
npm run dist         # 产出 dist/FreeAI-Radar-Setup-*.exe 与 Portable-*.zip
```

开发模式：

```bash
npm run dev          # Electron 客户端
npm run server       # 纯 Web 模式（无 Electron，node src/main/dev-server.js）
```

技术栈：Electron 33 + Express + 原生 JS 前端（无构建步骤），健康探测与抓取全部基于 Node 内置 `fetch`。

## ⚠️ 免责声明

- 本软件仅聚合**公开渠道信息**并提供官方来源链接，不存储、不分发任何 API 密钥。
- 所有服务的额度、条款与可用性以官方页面为准，请遵守各服务商服务条款。
- 「社区网关」类服务随时可能变动，仅供学习测试；信息按"现状"提供，不作任何担保。
- 使用本软件产生的一切行为由使用者自行负责。

## 📄 许可证

[MIT](LICENSE) © 2026 FreeAI Radar Contributors
