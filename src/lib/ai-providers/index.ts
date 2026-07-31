import type { AIProvider } from "./types";
import { GeminiProvider } from "./gemini-provider";
import { OllamaProvider } from "./ollama-provider";
import { CopilotProvider } from "./copilot-provider";
import { GroqProvider } from "./groq-provider";
import { withAICache } from "./cache";

export type { AIProvider } from "./types";

// Default priority order for every AI call in the app (resume extraction,
// interview question generation, employee quiz generation, etc.):
// Copilot first, then Groq, then Gemini, then Ollama last. Only after all
// four fail does a caller fall back to its own non-LLM fallback (e.g. the
// preset employee question bank) — never before every provider is tried.
const SUPPORTED_PROVIDERS = ["copilot", "groq", "gemini", "ollama"] as const;
type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

const instances = new Map<SupportedProvider, AIProvider>();

function getProvider(name: SupportedProvider): AIProvider {
  let p = instances.get(name);
  if (p) return p;
  p = name === "groq" ? new GroqProvider()
    : name === "ollama" ? new OllamaProvider()
    : name === "copilot" ? new CopilotProvider()
    : new GeminiProvider();
  instances.set(name, p);
  return p;
}

function providerOrder(): SupportedProvider[] {
  // AI_PROVIDER, if explicitly set, is an admin override that jumps to the
  // front of the queue. Leave it unset to use the standard Copilot -> Groq ->
  // Gemini -> Ollama priority order.
  const raw = (process.env.AI_PROVIDER || "").trim().toLowerCase();
  const configured = (SUPPORTED_PROVIDERS as readonly string[]).includes(raw) ? (raw as SupportedProvider) : null;
  if (!configured) return [...SUPPORTED_PROVIDERS];
  return [configured, ...SUPPORTED_PROVIDERS.filter((p) => p !== configured)];
}

// Configured provider first, then the rest as fallback; throws only after all fail.
export async function generateAIText(prompt: string): Promise<string> {
  let lastErr: unknown;
  for (const name of providerOrder()) {
    try {
      return await withAICache(name, prompt, () => getProvider(name).generateText(prompt));
    } catch (err) {
      lastErr = err;
      console.warn(`AI provider "${name}" failed, trying next.`, err);
    }
  }
  throw lastErr;
}
