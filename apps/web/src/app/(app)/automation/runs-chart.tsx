"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const SERIES = [
  { key: "completed", label: "Completed", color: "var(--color-chart-2)" },
  { key: "needed_you", label: "Needed you", color: "var(--color-chart-4)" },
  { key: "failed", label: "Failed", color: "var(--color-destructive)" },
] as const;

/** Runs per day, stacked by how they ended. */
export function RunsChart({ data }: { data: Array<{ day: string; completed: number; needed_you: number; failed: number }> }) {
  const rows = data.map((d) => ({
    ...d,
    label: new Date(`${d.day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
  }));
  return (
    <div className="h-56 w-full" data-testid="runs-chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--color-border)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={12} tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
          <Tooltip
            cursor={{ fill: "var(--color-muted)" }}
            contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
          />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
          {SERIES.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} stackId="runs" fill={s.color} radius={i === SERIES.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={28} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
