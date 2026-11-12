import { MODELS } from '../config.js';
import { gemini } from './providers/gemini.js';
import { groq } from './providers/groq.js';

// provider = the dialect (adapter). A route = adapter + model id.
// One Gemini adapter serves two routes because the model is just a parameter.
export const PROVIDERS = { gemini, groq };

// Model ids come only from MODELS in config.js. An empty id disables the route.
export const ROUTES = {
  gemini_flash: { provider: 'gemini', model: MODELS.geminiPrimary },
  gemini_flash_lite: { provider: 'gemini', model: MODELS.geminiFallback },
  groq: { provider: 'groq', model: MODELS.groq },
};

// Fallback order per task kind.
export const ORDER = {
  parse: ['gemini_flash', 'groq', 'gemini_flash_lite'],
  rewrite: ['groq', 'gemini_flash', 'gemini_flash_lite'],
};
