import { config } from '../../config.js';
import { httpError } from '../errors.js';

// Adapter for Google Gemini. Speaks Gemini's dialect, hands back plain text.
// It does not retry, parse JSON or validate. The router does all of that.
export const gemini = {
  name: 'gemini',
  isConfigured: () => Boolean(config.llm.geminiApiKey),

  async generate({ model, system, user, maxTokens, signal }) {
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/' +
      `${encodeURIComponent(model)}:generateContent`;

    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        // Key goes in a header, never the URL, so it can't leak through logs or error text.
        'x-goog-api-key': config.llm.geminiApiKey,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw httpError(res.status);

    const json = await res.json();
    // A safety block comes back as 200 with no parts; that becomes '' and the router sees 'empty'.
    const parts = json?.candidates?.[0]?.content?.parts ?? [];
    return parts.map((p) => p?.text ?? '').join('');
  },
};
