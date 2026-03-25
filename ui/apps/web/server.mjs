import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const dotEnvPath = path.resolve('.env.local');
if (fs.existsSync(dotEnvPath)) dotenv.config({ path: dotEnvPath });
else dotenv.config();

const PORT = process.env.WS_PORT || 8080;
const wss = new WebSocketServer({ port: PORT });
const apiKey = process.env.QWEN_API_KEY;

if (!apiKey) { console.error("FATAL: QWEN_API_KEY not set."); process.exit(1); }

function eid() { return `evt_${Date.now()}_${Math.random().toString(36).slice(2,10)}`; }

// ─── LLM Helper ──────────────────────────────────────────
async function callLLM(messages, { stream = false } = {}) {
    const model = process.env.QWEN_LLM_MODEL || 'qwen-plus';
    const baseUrl = (process.env.QWEN_API_BASE || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '');
    const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, stream, temperature: 0.7 })
    });
    if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
    if (!stream) {
        const json = await res.json();
        return json.choices?.[0]?.message?.content || '';
    }
    return res; // return Response for streaming
}

wss.on('connection', (clientWs) => {
    console.log('[Bridge] Client connected');

    let asrWs = null, ttsWs = null;
    let asrReady = false, ttsReady = false;
    let conversationHistory = [];
    let sessionStartTime = Date.now();
    let sessionContext = "";
    let asrLanguage = 'auto'; // Default: auto-detect language

    const send = (obj) => { try { clientWs.send(JSON.stringify(obj)); } catch(e) {} };

    // ─── ASR ──────────────────────────────────────
    const initASR = () => {
        const envModel = process.env.QWEN_ASR_MODEL || 'qwen3-asr-flash-realtime-2026-02-10';
        const model = envModel.includes('realtime') ? envModel : envModel.replace('flash', 'flash-realtime');
        const wsUrl = `wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=${encodeURIComponent(model)}`;
        console.log(`[ASR] Connecting: ${model}`);

        asrWs = new WebSocket(wsUrl, {
            headers: { Authorization: `Bearer ${apiKey}`, 'OpenAI-Beta': 'realtime=v1' }
        });

        asrWs.on('open', () => {
            console.log("[ASR] Connected");
            // Build session config — only pass language if explicitly set (not 'auto')
            const sessionConfig = {
                modalities: ['text'],
                input_audio_format: 'pcm',
                sample_rate: 16000,
                turn_detection: { type: 'server_vad', threshold: 0.3, silence_duration_ms: 1000 }
            };
            if (asrLanguage && asrLanguage !== 'auto') {
                sessionConfig.input_audio_transcription = { language: asrLanguage };
                console.log(`[ASR] Language forced: ${asrLanguage}`);
            } else {
                console.log(`[ASR] Language: auto-detect (no language field sent)`);
            }
            asrWs.send(JSON.stringify({
                event_id: eid(), type: 'session.update',
                session: sessionConfig
            }));
            asrReady = true;
            send({ type: 'system', status: 'asr_connected' });
        });

        asrWs.on('message', (raw) => {
            try {
                const event = JSON.parse(raw.toString());
                const t = event.type;
                
                // Log ALL ASR events with full payload for debugging
                if (t !== 'session.created' && t !== 'session.updated') {
                    console.log(`[ASR] Event: ${t} | ${JSON.stringify(event).substring(0, 300)}`);
                } else {
                    console.log(`[ASR] ${t}`);
                }

                // Partial transcription — try multiple possible event types
                if (t === 'conversation.item.input_audio_transcription.text' ||
                    t === 'response.audio_transcript.delta' ||
                    t === 'response.text.delta') {
                    const partial = event.text || event.delta || event.stash || event.transcript || '';
                    if (partial) {
                        console.log(`[ASR] Partial text: "${partial}"`);
                        send({ type: 'asr_partial', text: partial });
                    }
                }

                // Final transcription — try multiple possible event types
                if (t === 'conversation.item.input_audio_transcription.completed' ||
                    t === 'response.audio_transcript.done' ||
                    t === 'response.done') {
                    const text = event.transcript 
                        || event.text 
                        || event.response?.output?.[0]?.content?.[0]?.transcript
                        || event.response?.output?.[0]?.content?.[0]?.text
                        || '';
                    if (text.trim().length > 0) {
                        console.log(`[ASR] Final: "${text}"`);
                        send({ type: 'asr_final', text });
                        conversationHistory.push({ role: 'user', content: text });
                        processASRResult(text);
                    }
                }

                if (t === 'error') {
                    console.error(`[ASR] Error: ${JSON.stringify(event.error || event)}`);
                    send({ type: 'system', status: 'asr_error', detail: event.error?.message || JSON.stringify(event) });
                }
            } catch (e) { console.error('[ASR] Parse error:', e); }
        });

        asrWs.on('error', err => { console.error('[ASR] Error:', err.message); });
        asrWs.on('close', () => { asrReady = false; console.log('[ASR] Closed'); });
    };

    // ─── TTS (Qwen-TTS-Realtime API) ──────────────
    const initTTS = () => {
        // initTTS is now a no-op; each sendToTTS creates a fresh realtime connection
        ttsReady = true;
        send({ type: 'system', status: 'tts_connected' });
        console.log('[TTS] Ready (per-request connections)');
    };

    // Create a fresh TTS Realtime connection for each synthesis request
    const sendToTTS = (text) => {
        if (!text.trim()) return;

        const model = process.env.QWEN_TTS_MODEL || 'qwen3-tts-flash-realtime';
        const voice = 'Cherry';
        const tag = Date.now().toString(36);
        // Correct endpoint: /v1/realtime with model in query string
        const wsUrl = `wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=${model}`;

        console.log(`[TTS:${tag}] Connecting: ${wsUrl}`);
        console.log(`[TTS:${tag}] Text: "${text.substring(0, 60)}"`);

        const tts = new WebSocket(wsUrl, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'OpenAI-Beta': 'realtime=v1'
            }
        });

        tts.on('open', () => {
            console.log(`[TTS:${tag}] Connected, sending session.update...`);

            // Step 1: Configure session
            tts.send(JSON.stringify({
                event_id: `evt_${tag}_setup`,
                type: 'session.update',
                session: {
                    voice,
                    mode: 'server_commit',
                    response_format: 'pcm',
                    sample_rate: 24000,
                }
            }));
        });

        let sessionUpdated = false;

        tts.on('message', (raw) => {
            try {
                const event = JSON.parse(raw.toString());
                const evType = event.type;

                switch (evType) {
                    case 'session.created':
                        console.log(`[TTS:${tag}] Session created: ${event.session?.id}`);
                        break;

                    case 'session.updated':
                        console.log(`[TTS:${tag}] Session updated, sending text...`);
                        sessionUpdated = true;
                        // Step 2: Send text
                        tts.send(JSON.stringify({
                            event_id: `evt_${tag}_text`,
                            type: 'input_text_buffer.append',
                            text: text
                        }));
                        // Step 3: Finish session (server_commit mode will auto-synthesize)
                        tts.send(JSON.stringify({
                            event_id: `evt_${tag}_finish`,
                            type: 'session.finish'
                        }));
                        break;

                    case 'response.audio.delta':
                        // Base64 PCM audio chunk
                        if (event.delta) {
                            send({ type: 'tts_audio', audio: event.delta });
                        }
                        break;

                    case 'response.done':
                        console.log(`[TTS:${tag}] Response done`);
                        send({ type: 'tts_done' });
                        break;

                    case 'session.finished':
                        console.log(`[TTS:${tag}] Session finished, closing.`);
                        tts.close();
                        break;

                    case 'error':
                        console.error(`[TTS:${tag}] ERROR: ${event.error?.message || JSON.stringify(event)}`);
                        break;

                    default:
                        // Other events: response.created, response.output_item.added, etc.
                        break;
                }
            } catch (e) {
                console.error(`[TTS:${tag}] Parse error:`, e.message);
            }
        });

        tts.on('error', err => {
            console.error(`[TTS:${tag}] CONNECTION ERROR: ${err.message}`);
        });
        tts.on('close', (code, reason) => {
            console.log(`[TTS:${tag}] Closed: code=${code}, reason=${reason?.toString() || 'none'}`);
        });
    };

    // ─── Core Pipeline: Process ASR result ─────────
    async function processASRResult(userText) {
        // Run translation, suggestions, and AI reply in parallel
        const [translation] = await Promise.allSettled([
            generateTranslation(userText),
            generateSuggestions(userText),
            generateReply(userText),
        ]);
    }

    // ① Translation (language-aware)
    async function generateTranslation(text) {
        try {
            console.log(`[Translate] lang=${asrLanguage} "${text.substring(0, 30)}..."`);
            
            let translationPrompt;
            if (asrLanguage === 'ja') {
                translationPrompt = '你是一个日中翻译器。请将用户输入的日文翻译成简体中文。只输出翻译结果，不要解释。如果输入已经是中文则直接返回原文。';
            } else if (asrLanguage === 'zh' || asrLanguage === 'cn') {
                translationPrompt = '你是一个中日翻译器。请将用户输入的中文翻译成日文。只输出翻译结果，不要解释。如果输入已经是日文则直接返回原文。';
            } else {
                // auto or other languages — auto-detect and translate to Chinese
                translationPrompt = '你是一个多语言翻译器。请将用户输入的文本翻译成简体中文。如果输入已经是中文，则翻译成英文。只输出翻译结果，不要解释。';
            }
            
            const result = await callLLM([
                { role: 'system', content: translationPrompt },
                { role: 'user', content: text }
            ]);
            console.log(`[Translate] → "${result.substring(0, 50)}"`);
            send({ type: 'translation', original: text, translated: result });
        } catch (e) {
            console.error('[Translate] Error:', e.message);
        }
    }

    // ② Copilot Suggestions
    async function generateSuggestions(text) {
        try {
            console.log(`[Copilot] Generating suggestions...`);
            const context = conversationHistory.slice(-6).map(m => `${m.role}: ${m.content}`).join('\n');
            const result = await callLLM([
                { role: 'system', content: `你是一个会议协同助理。基于当前对话状态，请严格遵守用户的设定策略，提供3个供用户直接点击即可进行TTS播报的外交辞令建议选项。
${sessionContext ? `\n# [必读] 以下是用户会前设定的自身身份以及会议主导立场（选项必须根据这个设定推演立场）：\n${sessionContext}\n` : ''}
格式要求：每条选项一行，每行必须以数字开头，不能有任何解释内容或多余括号废话，例如：
1. はい、承知しました。
2. もう少し詳しく教えていただけますか？
3. ありがとうございます、確認いたします。` },
                { role: 'user', content: `当前对话：\n${context}\n\n请给出3条建议回复：` }
            ]);
            // Parse suggestions
            const lines = result.split('\n').filter(l => /^\d/.test(l.trim()));
            const suggestions = lines.map((l, i) => ({
                id: `sug_${Date.now()}_${i}`,
                text: l.replace(/^\d+[\.\、\s]+/, '').trim(),
                type: 'reply'
            }));
            console.log(`[Copilot] ${suggestions.length} suggestions generated`);
            send({ type: 'suggestions', suggestions });
        } catch (e) {
            console.error('[Copilot] Error:', e.message);
        }
    }

    // ③ AI Reply (streaming LLM → TTS)
    async function generateReply(userText) {
        console.log(`[LLM] Generating reply...`);
        send({ type: 'system', status: 'llm_start' });

        try {
            const sysPrompt = `你是一个智能语音会议辅助代理（Agent），代替用户或辅助用户进行对外实时语音沟通。
${sessionContext ? `
# [最高优先级] 这是用户在会前设定的背景资料、你的身份定位或谈判策略：
${sessionContext}
（请严格以上述设定的人设、立场和目标来生成回复内容。）
` : `
请根据对话上下文生成得体、简明扼要的日语口语回复。
`}
你的回复必须是适合直接通过TTS朗读的自然口语。不要带任何解释、拼音、说明或其他括号备注的内容，你的回复也就是直接将被播报出的话。`;

            const messages = [
                { role: 'system', content: sysPrompt },
                ...conversationHistory.slice(-8)
            ];

            const res = await callLLM(messages, { stream: true });
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let sentenceBuffer = "", fullResponse = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                for (const line of chunk.split('\n')) {
                    if (!line.startsWith('data: ') || line.trim() === 'data: [DONE]') continue;
                    try {
                        const data = JSON.parse(line.slice(6));
                        const token = data.choices?.[0]?.delta?.content || "";
                        if (!token) continue;

                        send({ type: 'llm_token', text: token });
                        sentenceBuffer += token;
                        fullResponse += token;

                        if (/[。！？\!\?\n]/.test(token)) {
                            // sendToTTS(sentenceBuffer); // Disabled auto-tts for proxy mode
                            sentenceBuffer = "";
                        }
                    } catch (e) {}
                }
            }
            // if (sentenceBuffer.trim()) sendToTTS(sentenceBuffer); // Disabled auto-tts

            conversationHistory.push({ role: 'assistant', content: fullResponse });
            console.log(`[LLM] Done: "${fullResponse.substring(0, 60)}"`);
            send({ type: 'llm_done', text: fullResponse });

            // After reply, also translate it for the user
            try {
                const replyTranslation = await callLLM([
                    { role: 'system', content: '将以下日文翻译成简体中文。只输出翻译，不解释。' },
                    { role: 'user', content: fullResponse }
                ]);
                send({ type: 'translation', original: fullResponse, translated: replyTranslation, speaker: 'ai' });
            } catch(e) {}

        } catch (err) {
            console.error("[LLM] Error:", err.message);
            send({ type: 'system', status: 'llm_error', detail: err.message });
        }
    }

    let summaryTimer = null;
    let isSummarizing = false;

    // ④ Session Summary
    async function generateSummary() {
        if (isSummarizing || conversationHistory.length < 2) return;
        isSummarizing = true;
        try {
            console.log(`[Summary] Generating...`);
            const historyText = conversationHistory.map(m => `${m.role}: ${m.content}`).join('\n');
            const result = await callLLM([
                { role: 'system', content: `你是一个专业的会议速记员。请对以下对话内容进行实时摘要。内容必须包含：概括(overview)、关键点(key_points)、结论/决定(decisions)、待办(action_items)。
输出格式必须是纯JSON，严禁包含Markdown代码块或任何解释，样例如下：
{"overview":"...", "key_points":["...","..."], "decisions":[], "action_items":[]}` },
                { role: 'user', content: historyText }
            ]);
            try {
                const cleanResult = result.replace(/```json|```/g, '').trim();
                const parsed = JSON.parse(cleanResult);
                send({ type: 'summary', data: parsed });
            } catch {
                send({ type: 'summary', data: { overview: result, key_points: [], decisions: [], action_items: [] } });
            }
            console.log(`[Summary] Done`);
        } catch (e) {
            console.error('[Summary] Error:', e.message);
        } finally {
            isSummarizing = false;
        }
    }

    // ─── Client Message Handler ───────────────────
    // NOTE: ws library v8+ delivers ALL messages as Buffer, including text.
    // We must try JSON parse first to detect control messages vs binary audio.
    clientWs.on('message', (msg, isBinary) => {
        // Try to parse as JSON control message first
        if (!isBinary) {
            try {
                const data = JSON.parse(msg.toString());
                handleControlMessage(data);
                return;
            } catch(e) {
                // Not JSON text, treat as binary below
            }
        }

        // Also try JSON parse on binary messages (ws sometimes marks text as binary)
        try {
            const text = msg.toString('utf-8');
            if (text.startsWith('{')) {
                const data = JSON.parse(text);
                handleControlMessage(data);
                return;
            }
        } catch(e) {}

        // Binary audio data → forward to ASR
        if (asrWs && asrWs.readyState === WebSocket.OPEN && asrReady) {
            asrWs.send(JSON.stringify({
                event_id: eid(), type: 'input_audio_buffer.append',
                audio: Buffer.from(msg).toString('base64')
            }));
        }
    });

    function handleControlMessage(data) {
        if (data.type === 'start') {
            console.log('[Bridge] Start');
            sessionStartTime = Date.now();
            conversationHistory = [];
            sessionContext = data.context || "";
            asrLanguage = data.asrLanguage || 'auto';
            console.log(`[Bridge] ASR Language: ${asrLanguage}`);
            if (!asrWs || asrWs.readyState !== WebSocket.OPEN) initASR();
            if (!ttsWs || ttsWs.readyState !== WebSocket.OPEN) initTTS();

            // Start periodic summary
            if (summaryTimer) clearInterval(summaryTimer);
            summaryTimer = setInterval(() => generateSummary(), 60000); 

        } else if (data.type === 'stop') {
            console.log('[Bridge] Stop');
            if (summaryTimer) clearInterval(summaryTimer);
            generateSummary();
            if (asrWs && asrWs.readyState === WebSocket.OPEN) {
                asrWs.send(JSON.stringify({ event_id: eid(), type: 'input_audio_buffer.commit' }));
            }
        } else if (data.type === 'request_summary') {
            generateSummary();
        } else if (data.type === 'send_suggestion') {
            const text = data.text;
            if (text) {
                console.log(`[Bridge] Selected: "${text}"`);
                conversationHistory.push({ role: 'assistant', content: text });
                // Echo back as an LLM reply so it stays in the history column
                send({ type: 'llm_token', text: text });
                send({ type: 'llm_done' });
                sendToTTS(text);
                send({ type: 'suggestion_sent', text });
            }
        } else if (data.type === 'manual_tts') {
            if (data.text) {
                conversationHistory.push({ role: 'assistant', content: data.text });
                send({ type: 'llm_token', text: data.text });
                send({ type: 'llm_done' });
                sendToTTS(data.text);
            }
        }
    }

    clientWs.on('close', () => {
        console.log('[Bridge] Client disconnected');
        if (summaryTimer) clearInterval(summaryTimer);
        try { if (asrWs) asrWs.close(); } catch(e) {}
        try { if (ttsWs) ttsWs.close(); } catch(e) {}
    });
});

console.log(`🐌 Den Den Mushi Bridge ws://localhost:${PORT}`);
