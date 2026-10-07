import type Redis from "ioredis";
import type { CDPSession, Page } from "playwright-core";
import {
  LIVE_SOLVE_FRAME_TTL_SECONDS,
  liveSolveChannel,
  liveSolveFrameKey,
  type LiveSolveEnd,
  type LiveSolveEvent,
  type LiveSolveFrame,
  type LiveSolveInput,
  type LiveSolveInputMessage,
} from "@autoapply/shared";

/** At most this many frames a second go to the app per window. */
const MAX_FPS = 8;
const JPEG_QUALITY = 60;

export interface LiveWindowInfo {
  applicationId: string;
  userId: string;
  company: string;
  title: string;
  expiresAt: Date;
}

/**
 * Live windows for CAPTCHAs: streams a paused application's real page to the
 * CAPTCHA screen in the app and plays the person's clicks and keys back into
 * that page. The person does the solving; this only carries pixels one way
 * and their input the other, for pages this worker already has open.
 */
export class LiveSolveHub {
  private readonly windows = new Map<string, LiveWindow>();

  constructor(private readonly redis: Redis) {}

  get openCount() {
    return this.windows.size;
  }

  async open(page: Page, info: LiveWindowInfo): Promise<LiveWindow> {
    await this.windows.get(info.applicationId)?.close("stopped");
    const window = new LiveWindow(this.redis, page, info, () => {
      if (this.windows.get(info.applicationId) === window) this.windows.delete(info.applicationId);
    });
    this.windows.set(info.applicationId, window);
    await window.start();
    return window;
  }

  /** Input from the app. Only the application's own user can drive its window. */
  dispatch(message: LiveSolveInputMessage) {
    const window = this.windows.get(message.applicationId);
    if (!window || window.info.userId !== message.userId) return;
    window.input(message.input);
  }

  async closeAll() {
    await Promise.all([...this.windows.values()].map((w) => w.close("stopped")));
  }
}

export class LiveWindow {
  private cdp: CDPSession | null = null;
  private closed = false;
  private lastSent = 0;
  private pending: { data: string; width: number; height: number } | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  private inputs: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly redis: Redis,
    private readonly page: Page,
    readonly info: LiveWindowInfo,
    private readonly onClose: () => void,
  ) {}

  async start() {
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.cdp.on("Page.screencastFrame", (event: { data: string; sessionId: number; metadata: { deviceWidth: number; deviceHeight: number } }) => {
      void this.cdp?.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => undefined);
      this.frame(event.data, Math.round(event.metadata.deviceWidth), Math.round(event.metadata.deviceHeight));
    });
    const viewport = this.page.viewportSize() ?? { width: 1280, height: 900 };
    await this.cdp.send("Page.startScreencast", { format: "jpeg", quality: JPEG_QUALITY, maxWidth: viewport.width, maxHeight: viewport.height });
    // A page that doesn't change sends no new frames; keep the last one from expiring.
    this.keepAlive = setInterval(() => void this.redis.expire(liveSolveFrameKey(this.info.applicationId), LIVE_SOLVE_FRAME_TTL_SECONDS).catch(() => undefined), 10_000);
  }

  private frame(data: string, width: number, height: number) {
    if (this.closed) return;
    this.pending = { data, width, height };
    const wait = this.lastSent + 1000 / MAX_FPS - Date.now();
    if (wait <= 0) void this.flush();
    else this.flushTimer ??= setTimeout(() => void this.flush(), wait);
  }

  private async flush() {
    this.flushTimer = null;
    const next = this.pending;
    if (!next || this.closed) return;
    this.pending = null;
    this.lastSent = Date.now();
    const { applicationId, userId, company, title, expiresAt } = this.info;
    let host = "";
    try {
      host = new URL(this.page.url()).hostname;
    } catch {
      /* about:blank and the like */
    }
    const frame: LiveSolveFrame = { applicationId, userId, company, title, host, ...next, expiresAt: expiresAt.toISOString(), at: new Date().toISOString() };
    const event: LiveSolveEvent = { type: "frame", frame };
    try {
      await this.redis
        .multi()
        .set(liveSolveFrameKey(applicationId), JSON.stringify(frame), "EX", LIVE_SOLVE_FRAME_TTL_SECONDS)
        .publish(liveSolveChannel(userId), JSON.stringify(event))
        .exec();
    } catch {
      /* the stream is best effort; the application still waits in Needs Attention */
    }
  }

  /** Play one input event into the page, in the order they arrived. */
  input(input: LiveSolveInput) {
    if (this.closed) return;
    this.inputs = this.inputs.then(() => this.apply(input)).catch(() => undefined);
  }

  private async apply(input: LiveSolveInput) {
    if (this.closed || this.page.isClosed()) return;
    const { mouse, keyboard } = this.page;
    switch (input.type) {
      case "mouse":
        if (input.action === "move") return mouse.move(input.x, input.y);
        await mouse.move(input.x, input.y);
        return input.action === "down" ? mouse.down() : mouse.up();
      case "wheel":
        await mouse.move(input.x, input.y);
        return mouse.wheel(input.deltaX, input.deltaY);
      case "text":
        return keyboard.type(input.text);
      case "key":
        return keyboard.press(input.shift ? `Shift+${input.key}` : input.key);
    }
  }

  async close(outcome: LiveSolveEnd) {
    if (this.closed) return;
    this.closed = true;
    this.onClose();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.keepAlive) clearInterval(this.keepAlive);
    await this.cdp?.send("Page.stopScreencast").catch(() => undefined);
    await this.cdp?.detach().catch(() => undefined);
    const { applicationId, userId } = this.info;
    const event: LiveSolveEvent = { type: "ended", applicationId, outcome };
    await this.redis.multi().del(liveSolveFrameKey(applicationId)).publish(liveSolveChannel(userId), JSON.stringify(event)).exec().catch(() => undefined);
  }
}
