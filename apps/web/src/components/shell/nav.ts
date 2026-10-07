import {
  AlertCircle,
  BellRing,
  BookOpenText,
  Briefcase,
  FileText,
  LayoutDashboard,
  PlaneTakeoff,
  Plug,
  Send,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  /** Label in the phone tab bar, where space is tight. */
  shortLabel?: string;
  icon: LucideIcon;
  badgeKey?: "attention";
  /** Only shown to admins (the pages themselves also check). */
  adminOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/flightpath", label: "Flightpath", icon: PlaneTakeoff },
  { href: "/recommended", label: "Recommended", icon: Sparkles },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/job-alerts", label: "Job alerts", icon: BellRing },
  { href: "/applications", label: "Applications", icon: Send },
  { href: "/needs-attention", label: "Needs Attention", shortLabel: "Needs you", icon: AlertCircle, badgeKey: "attention" },
  { href: "/profile", label: "Master Profile", icon: UserRound },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/answers", label: "Answer Library", icon: BookOpenText },
  { href: "/rules", label: "Rules", icon: SlidersHorizontal },
  { href: "/integrations", label: "Integrations", icon: Plug },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/admin", label: "Admin", icon: ShieldCheck, adminOnly: true },
];

/** The pages in the phone tab bar; everything else is under More. */
export const MOBILE_TABS = ["/dashboard", "/needs-attention", "/flightpath", "/jobs"];
