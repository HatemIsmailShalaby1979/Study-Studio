"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import { Lesson } from "@/types";
import {
  loadJourneys,
  createJourney,
  deleteJourney,
  removeTopicFromJourney,
  type Journey,
} from "@/lib/journeys";

export default function Journeys() {
  const router = useRouter();
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [library, setLibrary] = useState<Record<string, Lesson>>({});
  const [mounted, setMounted] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");

  useEffect(() => {
    setMounted(true);
    setJourneys(loadJourneys());
    try {
      const raw = localStorage.getItem("study-studio-library");
      const lessons: Lesson[] = raw ? JSON.parse(raw) : [];
      const map: Record<string, Lesson> = {};
      lessons.forEach((l) => (map[l.id] = l));
      setLibrary(map);
    } catch {}
  }, []);

  const refresh = () => setJourneys(loadJourneys());

  const handleCreate = () => {
    if (!newTitle.trim()) return;
    const journey = createJourney(newTitle, { description: newDescription.trim() || undefined });
    setNewTitle("");
    setNewDescription("");
    setCreating(false);
    refresh();
    router.push(`/journey?id=${journey.id}`);
  };

  const handleDelete = (id: string) => {
    if (confirm("Delete this journey and its topic grouping? Lessons themselves stay in your library.")) {
      deleteJourney(id);
      refresh();
    }
  };

  const handleRemoveTopic = (journeyId: string, topicId: string) => {
    removeTopicFromJourney(journeyId, topicId);
    refresh();
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
              <h1 className="text-3xl font-bold tracking-tight">Learning Journeys</h1>
              <span className="badge badge-primary text-xs">
                {journeys.length} {journeys.length === 1 ? "journey" : "journeys"}
              </span>
            </div>
            <p className="text-muted text-sm">
              Group related topics into sequential, context-aware tracks.
            </p>
          </div>
          <button
            onClick={() => setCreating((v) => !v)}
            className="btn btn-primary text-sm"
          >
            <span>+</span> Create Journey
          </button>
        </div>

        {/* Create form */}
        {creating && (
          <div className="card card-lg mb-6 animate-scale-in">
            <h3 className="font-semibold mb-3">New Learning Journey</h3>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Journey title, e.g. 'German A1 Foundations'"
              className="input-field text-sm mb-3"
            />
            <input
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Overarching context (optional) — shared across all topics"
              className="input-field text-sm mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setCreating(false)} className="btn btn-ghost text-sm">
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!newTitle.trim()}
                className="btn btn-primary text-sm"
              >
                Create Journey
              </button>
            </div>
          </div>
        )}

        {journeys.length === 0 ? (
          <div className="card card-lg text-center py-16 animate-scale-in">
            <div className="text-5xl mb-4">🗺️</div>
            <h3 className="text-xl font-semibold mb-2">Plan a learning track</h3>
            <p className="text-muted mb-6 max-w-sm mx-auto">
              A journey groups multiple topics into one cohesive track. Each new
              topic builds on the context of the ones before it.
            </p>
            <button onClick={() => setCreating(true)} className="btn btn-primary">
              🗺️ Create Your First Journey
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {journeys.map((journey) => (
              <div key={journey.id} className="card group animate-slide-up">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <h3 className="font-semibold text-lg group-hover:text-primary transition-colors">
                      {journey.title}
                    </h3>
                    {journey.description && (
                      <p className="text-sm text-muted mt-1">{journey.description}</p>
                    )}
                    <p className="text-xs text-muted mt-1.5">
                      {journey.topicIds.length} topics · created{" "}
                      {new Date(journey.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDelete(journey.id)}
                    className="btn btn-ghost text-xs !p-1.5 opacity-0 group-hover:opacity-100 transition-opacity text-muted hover:text-accent-red shrink-0"
                  >
                    ✕
                  </button>
                </div>

                {/* Topics in this journey */}
                {journey.topicIds.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {journey.topicIds.map((topicId, i) => {
                      const topic = library[topicId];
                      return (
                        <div
                          key={topicId}
                          className="flex items-center gap-3 p-2.5 rounded-xl border border-card-border bg-sidebar/50"
                        >
                          <span className="w-6 h-6 rounded-lg bg-primary-soft dark:bg-opacity-20 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                            {i + 1}
                          </span>
                          {topic ? (
                            <Link
                              href={`/lesson?id=${topic.id}`}
                              className="flex-1 text-sm font-medium hover:text-primary transition-colors line-clamp-1"
                            >
                              {topic.title}
                            </Link>
                          ) : (
                            <span className="flex-1 text-sm text-muted line-clamp-1 italic">
                              Missing topic
                            </span>
                          )}
                          <button
                            onClick={() => handleRemoveTopic(journey.id, topicId)}
                            className="text-xs text-muted hover:text-accent-red shrink-0"
                            title="Remove from journey"
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })}
                    <Link
                      href="/generate"
                      className="mt-1 text-xs font-medium text-primary hover:underline"
                    >
                      + Add next topic to this journey
                    </Link>
                  </div>
                ) : (
                  <Link
                    href="/generate"
                    className="block p-3 rounded-xl border border-dashed border-card-border text-sm text-muted text-center hover:border-primary/50 hover:text-primary transition-colors"
                  >
                    + Add your first topic
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}