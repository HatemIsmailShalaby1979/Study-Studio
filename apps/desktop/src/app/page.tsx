"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Lesson } from "@/types";
import { getProgressMap, computeStats, type JourneyStats } from "@/lib/progress";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDay(key: string): string {
  const parts = key.split("-").map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function Home() {
  const [library, setLibrary] = useState<Lesson[]>([]);
  const [stats, setStats] = useState<JourneyStats | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem("study-studio-library");
    const lessons: Lesson[] = stored
      ? (() => { try { return JSON.parse(stored); } catch { return []; } })()
      : [];
    setLibrary(lessons);
    setStats(computeStats(lessons));
  }, []);

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-16">
        <div className="animate-spin h-8 w-8 border-[3px] border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const recent = library.slice(0, 3);
  const continueLesson = library.find((l) => {
    const p = getProgressMap()[l.id];
    return p?.status === "in_progress";
  }) ?? library[0];

  return (
    <div className="min-h-screen flex flex-col items-center px-4 pt-20 pb-16">
      <div className="w-full max-w-4xl text-center mb-8 animate-fade-in">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary-soft dark:bg-opacity-20 text-primary text-xs font-medium mb-4">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          Architecture of Knowledge
        </div>
        <h1 className="text-5xl font-bold tracking-tight mb-3 bg-gradient-to-r from-primary to-accent-blue bg-clip-text text-transparent">
          Study Studio
        </h1>
        <p className="text-lg text-muted max-w-lg mx-auto">
          Earn genuine conviction through deep understanding.
        </p>
      </div>

      <div className="w-full max-w-4xl grid sm:grid-cols-2 gap-4 mb-8 animate-slide-up">
        <Link href="/generate" className="card card-lg group hover:border-primary/50 transition-colors">
          <div className="flex items-center justify-between mb-3">
            <span className="text-2xl">✨</span>
            <span className="badge badge-primary text-xs">Get started</span>
          </div>
          <h2 className="text-lg font-semibold mb-1 group-hover:text-primary transition-colors">Pursue Truth</h2>
          <p className="text-sm text-muted">Type a topic. Earn understanding through deep, structured exploration.</p>
        </Link>
        <Link href="/library" className="card card-lg group hover:border-primary/50 transition-colors">
          <div className="flex items-center justify-between mb-3">
            <span className="text-2xl">📖</span>
            {stats && stats.totalLessons > 0 && (
              <span className="badge badge-primary text-xs">{stats.totalLessons} saved</span>
            )}
          </div>
          <h2 className="text-lg font-semibold mb-1 group-hover:text-primary transition-colors">Learning Journey</h2>
          <p className="text-sm text-muted">Track progress across all your lessons and podcasts with scores and streaks.</p>
        </Link>
      </div>

      {stats && stats.totalLessons > 0 && (
        <>
          <div className="w-full max-w-4xl grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8 animate-slide-up">
            <div className="card p-4 text-center">
              <div className="text-2xl font-bold bg-gradient-to-r from-primary to-accent-blue bg-clip-text text-transparent">{stats.totalLessons}</div>
              <div className="text-xs text-muted mt-0.5">Lessons created</div>
            </div>
            <div className="card p-4 text-center">
              <div className="text-2xl font-bold">{stats.averageQuizScore !== null ? `${stats.averageQuizScore}%` : "—"}</div>
              <div className="text-xs text-muted mt-0.5">Avg quiz score</div>
            </div>
            <div className="card p-4 text-center">
              <div className="text-2xl font-bold">🔥 {stats.streakDays}</div>
              <div className="text-xs text-muted mt-0.5">Day streak</div>
            </div>
            <div className="card p-4 text-center">
              <div className="text-2xl font-bold">{stats.lastStudiedDate ? formatDay(stats.lastStudiedDate) : "—"}</div>
              <div className="text-xs text-muted mt-0.5">Last studied</div>
            </div>
          </div>

          {continueLesson && (
            <Link href={`/lesson?id=${continueLesson.id}`} className="w-full max-w-4xl card mb-8 animate-slide-up group">
              <div className="flex items-center justify-between mb-2">
                <span className="badge badge-primary text-xs">Continue learning</span>
                <span className="text-xs text-muted">{formatDate(continueLesson.createdAt)}</span>
              </div>
              <div className="text-lg font-semibold group-hover:text-primary transition-colors">
                {continueLesson.type === "podcast" ? "🎙️ " : "📖 "}{continueLesson.title}
              </div>
            </Link>
          )}

          {recent.length > 0 && (
            <div className="w-full max-w-4xl animate-slide-up">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-muted uppercase tracking-wider">Recent</h2>
                <Link href="/library" className="text-xs text-primary hover:underline">View all</Link>
              </div>
              <div className="grid sm:grid-cols-3 gap-3">
                {recent.map((lesson) => (
                  <Link key={lesson.id} href={`/lesson?id=${lesson.id}`} className="card group">
                    <div className="text-sm font-semibold group-hover:text-primary transition-colors line-clamp-2 mb-1">
                      {lesson.type === "podcast" ? "🎙️ " : "📖 "}{lesson.title}
                    </div>
                    <div className="text-xs text-muted">{formatDate(lesson.createdAt)}</div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
