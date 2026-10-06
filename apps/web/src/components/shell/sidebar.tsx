"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Flag, LifeBuoy, LogOut, Menu, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { signOutAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ReportProblemDialog } from "@/components/support/report-problem-dialog";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav";

interface SidebarProps {
  user: { name: string; email: string; role: string };
  attentionCount: number;
}

function NavLinks({ attentionCount, isAdmin, onNavigate }: { attentionCount: number; isAdmin: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="grid gap-0.5 px-2">
      {NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin).map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const badge = item.badgeKey === "attention" && attentionCount > 0 ? attentionCount : null;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "text-sidebar-foreground hover:bg-sidebar-accent flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors",
              active && "bg-sidebar-accent text-foreground",
            )}
          >
            <item.icon className={cn("size-4", active ? "text-primary" : "text-muted-foreground")} />
            <span className="flex-1">{item.label}</span>
            {badge != null && (
              <span className="bg-warning/20 rounded-full px-1.5 text-[11px] font-semibold tabular-nums text-[color-mix(in_oklch,var(--warning),black_30%)] dark:text-warning">
                {badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

const supportLinkClass = "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors";

function SupportLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="grid gap-0.5 pb-1">
      <Link href="/help" onClick={onNavigate} className={supportLinkClass}>
        <LifeBuoy className="size-4" />
        Help center
      </Link>
      <ReportProblemDialog>
        <button type="button" className={supportLinkClass}>
          <Flag className="size-4" />
          Report a problem
        </button>
      </ReportProblemDialog>
    </div>
  );
}

function Brand() {
  return (
    <Link href="/dashboard" className="flex h-14 items-center gap-2 px-4">
      <div className="bg-primary text-primary-foreground grid size-7 place-items-center rounded-md text-xs font-bold">A</div>
      <span className="font-semibold tracking-tight">AutoApply</span>
    </Link>
  );
}

function UserMenu({ user }: { user: SidebarProps["user"] }) {
  const { resolvedTheme, setTheme } = useTheme();
  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="hover:bg-sidebar-accent flex w-full items-center gap-2.5 rounded-md p-2 text-left">
          <div className="bg-primary/15 text-primary grid size-8 place-items-center rounded-full text-xs font-semibold">{initials}</div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">{user.name}</p>
            <p className="text-muted-foreground truncate text-xs">{user.email}</p>
          </div>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
          {resolvedTheme === "dark" ? <Sun /> : <Moon />}
          {resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOutAction()}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Sidebar({ user, attentionCount }: SidebarProps) {
  return (
    <aside className="bg-sidebar border-sidebar-border sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r md:flex">
      <Brand />
      <div className="flex-1 overflow-y-auto py-2">
        <NavLinks attentionCount={attentionCount} isAdmin={user.role === "ADMIN"} />
      </div>
      <div className="border-sidebar-border border-t p-2">
        <SupportLinks />
        <UserMenu user={user} />
      </div>
    </aside>
  );
}

export function MobileNav({ user, attentionCount }: SidebarProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-background/80 sticky top-0 z-40 flex h-14 items-center gap-2 border-b px-3 backdrop-blur md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Open navigation">
            <Menu />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="bg-sidebar w-64 gap-0 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Brand />
          <div className="flex-1 overflow-y-auto py-2">
            <NavLinks attentionCount={attentionCount} isAdmin={user.role === "ADMIN"} onNavigate={() => setOpen(false)} />
          </div>
          <div className="border-t p-2">
            <SupportLinks onNavigate={() => setOpen(false)} />
            <UserMenu user={user} />
          </div>
        </SheetContent>
      </Sheet>
      <span className="font-semibold tracking-tight">AutoApply</span>
    </div>
  );
}
