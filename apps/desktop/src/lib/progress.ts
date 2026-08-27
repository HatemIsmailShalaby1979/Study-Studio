export type LessonStatus = "not_started" | "in_progress" | "completed";

export interface LessonProgress {
  status: LessonStatus;
  lastAccessed: string | null;
  lastQuizScore: number | null;
  quizTakenAt: string | null;
}

export interface JourneyStats {
  totalLessons: number;
  completedLessons: number;
  inProgressLessons: number;
  averageQuizScore: number | null;
  streakDays: number;
  lastStudiedDate: string | null;
}

const STORAGE_KEY = "study-studio-progress";
const DAYS_KEY = "study-studio-study-days";

export function dayKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function dayBefore(key: string): string {
  const parts = key.split("-").map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);
  return dayKey(dt);
}

function emptyProgress(): LessonProgress {
  return { status: "not_started", lastAccessed: null, lastQuizScore: null, quizTakenAt: null };
}

function safeGet(): Record<string, LessonProgress> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function safeSet(map: Record<string, LessonProgress>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage unavailable; progress is best-effort only.
  }
}

function getStudyDays(): string[] {
  try {
    const raw = localStorage.getItem(DAYS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setStudyDays(days: string[]): void {
  try {
    localStorage.setItem(DAYS_KEY, JSON.stringify(days));
  } catch {
    // Best-effort only.
  }
}

function recordStudyDay(): void {
  const day = dayKey();
  const days = getStudyDays();
  if (!days.includes(day)) {
    days.push(day);
    setStudyDays(days);
  }
}

export function getProgressMap(): Record<string, LessonProgress> {
  return safeGet();
}

export function getProgress(lessonId: string): LessonProgress {
  const map = safeGet();
  return map[lessonId] ?? emptyProgress();
}

export function markAccessed(lessonId: string): LessonProgress {
  const map = safeGet();
  const current = map[lessonId] ?? emptyProgress();
  const next: LessonProgress = {
    ...current,
    lastAccessed: new Date().toISOString(),
    status: current.status === "not_started" ? "in_progress" : current.status,
  };
  map[lessonId] = next;
  safeSet(map);
  recordStudyDay();
  return next;
}

export function markQuizComplete(lessonId: string, score: number): LessonProgress {
  const map = safeGet();
  const current = map[lessonId] ?? emptyProgress();
  const now = new Date().toISOString();
  const next: LessonProgress = {
    ...current,
    status: "completed",
    lastAccessed: now,
    lastQuizScore: Math.max(0, Math.min(100, Math.round(score))),
    quizTakenAt: now,
  };
  map[lessonId] = next;
  safeSet(map);
  recordStudyDay();
  return next;
}

export function clearProgress(lessonId: string): void {
  const map = safeGet();
  delete map[lessonId];
  safeSet(map);
}

export function clearAllProgress(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(DAYS_KEY);
  } catch {
    // Best-effort only.
  }
}

export function computeStreak(days: string[]): number {
  const unique = Array.from(new Set(days));
  if (unique.length === 0) return 0;
  const today = dayKey();
  const anchor = unique.includes(today) ? today : dayBefore(today);
  const set = new Set(unique);
  if (!set.has(anchor)) return 0;
  let streak = 0;
  let cursor = anchor;
  while (set.has(cursor)) {
    streak++;
    cursor = dayBefore(cursor);
  }
  return streak;
}

export function computeStats(lessons: { id: string }[]): JourneyStats {
  const map = safeGet();
  const scores = lessons
    .map((l) => map[l.id]?.lastQuizScore)
    .filter((s): s is number => typeof s === "number" && s !== null);
  const averageQuizScore =
    scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const statuses = lessons.map((l) => map[l.id]?.status ?? "not_started");
  const completedLessons = statuses.filter((s) => s === "completed").length;
  const inProgressLessons = statuses.filter((s) => s === "in_progress").length;
  const studyDays = getStudyDays().sort();
  const lastStudied = studyDays.length > 0 ? (studyDays[studyDays.length - 1] ?? null) : null;
  return {
    totalLessons: lessons.length,
    completedLessons,
    inProgressLessons,
    averageQuizScore,
    streakDays: computeStreak(studyDays),
    lastStudiedDate: lastStudied,
  };
}
