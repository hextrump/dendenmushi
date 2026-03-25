# 🐌 Den Den Mushi

> 面向实时语音场景的 AI 语音工作台 — 听懂・辅助・代理

## 项目结构

```
dendenmushi/
├── plan.md                  # 项目需求文档
├── README.md                # 本文件
│
├── ui/                      # 前端 + 后端 monorepo
│   ├── apps/
│   │   └── web/             # Next.js Dashboard + Node.js 后端
│   │       ├── server.mjs           # ★ 核心后端：WebSocket 桥接 (ASR/LLM/TTS)
│   │       ├── src/
│   │       │   ├── app/page.tsx     # Dashboard 主页面 (看板+副驾+代理)
│   │       │   └── providers/
│   │       │       └── Stream.tsx   # 客户端 WebSocket + 音频流 Provider
│   │       └── public/
│   │           └── audio-processor.js  # AudioWorklet PCM 采集 (16kHz)
│   └── package.json
│
├── main.py                  # Python 后端 (REST fallback, 可选)
├── pyproject.toml           # Python 依赖
└── env                      # 环境变量 (不要提交!)
```

## 核心架构

```
┌─────────────────────────────────────────────┐
│  Browser (Next.js Dashboard)                │
│  AudioWorklet → 16kHz PCM → WebSocket       │
└──────────────────┬──────────────────────────┘
                   │ ws://localhost:8080
┌──────────────────▼──────────────────────────┐
│  Node.js Bridge  (server.mjs)   ★ 核心后端  │
│  ┌────────┐  ┌────────┐  ┌────────┐        │
│  │Qwen ASR│  │Qwen LLM│  │Qwen TTS│        │
│  │Realtime│→ │Streaming│→ │Streaming│        │
│  │  WS    │  │  HTTP   │  │  WS    │        │
│  └────────┘  └────────┘  └────────┘        │
└─────────────────────────────────────────────┘

延迟目标: ASR 100ms + LLM 200ms + TTS 150ms ≈ 300-500ms
```

## 快速启动

### 1. 配置环境变量
```bash
# ui/apps/web/.env.local
QWEN_API_KEY=your_key_here
QWEN_API_BASE=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_ASR_MODEL=qwen3-asr-flash-realtime-2026-02-10
QWEN_LLM_MODEL=qwen-plus
QWEN_TTS_MODEL=qwen3-tts-flash
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
