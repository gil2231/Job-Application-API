import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPublicAddress } from "@autoapply/ingestion";
import type { WorkerConfig } from "./config";

export type SiteDecision = { allowed: true } | { allowed: false; reason: string };

/**
 * Which sites the worker may open. By default only the hosts in
 * AUTOMATION_ALLOWED_HOSTS (the local mock pages), so nothing runs against a
 * real employer until the operator turns that on. With AUTOMATION_ALLOW_ALL_HOSTS,
 * public sites are allowed but private and internal addresses still aren't,
 * unless explicitly listed.
 */
export async function checkSite(input: string, config: Pick<WorkerConfig, "allowedHosts" | "allowAllHosts">): Promise<SiteDecision> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { allowed: false, reason: "The application link isn't a valid URL." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { allowed: false, reason: "Only http and https application links can be opened." };
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (config.allowedHosts.includes(host)) return { allowed: true };
  if (!config.allowAllHosts) {
    return { allowed: false, reason: `Automation on real employer sites is turned off for this worker (only ${config.allowedHosts.join(", ")} are allowed). Set AUTOMATION_ALLOW_ALL_HOSTS=true to enable it.` };
  }
  try {
    const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
    if (!addresses.length || !addresses.every(isPublicAddress)) return { allowed: false, reason: `${host} points at a private or internal address, which AutoApply won't open.` };
  } catch {
    return { allowed: false, reason: `Couldn't look up ${host}.` };
  }
  return { allowed: true };
}
