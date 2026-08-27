// Metacognitive Observer Service
//
// Evaluates the quality of the learning experience, identifies performance
// bottlenecks on low-spec hardware, and triggers a "Feedback Pulse" every
// N=5 generated topics.

"use client";

import { useEffect, useState, useMemo } from "react";
import { quizRetentionSummary } from "@/lib/helixEvents";
import type { QuizRetentionSummary } from "@/types";

export interface PulseSubmission {
  rating: number; // 1-8
  feedback: string;
  topicsCompleted: number;
}

const PULSE_INTERVAL = 5; // topics between pulses
const STORAGE_KEY = "study-studio-metacognitive";

interface PulseRecord {
  topicCount: number;
  lastRating: number | null;
  lastFeedback: string;
  submittedAt: string | null;
  lastSubmittedTopicCount: number;
  systemAdviceGiven: boolean;
}

function loadRecord(): PulseRecord {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as PulseRecord;
  } catch {}
  return {
    topicCount: 0,
    lastRating: null,
    lastFeedback: "",
    submittedAt: null,
    lastSubmittedTopicCount: 0,
    systemAdviceGiven: false,
  };
}

function saveRecord(record: PulseRecord): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {}
}

/**
 * Tracks topic completions. Returns `showPulse` when the N-th topic is
 * reached, plus helpers to submit/dismiss and to check whether the system
 * should offer a hardware-optimization suggestion.
 */
export function useMetacognitiveObserver() {
  const [record, setRecord] = useState<PulseRecord>(() => loadRecord());
  const [showPulse, setShowPulse] = useState(false);
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [optimizationAdvice, setOptimizationAdvice] = useState("");

  // Quiz retention roll-up for the last 5 topics — refreshed each time the
  // pulse dialog is shown, so it reflects all MasteryScored events logged so
  // far.  The hook is read-only; helixEvents reads from localStorage.
  const retentionSummary: QuizRetentionSummary = useMemo(() => {
    if (!showPulse) return { topics: [], averageAccuracy: null, averageRetention: null, lastN: 0 };
    return quizRetentionSummary(5);
  }, [showPulse]);

  /** Call after a topic is fully generated. Triggers the pulse at N topics. */
  const recordTopicCompletion = () => {
    setRecord((prev) => {
      const next: PulseRecord = {
        ...prev,
        topicCount: prev.topicCount + 1,
      };
      saveRecord(next);
      // Fire the pulse every N topics (starting after the first completed N).
      const sinceSubmit = prev.submittedAt == null
        ? next.topicCount
        : next.topicCount - prev.lastSubmittedTopicCount;
      if (sinceSubmit >= PULSE_INTERVAL) {
        setShowPulse(true);
      }
      return next;
    });
  };

  /** Submit the pulse; stores feedback and clears the dialog. */
  const submitPulse = () => {
    const finalRating = rating || 5;
    const rec: PulseRecord = {
      ...record,
      lastRating: finalRating,
      lastFeedback: feedback.trim(),
      submittedAt: new Date().toISOString(),
      lastSubmittedTopicCount: record.topicCount,
    };
    saveRecord(rec);
    setRecord(rec);
    setShowPulse(false);
    setRating(0);
    setFeedback("");
  };

  /** Dismiss the pulse without submitting. */
  const dismissPulse = () => {
    setShowPulse(false);
    setRating(0);
    setFeedback("");
  };

  // Suggest light-mode TTS when rendering feels sluggish (no hard metric yet —
  // this is a placeholder the user can refine with real telemetry later).
  useEffect(() => {
    if (!showPulse) return;
    setOptimizationAdvice(
      "We noticed audio generation can feel sluggish on some hardware. Would you like us to switch the default TTS engine to light-mode Piper files for a 3x speed boost?"
    );
  }, [showPulse]);

  return {
    showPulse,
    rating,
    setRating,
    feedback,
    setFeedback,
    optimizationAdvice,
    retentionSummary,
    recordTopicCompletion,
    submitPulse,
    dismissPulse,
  };
}