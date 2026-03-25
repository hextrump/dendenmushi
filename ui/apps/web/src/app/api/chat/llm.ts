export async function generateTeacherReply(messages, config = {}) {
  const apiKey = config.QWEN_API_KEY;
  const model = config.QWEN_LLM_MODEL || 'qwen-plus';
  const baseUrl = (config.QWEN_API_BASE || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '');

  if (!apiKey) {
    return mockReply(messages);
  }

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
        max_tokens: 300
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LLM request failed: ${response.status} ${text}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content?.trim();

    if (!text) {
      throw new Error('Empty LLM response');
    }

    return {
      text,
      isMock: false,
      model
    };
  } catch (error) {
    return {
      ...(await mockReply(messages)),
      fallbackReason: error.message
    };
  }
}

async function mockReply(messages) {
  const lastUser = messages[messages.length - 1]?.content || '';
  return {
    text: `わかりました。では、もう少し自然に言うならこうです。\n\n${lastUser}\n\nでは、次の質問です。今日は何をしましたか？`,
    isMock: true
  };
}
