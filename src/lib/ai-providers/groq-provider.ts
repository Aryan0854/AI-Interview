import type { AIProvider } from "./types";

/**
 * Groq provider — uses Groq's hosted inference API (OpenAI-compatible chat-completions
 * schema, but this talks to Groq's own endpoint via plain fetch, not the "openai" package).
 * Groq runs open models (Llama, Gemma, etc.) on custom hardware and is typically both
 * faster and substantially cheaper per token than Gemini/OpenAI-class hosted APIs, which
 * is why it's offered here as a cost-conscious option.
 *
 * All configuration is read exclusively from environment variables (.env.local):
 *   GROQ_API_KEY  - required
 *   GROQ_MODEL    - defaults to "llama-3.3-70b-versatile" if unset
 *   GROQ_API_BASE_URL - defaults to https://api.groq.com/openai/v1
 *
 * To activate this provider instead of Gemini, set AI_PROVIDER=groq in .env.local.
 *
 * --- Tokens-per-minute (TPM) rate limiting ---
 * Groq's free/on-demand tier enforces a low per-model TPM cap (e.g. 8000 TPM for
 * `openai/gpt-oss-20b`), shared across every concurrent test-taker/admin call. Two
 * lightweight, serverless-safe mitigations are applied here (no long sleeps, since a
 * Vercel function has a hard wall-clock timeout):
 *   1. Before sending, roughly estimate the prompt's token count. If a single request
 *      would already exceed the model's usual budget, skip Groq immediately (throw)
 *      instead of guaranteeing a 429 round-trip — the existing Copilot->Groq->Gemini->
 *      Ollama fallback chain in `ai-providers/index.ts` then tries the next provider
 *      right away.
 *   2. On an actual 429, parse Groq's `retry-after` (header or error body) and, if it's
 *      short, wait that long (capped) and retry once in-process before giving up — this
 *      avoids unnecessarily burning a fallback provider on a purely transient/timing
 *      TPM burst that would have cleared itself in a few seconds.
 */

// Conservative default; overridable per-model via GROQ_TPM_LIMIT if a different model's
// limit is known to differ (Groq's dashboard/console shows the exact per-model number).
const DEFAULT_TPM_LIMIT = 8000;
// Leave headroom for the prompt template + expected response tokens + other concurrent
// callers, rather than trying to use the full budget on a single request.
const SAFE_REQUEST_TOKEN_FRACTION = 0.6;
const MAX_RETRY_WAIT_MS = 6000;

function estimateTokens(text: string): number {
  // Rough, provider-agnostic heuristic (~4 chars/token for English prose/JSON) — good
  // enough to catch prompts that are certain to blow the whole per-minute budget alone,
  // without needing a real tokenizer dependency just for this guard.
  return Math.ceil(text.length / 4);
}

function getTpmLimit(): number {
  const configured = Number(process.env.GROQ_TPM_LIMIT);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TPM_LIMIT;
}

/** Parses a "try again in Xs" style hint out of Groq's rate-limit error body, if present. */
function parseRetryAfterSeconds(headerValue: string | null, bodyText: string): number | null {
  if (headerValue) {
    const fromHeader = Number(headerValue);
    if (Number.isFinite(fromHeader) && fromHeader > 0) return fromHeader;
  }
  const match = bodyText.match(/try again in\s+([\d.]+)s/i);
  if (match) {
    const seconds = Number(match[1]);
    if (Number.isFinite(seconds) && seconds > 0) return seconds;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GroqProvider implements AIProvider {
  readonly name = "groq";

  async generateText(prompt: string): Promise<string> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error("GROQ_API_KEY is not configured. Set GROQ_API_KEY in .env.local.");
    }

    const estimatedTokens = estimateTokens(prompt);
    const safeBudget = getTpmLimit() * SAFE_REQUEST_TOKEN_FRACTION;
    if (estimatedTokens > safeBudget) {
      throw new Error(
        `Groq request skipped: estimated ~${estimatedTokens} prompt tokens exceeds the safe ` +
        `per-request budget (~${Math.round(safeBudget)} of the ${getTpmLimit()} TPM limit). ` +
        `Falling back to the next AI provider instead of guaranteeing a 429.`
      );
    }

    const baseUrl = (process.env.GROQ_API_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/+$/, "");
    const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

    return this.sendWithRetry(baseUrl, apiKey, model, prompt, /* isRetry */ false);
  }

  private async sendWithRetry(
    baseUrl: string,
    apiKey: string,
    model: string,
    prompt: string,
    isRetry: boolean
  ): Promise<string> {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
        }),
      });
    } catch (networkErr: any) {
      throw new Error(`Could not reach Groq API at ${baseUrl}. (${networkErr?.message || networkErr})`);
    }

    if (res.status === 429 && !isRetry) {
      const errText = await res.text().catch(() => "");
      const retryAfterSeconds = parseRetryAfterSeconds(res.headers.get("retry-after"), errText);
      const waitMs = retryAfterSeconds ? Math.min(retryAfterSeconds * 1000, MAX_RETRY_WAIT_MS) : null;
      if (waitMs !== null) {
        await sleep(waitMs);
        return this.sendWithRetry(baseUrl, apiKey, model, prompt, /* isRetry */ true);
      }
      throw new Error(`Groq request failed (429): ${errText || res.statusText}`);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Groq request failed (${res.status}): ${errText || res.statusText}`);
    }

    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? "";
  }
}
