import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

/**
 * Fetching URLs that users paste is a server-side request forgery risk, so
 * every request goes through here:
 * - only http(s) on the default ports,
 * - every address the hostname resolves to must be public (checked at connect
 *   time, so DNS rebinding can't swap in a private address after the check),
 * - redirects are followed manually (at most 3) and re-checked,
 * - responses are capped in size and time.
 */

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
}

const BLOCKED_V4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const n = ipv4ToInt(address);
    return !BLOCKED_V4.some(([base, bits]) => (n >>> (32 - bits)) === (ipv4ToInt(base) >>> (32 - bits)));
  }
  if (family === 6) {
    const a = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
    if (mapped) return isPublicAddress(mapped[1]!);
    if (a === "::" || a === "::1") return false;
    // Unique local fc00::/7, link-local fe80::/10, multicast ff00::/8, documentation 2001:db8::/32, NAT64 64:ff9b::/96.
    if (/^f[cd]/.test(a) || /^fe[89ab]/.test(a) || a.startsWith("ff") || a.startsWith("2001:db8") || a.startsWith("64:ff9b")) return false;
    return true;
  }
  return false;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** DNS lookup that refuses non-public addresses. Used by the HTTP agent on every connection. */
export function safeLookup(hostname: string, options: { all?: boolean } & Record<string, unknown>, callback: LookupCallback): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const list = addresses as LookupAddress[];
    const blocked = list.find((a) => !isPublicAddress(a.address));
    if (!list.length || blocked) {
      const error = new UnsafeUrlError(`${hostname} resolves to a private address`) as NodeJS.ErrnoException;
      error.code = "EUNSAFEADDRESS";
      return callback(error, []);
    }
    if (options.all) callback(null, list);
    else callback(null, list[0]!.address, list[0]!.family);
  });
}

const agent = new Agent({ connect: { lookup: safeLookup as never, timeout: 5_000 }, headersTimeout: 10_000, bodyTimeout: 10_000 });

export function assertFetchableUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UnsafeUrlError("Not a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new UnsafeUrlError("Only http and https URLs can be fetched");
  if (url.port && url.port !== "80" && url.port !== "443") throw new UnsafeUrlError("Only standard ports can be fetched");
  if (url.username || url.password) throw new UnsafeUrlError("URLs with credentials can't be fetched");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !isPublicAddress(host)) throw new UnsafeUrlError("Private addresses can't be fetched");
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) throw new UnsafeUrlError("Private hostnames can't be fetched");
  return url;
}

export interface FetchedResponse {
  url: string;
  status: number;
  contentType: string;
  text: string;
}

export type HttpFetcher = (url: string, init: { accept: string }) => Promise<FetchedResponse>;

const MAX_BYTES = 3 * 1024 * 1024;
const USER_AGENT = "AutoApply/1.0 (job posting import; +https://github.com/gil2231/Job-Application-API)";

/** GET a public URL safely. Throws on non-2xx responses. */
export const safeFetch: HttpFetcher = async (input, init) => {
  let url = assertFetchableUrl(input);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await undiciFetch(url, {
      dispatcher: agent,
      redirect: "manual",
      headers: { accept: init.accept, "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error(`Redirect without a location (${response.status})`);
      url = assertFetchableUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(response.status === 404 ? "The posting was not found (it may have closed)" : `The site returned ${response.status}`);
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) {
          await reader.cancel();
          throw new Error("The page is too large to import");
        }
        chunks.push(value);
      }
    }
    return {
      url: url.toString(),
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      text: new TextDecoder("utf-8").decode(Buffer.concat(chunks)),
    };
  }
  throw new Error("Too many redirects");
};
