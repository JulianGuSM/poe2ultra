export interface FetchProgress {
  attempt: number;
  attempts: number;
}

export type HtmlFetcher = (url: string, onProgress?: (progress: FetchProgress) => void) => Promise<string>;

export interface HtmlFetcherOptions {
  attempts?: number;
  sleep?: (ms: number) => Promise<void>;
  delayMs?: (waited: number) => number;
  /** How long one attempt may take; a request that never answers must not hold up the guide. */
  attemptMs?: number;
  /** The clock the attempt is timed by; separate from `sleep`, which only paces the retries. */
  timer?: (ms: number) => Promise<void>;
  /** Called after every completed or failed network attempt. */
  onAttempt?: (attempt: FetchAttemptLog, request: { sessionId: string; url: string }) => void | Promise<void>;
}

export interface FetchAttemptLog {
  at: string;
  attempt: number;
  credentials: RequestCredentials;
  elapsedMs: number;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  responseBytes?: number;
  error?: { name: string; message: string };
  responseExcerpt?: string;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Fetches a build page's HTML without cookies. Signed in, the site renders build pages in the browser and its HTML
 * carries no build data; the signed-out page has it all in `__PRELOADED_STATE__`.
 *
 * The site sits behind bot protection that turns away a visitor it has not seen before, so a first visit can be
 * refused a few times before it goes through: the fetch waits and asks again, and spends its last attempt on the
 * visitor's own session, which the page itself was loaded with.
 */
export function createHtmlFetcher(fetchImpl: typeof fetch = (input, init) => fetch(input, init), options: HtmlFetcherOptions = {}): HtmlFetcher {
  const { attempts = 8, sleep = wait, delayMs = (waited) => 700 * 2 ** waited, attemptMs = 15_000, timer = wait, onAttempt } = options;

  return async (url, onProgress) => {
    let failure: unknown = new Error('No attempt was made');
    const request = { sessionId: `${Date.now()}-${crypto.randomUUID()}`, url };
    const recordAttempt = async (record: FetchAttemptLog) => {
      try { await onAttempt?.(record, request); } catch { /* Logging must never break guide loading. */ }
    };

    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1) {
        onProgress?.({ attempt, attempts });
        await sleep(delayMs(attempt - 2));
      }
      const credentials = attempt === attempts && attempts > 1 ? 'include' : 'omit';
      const started = Date.now();
      try {
        const response = await Promise.race([
          fetchImpl(url, { credentials }),
          timer(attemptMs).then(() => Promise.reject(new Error('The site took too long to answer'))),
        ]);
        const body = await response.text();
        const log: FetchAttemptLog = {
          at: new Date().toISOString(), attempt, credentials, elapsedMs: Date.now() - started,
          status: response.status, statusText: response.statusText,
          headers: Object.fromEntries(['server', 'cf-ray', 'cf-cache-status', 'content-type', 'retry-after', 'date', 'x-request-id']
            .map((name) => [name, response.headers.get(name)] as const).filter((entry): entry is [string, string] => Boolean(entry[1]))),
          responseBytes: new TextEncoder().encode(body).length,
          ...(!response.ok ? { responseExcerpt: sanitizeResponseExcerpt(body) } : {}),
        };
        await recordAttempt(log);
        if (response.ok) return body;
        failure = new Error(`HTTP ${response.status}`);
      } catch (error) {
        failure = error;
        await recordAttempt({ at: new Date().toISOString(), attempt, credentials, elapsedMs: Date.now() - started,
          error: { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error) } });
      }
    }

    throw failure;
  };
}

function sanitizeResponseExcerpt(body: string): string {
  return body
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/gi, ' ')
    .replace(/\b(authorization|cookie|set-cookie|token|secret|api[_-]?key)\b\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[URL]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
}
