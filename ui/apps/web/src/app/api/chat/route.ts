import { NextRequest, NextResponse } from "next/server";
import { transcribeAudioChunk } from "./asr";
import { generateTeacherReply } from "./llm";
import { synthesizeSpeech } from "./tts";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audioBlob = formData.get("audio") as Blob | null;
    
    if (!audioBlob) {
      return NextResponse.json({ error: "No audio provided" }, { status: 400 });
    }

    // Convert Blob to Buffer
    const arrayBuffer = await audioBlob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const audioBase64 = buffer.toString('base64');
    
    const config = {
       QWEN_API_KEY: process.env.QWEN_API_KEY,
       QWEN_API_BASE: process.env.QWEN_API_BASE || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
       QWEN_ASR_MODEL: process.env.QWEN_ASR_MODEL || 'qwen3-asr-flash',
       QWEN_LLM_MODEL: process.env.QWEN_LLM_MODEL || 'qwen-plus',
       QWEN_TTS_MODEL: process.env.QWEN_TTS_MODEL || 'qwen3-tts-flash',
       QWEN_TTS_VOICE: process.env.QWEN_TTS_VOICE || 'Cherry',
       QWEN_TTS_LANGUAGE_TYPE: process.env.QWEN_TTS_LANGUAGE_TYPE || 'Japanese',
       FORCE_QWEN_TTS: true,
       FORCE_QWEN_ASR: true
    };
    
    // 1. ASR
    const cleanMimeType = audioBlob.type.split(';')[0];
    const asrRes = (await transcribeAudioChunk({ audioBase64, encoding: 'base64', mimeType: cleanMimeType }, config)) as any;
    if (!asrRes || !asrRes.text || asrRes.text.trim() === '' || asrRes.isMock) {
       if (asrRes?.fallbackReason) console.error("ASR Fallback reason:", asrRes.fallbackReason);
       return NextResponse.json({ error: "Could not hear any speech clearly. Please speak a little longer or check your mic." });
    }
    const userText = asrRes.text;

    // 2. LLM
    const messages = [
       { role: "system", content: "You are Sakura, a Japanese teacher. Be extremely concise, conversational, and natural. Keep responses very short." },
       { role: "user", content: userText }
    ];
    const llmRes = (await generateTeacherReply(messages, config)) as any;
    const assistantText = llmRes.text;
    if (!assistantText) {
       return NextResponse.json({ error: "LLM empty response" });
    }

    // 3. TTS
    const ttsRes = (await synthesizeSpeech(assistantText, config)) as any;
    if (!ttsRes.audioBase64) {
       // If it only returns an audioUrl without Base64, we fetch it (though synthesizeSpeech native JS logic usually handles mocking it or generating base64 directly)
       let finalBase64: string | null = null;
       if (ttsRes.audioUrl) {
           const wavRes = await fetch(ttsRes.audioUrl);
           const wavBuf = await wavRes.arrayBuffer();
           finalBase64 = Buffer.from(wavBuf).toString('base64');
           ttsRes.audioBase64 = finalBase64;
       } else {
           return NextResponse.json({ error: "TTS failed: " + JSON.stringify(ttsRes) });
       }
    }

    return NextResponse.json({
       user_text: userText,
       assistant_text: assistantText,
       audio_base64: ttsRes.audioBase64 || null
    });
  } catch (error: any) {
    console.error("API error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
