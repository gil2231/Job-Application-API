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
  SlidersHorizontal,
  Sparkles,
  UserRound,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badgeKey?: "attention";
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/flightpath", label: "Flightpath", icon: PlaneTakeoff },
  { href: "/recommended", label: "Recommended", icon: Sparkles },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/job-alerts", label: "Job alerts", icon: BellRing },
  { href: "/applications", label: "Applications", icon: Send },
  { href: "/needs-attention", label: "Needs Attention", icon: AlertCircle, badgeKey: "attention" },
  { href: "/profile", label: "Master Profile", icon: UserRound },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/answers", label: "Answer Library", icon: BookOpenText },
  { href: "/rules", label: "Rules", icon: SlidersHorizontal },
  { href: "/integrations", label: "Integrations", icon: Plug },
  { href: "/settings", label: "Settings", icon: Settings },
];
