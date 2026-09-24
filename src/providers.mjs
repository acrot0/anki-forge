/**
 * Built-in OpenAI-compatible endpoints. Students should not have to look up
 * base URLs; `--provider deepseek` (or picking it in the interactive wizard)
 * fills them in. `hint` is the default model suggestion, not a hard default —
 * model names move faster than this table.
 */
export const PROVIDERS = {
  openai: { baseUrl: 'https://api.openai.com/v1', hint: 'gpt-4o-mini' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', hint: 'deepseek-chat' },
  zhipu: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', hint: 'glm-4-flash' },
  kimi: { baseUrl: 'https://api.moonshot.cn/v1', hint: 'moonshot-v1-8k' },
  siliconflow: { baseUrl: 'https://api.siliconflow.cn/v1', hint: 'deepseek-ai/DeepSeek-V3' },
  ollama: { baseUrl: 'http://127.0.0.1:11434/v1', hint: 'llama3.1', keyless: true },
};

/** Resolve --provider into baseUrl (+ model hint when none given). */
export function applyProvider(args) {
  if (!args.provider) return args;
  const p = PROVIDERS[args.provider];
  if (!p) {
    const names = Object.keys(PROVIDERS).join(', ');
    throw new Error(`unknown provider "${args.provider}" — known: ${names}`);
  }
  if (!args.baseUrl) args.baseUrl = p.baseUrl;
  if (!args.model) args.model = p.hint;
  if (p.keyless && !args.apiKey) args.apiKey = 'ollama'; // the API requires a bearer, it just ignores it
  return args;
}
