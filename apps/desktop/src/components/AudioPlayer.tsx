"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Section } from "@/types";

interface Props {
  sections: Section[];
  title: string;
  onClose: () => void;
}

export default function AudioPlayer({ sections, title, onClose }: Props) {
  const [currentSection, setCurrentSection] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string>("");
  const [isPaused, setIsPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [pitch, setPitch] = useState(1);
  const synthRef = useRef<SpeechSynthesis | null>(null);

  useEffect(() => {
    synthRef.current = window.speechSynthesis;
    const loadVoices = () => {
      const available = window.speechSynthesis.getVoices();
      if (available.length > 0) {
        setVoices(available);
        const preferred = available.find(
          (v) => v.lang.startsWith("en") && v.name.includes("Natural")
        ) || available.find((v) => v.lang.startsWith("en")) || available[0];
        setSelectedVoice(preferred?.name || "");
      }
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => { window.speechSynthesis.cancel(); };
  }, []);

  const speakSection = useCallback(
    (index: number) => {
      if (!synthRef.current || !sections[index]) return;
      synthRef.current.cancel();
      const utterance = new SpeechSynthesisUtterance(
        `${sections[index].heading}. ${sections[index].content}`
      );
      const voice = voices.find((v) => v.name === selectedVoice);
      if (voice) utterance.voice = voice;
      utterance.rate = speed;
      utterance.pitch = pitch;
      utterance.onend = () => {
        if (index < sections.length - 1) {
          setCurrentSection(index + 1);
          speakSection(index + 1);
        } else {
          setIsPlaying(false);
          setCurrentSection(0);
        }
      };
      synthRef.current.speak(utterance);
    },
    [sections, voices, selectedVoice, speed, pitch]
  );

  const handlePlayPause = () => {
    if (!synthRef.current) return;
    if (isPlaying) {
      if (isPaused) { synthRef.current.resume(); setIsPaused(false); }
      else { synthRef.current.pause(); setIsPaused(true); }
    } else {
      setIsPlaying(true);
      setIsPaused(false);
      speakSection(currentSection);
    }
  };

  const handleSkip = (direction: "prev" | "next") => {
    if (!synthRef.current) return;
    synthRef.current.cancel();
    const next = direction === "next"
      ? Math.min(currentSection + 1, sections.length - 1)
      : Math.max(currentSection - 1, 0);
    setCurrentSection(next);
    if (isPlaying) speakSection(next);
  };

  const handleStop = () => {
    if (!synthRef.current) return;
    synthRef.current.cancel();
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentSection(0);
  };

  return (
    <div className="card border-primary/20 bg-gradient-to-br from-primary-soft/30 to-transparent dark:from-primary-soft/10">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-primary-soft dark:bg-opacity-20 flex items-center justify-center text-primary">🔊</span>
          <div>
            <h3 className="font-semibold text-sm">Audio Playback</h3>
            <p className="text-[11px] text-muted">{title}</p>
          </div>
        </div>
        <button onClick={onClose} className="btn btn-ghost text-xs !p-1.5">✕</button>
      </div>

      <div className="flex items-center gap-2 mb-3 px-1">
        <div className="flex-1 h-1.5 rounded-full bg-card-border overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${((currentSection + 1) / sections.length) * 100}%` }} />
        </div>
        <span className="text-[11px] text-muted whitespace-nowrap">{currentSection + 1}/{sections.length}</span>
      </div>

      <div className="text-xs text-muted mb-4 px-1">
        Now playing: <span className="font-medium text-foreground">{sections[currentSection]?.heading}</span>
      </div>

      {/* Voice selection */}
      <div className="mb-3">
        <select
          value={selectedVoice}
          onChange={(e) => setSelectedVoice(e.target.value)}
          className="input-field text-xs"
        >
          {voices.map((v) => (<option key={v.name} value={v.name}>{v.name}</option>))}
        </select>
      </div>

      {/* Audio length controls - speed + pitch */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="text-[11px] text-muted block mb-1">Speed: {speed.toFixed(1)}x</label>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            value={speed}
            onChange={(e) => setSpeed(parseFloat(e.target.value))}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-[10px] text-muted mt-0.5">
            <span>0.5x</span>
            <span>1x</span>
            <span>2x</span>
          </div>
        </div>
        <div>
          <label className="text-[11px] text-muted block mb-1">Pitch: {pitch.toFixed(1)}</label>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            value={pitch}
            onChange={(e) => setPitch(parseFloat(e.target.value))}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-[10px] text-muted mt-0.5">
            <span>Low</span>
            <span>Normal</span>
            <span>High</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={() => handleSkip("prev")} className="btn btn-secondary !p-2.5" title="Previous">⏮</button>
        <button onClick={handlePlayPause} className="btn btn-primary flex-1 !py-2.5 text-sm font-semibold">
          {isPlaying ? (isPaused ? "▶ Resume" : "⏸ Pause") : "▶ Play"}
        </button>
        <button onClick={() => handleSkip("next")} className="btn btn-secondary !p-2.5" title="Next">⏭</button>
        <button onClick={handleStop} className="btn btn-secondary !p-2.5" title="Stop">⏹</button>
      </div>
    </div>
  );
}
