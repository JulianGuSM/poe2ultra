import { afterEach, expect, it, vi } from 'vitest';
import { withRequest, assertOk } from './vendor/api-base.js';

afterEach(() => vi.unstubAllGlobals());
it.each([200, 400])('captures the exact decoded HTTP body even for status %i', async status => {
  const raw = status === 200 ? 'data: {"text":"中文"}\n\ndata: [DONE]\n\n' : JSON.stringify({ error: { message: 'bad request ' + 'x'.repeat(3000) } });
  const bytes = new TextEncoder().encode(raw);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
    controller.close();
  } }), { status })));
  const debug = { data: vi.fn(async () => {}), chunk: vi.fn() };
  const body = { input: 'All source text', max_tokens: 123 };
  const request = withRequest({ endpoint: 'https://example.com/api', apiKey: 'test-only-key', body, debug }, async (res: Response) => { await assertOk(res); return res.text(); });
  if (status === 200) expect(await request).toBe(raw);
  else await expect(request).rejects.toThrow('bad request');
  expect(debug.data).toHaveBeenCalledWith('request', expect.objectContaining({ body, endpoint: 'https://example.com/api' }));
  expect(debug.data).toHaveBeenCalledWith('http', expect.objectContaining({ status }));
  expect(debug.chunk.mock.calls.filter(([kind]) => kind === 'http').map(([, value]) => value).join('')).toBe(raw);
});
