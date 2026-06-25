"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import {
  LayoutDashboard,
  ImagePlus,
  Video,
  FolderOpen,
  Users,
  Settings,
  Activity,
  History,
  BookOpen,
  Zap,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/generate/image", label: "Image Gen", icon: ImagePlus },
  { href: "/generate/video", label: "Video Gen", icon: Video },
  { href: "/history", label: "History", icon: History },
  { href: "/projects", label: "Projects", icon: FolderOpen },
  { href: "/accounts", label: "Accounts", icon: Users },
  { href: "/requests", label: "Requests", icon: Activity },
  { href: "/docs", label: "API Docs", icon: BookOpen },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={clsx(
        "h-screen fixed left-0 top-0 z-40 flex flex-col border-r border-border transition-all duration-300",
        "bg-bg-secondary/80 backdrop-blur-xl",
        collapsed ? "w-[68px]" : "w-[240px]"
      )}
    >
      <div className="flex items-center gap-3 px-4 h-16 border-b border-border">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-violet to-accent-pink flex items-center justify-center flex-shrink-0">
          <Zap className="w-4 h-4 text-white" />
        </div>
        {!collapsed && (
          <span className="text-lg font-bold gradient-text">Flow Kit</span>
        )}
      </div>

      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                active
                  ? "bg-gradient-to-r from-accent-violet/20 to-accent-pink/10 text-white glow-violet"
                  : "text-text-secondary hover:text-text-primary hover:bg-bg-card/50"
              )}
            >
              <item.icon
                className={clsx(
                  "w-5 h-5 flex-shrink-0",
                  active ? "text-accent-violet" : ""
                )}
              />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-center h-12 border-t border-border text-text-muted hover:text-text-primary transition-colors"
      >
        {collapsed ? (
          <ChevronRight className="w-4 h-4" />
        ) : (
          <ChevronLeft className="w-4 h-4" />
        )}
      </button>
    </aside>
  );
}
