import { chromium, type Browser, type BrowserContext, type BrowserContextOptions } from "playwright-core";
import type { WorkerConfig } from "./config";

/**
 * One Chromium per worker process, a fresh isolated context per application.
 * Saved sessions (cookies + local storage) are loaded into the context so a
 * sign-in the user completed once carries over.
 */
export class BrowserPool {
  private browser: Promise<Browser> | null = null;

  constructor(private readonly config: Pick<WorkerConfig, "headless" | "chromiumExecutable" | "navigationTimeoutMs">) {}

  get interactive() {
    return !this.config.headless;
  }

  private launch(): Promise<Browser> {
    this.browser ??= chromium
      .launch({ headless: this.config.headless, executablePath: this.config.chromiumExecutable })
      .then((b) => {
        b.on("disconnected", () => {
          this.browser = null;
        });
        return b;
      })
      .catch((error) => {
        this.browser = null;
        throw error;
      });
    return this.browser;
  }

  async newContext(storageState?: unknown): Promise<BrowserContext> {
    const browser = await this.launch();
    const context = await browser.newContext({
      storageState: storageState ? (storageState as BrowserContextOptions["storageState"]) : undefined,
      viewport: { width: 1280, height: 900 },
      acceptDownloads: false,
    });
    context.setDefaultTimeout(15_000);
    context.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);
    return context;
  }

  async close() {
    const b = await this.browser?.catch(() => null);
    this.browser = null;
    await b?.close().catch(() => undefined);
  }
}
