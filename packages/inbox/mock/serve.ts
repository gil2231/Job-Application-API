/**
 * Serve the mock Google/Microsoft provider for local development and the
 * browser tests: `pnpm --filter @autoapply/inbox mock` (port MOCK_PROVIDER_PORT, default 4120).
 * Then set GOOGLE_ENDPOINT_BASE and MICROSOFT_ENDPOINT_BASE to http://127.0.0.1:4120
 * and any non-empty client ids and secrets.
 */
import { createServer } from "node:http";
import { MockProvider } from "./provider";

const port = Number(process.env.MOCK_PROVIDER_PORT ?? 4120);
const base = `http://127.0.0.1:${port}`;
const mock = new MockProvider(base);

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(`${base}${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, body: req.method === "GET" || req.method === "HEAD" ? undefined : body });
  const response = await mock.handle(request);
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, "127.0.0.1", () => console.warn(`[mock-provider] Google and Microsoft mock on ${base}`));
