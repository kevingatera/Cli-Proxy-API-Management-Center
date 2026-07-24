/**
 * Pure helpers for the proxy smoke test.
 *
 * These are extracted from SystemPage so the SmokeTestCard component can own
 * them without duplicating logic, and so they're testable in isolation.
 */

export const SMOKE_TEST_VARIANTS = ['', 'fast', 'minimal', 'low', 'medium', 'high', 'xhigh', 'auto', 'none'];

export const splitSmokeTestModel = (value: string): { model: string; variant: string } => {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return { model: '', variant: '' };
  }

  const lastSlash = trimmed.lastIndexOf('/');
  if (lastSlash <= 0 || lastSlash === trimmed.length - 1) {
    return { model: trimmed, variant: '' };
  }

  const tail = trimmed.slice(lastSlash + 1).trim().toLowerCase();
  if (!SMOKE_TEST_VARIANTS.includes(tail)) {
    return { model: trimmed, variant: '' };
  }

  return {
    model: trimmed.slice(0, lastSlash).trim(),
    variant: tail,
  };
};

export const buildSmokeTestModel = (model: string, variant: string): string => {
  const trimmedModel = String(model || '').trim();
  const trimmedVariant = String(variant || '').trim();
  if (!trimmedModel) return '';
  if (!trimmedVariant) return trimmedModel;
  return `${trimmedModel}/${trimmedVariant}`;
};

export const normalizeProxyBaseUrl = (baseUrl: string): string => {
  let normalized = String(baseUrl || '').trim();
  if (!normalized) return '';
  normalized = normalized.replace(/\/?v0\/management\/?$/i, '');
  normalized = normalized.replace(/\/+$/g, '');
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `http://${normalized}`;
  }
  return normalized;
};

export const buildProxyChatCompletionsEndpoint = (baseUrl: string): string => {
  const normalized = normalizeProxyBaseUrl(baseUrl);
  if (!normalized) return '';
  return `${normalized}/v1/chat/completions`;
};

const extractTextSegments = (input: unknown): string[] => {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    return trimmed ? [trimmed] : [];
  }

  if (Array.isArray(input)) {
    return input.flatMap((entry) => extractTextSegments(entry));
  }

  if (input && typeof input === 'object') {
    const candidate = input as Record<string, unknown>;
    return [
      ...extractTextSegments(candidate.text),
      ...extractTextSegments(candidate.content),
      ...extractTextSegments(candidate.output_text),
    ];
  }

  return [];
};

export const extractChatResponseText = (payload: unknown): string => {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const body = payload as Record<string, unknown>;
  const choices = Array.isArray(body.choices) ? body.choices : [];
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') continue;
    const message = (choice as Record<string, unknown>).message;
    const text = extractTextSegments(message).join('\n').trim();
    if (text) return text;
  }

  return extractTextSegments(body.output ?? body.output_text ?? body.content).join('\n').trim();
};

export interface SmokeTestTokens {
  prompt: number;
  completion: number;
  total: number;
  cached: number;
  reasoning: number;
}

/**
 * Extract token usage from a chat completion response body.
 * Handles both OpenAI-style (`prompt_tokens_details.cached_tokens`,
 * `completion_tokens_details.reasoning_tokens`) and Anthropic-style fields.
 */
export const extractTokens = (body: unknown): SmokeTestTokens => {
  const empty: SmokeTestTokens = { prompt: 0, completion: 0, total: 0, cached: 0, reasoning: 0 };
  if (!body || typeof body !== 'object') return empty;

  const usage = (body as Record<string, unknown>)?.usage;
  if (!usage || typeof usage !== 'object') return empty;

  const u = usage as Record<string, any>;
  const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };

  const promptDetails = u.prompt_tokens_details ?? {};
  const completionDetails = u.completion_tokens_details ?? {};

  return {
    prompt: num(u.prompt_tokens ?? u.input_tokens),
    completion: num(u.completion_tokens ?? u.output_tokens),
    total: num(u.total_tokens),
    cached: num(promptDetails.cached_tokens ?? promptDetails.cached_creation_tokens ?? u.cached_tokens),
    reasoning: num(completionDetails.reasoning_tokens ?? u.reasoning_tokens),
  };
};

export const extractFinishReason = (body: unknown): string => {
  if (!body || typeof body !== 'object') return '';
  const choices = (body as Record<string, unknown>)?.choices;
  if (!Array.isArray(choices) || !choices.length) return '';
  const first = choices[0];
  if (!first || typeof first !== 'object') return '';
  return String(
    (first as Record<string, unknown>)?.finish_reason ??
      (first as Record<string, unknown>)?.native_finish_reason ??
      ''
  );
};

export const extractResolvedModel = (body: unknown, fallback: string): string => {
  if (!body || typeof body !== 'object') return fallback;
  const model = (body as Record<string, unknown>)?.model;
  return typeof model === 'string' && model ? model : fallback;
};

/**
 * Build a curl command that reproduces the exact smoke test request.
 * The key is masked so the command is safe to copy/share.
 */
export const buildCurlCommand = (
  endpoint: string,
  model: string,
  prompt: string,
  maskedKey: string
): string => {
  const body = JSON.stringify(
    { model, messages: [{ role: 'user', content: prompt }], stream: false },
    null,
    2
  );
  return [
    'curl',
    '-X',
    'POST',
    `"${endpoint}"`,
    '-H',
    '"Authorization: Bearer ' + maskedKey + '"',
    '-H',
    '"Content-Type: application/json"',
    '-d',
    `'${body.replace(/'/g, "'\\''")}'`,
  ].join(' \\\n  ');
};
