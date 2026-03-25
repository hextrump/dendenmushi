# Den Den Mushi — 项目需求文档

> **版本**: v2.0 | **日期**: 2026-03-24 | **状态**: 重写整理

---

## 1. 项目概况

### 1.1 产品名
**Den Den Mushi**（电话虫）

### 1.2 一句话定义
> 一个面向实时语音场景的 AI 语音工作台，将「听懂、辅助、代理」三层能力整合在一个可控的浏览器界面中。

### 1.3 产品形态
以 **Python 后端 + React Web UI** 为核心，通过 WebSocket 实现全双工实时通信的语音工作台应用。

---

## 2. 当前实现状态 ✅ / ❌

基于代码分析的现状评估：

| 模块 | 目标 | 当前状态 | 说明 |
|------|------|---------|------|
| Python 后端 | FastAPI 服务 | ✅ 已实现 | `main.py` — FastAPI + CORS + 静态文件 |
| ASR（语音识别） | Qwen Realtime ASR | ✅ 已实现 | WebSocket 实时流式 ASR（`qwen3-asr-flash-realtime`） |
| LLM（对话） | Qwen Plus | ✅ 已实现 | 多轮对话 + Session 管理 |
| TTS（语音合成） | Qwen TTS | ✅ 已实现 | `qwen3-tts-flash` HTTPx 调用 |
| 静态前端 | 基础语音聊天 | ✅ 已实现 | `static/` — 按住说话 + 聊天界面 |
| React Dashboard | 实时看板 UI | ✅ 已实现 | `ui/apps/web/` — Next.js + Tailwind |
| WebSocket Bridge | 全双工音频流 | ✅ 已实现 | `Stream.tsx` — AudioWorklet + WS 桥接 |
| 实时 PCM 播放 | 无缝 TTS 回放 | ✅ 已实现 | Gapless PCM playback via AudioContext |
| 音量可视化 | 麦克风音量反馈 | ✅ 已实现 | Analyser + 频率可视化条 |
| **副驾（Copilot）** | 建议回复 + 知识卡 | ⚠️ **仅 UI 骨架** | 有静态占位内容，无后端逻辑 |
| **代理（Proxy）** | 自动发言 + 策略控制 | ❌ **未实现** | 无代理引擎、策略判定、请示卡逻辑 |
| **翻译** | 实时翻译 | ❌ **未实现** | 无独立翻译管线 |
| **意图/阶段分析** | Interpreter 层 | ❌ **未实现** | 无意图提取、阶段检测 |
| **知识库 / RAG** | 文档检索 | ❌ **未实现** | 无向量存储或检索管线 |
| **角色模板** | 多场景预设 | ❌ **未实现** | 仅 hardcoded Sakura persona |
| **会后摘要** | Session Summary | ❌ **未实现** | 无摘要生成 |
| **Session Store** | 会话持久化 | ❌ **未实现** | 仅内存 dict 存储 |
| **事件总线** | 模块解耦通信 | ❌ **未实现** | 模块间直接调用 |

---

## 3. 核心能力定义（三层架构）

```
┌─────────────────────────────────────────────┐
│  Layer 3: 代理型（Proxy Mode）              │  ← 自动发言・策略控制・请示
│  ┌────────────────────────────────────────┐  │
│  │  Layer 2: 副驾型（Copilot Mode）       │  │  ← 建议回复・知识卡・追问推荐
│  │  ┌─────────────────────────────────────┤  │
│  │  │  Layer 1: 看板型（Board Mode）      │  │  ← 字幕・翻译・说话人・阶段
│  │  └─────────────────────────────────────┤  │
│  └────────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

### Layer 1: 看板型（Board Mode）— **基座能力**
| 能力 | 说明 |
|------|------|
| 实时字幕 | ASR partial + final transcript 实时显示 |
| 实时翻译 | 源语言 → 目标语言的流式翻译 |
| 说话人识别 | User / Remote 粗分离 |
| 阶段显示 | 寒暄 / 澄清 / 提案 / 决策 / 收尾 |
| 关键点提取 | 实时标记重要信息 |

### Layer 2: 副驾型（Copilot Mode）— **辅助能力**
| 能力 | 说明 |
|------|------|
| 建议回复 | 基于上下文生成 2-3 条可选回复 |
| 可点选回答 | 用户点击即发送 |
| 推荐追问 | 建议下一个该问的问题 |
| 风险提醒 | 检测到敏感话题时提示 |
| RAG 事实卡 | 从挂载知识库中检索相关信息 |

### Layer 3: 代理型（Proxy Mode）— **代理能力**
| 能力 | 说明 |
|------|------|
| AI 草拟回复 | 自动草拟可发言内容 |
| 自动发言 | 低风险场景自动 TTS 播放 |
| 关键节点请示 | 涉及价格/时间/承诺时弹卡确认 |
| 人工接管 | 用户随时可打断/接管 |
| 半自动切换 | 全自动 ↔ 请示模式切换 |

---

## 4. 系统架构

### 4.1 系统组成

```
┌───────────────────────────────────────────────────────┐
│                     Browser (React)                    │
│  ┌─────────┐  ┌──────────┐  ┌─────────┐  ┌────────┐  │
│  │ 看板区   │  │ 副驾区    │  │ 代理区   │  │ 配置区  │  │
│  └────┬────┘  └─────┬────┘  └────┬────┘  └───┬────┘  │
│       └──────────────┴───────────┴────────────┘       │
│                        │ WebSocket                     │
└────────────────────────┼──────────────────────────────┘
                         │
