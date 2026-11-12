import { Router } from 'express';
import { z } from 'zod';
import { callLLM } from '../llm/index.js';
import { LLMError } from '../llm/errors.js';
import { requireAuth } from '../middleware/requireAuth.js';

// DEV ONLY. app.js mounts this router only when NODE_ENV is exactly "development" (npm run dev).
// It exists so you can poke callLLM from curl and watch fallback happen.

const SAMPLE_TEXT =
  'Jane Doe has been a software engineer at Acme Corp since 2021. She works mainly with React and Node.js.';

const bodySchema = z.object({
  // Which route order to exercise: parse starts on Gemini, rewrite starts on Groq.
  task: z.enum(['parse', 'rewrite']).default('parse'),
  // Capped so a dev call can never become a giant prompt.
  text: z.string().trim().min(1).max(500).default(SAMPLE_TEXT),
});

// What we ask the model to return. Plain facts only, nothing to invent.
const extractionSchema = z.object({
  name: z.string(),
  role: z.string(),
  company: z.string(),
  skills: z.array(z.string()).max(10),
});

const SYSTEM =
  'You extract facts from text. Reply with JSON only, in the form ' +
  '{"name": string, "role": string, "company": string, "skills": string[]}. ' +
  'Use only what the text says. Use "" or [] when something is missing. Never invent facts.';

// `llm` is injectable so tests can pass a fake and never touch a real provider.
export function createDevRouter({ llm = callLLM } = {}) {
  const router = Router();

  // Whole router is protected, same as the profile router.
  router.use(requireAuth);

  router.post('/llm-test', async (req, res) => {
    const parsed = bodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      return res.status(400).json({ error: 'Invalid body', issues });
    }
    const { task, text } = parsed.data;

    try {
      const { data, provider, ms } = await llm({
        task,
        system: SYSTEM,
        user: `Extract the JSON from this text:\n${text}`,
        schema: extractionSchema,
        maxTokens: 400,
      });
      return res.json({ provider, ms, data });
    } catch (err) {
      if (err instanceof LLMError) {
        // kind and per-route causes hold no prompts, bodies or keys, so they are safe to show.
        console.error(`llm-test failed: ${err.kind}`);
        return res.status(502).json({ error: 'LLM call failed', kind: err.kind, causes: err.causes ?? [] });
      }
      console.error('llm-test crashed:', err.message);
      return res.status(500).json({ error: 'Dev route failed' });
    }
  });

  return router;
}
