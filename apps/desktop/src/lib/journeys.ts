// Learning Track & Journey Architecture
//
// A Journey is a parent container holding multiple topics linked sequentially.
// Topics inside a journey retain context from prior topics within the same
// container, and run through the same 3-step pipeline (HTML -> Audio ->
// Save/Listen). Journeys persist to localStorage alongside the library.

import { readVersioned, writeVersioned } from "./storage";

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

/**
 * v0 was a bare JSON array with no wrapper; v1 is the same array, versioned.
 * Dropping entries that are not journeys is deliberate — an array of junk is
 * corruption, and one bad row should not cost the user the rest.
 */
function migrateJourneys(raw: unknown): Journey[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.filter(
    (j): j is Journey =>
      j !== null && typeof j === "object" && typeof (j as Journey).id === "string"
  );
}

export function loadJourneys(): Journey[] {
  return readVersioned<Journey[]>(JOURNEYS_KEY, migrateJourneys, []);
}

/**
 * Persist journeys.
 *
 * A failure is reported through `onStorageFailure` rather than swallowed — the
 * old version's empty `catch` meant a journey could silently fail to save.
 */
export function saveJourneys(journeys: Journey[]): void {
  writeVersioned(JOURNEYS_KEY, journeys);
}

export function getJourney(id: string): Journey | null {
  return loadJourneys().find((j) => j.id === id) ?? null;
}

/**
 * Generate a journey id.
 *
 * `crypto.randomUUID` only exists in a secure context (https, localhost, or the
 * Tauri shell). When it is missing the old fallback was `j-${Date.now()}` — and
 * `Date.now()` has millisecond resolution, so two journeys created in the same
 * tick got the *same* id. `deleteJourney` filters by id, so deleting one would
 * silently delete both. The random suffix removes that collision.
 */
function generateJourneyId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return `j-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createJourney(title: string, opts?: Partial<Journey>): Journey {
  const journey: Journey = {
    id: generateJourneyId(),
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