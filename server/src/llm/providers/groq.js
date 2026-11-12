import { config } from '../../config.js';
import { httpError } from '../errors.js';

// Adapter for Groq (OpenAI-compatible chat completions). Same contract as gemini.js.
// Note: Groq's JSON mode wants the word "JSON" somewhere in the prompt, so callers' prompts say it.
export const groq = {
  name: 'groq',
  isConfigured: () => Boolean(config.llm.groqApiKey),

  async generate({ model, system, user, maxTokens, signal }) {
    const body = {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
    };

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.llm.groqApiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw httpError(res.status);

    const json = await res.json();
    return json?.choices?.[0]?.message?.content ?? '';
  },
};
