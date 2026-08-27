import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AIRuntimeProvider } from "@/components/AIRuntimeProvider";
import NavBar from "@/components/NavBar";

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
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen">
        <ThemeProvider>
          <AIRuntimeProvider>
            <NavBar />
            <main>{children}</main>
          </AIRuntimeProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