┌────────────────────────┼──────────────────────────────┐
│               Python Backend (FastAPI)                 │
│  ┌──────────────────────────────────────────────────┐  │
│  │            Session Orchestrator（主控）            │  │
│  └──────────┬──────┬──────┬──────┬──────┬───────────┘  │
│       ┌─────┴──┐ ┌─┴───┐ ┌┴────┐ ┌┴───┐ ┌┴─────────┐  │
│       │ Audio  │ │ ASR │ │ LLM │ │TTS │ │ RAG/KB   │  │
│       │Ingest  │ │     │ │     │ │    │ │          │  │
│       └────────┘ └─────┘ └─────┘ └────┘ └──────────┘  │
│                       Event Bus                        │
└───────────────────────────────────────────────────────┘
```

### 4.2 全链路流式 Pipeline（核心技术要求）

```
Mic → [AudioWorklet 16kHz PCM] → WebSocket → ASR (streaming) → partial text
                                                        ↓
                                               Interpreter (翻译/意图)
                                                        ↓
                                               Copilot (建议生成)
                                                        ↓
                                               Proxy (草拟回复)
                                                        ↓
                                             TTS (streaming) → PCM audio
                                                        ↓
                                         WebSocket → Browser → Speaker
```

**延迟目标**: ASR 100ms + LLM 首 token 200ms + TTS 首音频 150ms = **总延迟 ≈ 300–500ms**

### 4.3 核心架构原则

1. **单主控**：Session Orchestrator 是唯一的会话状态真相源
2. **事件驱动**：模块间通过 Event Bus 通信，不直接硬耦合
3. **逐级接管**：先看板 → 再副驾 → 最后代理，能力逐层构建
4. **人类最终决定**：涉及价格/时间/承诺/隐私时，必须请示用户

---

## 5. 技术栈

### 5.1 后端
| 技术 | 用途 |
|------|------|
| Python 3.13+ | 运行时 |
| FastAPI / Starlette | Web 框架 + WebSocket |
| asyncio | 事件驱动异步 |
| Pydantic | 数据模型 |
| Qwen ASR (Realtime) | 流式语音识别 |
| Qwen LLM (Plus) | 对话生成 |
| Qwen TTS (Flash) | 流式语音合成 |

### 5.2 前端
| 技术 | 用途 |
|------|------|
| Next.js (React) | UI 框架 |
| Tailwind CSS | 样式系统 |
| AudioWorklet API | 16kHz PCM 采集 |
| WebSocket | 全双工实时通信 |
| Zustand / Context | 状态管理 |

### 5.3 模型分层使用
| 任务 | 模型 | 备注 |
|------|------|------|
| ASR | `qwen3-asr-flash-realtime` | 流式 WebSocket，低延迟 |
| 翻译 / 理解 | `qwen-plus` 或专用翻译模型 | 意图+翻译+阶段分析 |
| 建议 / 代理 | `qwen-plus` 或更强模型 | 回复生成+风险判定 |
| RAG 检索 | Embedding 模型 | 文档向量化+检索 |
| TTS | `qwen3-tts-flash` | 流式语音合成 |

---

## 6. 用户界面需求

### 6.1 Dashboard 布局

```
┌──────────────────────────────────────────────────────┐
│  Header: 产品标识 + 当前角色 + 连接状态 + 设置       │
├──────────┬──────────────────────┬─────────────────────┤
│          │                      │                     │
│  配置区   │     看板区（中央）    │     副驾区（右）     │
│（左 可折叠）│  实时字幕+翻译       │  建议回复+知识卡     │
│  角色选择  │  说话人+阶段         │  追问+风险提醒       │
│  场景模板  │  关键事件流          │                     │
│  知识库   │                      │                     │
│  授权边界  │                      │                     │
│          │                      │                     │
├──────────┴──────────────────────┴─────────────────────┤
│  代理区（下方）                                        │
│  AI草拟回复 | 自动发言开关 | 模式切换 | 打断/接管 | 请示卡 │
└──────────────────────────────────────────────────────┘
```

### 6.2 UI 状态展示
- 麦克风音量可视化（频率条动画）
- 连接状态指示灯（WebSocket / ASR / TTS）
- 当前模式标识（Board / Copilot / Proxy）
- 实时延迟显示

---

## 7. 首批支持场景

| 场景 | 语言方向 | 优先级 |
|------|---------|--------|
| 日语电话辅助/代打 | 日→中、中→日 | P0 |
| 日语线上会议辅助 | 日→中、中→日 | P0 |
| 面试辅助 | 日→中、英→中 | P1 |
| IT/客户沟通辅助 | 日→中、英→中 | P1 |

---

## 8. 角色模板系统

每个角色模板包含：

| 字段 | 说明 |
|------|------|
| `system_prompt` | 角色人设 + 语气风格 |
| `language_pair` | 默认语言组合 |
| `risk_threshold` | 风险敏感度（低/中/高） |
| `common_phrases` | 常用话术库 |
| `knowledge_sources` | 默认知识源 |
| `auto_level` | 推荐自动化等级 |

初版预设角色：
1. 🍣 **餐厅预约虫** — 餐厅预约、变更、取消
2. 💼 **IT 客户沟通虫** — 技术沟通、需求澄清
3. 🎤 **面试虫** — 面试问答、自我介绍
4. 📋 **通用商务沟通虫** — 一般性商务对话

---

## 9. 策略 / 风控规则

### 9.1 必须请示用户
- 价格变化、付款承诺
- 时间选择、改签
- 方案替代、服务范围变化
- 隐私信息披露、责任承诺
- 取消/违约相关

### 9.2 可自动处理
- 问候语、礼貌过渡
- 重复说明目的
- 请求稍等
- 澄清非风险信息
- 低风险预约推进

### 9.3 必须阻止自动代理
- 医疗/法律/金融敏感信息
- 要求本人确认的场景
- 高情绪冲突
- 用户关闭自动代理时

---

## 10. 数据结构

### 核心实体

```
Session {
  id, role_template_id, mode, language_pair,
  status, knowledge_sources[], policy_config,
  started_at, ended_at
}

