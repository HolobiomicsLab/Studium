export const LLM_ALIASES = [
  'studium/planner',
  'studium/scene-synth',
  'studium/critic',
  'studium/teacher-review',
  'studium/runtime-tutor',
] as const;

export type LLMAlias = (typeof LLM_ALIASES)[number];

export interface LLMClient {
  complete(prompt: string, alias: LLMAlias): Promise<string>;
}

export interface MockClientOptions {
  mode: 'mock';
}

export interface LiteLLMClientOptions {
  mode: 'litellm';
  baseUrl: string;
  apiKey?: string;
}

export type LLMClientOptions = MockClientOptions | LiteLLMClientOptions;

function assertValidAlias(alias: string): asserts alias is LLMAlias {
  if (!(LLM_ALIASES as readonly string[]).includes(alias)) {
    throw new Error(`Unknown LLM alias: "${alias}". Must be one of: ${LLM_ALIASES.join(', ')}`);
  }
}

function makeMockClient(): LLMClient {
  return {
    async complete(prompt: string, alias: LLMAlias): Promise<string> {
      assertValidAlias(alias);
      return `[mock] response for ${alias}: ${prompt.slice(0, 40)}`;
    },
  };
}

function makeLiteLLMClient(opts: LiteLLMClientOptions): LLMClient {
  return {
    async complete(prompt: string, alias: LLMAlias): Promise<string> {
      assertValidAlias(alias);
      const res = await fetch(`${opts.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: alias,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) {
        throw new Error(`LiteLLM request failed: ${res.status} ${await res.text()}`);
      }
      const json = (await res.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      return json.choices[0]?.message.content ?? '';
    },
  };
}

export function makeLLMClient(opts: LLMClientOptions): LLMClient {
  if (opts.mode === 'mock') return makeMockClient();
  return makeLiteLLMClient(opts);
}
