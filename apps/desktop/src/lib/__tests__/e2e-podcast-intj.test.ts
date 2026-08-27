/**
 * End-to-end integration test: generate an ARABIC LONG-length podcast about
 * the INTJ personality type using the session-pinned model (qwen3:8b), then
 * synthesize a real MP3 file on disk via Piper TTS + ffmpeg.
 *
 * This test is GATED: it only runs when E2E_PODCAST=1. It is intentionally
 * excluded from the normal `npm test` run because it talks to the real local
 * Ollama server and takes several minutes. Run with:
 *
 *   $env:E2E_PODCAST="1"; npx jest e2e-podcast-intj
 *
 * On success it asserts the MP3 exists and prints its absolute path, which is
 * the file the user asked to be produced.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as http from "http";
import { spawnSync } from "child_process";
import { generatePodcastOnly } from "@/lib/generation";

const RUN = process.env["E2E_PODCAST"] === "1";

/**
 * The jsdom jest environment has no `fetch`. Provide a minimal real HTTP
 * implementation backed by node:http so `generatePodcastOnly` talks to the
 * ACTUAL local Ollama server (this is the point of the E2E test).
 */
if (typeof globalThis.fetch !== "function") {
  (globalThis as Record<string, unknown>).fetch = ((
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }
  ) =>
    new Promise<unknown>((resolve, reject) => {
      const u = new URL(url);
      const req = http.request(
        {
          hostname: u.hostname,
          port: u.port || 80,
          path: u.pathname + u.search,
          method: init?.method || "GET",
          headers: init?.headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const buf = Buffer.concat(chunks);
            resolve({
              ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
              status: res.statusCode,
              json: async () => JSON.parse(buf.toString("utf8")),
              text: async () => buf.toString("utf8"),
            });
          });
        }
      );
      if (init?.signal) {
        init.signal.addEventListener("abort", () => req.destroy(new Error("aborted")));
      }
      req.on("error", reject);
      if (init?.body) req.write(init.body);
      req.end();
    })) as typeof fetch;
}

const TTS_DIR = path.join(process.env["APPDATA"] || "", "com.studio.study", "tts");
const KAREEM = path.join(TTS_DIR, "ar_JO-kareem-medium.onnx");
const KAREEM_JSON = path.join(TTS_DIR, "ar_JO-kareem-medium.onnx.json");
const AUDIO_DIR = path.join(process.env["APPDATA"] || "", "com.studio.study", "audio");
const MP3_PATH = path.join(AUDIO_DIR, "intj-arabic-long-podcast.mp3");
const WAV_PATH = path.join(AUDIO_DIR, "intj-arabic-long-podcast.wav");

function runPiperLine(text: string, outWav: string): void {
  const input = path.join(os.tmpdir(), `study-studio-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(input, text, "utf8");
  const res = spawnSync(
    "piper",
    ["-m", KAREEM, "-c", KAREEM_JSON, "-i", input, "-f", outWav, "--sentence-silence", "0.35"],
    { encoding: "utf8", timeout: 300_000 }
  );
  try { fs.unlinkSync(input); } catch { /* ignore */ }
  if (res.status !== 0) {
    throw new Error(`piper failed: ${res.stderr || res.stdout || `exit ${res.status}`}`);
  }
}

function ffmpegConcatToMp3(segments: string[]): void {
  const listPath = path.join(os.tmpdir(), `study-studio-e2e-list-${Date.now()}.txt`);
  fs.writeFileSync(
    listPath,
    segments.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
    "utf8"
  );
  const concat = spawnSync(
    "ffmpeg",
    ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", WAV_PATH],
    { encoding: "utf8", timeout: 120_000 }
  );
  try { fs.unlinkSync(listPath); } catch { /* ignore */ }
  if (concat.status !== 0) {
    throw new Error(`ffmpeg concat failed: ${concat.stderr}`);
  }
  const mp3 = spawnSync(
    "ffmpeg",
    ["-y", "-i", WAV_PATH, "-codec:a", "libmp3lame", "-qscale:a", "2", MP3_PATH],
    { encoding: "utf8", timeout: 120_000 }
  );
  if (mp3.status !== 0) {
    throw new Error(`ffmpeg mp3 failed: ${mp3.stderr}`);
  }
}

describe("E2E: Arabic LONG podcast about INTJ -> saved MP3", () => {
  jest.setTimeout(1_200_000);

  if (!RUN) {
    test.skip("requires E2E_PODCAST=1 (run: $env:E2E_PODCAST='1')", () => {});
    return;
  }

  test("generates the script with qwen3:8b and saves an MP3", async () => {
    // Prereqs must be in place (voice model downloaded, tools on PATH).
    expect(fs.existsSync(KAREEM) && fs.existsSync(KAREEM_JSON)).toBe(true);
    const piperOk = spawnSync("piper", ["-h"], { encoding: "utf8" }).status !== null;
    expect(piperOk).toBe(true);
    const ffmpegOk = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status === 0;
    expect(ffmpegOk).toBe(true);

    const { podcastScript } = await generatePodcastOnly({
      topic: "شخصية INTJ",
      language: "ar",
      length: "long",
      difficulty: "intermediate",
      model: "qwen3:8b",
      voiceGenderA: "male",
      voiceGenderB: "female",
    });

    // "long" targets >= 24 exchanges — assert we got a genuinely long episode.
    expect(podcastScript.length).toBeGreaterThanOrEqual(24);
    const speakers = new Set(podcastScript.map((l) => l.speaker));
    expect(speakers.has("Host A")).toBe(true);
    expect(speakers.has("Host B")).toBe(true);

    // Persist the transcript next to the audio for inspection.
    const transcriptPath = path.join(AUDIO_DIR, "intj-arabic-long-podcast.txt");
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
    fs.writeFileSync(
      transcriptPath,
      podcastScript.map((l) => `${l.speaker}: ${l.text}`).join("\n\n"),
      "utf8"
    );

    // Synthesize each line with the Arabic piper voice, then join + encode.
    const segments: string[] = [];
    for (let i = 0; i < podcastScript.length; i++) {
      const seg = path.join(os.tmpdir(), `study-studio-e2e-seg-${Date.now()}-${i}.wav`);
      runPiperLine(podcastScript[i].text, seg);
      segments.push(seg);
    }
    ffmpegConcatToMp3(segments);
    for (const s of segments) {
      try { fs.unlinkSync(s); } catch { /* ignore */ }
    }

    // The requested artifact must exist on disk.
    expect(fs.existsSync(MP3_PATH)).toBe(true);
    const stat = fs.statSync(MP3_PATH);
    expect(stat.size).toBeGreaterThan(0);
    // MP3 magic header (ID3 or 0xFF frame sync).
    const head = fs.readFileSync(MP3_PATH);
    const isMp3 = head[0] === 0x49 || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
    expect(isMp3).toBe(true);

    // eslint-disable-next-line no-console
    console.log(`\nE2E MP3 SAVED: ${MP3_PATH} (${(stat.size / 1024 / 1024).toFixed(2)} MB, ${podcastScript.length} lines)\n`);
  });
});
