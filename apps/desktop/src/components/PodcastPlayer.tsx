"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { PodcastLine } from "@/types";

interface Props {
  script: PodcastLine[];
  title: string;
  onClose: () => void;
}

export default function PodcastPlayer({ script, title, onClose }: Props) {
  const [currentLine, setCurrentLine] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceA, setVoiceA] = useState("");
  const [voiceB, setVoiceB] = useState("");
  const [speed, setSpeed] = useState(1);
  const [pitch, setPitch] = useState(1);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const lineTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    synthRef.current = globalThis.speechSynthesis;
    const loadVoices = () => {
      const available = globalThis.speechSynthesis.getVoices();
      if (available.length > 0) {
        setVoices(available);
        const enVoices = available.filter((v) => v.lang.startsWith("en"));
        setVoiceA(
          (enVoices.find((v) => v.name.includes("Male")) ||
           enVoices.find((v) => v.name.includes("David")) ||
           enVoices[0])?.name || ""
        );
        setVoiceB(
          (enVoices.find((v) => v.name.includes("Female")) ||
           enVoices.find((v) => v.name.includes("Zira")) ||
           enVoices[enVoices.length > 1 ? 1 : 0])?.name || ""
        );
      }
    };
    loadVoices();
    globalThis.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      if (lineTimeoutRef.current) clearTimeout(lineTimeoutRef.current);
      globalThis.speechSynthesis.cancel();
    };
  }, []);

  const speakLine = useCallback(
    (index: number) => {
      if (!synthRef.current || !script[index]) return;
      synthRef.current.cancel();
      const utterance = new SpeechSynthesisUtterance(script[index].text);
      const voiceName = script[index].speaker === "Host A" ? voiceA : voiceB;
      const voice = voices.find((v) => v.name === voiceName);
      if (voice) utterance.voice = voice;
      utterance.rate = speed;
      utterance.pitch = pitch;
      utterance.onend = () => {
        if (index < script.length - 1) {
          lineTimeoutRef.current = setTimeout(() => {
            setCurrentLine(index + 1);
            speakLine(index + 1);
          }, 500);
        } else {
          setIsPlaying(false);
          setCurrentLine(0);
        }
      };
      synthRef.current.speak(utterance);
    },
    [script, voices, voiceA, voiceB, speed, pitch]
  );

  const handlePlayPause = () => {
    if (!synthRef.current) return;
    if (isPlaying) {
      if (isPaused) { synthRef.current.resume(); setIsPaused(false); }
      else { synthRef.current.pause(); setIsPaused(true); }
    } else {
      setIsPlaying(true);
      setIsPaused(false);
      speakLine(currentLine);
    }
  };

  const handleSkip = (direction: "prev" | "next") => {
    if (!synthRef.current) return;
    if (lineTimeoutRef.current) clearTimeout(lineTimeoutRef.current);
    synthRef.current.cancel();
    const next = direction === "next"
      ? Math.min(currentLine + 1, script.length - 1)
      : Math.max(currentLine - 1, 0);
    setCurrentLine(next);
    if (isPlaying) speakLine(next);
  };

  const handleStop = () => {
    if (!synthRef.current) return;
    if (lineTimeoutRef.current) clearTimeout(lineTimeoutRef.current);
    synthRef.current.cancel();
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentLine(0);
  };

  const currentSpeaker = script[currentLine]?.speaker;

  return (
    <div className="card border-amber-200/50 dark:border-amber-800/30 bg-gradient-to-br from-amber-50/70 to-orange-50/30 dark:from-amber-900/10 dark:to-orange-900/5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-amber-600 dark:text-amber-400">🎙️</span>
          <div>
            <h3 className="font-semibold text-sm">Podcast Player</h3>
            <p className="text-[11px] text-muted">{title}</p>
          </div>
        </div>
        <button onClick={onClose} className="btn btn-ghost text-xs !p-1.5">✕</button>
      </div>

      {/* Voices */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-[11px] text-muted block mb-1">Host A Voice</label>
          <select value={voiceA} onChange={(e) => setVoiceA(e.target.value)} className="input-field text-xs">
            {voices.map((v) => (<option key={v.name} value={v.name}>{v.name}</option>))}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-muted block mb-1">Host B Voice</label>
          <select value={voiceB} onChange={(e) => setVoiceB(e.target.value)} className="input-field text-xs">
            {voices.map((v) => (<option key={v.name} value={v.name}>{v.name}</option>))}
          </select>
        </div>
      </div>

      {/* Audio length controls */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="text-[11px] text-muted block mb-1">Speed: {speed.toFixed(1)}x</label>
          <input type="range" min="0.5" max="2" step="0.1" value={speed}
            onChange={(e) => setSpeed(parseFloat(e.target.value))}
            className="w-full accent-amber-500" />
          <div className="flex justify-between text-[10px] text-muted mt-0.5">
            <span>0.5x</span><span>1x</span><span>2x</span>
          </div>
        </div>
        <div>
          <label className="text-[11px] text-muted block mb-1">Pitch: {pitch.toFixed(1)}</label>
          <input type="range" min="0.5" max="2" step="0.1" value={pitch}
            onChange={(e) => setPitch(parseFloat(e.target.value))}
            className="w-full accent-amber-500" />
          <div className="flex justify-between text-[10px] text-muted mt-0.5">
            <span>Low</span><span>Normal</span><span>High</span>
          </div>
        </div>
      </div>

      {/* Current line */}
      {script[currentLine] && (
        <div className={`mb-4 p-4 rounded-xl border transition-all duration-300 ${
          currentSpeaker === "Host A"
            ? "bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800/30"
            : "bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/30"
        } ${isPlaying && !isPaused ? "animate-scale-in" : ""}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white ${
              currentSpeaker === "Host A" ? "bg-blue-500" : "bg-amber-500"
            }`}>{currentSpeaker === "Host A" ? "A" : "B"}</span>
            <span className={`text-xs font-semibold ${
              currentSpeaker === "Host A" ? "text-blue-600 dark:text-blue-400" : "text-amber-600 dark:text-amber-400"
            }`}>{currentSpeaker}</span>
            {isPlaying && !isPaused && (
              <span className="flex items-center gap-0.5 ml-auto">
                <span className="w-1 h-3 bg-primary rounded-full animate-bounce" style={{animationDelay: '0s'}} />
                <span className="w-1 h-2 bg-primary rounded-full animate-bounce" style={{animationDelay: '0.15s'}} />
                <span className="w-1 h-4 bg-primary rounded-full animate-bounce" style={{animationDelay: '0.3s'}} />
              </span>
            )}
          </div>
          <p className="text-sm leading-relaxed">{script[currentLine].text}</p>
        </div>
      )}

      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1 h-1.5 rounded-full bg-card-border overflow-hidden">
          <div className="h-full bg-gradient-to-r from-amber-400 to-primary rounded-full transition-all duration-300" style={{ width: `${((currentLine + 1) / script.length) * 100}%` }} />
        </div>
        <span className="text-[11px] text-muted whitespace-nowrap">{currentLine + 1}/{script.length}</span>
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
