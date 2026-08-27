"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { Lesson } from "@/types";
import {
  getProgress,
  getProgressMap,
  computeStats,
  clearProgress,
  clearAllProgress,
  type LessonProgress,
  type JourneyStats,
} from "@/lib/progress";

const FEATURED_IDS = ["podcast-studio-intro", "lesson-studio-intro"];

const FEATURED_FILES: { id: string; path: string }[] = [
  { id: "podcast-studio-intro", path: "/featured-podcast.json" },
  { id: "lesson-studio-intro", path: "/featured-lesson.json" },
];

async function ensureFeaturedContent(): Promise<Lesson[]> {
  const imported: Lesson[] = [];
  try {
    const stored = localStorage.getItem("study-studio-library");
    const library: Lesson[] = stored ? JSON.parse(stored) : [];

    for (const file of FEATURED_FILES) {
      if (library.some((l) => l.id === file.id)) continue;
      const res = await fetch(file.path);
      if (!res.ok) continue;
      const featured: Lesson = await res.json();
      library.unshift(featured);
      imported.push(featured);
    }

    if (imported.length > 0) {
      localStorage.setItem("study-studio-library", JSON.stringify(library));
    }
  } catch {}
  return imported;
}

const STATUS_META: Record<LessonProgress["status"], { label: string; emoji: string; style: CSSProperties }> = {
  not_started: {
    label: "Not Started",
    emoji: "⏳",
    style: { background: "rgba(148,163,184,0.12)", color: "#94a3b8", border: "1px solid rgba(148,163,184,0.25)" },
  },
  in_progress: {
    label: "In Progress",
    emoji: "📖",
    style: { background: "rgba(59,130,246,0.12)", color: "#3b82f6", border: "1px solid rgba(59,130,246,0.25)" },
  },
  completed: {
    label: "Completed",
    emoji: "✅",
    style: { background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.25)" },
  },
};

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDay(key: string): string {
  const parts = key.split("-").map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function scoreStyle(score: number): CSSProperties {
  const color = score >= 80 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#ef4444";
  return { background: "rgba(0,0,0,0.05)", color, border: "1px solid rgba(0,0,0,0.08)" };
}

export default function Library() {
  const [library, setLibrary] = useState<Lesson[]>([]);
  const [progress, setProgress] = useState<Record<string, LessonProgress>>({});
  const [stats, setStats] = useState<JourneyStats | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem("study-studio-library");
    const initial: Lesson[] = stored ? (() => { try { return JSON.parse(stored); } catch { return []; } })() : [];
    setLibrary(initial);
    setProgress(getProgressMap());
    setStats(computeStats(initial));

    ensureFeaturedContent().then((imported) => {
      if (imported.length > 0) {
        setLibrary((prev) => {
          const missing = imported.filter((l) => !prev.some((p) => p.id === l.id));
          if (missing.length === 0) return prev;
          return [...missing, ...prev];
        });
      }
    });
  }, []);

  const getProgressMapSync = () => {
    const map: Record<string, LessonProgress> = {};
    const stored = localStorage.getItem("study-studio-progress");
    try {
      const parsed = stored ? JSON.parse(stored) : {};
      if (parsed && typeof parsed === "object") Object.assign(map, parsed);
    } catch {}
    return map;
  };

  const refresh = (next: Lesson[]) => {
    setLibrary(next);
    const map: Record<string, LessonProgress> = {};
    next.forEach((l) => {
      map[l.id] = getProgress(l.id);
    });
    setProgress(map);
    setStats(computeStats(next));
  };

  const handleDelete = (id: string) => {
    if (!confirm("Delete this lesson from your learning journey?")) return;
    const updated = library.filter((l) => l.id !== id);
    localStorage.setItem("study-studio-library", JSON.stringify(updated));
    localStorage.removeItem(`study-studio-quiz-${id}`);
    clearProgress(id);
    refresh(updated);
  };

  const handleClearAll = () => {
    if (confirm("Delete all lessons from your learning journey?")) {
      library.forEach((l) => localStorage.removeItem(`study-studio-quiz-${l.id}`));
      clearAllProgress();
      setLibrary([]);
      setProgress({});
      setStats(computeStats([]));
      localStorage.removeItem("study-studio-library");
    }
  };

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-16">
        <div className="animate-spin h-8 w-8 border-[3px] border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-20 pb-16 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 animate-fade-in">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-3xl font-bold tracking-tight">Learning Journey</h1>
              <span className="badge badge-primary text-xs">
                {library.length} {library.length === 1 ? "lesson" : "lessons"}
              </span>
            </div>
            <p className="text-muted text-sm">
              Track your progress across all your lessons, podcasts, and quizzes
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/generate" className="btn btn-primary text-sm">
              <span>+</span> New Lesson
            </Link>
            {library.length > 0 && (
              <button onClick={handleClearAll} className="btn btn-ghost text-sm text-accent-red">
                🗑 Clear
              </button>
            )}
          </div>
        </div>

        {/* Stats summary */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8 animate-slide-up">
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
              <div className="text-xs text-muted mt-0.5">
                {stats.streakDays === 1 ? "Day streak" : "Day streak"}
              </div>
            </div>
            <div className="card p-4 text-center">
              <div className="text-2xl font-bold">{stats.lastStudiedDate ? formatDay(stats.lastStudiedDate) : "—"}</div>
              <div className="text-xs text-muted mt-0.5">Last studied</div>
            </div>
          </div>
        )}

        {library.length === 0 ? (
          <div className="card card-lg text-center py-20 animate-scale-in">
            <div className="text-5xl mb-4">📭</div>
            <h3 className="text-xl font-semibold mb-2">Your journey starts here</h3>
            <p className="text-muted mb-6 max-w-sm mx-auto">
              Generate your first lesson or podcast by pasting study material or typing a topic.
            </p>
            <Link href="/generate" className="btn btn-primary">
              📖 Generate a Lesson
            </Link>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {library.map((lesson, i) => {
              const prog = progress[lesson.id] ?? getProgress(lesson.id);
              const status = STATUS_META[prog.status] ?? STATUS_META.not_started;
              return (
                <div
                  key={lesson.id}
                  className="card group animate-slide-up"
                  style={{ animationDelay: `${i * 0.04}s` }}
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <span className="text-lg">
                      {lesson.type === "podcast" ? "🎙️" : "📖"}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="badge text-[10px]" style={status.style}>
                        {status.emoji} {status.label}
                      </span>
                      <button
                        onClick={(e) => { e.preventDefault(); handleDelete(lesson.id); }}
                        className="btn btn-ghost text-xs !p-1.5 opacity-0 group-hover:opacity-100 transition-opacity text-muted hover:text-accent-red shrink-0"
                        title="Delete lesson"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <Link href={`/lesson?id=${lesson.id}`} className="block">
                    <h3 className="font-semibold mb-1.5 group-hover:text-primary transition-colors line-clamp-2">
                      {lesson.title}
                    </h3>
                    <div className="flex items-center flex-wrap gap-2 text-xs text-muted">
                      <span>
                        {prog.lastAccessed ? `Last studied ${formatDate(prog.lastAccessed)}` : `Created ${formatDate(lesson.createdAt)}`}
                      </span>
                      {prog.lastQuizScore !== null && (
                        <span className="badge text-[10px]" style={scoreStyle(prog.lastQuizScore)}>
                          Quiz {prog.lastQuizScore}%
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-3 text-xs text-muted">
                      <span className="badge badge-green">
                        ✍️ {lesson.quiz.length} quiz
                      </span>
                      <span className="badge badge-primary">
                        📖 {lesson.glossary.length} terms
                      </span>
                      <span className="badge" style={{background: 'var(--sidebar)', border: '1px solid var(--card-border)'}}>
                        {lesson.sections.length} sections
                      </span>
                    </div>
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
