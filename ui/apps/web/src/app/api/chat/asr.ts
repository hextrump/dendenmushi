export async function transcribeAudioChunk(payload: any, config: any = {}) {
  const apiKey = config.QWEN_API_KEY;
  const model = config.QWEN_ASR_MODEL || 'qwen3-asr-flash';
  const baseUrl = (config.QWEN_API_BASE || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '');
  const forceQwenAsr = config.FORCE_QWEN_ASR === true || config.FORCE_QWEN_ASR === 'true';

  // If not forcing Qwen ASR and no audio provided, return mock
  if (!payload?.audioBase64 && !forceQwenAsr) {
    return mockAsr();
  }

  // If forcing Qwen ASR but missing required params, return error info
  if (forceQwenAsr && (!payload?.audioBase64 || !apiKey)) {
    return {
      text: '',
      isMock: true,
      fallbackReason: forceQwenAsr ? 'FORCE_QWEN_ASR but missing audio or API key' : 'no audio data'
    };
  }

  if (!payload?.audioBase64 || payload?.encoding !== 'base64' || !apiKey) {
    return mockAsr();
  }

  try {
    const mimeType = payload.mimeType || 'audio/webm';
    const dataUri = `data:${mimeType};base64,${payload.audioBase64}`;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'input_audio',
                input_audio: {
                  data: dataUri
                }
              }
            ]
          }
        ],
        stream: false,
        asr_options: {
          enable_itn: false
        }
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ASR request failed: ${response.status} ${text}`);
    }

    const data = await response.json();
    const text = extractAsrText(data);
    if (!text) {
      throw new Error(`Empty ASR response | raw=${JSON.stringify(data)}`);
    }

    return {
      text,
      isMock: false,
      model,
      rawPreview: JSON.stringify(data).slice(0, 500)
    };
  } catch (error: any) {
    console.error("ASR Error fallback hit:", error.message);
    return {
      ...(await mockAsr()),
      fallbackReason: error.message
    };
  }
}

function extractAsrText(data) {
  const messageContent = data?.choices?.[0]?.message?.content;

  if (typeof messageContent === 'string') {
    return messageContent.trim();
  }

  if (Array.isArray(messageContent)) {
    const texts = messageContent
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item?.text) return item.text;
        if (item?.type === 'text' && item?.text) return item.text;
        return '';
      })
      .filter(Boolean)
      .join(' ')
      .trim();
    if (texts) return texts;
  }

  if (typeof data?.output?.text === 'string') return data.output.text.trim();
  if (typeof data?.text === 'string') return data.text.trim();

  return '';
}

async function mockAsr() {
  return {
    text: '[mock-asr] ここから日本語の練習を始めましょう。',
    isMock: true
  };
}
