import type { Platform } from "@autoapply/shared";
import type { ApplicationAdapter } from "./adapter";
import { detectPlatformFromHtml, detectPlatformFromUrl, type PlatformDetection } from "./detect";

/**
 * Holds the installed adapters. Adding an ATS means registering one adapter;
 * nothing in the dashboard or worker changes.
 */
export class AdapterRegistry<TPage = unknown> {
  private readonly adapters = new Map<Platform, ApplicationAdapter<TPage>>();

  register(adapter: ApplicationAdapter<TPage>): this {
    if (this.adapters.has(adapter.platform)) throw new Error(`Adapter for ${adapter.platform} is already registered`);
    this.adapters.set(adapter.platform, adapter);
    return this;
  }

  get(platform: Platform): ApplicationAdapter<TPage> | undefined {
    return this.adapters.get(platform);
  }

  has(platform: Platform): boolean {
    return this.adapters.has(platform);
  }

  list(): ApplicationAdapter<TPage>[] {
    return [...this.adapters.values()];
  }

  /**
   * Pick the adapter for a page: the platform detector first, then each
   * adapter's own detect(); falls back to the GENERIC adapter if registered.
   */
  async resolve(url: string, html?: string): Promise<{ adapter: ApplicationAdapter<TPage> | undefined; detection: PlatformDetection }> {
    const detection = html ? detectPlatformFromHtml(url, html) : detectPlatformFromUrl(url);
    const direct = detection.platform === "GENERIC" ? undefined : this.adapters.get(detection.platform);
    if (direct) return { adapter: direct, detection };

    let best: { adapter: ApplicationAdapter<TPage>; score: number } | undefined;
    for (const adapter of this.adapters.values()) {
      if (adapter.platform === "GENERIC") continue;
      const score = await adapter.detect(url, html);
      if (score >= 70 && (!best || score > best.score)) best = { adapter, score };
    }
    if (best) return { adapter: best.adapter, detection: { platform: best.adapter.platform, confidence: best.score, evidence: `${best.adapter.displayName} adapter detection` } };
    return { adapter: this.adapters.get("GENERIC"), detection };
  }
}
