import type { Metadata } from "next";
import { Inter } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AIRuntimeProvider } from "@/components/AIRuntimeProvider";
import NavBar from "@/components/NavBar";
import { StorageWarning } from "@/components/StorageWarning";

/**
 * Inter, self-hosted at build time.
 *
 * This is what actually loads the typeface. `globals.css` previously declared
 * `font-family: 'Inter', ...` without anything ever fetching Inter — there was
 * no `@font-face`, no `next/font` import, and no font file in the repo — so the
 * app silently rendered in the system fallback. See DESIGN.md §11 (D3/D4) and
 * AUDIT.md P1-1.
 *
 * `next/font` downloads and self-hosts the woff2 files into
 * `_next/static/media` at build time, so the desktop app never fetches a font
 * over the network at runtime. That matters here: Study Studio is offline-first.
 *
 * Only the `latin` subset is loaded. The app also generates Arabic lessons and
 * podcast scripts, and Inter has no meaningful Arabic coverage — those glyphs
 * fall through to the system font, which is why the fallback chain in
 * `globals.css` is kept rather than replaced.
 *
 * `display: "swap"` means text renders immediately in the fallback and swaps
 * when Inter arrives, instead of staying invisible until the font loads.
 */
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

/**
 * Geist Mono, self-hosted from the file already in the repo.
 *
 * `src/app/fonts/GeistMonoVF.woff` shipped with the project and was never
 * imported — 68 KB of dead weight (DESIGN.md §11 D4). It has exactly one
 * consumer, the monospace input in Settings, so it is wired rather than
 * deleted. `localFont` inlines a stable path, so this stays offline-safe.
 */
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Study Studio",
  description: "Turn any topic into a structured lesson",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen">
        <ThemeProvider>
          <AIRuntimeProvider>
            <NavBar />
            <main>{children}</main>
            <StorageWarning />
          </AIRuntimeProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
