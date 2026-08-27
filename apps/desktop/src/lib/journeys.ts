// Learning Track & Journey Architecture
//
// A Journey is a parent container holding multiple topics linked sequentially.
// Topics inside a journey retain context from prior topics within the same
// container, and run through the same 3-step pipeline (HTML -> Audio ->
// Save/Listen). Journeys persist to localStorage alongside the library.

export interface Journey {
  id: string;
  title: string;
  description?: string;
  createdAt: string;
  topicIds: string[];
  /** Overarching context shared by all topics in this journey. */
  context?: string;
  language?: "en" | "ar";
}

const JOURNEYS_KEY = "study-studio-journeys";

export function loadJourneys(): Journey[] {
  try {
    const raw = localStorage.getItem(JOURNEYS_KEY);
    if (raw) return JSON.parse(raw) as Journey[];
  } catch {}
  return [];
}

export function saveJourneys(journeys: Journey[]): void {
  try {
    localStorage.setItem(JOURNEYS_KEY, JSON.stringify(journeys));
  } catch {}
}

export function getJourney(id: string): Journey | null {
  return loadJourneys().find((j) => j.id === id) ?? null;
}

export function createJourney(title: string, opts?: Partial<Journey>): Journey {
  const journey: Journey = {
    id: crypto?.randomUUID?.() ?? `j-${Date.now()}`,
    title: title.trim() || "Untitled Journey",
    description: opts?.description,
    createdAt: new Date().toISOString(),
    topicIds: opts?.topicIds ?? [],
    context: opts?.context,
    language: opts?.language,
  };
  const journeys = loadJourneys();
  journeys.unshift(journey);
  saveJourneys(journeys);
  return journey;
}

export function updateJourney(id: string, patch: Partial<Journey>): Journey | null {
  const journeys = loadJourneys();
  const idx = journeys.findIndex((j) => j.id === id);
  if (idx < 0) return null;
  const existing = journeys[idx];
  if (!existing) return null;
  const updated: Journey = { ...existing, ...patch };
  journeys[idx] = updated;
  saveJourneys(journeys);
  return updated;
}

export function deleteJourney(id: string): void {
  saveJourneys(loadJourneys().filter((j) => j.id !== id));
}

/** Add a lesson/topic to a journey. */
export function addTopicToJourney(journeyId: string, topicId: string): boolean {
  const journey = getJourney(journeyId);
  if (!journey) return false;
  if (!journey.topicIds.includes(topicId)) {
    updateJourney(journeyId, { topicIds: [...journey.topicIds, topicId] });
  }
  return true;
}

/** Remove a lesson/topic from a journey. */
export function removeTopicFromJourney(journeyId: string, topicId: string): void {
  const journey = getJourney(journeyId);
  if (!journey) return;
  updateJourney(journeyId, {
    topicIds: journey.topicIds.filter((id) => id !== topicId),
  });
}

/**
 * Build the overarching context prompt that connects topics in a journey.
 * Topics generated later receive the context of the topics already in the
 * journey so they can reference and build on prior material.
 */
export function buildJourneyContextPrompt(journey: Journey, topics: { id: string; title: string }[]): string {
  if (topics.length === 0) {
    return journey.context ?? `Journey: ${journey.title}`;
  }
  const covered = topics.map((t) => `- ${t.title}`).join("\n");
  return [
    `OVERARCHING JOURNEY CONTEXT: ${journey.title}`,
    journey.description ? `Description: ${journey.description}` : "",
    "Topics already covered in this journey (build on them; avoid repeating):",
    covered,
    "Treat this new topic as the next step in the journey, referencing earlier topics where natural.",
  ]
    .filter(Boolean)
    .join("\n");
}