import WebSocket from 'ws';

export async function synthesizeSpeech(text, config = {}) {
  const apiKey = config.QWEN_API_KEY;
  const model = config.QWEN_TTS_MODEL;
  const baseUrl = (config.QWEN_API_BASE || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '');
  const forceQwenTts = config.FORCE_QWEN_TTS === true || config.FORCE_QWEN_TTS === 'true';

  if (forceQwenTts && (!apiKey || !model)) {
    return mockResult(text, 'FORCE_QWEN_TTS but missing model or API key');
  }

  if (!apiKey || !model) {
    return mockResult(text, !model ? 'QWEN_TTS_MODEL not configured' : 'missing api key');
  }

  const voice = config.QWEN_TTS_VOICE || 'Cherry';

  if (isQwenRealtimeModel(model)) {
    try {
      return await synthesizeWithQwenRealtime({ text, apiKey, model, voice });
    } catch (error) {
      if (forceQwenTts) {
        return mockResult(text, `qwen-realtime: ${error.message}`);
      }
    }
  }

  const attempts = [
    {
      name: 'dashscope-multimodal-generation',
      url: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      body: {
        model,
        input: {
          text,
          voice,
          language_type: config.QWEN_TTS_LANGUAGE_TYPE || 'Japanese'
        }
      }
    },
    {
      name: 'compatible-audio-speech',
      url: `${baseUrl}/audio/speech`,
      body: {
        model,
        input: text,
        voice,
        format: 'mp3'
      }
    }
  ];

  const failures = [];

  for (const attempt of attempts) {
    try {
      const response = await fetch(attempt.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(attempt.body)
      });

      const parsed = await parseHttpTtsResponse(response, model, attempt.name);
      if (!parsed.ok) {
        failures.push(`${attempt.name}: ${parsed.error}`);
        continue;
      }

      return parsed.result;
    } catch (error) {
      failures.push(`${attempt.name}: ${error.message}`);
    }
  }

  return mockResult(text, failures.join(' | '));
}

function isQwenRealtimeModel(model) {
  return /^qwen.*tts.*realtime/i.test(model || '');
}

function mockResult(text, fallbackReason) {
  return {
    audioUrl: null,
    audioBase64: null,
    isMock: true,
    text,
    fallbackReason
  };
}

async function synthesizeWithQwenRealtime({ text, apiKey, model, voice }) {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=${encodeURIComponent(model)}`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });

    const chunks = [];
    let settled = false;
    let sessionReady = false;
    let responseDone = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {}
      fn(value);
    };

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          event_id: createEventId(),
          type: 'session.update',
          session: {
            voice,
            mode: 'commit',
            response_format: 'pcm',
            sample_rate: 24000
          }
        })
      );
    });

    ws.on('message', (raw) => {
      let event;
      try {
        event = JSON.parse(raw.toString());
      } catch (error) {
        finish(reject, new Error(`invalid realtime payload: ${error.message}`));
        return;
      }

      const type = event?.type;

      if (type === 'error') {
        const detail = JSON.stringify(event?.error || event).slice(0, 500);
        finish(reject, new Error(detail));
        return;
      }

      if ((type === 'session.created' || type === 'session.updated') && !sessionReady) {
        sessionReady = true;
        ws.send(JSON.stringify({ event_id: createEventId(), type: 'input_text_buffer.append', text }));
        ws.send(JSON.stringify({ event_id: createEventId(), type: 'input_text_buffer.commit' }));
        ws.send(JSON.stringify({ event_id: createEventId(), type: 'session.finish' }));
        return;
      }

      if (type === 'response.audio.delta' && event.delta) {
        chunks.push(event.delta);
        return;
      }

      if (type === 'response.done') {
        responseDone = true;
        return;
      }

      if (type === 'session.finished') {
        if (!responseDone && chunks.length === 0) {
          finish(reject, new Error('session finished without audio'));
          return;
        }

        const pcmBuffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk, 'base64')));
        if (!pcmBuffer.length) {
          finish(reject, new Error('empty audio body'));
          return;
        }

        const wavBuffer = pcmToWav(pcmBuffer, 24000, 1, 16);
        finish(resolve, {
          audioUrl: null,
          audioBase64: wavBuffer.toString('base64'),
          mimeType: 'audio/wav',
          isMock: false,
          model,
          providerAttempt: 'qwen-realtime-websocket'
        });
      }
    });

    ws.on('error', (error) => finish(reject, error));
    ws.on('close', (code, reason) => {
      if (!settled) {
        finish(reject, new Error(`websocket closed before completion (${code} ${reason?.toString() || ''})`.trim()));
      }
    });
  });
}

async function parseHttpTtsResponse(response, model, attemptName) {
  if (!response.ok) {
    const raw = await response.text();
    return { ok: false, error: `HTTP ${response.status} ${raw}` };
  }

  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const data = await response.json();
    const audioBase64 = extractAudioBase64(data);
    const audioUrl = extractAudioUrl(data);
    const mimeType = extractMimeType(data) || 'audio/mpeg';

    if (!audioBase64 && !audioUrl) {
      return { ok: false, error: `empty JSON payload ${JSON.stringify(data).slice(0, 500)}` };
    }

    return {
      ok: true,
      result: {
        audioUrl,
        audioBase64,
        mimeType,
        isMock: false,
        model,
        providerAttempt: attemptName
      }
    };
  }

  const arrayBuffer = await response.arrayBuffer();
  const audioBase64 = Buffer.from(arrayBuffer).toString('base64');
  if (!audioBase64) {
    return { ok: false, error: 'empty audio body' };
  }

  return {
    ok: true,
    result: {
      audioUrl: null,
      audioBase64,
      mimeType: contentType || 'audio/mpeg',
      isMock: false,
      model,
      providerAttempt: attemptName
    }
  };
}

function extractAudioBase64(data) {
  return data?.output?.audio?.data || data?.output?.audio_base64 || data?.output?.audioBase64 || data?.audio?.data || data?.audio_base64 || data?.audioBase64 || null;
}

function extractAudioUrl(data) {
  return data?.output?.audio?.url || data?.output?.audio_url || data?.output?.audioUrl || data?.audio?.url || data?.audio_url || data?.audioUrl || null;
}

function extractMimeType(data) {
  return data?.output?.audio?.mime_type || data?.output?.audio?.mimeType || data?.output?.mime_type || data?.output?.mimeType || data?.mime_type || data?.mimeType || null;
}

function createEventId() {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function pcmToWav(pcmBuffer, sampleRate, channels, bitDepth) {
  const blockAlign = (channels * bitDepth) / 8;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmBuffer.length, 40);

  return Buffer.concat([header, pcmBuffer]);
}
