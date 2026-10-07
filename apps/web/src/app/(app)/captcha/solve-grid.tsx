"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, Info, Loader2, Maximize2, Minimize2, MousePointerClick, ShieldQuestion, WifiOff } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { LIVE_SOLVE_KEYS, type LiveSolveEvent, type LiveSolveFrame, type LiveSolveInput } from "@autoapply/shared";
import { completeHumanStepAction } from "@/actions/applications";
import { useServerAction } from "@/components/action-button";
import { EmptyState } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Waiting {
  id: string;
  company: string;
  title: string;
  updatedAt: string;
}

const SPECIAL_KEYS = new Set<string>(LIVE_SOLVE_KEYS);

export function SolveGrid({ initialFrames, waiting, maxWindows, workerState }: { initialFrames: LiveSolveFrame[]; waiting: Waiting[]; maxWindows: number; workerState: "live" | "no-live" | "offline" }) {
  const router = useRouter();
  const [frames, setFrames] = useState(() => new Map(initialFrames.map((f) => [f.applicationId, f])));
  const [connected, setConnected] = useState(false);
  const framesRef = useRef(frames);
  useEffect(() => {
    framesRef.current = frames;
  }, [frames]);

  useEffect(() => {
    const source = new EventSource("/api/live-solve/stream");
    const onFrame = (e: MessageEvent<string>) => {
      const event = JSON.parse(e.data) as Extract<LiveSolveEvent, { type: "frame" }>;
      setFrames((prev) => new Map(prev).set(event.frame.applicationId, event.frame));
    };
    const onEnded = (e: MessageEvent<string>) => {
      const event = JSON.parse(e.data) as Extract<LiveSolveEvent, { type: "ended" }>;
      const frame = framesRef.current.get(event.applicationId);
      if (frame && event.outcome === "solved") toast.success(`${frame.company}: CAPTCHA solved. The application is carrying on.`);
      if (frame && event.outcome === "timed_out") toast.info(`${frame.company}: the live window closed. Open it again when you're ready.`);
      setFrames((prev) => {
        const next = new Map(prev);
        next.delete(event.applicationId);
        return next;
      });
      router.refresh();
    };
    source.addEventListener("frame", onFrame as EventListener);
    source.addEventListener("ended", onEnded as EventListener);
    source.addEventListener("ready", () => setConnected(true));
    source.onerror = () => setConnected(false);
    return () => source.close();
  }, [router]);

  const live = useMemo(() => [...frames.values()], [frames]);
  const waitingOnly = waiting.filter((w) => !frames.has(w.id));

  return (
    <div className="grid gap-5">
      <section aria-label="CAPTCHA windows" className="dark bg-sidebar text-sidebar-foreground border-sidebar-border overflow-hidden rounded-2xl border p-4 sm:p-5" data-testid="solve-deck" data-connected={connected}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <dl className="grid flex-1 grid-cols-3 gap-2">
            {[
              { label: "Live now", value: live.length, tone: live.length ? "text-primary" : "text-white" },
              { label: "Waiting", value: waitingOnly.length, tone: waitingOnly.length ? "text-warning" : "text-white" },
              { label: "At once", value: maxWindows, tone: "text-white" },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
                <dt className="text-muted-foreground truncate text-[10px] font-semibold tracking-wider uppercase sm:text-[11px]">{stat.label}</dt>
                <dd className={cn("text-xl font-semibold tabular-nums sm:text-2xl", stat.tone)}>{stat.value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap items-center gap-2 text-xs sm:max-w-80 sm:justify-end">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1" data-testid={workerState === "live" ? undefined : "live-unavailable"}>
              {workerState === "live" ? (
                <span className={cn("size-1.5 rounded-full", connected ? "bg-success" : "bg-muted-foreground animate-pulse")} />
              ) : (
                <WifiOff className="size-3.5" />
              )}
              {workerState === "live" ? "Live windows on" : workerState === "offline" ? "Worker not running" : "Live windows turned off on the worker"}
            </span>
            <Link href="/rules" className="text-primary text-xs hover:underline">
              Change how many in Rules
            </Link>
          </div>
        </div>
        <p className="text-muted-foreground mt-4 flex items-start gap-2 text-xs">
          <MousePointerClick className="mt-0.5 size-3.5 shrink-0" />
          {workerState === "live"
            ? "Click a window to use it. Your typing goes to the window you clicked last. When the check is solved, the application carries on by itself."
            : workerState === "offline"
              ? "The automation worker isn't running, so no live windows can open right now. CAPTCHAs wait in Needs Attention."
              : "Live CAPTCHA windows are turned off on the automation worker (WORKER_LIVE_SOLVE=false). CAPTCHAs wait in Needs Attention instead."}
        </p>
      </section>

      {live.length === 0 && waitingOnly.length === 0 ? (
        <div className="rounded-xl border">
          <EmptyState
            icon={ShieldQuestion}
            title="No CAPTCHAs right now"
            description="When an application stops on a CAPTCHA, its page pops up here live so you can solve it without leaving Applyance."
          />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2" data-testid="solve-grid">
          {live.map((frame) => (
            <LivePanel key={frame.applicationId} frame={frame} />
          ))}
          {waitingOnly.map((item) => (
            <WaitingPanel key={item.id} item={item} canOpen={workerState === "live"} />
          ))}
        </div>
      )}

      <p className="text-muted-foreground flex items-start gap-2 text-xs">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        You solve every CAPTCHA yourself on the employer&apos;s real page. Applyance never solves them for you or uses a solving service.
      </p>
    </div>
  );
}

function useCountdown(until: string) {
  // Starts empty so the server render and the first client render agree.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  if (now == null) return "–:––";
  const left = Math.max(0, Math.round((new Date(until).getTime() - now) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

function LivePanel({ frame }: { frame: LiveSolveFrame }) {
  const [expanded, setExpanded] = useState(false);
  const [focused, setFocused] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const lastMove = useRef(0);
  const pressed = useRef(false);
  const size = useRef({ width: frame.width, height: frame.height });
  useEffect(() => {
    size.current = { width: frame.width, height: frame.height };
  }, [frame.width, frame.height]);
  const countdown = useCountdown(frame.expiresAt);
  const id = frame.applicationId;

  // Inputs go out one at a time so a press always lands before its release.
  const send = useCallback(
    (input: LiveSolveInput) => {
      queue.current = queue.current
        .then(() => fetch(`/api/live-solve/${id}/input`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }))
        .catch(() => undefined);
    },
    [id],
  );

  const point = (clientX: number, clientY: number) => {
    const rect = imgRef.current!.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * size.current.width;
    const y = ((clientY - rect.top) / rect.height) * size.current.height;
    return { x: Math.min(Math.max(0, x), size.current.width - 1), y: Math.min(Math.max(0, y), size.current.height - 1) };
  };

  // Wheel needs a non-passive listener to keep the Applyance page from scrolling instead.
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    let dx = 0;
    let dy = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let at = { x: 0, y: 0 };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      dx += e.deltaX;
      dy += e.deltaY;
      const rect = img.getBoundingClientRect();
      at = { x: ((e.clientX - rect.left) / rect.width) * size.current.width, y: ((e.clientY - rect.top) / rect.height) * size.current.height };
      timer ??= setTimeout(() => {
        send({ type: "wheel", ...at, deltaX: Math.max(-2000, Math.min(2000, dx)), deltaY: Math.max(-2000, Math.min(2000, dy)) });
        dx = dy = 0;
        timer = null;
      }, 60);
    };
    img.addEventListener("wheel", onWheel, { passive: false });
    return () => img.removeEventListener("wheel", onWheel);
  }, [send]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return; // leave shortcuts (and paste) to the browser
    if (e.key.length === 1) {
      e.preventDefault();
      send({ type: "text", text: e.key });
    } else if (SPECIAL_KEYS.has(e.key)) {
      e.preventDefault();
      send({ type: "key", key: e.key as (typeof LIVE_SOLVE_KEYS)[number], shift: e.shiftKey });
    }
  };

  return (
    <Card className={cn("dark bg-sidebar text-sidebar-foreground border-sidebar-border gap-3 py-4", expanded && "lg:col-span-2")} data-testid="live-panel" data-application-id={id}>
      <CardHeader className="flex flex-row flex-wrap items-center gap-2 px-4">
        <span className="relative flex size-2">
          <span className="bg-success absolute inline-flex size-full animate-ping rounded-full opacity-60" />
          <span className="bg-success relative inline-flex size-2 rounded-full" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{frame.company}</p>
          <p className="text-muted-foreground truncate text-xs">{frame.title}</p>
        </div>
        {frame.host && (
          <Badge variant="outline" className="max-w-40 truncate font-mono text-[11px]">
            {frame.host}
          </Badge>
        )}
        <Badge variant="secondary" className="tabular-nums" title="The window closes when this runs out">
          {countdown}
        </Badge>
        <Button variant="ghost" size="icon-sm" onClick={() => setExpanded((v) => !v)} aria-label={expanded ? "Make smaller" : "Make bigger"}>
          {expanded ? <Minimize2 /> : <Maximize2 />}
        </Button>
      </CardHeader>
      <CardContent className="px-4">
        <div
          ref={panelRef}
          tabIndex={0}
          role="application"
          aria-label={`Live CAPTCHA window for ${frame.company}`}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text").slice(0, 500);
            if (text) {
              e.preventDefault();
              send({ type: "text", text });
            }
          }}
          className={cn("bg-muted relative overflow-hidden rounded-md border outline-none", focused ? "ring-primary ring-2" : "hover:ring-ring/50 hover:ring-1")}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a live JPEG stream, not a static asset */}
          <img
            ref={imgRef}
            src={`data:image/jpeg;base64,${frame.data}`}
            alt={`Live view of the ${frame.company} application`}
            width={frame.width}
            height={frame.height}
            draggable={false}
            className="block h-auto w-full cursor-pointer touch-none select-none"
            onPointerDown={(e) => {
              e.preventDefault();
              // Measure before focusing, and focus without scrolling, so the press lands where it was clicked.
              const at = point(e.clientX, e.clientY);
              panelRef.current?.focus({ preventScroll: true });
              e.currentTarget.setPointerCapture(e.pointerId);
              pressed.current = true;
              send({ type: "mouse", action: "down", ...at });
            }}
            onPointerMove={(e) => {
              const now = Date.now();
              // Drags (slider puzzles) need a smooth path; plain hovering much less.
              if (now - lastMove.current < (pressed.current ? 30 : 120)) return;
              lastMove.current = now;
              send({ type: "mouse", action: "move", ...point(e.clientX, e.clientY) });
            }}
            onPointerUp={(e) => {
              if (!pressed.current) return;
              pressed.current = false;
              send({ type: "mouse", action: "up", ...point(e.clientX, e.clientY) });
            }}
            onContextMenu={(e) => e.preventDefault()}
          />
        </div>
        <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span>Solve the check on the page. You don&apos;t need to press anything here afterwards.</span>
          <Link href={`/applications/${id}`} className="hover:text-foreground ml-auto inline-flex items-center gap-1 underline-offset-2 hover:underline">
            Application <ExternalLink className="size-3" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function WaitingPanel({ item, canOpen }: { item: Waiting; canOpen: boolean }) {
  const { pending, run } = useServerAction();
  return (
    <Card className="dark bg-sidebar text-sidebar-foreground border-sidebar-border gap-3 py-4" data-testid="waiting-panel">
      <CardHeader className="flex flex-row items-center gap-2 px-4">
        <ShieldQuestion className="text-warning size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{item.company}</p>
          <p className="text-muted-foreground truncate text-xs">{item.title}</p>
        </div>
        <span className="text-muted-foreground text-xs" suppressHydrationWarning>{formatRelative(item.updatedAt)}</span>
      </CardHeader>
      <CardContent className="grid gap-3 px-4">
        <div className="bg-muted/50 text-muted-foreground grid aspect-[1280/900] place-items-center rounded-md border border-dashed p-6 text-center text-sm">
          {pending ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" /> Opening the page…
            </span>
          ) : (
            "This CAPTCHA is waiting without a live window."
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={pending || !canOpen} onClick={() => run(() => completeHumanStepAction(item.id).then((r) => (r.ok ? { ok: true, message: "Opening a live window. It pops up here in a moment." } : r)))}>
            <CheckCircle2 /> Open a live window
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href={`/applications/${item.id}`}>
              <ExternalLink /> Application
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
