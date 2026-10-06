"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TABS = ["personal", "professional", "education", "employment", "documents"] as const;
type Tab = (typeof TABS)[number];

export function ProfileTabs(props: {
  initialTab?: string;
  counts: { education: number; employment: number; documents: number };
} & Record<Tab, React.ReactNode>) {
  const router = useRouter();
  const params = useSearchParams();
  const current = (TABS as readonly string[]).includes(params.get("tab") ?? props.initialTab ?? "") ? (params.get("tab") ?? props.initialTab)! : "personal";
  const label = (t: Tab) => {
    const base = t.charAt(0).toUpperCase() + t.slice(1);
    const count = t in props.counts ? props.counts[t as keyof typeof props.counts] : undefined;
    return count ? `${base} (${count})` : base;
  };
  return (
    <Tabs value={current} onValueChange={(v) => router.replace(`/profile?tab=${v}`, { scroll: false })}>
      <TabsList>
        {TABS.map((t) => (
          <TabsTrigger key={t} value={t}>
            {label(t)}
          </TabsTrigger>
        ))}
      </TabsList>
      {TABS.map((t) => (
        <TabsContent key={t} value={t} forceMount hidden={current !== t}>
          <Card>
            <CardContent>{props[t]}</CardContent>
          </Card>
        </TabsContent>
      ))}
    </Tabs>
  );
}
