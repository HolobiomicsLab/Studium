import { describe, it, expect } from 'vitest';
import { makePerspicaciteClient } from '../src/index.js';

describe('PerspicaciteClient (mock mode)', () => {
  it('resolveDOI returns static fixture in mock mode', async () => {
    const client = makePerspicaciteClient({ mode: 'mock' });
    const result = await client.resolveDOI('10.1073/pnas.1319030111');
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.doi).toBe('10.1073/pnas.1319030111');
      expect(typeof result.title).toBe('string');
    }
  });

  it('returns {status: "offline"} without throwing when MCP is unavailable (real mode with bad url)', async () => {
    const client = makePerspicaciteClient({
      mode: 'real',
      mcpUrl: 'http://localhost:1',
    });
    const result = await client.resolveDOI('10.1073/pnas.1319030111');
    expect(result.status).toBe('offline');
  });
});
