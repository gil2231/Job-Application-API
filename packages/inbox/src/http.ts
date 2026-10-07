/** Errors and a small JSON fetch helper shared by the providers. */

/** The provider refused the saved sign-in; the user has to connect again. */
export class ProviderAuthError extends Error {
  constructor(message = "The sign-in for this account has expired or was revoked. Connect it again.") {
    super(message);
    this.name = "ProviderAuthError";
  }
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch with one retry on rate limits and server errors. Returns the response
 * for 2xx and 404/410 (callers decide what "gone" means); throws otherwise.
 */
export async function request(fetchImpl: FetchLike, url: string, init: RequestInit = {}, label = "request"): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(url, { ...init, signal: init.signal ?? AbortSignal.timeout(20_000) });
    } catch (error) {
      if (attempt === 0) {
        await wait(500);
        continue;
      }
      throw new ProviderError(`${label} failed: ${(error as Error).message}`, 0);
    }
    if (res.ok || res.status === 404 || res.status === 410) return res;
    if (res.status === 401) throw new ProviderAuthError();
    if ((res.status === 429 || res.status >= 500) && attempt === 0) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await wait(Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000, 5000));
      continue;
    }
    const body = await res.text().catch(() => "");
    throw new ProviderError(`${label} failed (${res.status})${body ? `: ${body.slice(0, 200)}` : ""}`, res.status);
  }
}

export async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Run `fn` over items with a small concurrency limit, keeping order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}
