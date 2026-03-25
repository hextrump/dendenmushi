# 🐌 Den Den Mushi

> 面向实时语音场景的 AI 语音工作台 — 听懂・辅助・代理

## 项目结构

```
dendenmushi/
├── ref/                     # 官方 API 参考文档
├── README.md                # 本文件
│
├── ui/                      # 前端 + 后端 monorepo
│   ├── apps/
│   │   └── web/             # Next.js Dashboard + Node.js 后端
│   │       ├── server.mjs           # ★ 核心后端：WebSocket 桥接 (ASR/LLM/TTS)
│   │       ├── src/
│   │       │   ├── app/page.tsx     # Dashboard 主页面 (History + Context + Board)
│   │       │   └── providers/
│   │       │       └── Stream.tsx   # 客户端 WebSocket + 音频流 Provider
│   │       └── public/
│   │           └── audio-processor.js  # AudioWorklet PCM 采集 (16kHz)
│   └── package.json
└── .env.local               # 环境变量 (不要提交!)
```

## 核心架构

```
┌──────────────────────────────────────────────┐
│  Browser (Next.js Dashboard)                 │
│  PCM Capture → Binary WS → Node.js Bridge    │
└──────────────────┬───────────────────────────┘
                   │ ws://localhost:8080
┌──────────────────▼───────────────────────────┐
│  Node.js Bridge  (server.mjs)   ★ 核心后端   │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐ │
│  │ Qwen ASR  │  │ Qwen LLM  │  │ Qwen TTS  │ │
│  │ Realtime  │→ │ Streaming │→ │ Realtime  │ │
│  │ WS (v1)   │  │ HTTP      │  │ WS (v1)   │ │
│  └───────────┘  └───────────┘  └───────────┘ │
└──────────────────────────────────────────────┘

架构优势:
- 极速响应: 端到端全双工流式处理，对话体感延迟极低。
- 多源支持: 支持 麦克风 / 系统会议音频 / 本地文件 识别。
- 环境隔离: 核心 ASR/TTS 管线在 Node.js 侧处理，前端轻量化。
```

## 快速启动

### 1. 配置环境变量
```bash
# ui/apps/web/.env.local (基于 .env.example 复制)
QWEN_API_KEY=your_key_here
QWEN_ASR_MODEL=qwen3-asr-flash-realtime-2026-02-10
QWEN_LLM_MODEL=qwen-plus
QWEN_TTS_MODEL=qwen3-tts-flash-realtime
QWEN_TTS_VOICE=Cherry
```

### 2. 安装依赖
```bash
cd ui && npm install
```

### 3. 启动 WebSocket 后端 (核心)
```bash
cd ui/apps/web && node server.mjs
# → ws://localhost:8080
```

### 4. 启动前端
```bash
cd ui && npm run dev
# → http://localhost:3000
```

## 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 前端 | Next.js / React / Tailwind | Dashboard UI |
| 音频采集 | AudioWorklet API | 16kHz PCM 采集 |
| 后端 | Node.js WebSocket Server | 核心实时管线 |
| ASR | Qwen3 ASR Flash Realtime | 流式 WebSocket |
| LLM | Qwen Plus | SSE 流式输出 |
| TTS | Qwen3 TTS Flash | 流式 WebSocket |

## 三层能力

1. **看板 (Board)** — 实时字幕 + 翻译 + 说话人
2. **副驾 (Copilot)** — 建议回复 + 知识卡 + 追问
3. **代理 (Proxy)** — 自动发言 + 策略控制 + 请示

详见 [plan.md](./plan.md)
