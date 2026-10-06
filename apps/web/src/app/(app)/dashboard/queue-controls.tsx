"use client";

import { Pause, Play, Square, TimerReset } from "lucide-react";
import { queueControlAction } from "@/actions/queue";
import { ActionButton } from "@/components/action-button";

export function QueueControls({ paused, pauseAfterCurrent, processing }: { paused: boolean; pauseAfterCurrent: boolean; processing: number }) {
  return (
    <div className="flex flex-wrap gap-2">
      {paused ? (
        <ActionButton size="sm" action={() => queueControlAction("resume")}>
          <Play /> Resume
        </ActionButton>
      ) : (
        <>
          <ActionButton size="sm" variant="outline" action={() => queueControlAction("pause")}>
            <Pause /> Pause
          </ActionButton>
          {!pauseAfterCurrent && processing > 0 && (
            <ActionButton size="sm" variant="outline" action={() => queueControlAction("pause_after_current")}>
              <TimerReset /> Pause after current
            </ActionButton>
          )}
        </>
      )}
      {processing > 0 && (
        <ActionButton size="sm" variant="outline" className="text-destructive" action={() => queueControlAction("stop")}>
          <Square /> Stop now
        </ActionButton>
      )}
    </div>
  );
}
