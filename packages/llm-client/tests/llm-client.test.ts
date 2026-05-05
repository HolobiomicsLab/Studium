import { describe, it, expect } from 'vitest';
import { makeLLMClient, LLM_ALIASES } from '../src/index.js';

describe('LLMClient (mock mode)', () => {
  it('returns a non-empty string for a prompt with studium/planner alias', async () => {
    const client = makeLLMClient({ mode: 'mock' });
    const result = await client.complete('hello', 'studium/planner');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('accepts all four canonical aliases', async () => {
    const client = makeLLMClient({ mode: 'mock' });
    for (const alias of LLM_ALIASES) {
      const result = await client.complete('ping', alias);
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it('throws on an unknown alias', async () => {
    const client = makeLLMClient({ mode: 'mock' });
    await expect(client.complete('ping', 'studium/unknown' as never)).rejects.toThrow();
  });
});
