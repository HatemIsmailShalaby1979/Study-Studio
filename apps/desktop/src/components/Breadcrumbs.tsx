"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

interface Props {
  title?: string;
}

export default function Breadcrumbs({ title }: Props) {
  const router = useRouter();

  return (
    <nav className="flex items-center gap-2 text-xs text-muted mb-6 flex-wrap animate-fade-in" aria-label="Breadcrumb">
      <button
        onClick={() => router.back()}
        className="btn btn-ghost text-xs !py-1 !px-2.5 !mr-1"
        aria-label="Go back"
      >
        ← Back
      </button>
      <Link href="/" className="hover:text-primary transition-colors">
        Home
      </Link>
      <span className="opacity-50">›</span>
      <Link href="/library" className="hover:text-primary transition-colors">
        Learning Journey
      </Link>
      {title && (
        <>
          <span className="opacity-50">›</span>
          <span className="text-foreground font-medium truncate max-w-[280px]">{title}</span>
        </>
      )}
    </nav>
  );
}
