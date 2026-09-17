import { useCallback, useMemo } from "react";
import type { Lesson } from "@/types";
import { getLesson, upsertLesson } from "@/lib/libraryStore";

/** Persistence boundary for LessonContent's mutable lesson fields. */
export function useLessonPersistence() {
  const load = useCallback((id: string) => getLesson(id), []);
  const updateAudioPath = useCallback(
    (lesson: Lesson, audioPath: string) => upsertLesson({ ...lesson, audioPath }),
    []
  );
  const updatePodcastScript = useCallback(
    (lesson: Lesson, podcastScript: NonNullable<Lesson["podcastScript"]>) =>
      upsertLesson({ ...lesson, podcastScript }),
    []
  );
  return useMemo(() => ({ load, updateAudioPath, updatePodcastScript }), [
    load,
    updateAudioPath,
    updatePodcastScript,
  ]);
}
