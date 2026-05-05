export type DOIMetadata = {
  status: 'ok';
  doi: string;
  title: string;
  authors?: string[];
  year?: number;
  journal?: string;
};

export type OfflineResult = { status: 'offline'; doi: string };

export type ResolveResult = DOIMetadata | OfflineResult;

export interface PerspicaciteClient {
  resolveDOI(doi: string): Promise<ResolveResult>;
}

export interface MockClientOptions {
  mode: 'mock';
}

export interface RealClientOptions {
  mode: 'real';
  mcpUrl: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export type PerspicaciteClientOptions = MockClientOptions | RealClientOptions;

const MOCK_FIXTURE: DOIMetadata = {
  status: 'ok',
  doi: '10.1073/pnas.1319030111',
  title: 'Untargeted metabolomics reveals a link between gut microbiota and host energy metabolism',
  authors: ['Wikoff WR', 'Anfora AT'],
  year: 2014,
  journal: 'PNAS',
};

function makeMockClient(): PerspicaciteClient {
  return {
    async resolveDOI(doi: string): Promise<ResolveResult> {
      return { ...MOCK_FIXTURE, doi };
    },
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function makeRealClient(opts: RealClientOptions): PerspicaciteClient {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxRetries = opts.maxRetries ?? 3;

  return {
    async resolveDOI(doi: string): Promise<ResolveResult> {
      let attempt = 0;
      while (attempt <= maxRetries) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await fetch(`${opts.mcpUrl}/resolve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ doi }),
            signal: controller.signal,
          });
          clearTimeout(id);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as DOIMetadata;
          return { ...data, status: 'ok', doi };
        } catch {
          clearTimeout(id);
          if (attempt === maxRetries) {
            return { status: 'offline', doi };
          }
          // Exponential backoff: 200ms, 400ms, 800ms…
          await sleep(200 * Math.pow(2, attempt));
          attempt++;
        }
      }
      return { status: 'offline', doi };
    },
  };
}

export function makePerspicaciteClient(opts: PerspicaciteClientOptions): PerspicaciteClient {
  if (opts.mode === 'mock') return makeMockClient();
  return makeRealClient(opts);
}