TranscriptSegment {
  id, session_id, speaker, source_lang,
  text, translated_text, start_ms, end_ms, finalized
}

Suggestion {
  id, session_id, source_segment_ids[],
  text, confidence, type(reply|followup|warning|fact),
  selectable
}

DecisionRequest {
  id, session_id, category(price|time|alternative|privacy|other),
  prompt, options[], urgency, blocking
}

ProxyDraft {
  id, session_id, text, target_lang,
  risk_level, auto_send_allowed, reason
}

Summary {
  session_id, overview, key_points[],
  decisions[], action_items[], risks[], followups[]
}
```

---

## 11. 事件总线

### 核心事件清单

| 事件 | 来源 | 说明 |
|------|------|------|
| `session.started` | Orchestrator | 会话开始 |
| `audio.chunk.received` | Audio Ingest | 收到音频帧 |
| `speech.segment.partial` | ASR | 实时识别中间结果 |
| `speech.segment.final` | ASR | 最终识别结果 |
| `translation.updated` | Interpreter | 翻译更新 |
| `intent.detected` | Interpreter | 意图识别 |
| `stage.updated` | Interpreter | 对话阶段变化 |
| `risk.detected` | Interpreter | 风险信号 |
| `suggestions.updated` | Copilot | 建议回复更新 |
| `proxy.reply.draft` | Proxy | AI 草拟完成 |
| `decision.required` | Proxy | 需要用户决策 |
| `user.option.selected` | UI | 用户做出选择 |
| `tts.play.requested` | Proxy/UI | 请求 TTS |
| `tts.play.started` | TTS | 开始播放 |
| `tts.play.finished` | TTS | 播放结束 |
| `session.ended` | Orchestrator | 会话结束 |

### 事件设计要求
- 所有事件携带 `session_id` + `timestamp`
- UI 与后端通过 WebSocket 实时同步
- 事件支持持久化，可重放审计

---

## 12. MVP 范围

### 12.1 MVP 必做（Phase 1）

> [!IMPORTANT]
> MVP 聚焦 **看板 + 副驾**，代理层仅做最小手动 TTS。

| # | 功能 | 说明 |
|---|------|------|
| 1 | Python 后端 + React Dashboard | ✅ 已有 |
| 2 | WebSocket 全双工音频流 | ✅ 已有 |
| 3 | 实时 ASR 字幕 | ✅ 已有 |
| 4 | 实时翻译显示 | 🔨 需实现 Interpreter 翻译管线 |
| 5 | 建议回复（可点选） | 🔨 需实现 Copilot 后端 |
| 6 | AI Draft 回复展示 | 🔨 需实现 |
| 7 | 手动触发 TTS 播放 | ✅ 已有基础 |
| 8 | 一个角色模板（Sakura） | ✅ 已有 hardcode |
| 9 | 会后摘要 | 🔨 需实现 |
| 10 | 事件总线基础架构 | 🔨 需实现 |

### 12.2 MVP 暂不做
- 多人会议 speaker diarization
- 多角色动态热切换
- 完整电话平台直连
- 高复杂度自动接管
- 企业级权限系统
- RAG / 知识库检索

### 12.3 MVP 成功标准
1. 用户能稳定看到实时字幕和翻译
2. 建议回复可用，不明显胡说
3. 至少一个场景（面试 / IT 沟通）可完成辅助闭环
4. 手动 TTS 能正常播放 AI 回复
5. 会后能生成可接受质量的摘要

---

## 13. 迭代路线图

### Phase 1（Current → MVP）
- [x] 项目骨架（Python + React + WebSocket）
- [x] 音频输入 + ASR + 字幕展示
- [ ] 翻译管线
- [ ] Copilot 建议引擎
- [ ] 事件总线基础
- [ ] 会后摘要

### Phase 2 — 副驾完善 + 半自动代理
- [ ] RAG / 知识库检索
- [ ] 事实卡片
- [ ] 半自动代理发言
- [ ] 策略引擎（风险判定）
- [ ] 请示卡 + 用户决策流
- [ ] 角色模板系统

### Phase 3 — 电话模式 + 全自动代理
- [ ] 电话模式适配
- [ ] 外部音频设备桥接
- [ ] 全自动代理流程
- [ ] 电话任务模板
- [ ] 更稳定音频路由

### Phase 4 — 平台化
- [ ] 多场景模板
- [ ] 企业知识库
- [ ] 多会话管理 + 回放
- [ ] 风控审计
- [ ] 性能优化

---

## 14. 开发原则

> [!WARNING]
> 以下原则在整个开发过程中必须遵守：

1. **不要多脑打架** — 必须由 Orchestrator 统一裁决，不允许多 agent 抢控制权
2. **先打透一个场景** — 不要一上来做太多场景
3. **字幕翻译先稳** — 看板 → 副驾 → 代理，逐步加能力
4. **角色不是皮肤** — 模板必须影响语气、风险阈值、知识库、策略
5. **不要黑箱** — 用户必须知道 AI 为什么这么回复、为什么需要请示
6. **透明优先** — 用户能看到 AI 听到什么、理解什么、准备怎么回复

---

## 15. 关键风险与注意事项

| 风险 | 影响 | 缓解 |
|------|------|------|
| ASR 延迟波动 | 影响实时体验 | 使用 Realtime WebSocket ASR，非整段 Whisper |
| LLM 幻觉 | 回复质量 | 副驾模式仅建议不自动发，代理模式有风控 |
| 音频路由复杂 | 桌面兼容性 | MVP 先做浏览器麦克风，不做虚拟设备 |
| WebSocket 断连 | 会话中断 | 自动重连 + 状态恢复 |
| 策略边界模糊 | 代理越权 | 保守默认策略，严格请示规则 |
