"use client";

import Link from "next/link";
import { useTheme } from "@/components/ThemeProvider";
import { useAIRuntime } from "@/components/AIRuntimeProvider";
import { usePathname } from "next/navigation";

const NAV_LINKS = [
  { href: "/", label: "Home", emoji: "🏠" },
  { href: "/library", label: "Learning Journey", emoji: "📖" },
  { href: "/journey", label: "Journeys", emoji: "🗺️" },
  { href: "/generate", label: "Generate New", emoji: "✨" },
  { href: "/settings", label: "Settings", emoji: "⚙️" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function NavBar() {
  const { theme, toggle } = useTheme();
  const { initializing, available, message } = useAIRuntime();
  const pathname = usePathname();
  const isLessonPage = pathname.startsWith("/lesson");

  // AI runtime status pill shown next to the theme toggle.
  const runtimeStatus = initializing ? (
    <span className="flex items-center gap-1.5 text-xs text-muted">
      <span className="skeleton h-2 w-2 rounded-full" />
      Connecting…
    </span>
  ) : available ? (
    <span className="flex items-center gap-1.5 text-xs text-green-500" title="AI runtime connected">
      <span className="h-2 w-2 rounded-full bg-green-400" />
      Ready
    </span>
  ) : message ? (
    <span className="flex items-center gap-1.5 text-xs text-amber-500" title="AI runtime has no models">
      <span className="h-2 w-2 rounded-full bg-amber-400" />
      No models
    </span>
  ) : (
    <span className="flex items-center gap-1.5 text-xs text-red-400" title="AI runtime not running">
      <span className="h-2 w-2 rounded-full bg-red-400" />
      Offline
    </span>
  );

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 h-16">
      <div
        className={`absolute inset-0 border-b transition-colors ${
          isLessonPage ? "bg-sidebar border-card-border" : "card-glass border-transparent"
        }`}
      />
      <div className="relative max-w-6xl mx-auto px-4 h-full flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2.5 group shrink-0">
          <span className="text-xl">📚</span>
          <span className="hidden sm:inline text-lg font-bold tracking-tight bg-gradient-to-r from-foreground to-muted bg-clip-text text-transparent group-hover:from-primary group-hover:to-accent-blue transition-all duration-300">
            Study Studio
          </span>
        </Link>
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className={`btn text-sm !py-1.5 !px-3.5 whitespace-nowrap ${
                isActive(pathname, link.href) ? "btn-primary shadow-sm" : "btn-secondary"
              }`}
            >
              <span>{link.emoji}</span> {link.label}
            </Link>
          ))}
          <Link
            href="/settings"
            className="hidden sm:flex items-center gap-1.5 text-xs ml-2 hover:opacity-80 transition-opacity"
            title="Open Model Settings"
          >
            {runtimeStatus}
          </Link>
          <button
            onClick={toggle}
            className="btn btn-secondary text-sm !py-1.5 !px-3 ml-1"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>
      </div>
    </nav>
  );
}
