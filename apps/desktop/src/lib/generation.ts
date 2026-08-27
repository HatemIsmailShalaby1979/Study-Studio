// Shared lesson/podcast generation orchestration.
//
// This module is isomorphic: it runs on the server inside the old Next.js API
// route AND in the client bundle. All model I/O goes through the AI Runtime
// (`src/lib/ai-runtime`), which dispatches to the active provider (Tauri IPC
// inside the desktop shell, direct HTTP in a plain browser). This module is
// provider-agnostic — it never names a concrete backend.
import { ZodError } from "zod";
import { AppError, ErrorCode } from "./error";
import {
  validateGenerateLesson,
  validateLessonOutput,
  validatePodcastOutput,
  validateLessonOutline,
  validateLessonSectionBatch,
  validateGlossaryQuiz,
  validatePodcastTitle,
  validatePodcastChunk,
} from "./validation";
import {
  GLOSSARY_QUIZ_JSON_SCHEMA,
  LESSON_OUTLINE_JSON_SCHEMA,
  LESSON_OUTPUT_JSON_SCHEMA,
  LESSON_SECTIONS_BATCH_JSON_SCHEMA,
  PODCAST_CHUNK_JSON_SCHEMA,
  PODCAST_TITLE_JSON_SCHEMA,
} from "./validation";
import { aiRuntime, extractJsonFromResponse, repairJson } from "./ai-runtime";
import type { AIMessage } from "./ai-runtime";
import { skillInjector } from "./skills";

export interface GenerateRequest {
  topic?: string;
  content?: string;
  model?: string;
  difficulty?: string;
  format?: "html" | "audio" | "podcast" | "text";
  length?: "short" | "medium" | "long" | "comprehensive";
  /** Output language. "ar" enables Arabic + RTL; "en" is English. */
  language?: "ar" | "en";
  /** Voice gender for podcast Host A — "male" or "female". */
  voiceGenderA?: "male" | "female";
  /** Voice gender for podcast Host B — "male" or "female". */
  voiceGenderB?: "male" | "female";
  /** Overarching context from a Learning Journey, if generating inside one. */
  journeyContext?: string;
  /** Cancellation signal — aborts the generation at the next provider call. */
  signal?: AbortSignal;
}

/** Supported output language ids. */
export type LessonLanguage = "ar" | "en";

/**
 * Detect whether a string contains Arabic script (core block U+0600–U+06FF).
 * Mirrors the detection in `tts.rs::default_voice_for` so UI, generation, and
 * TTS all agree on what counts as "Arabic".
 */
export function detectLanguage(text: string): LessonLanguage {
  return /[\u0600-\u06FF]/.test(text ?? "") ? "ar" : "en";
}

export interface GeneratedLesson {
  title: string;
  sections: { heading: string; content: string }[];
  glossary: { term: string; definition: string }[];
  quiz: { question: string; options: string[]; correctIndex: number; explanation: string }[];
  podcastScript?: { speaker: "Host A" | "Host B"; text: string }[];
  htmlContent?: string | null;
  _model: string;
  _format?: "html" | "audio" | "podcast" | "text";
  _length?: "short" | "medium" | "long" | "comprehensive";
}

export function getLessonSystemPrompt(difficulty: string, language: LessonLanguage = "en"): string {
  const diff = difficulty || "intermediate";
  const depthMap: Record<string, string> = {
    beginner: `You are a world-class educator generating a THOROUGH, EDUCATIONAL lesson at BEGINNER level.

QUALITY STANDARD — ZERO TOLERANCE FOR SHALLOW CONTENT:
This lesson must be genuinely useful to a beginner. Every section must TEACH, not just list facts. A beginner should be able to learn the topic from this lesson alone.

STRUCTURAL REQUIREMENTS:
- 6-8 sections, each with a clear heading and 200-400 words of substantive content
- Every concept must be explained from first principles with real-world analogies
- Use simple language, avoid jargon, define every term before using it
- Include concrete examples, everyday comparisons, and step-by-step explanations
- Each section must build on the previous one — progressive complexity
- Do NOT write surface-level summaries. Explain MECHANISMS, not just outcomes.

CONTENT DEPTH REQUIREMENTS:
- For each concept: explain WHAT it is, WHY it matters, HOW it works, and WHERE it applies
- Include at least one concrete example or analogy per section
- Connect abstract ideas to real-world situations the learner can relate to
- If the topic has history, briefly cover how it developed

QUIZ REQUIREMENTS (6-10 questions):
- Each question must have EXACTLY 4 options (A, B, C, D)
- Test fundamental understanding: "What is X?", "Which of these is Y?", "Why does Z happen?"
- Each explanation must be 2-3 sentences explaining WHY the correct answer is correct
- Wrong answers must be plausible but clearly incorrect upon understanding

GLOSSARY REQUIREMENTS (8-12 terms):
- Every term must have a clear, precise definition (2-3 sentences)
- Include terms that a beginner would need to look up`,

    intermediate: `You are a world-class expert educator generating a COMPREHENSIVE, IN-DEPTH lesson at INTERMEDIATE level.

QUALITY STANDARD — ZERO TOLERANCE FOR SURFACE CONTENT:
This lesson must go beyond textbook descriptions. Every section must provide ANALYSIS, not just description. An intermediate learner should gain genuine insight, not just facts they could Google.

STRUCTURAL REQUIREMENTS:
- 8-12 sections, each with a clear heading and 300-500 words of substantive content
- Use precise technical language, assume basic familiarity with the domain
- Include concrete examples, case studies, real-world applications, and data
- Each section must have depth — analyze CAUSES, compare APPROACHES, evaluate TRADE-OFFS
- Cover cause-and-effect relationships, comparisons, and practical implications
- Include numbers, statistics, named examples, or specific methodologies where relevant

CONTENT DEPTH REQUIREMENTS:
- For each concept: explain the MECHANISM, not just the definition
- Compare at least two approaches, frameworks, or perspectives where relevant
- Include specific data, statistics, or named examples — not vague generalizations
- Address common misconceptions and explain why they are wrong
- Connect theory to practice: when would someone actually use this?

QUIZ REQUIREMENTS (8-12 questions):
- Each question must have EXACTLY 4 options (A, B, C, D)
- Test APPLICATION and ANALYSIS: "How would you apply X?", "What happens when Y?", "Compare A and B"
- Each explanation must be 3-4 sentences explaining the reasoning
- Wrong answers must be plausible misconceptions
- Mix question types: scenario-based, comparison, cause-effect, application

GLOSSARY REQUIREMENTS (10-15 terms):
- Every term must have a precise definition with context (3-4 sentences)
- Include technical terms, their relationships, and practical significance`,

    expert: `You are a world-renowned authority generating a RIGOROUS, COMPREHENSIVE lesson at EXPERT level.

QUALITY STANDARD — ZERO TOLERANCE FOR TEXTBOOK SUMMARIES:
This lesson must provide genuine expert insight. Every section must offer analysis that goes beyond what a standard reference would cover. An expert reading this should encounter new perspectives, nuanced distinctions, or deeper connections.

STRUCTURAL REQUIREMENTS:
- 10-15 sections, each with a clear heading and 400-700 words of substantive content
- Use advanced technical language, assume deep domain knowledge
- Include research references, named studies, specific methodologies, and named experts
- Cover edge cases, controversies, competing frameworks, and unresolved questions
- Each section must provide genuine insight — not textbook summaries
- Include comparative analysis, theoretical frameworks, and practical implications
- Reference specific papers, authors, or landmark studies where relevant
- Cover historical development, current state, and future directions

CONTENT DEPTH REQUIREMENTS:
- Analyze WHY certain approaches succeeded or failed — not just that they did
- Identify tensions, trade-offs, and open questions in the field
- Connect across subdomains: how does this relate to X in adjacent fields?
- Include specific named researchers, institutions, or landmark studies
- Address the limits of current knowledge — what don't we know yet?

QUIZ REQUIREMENTS (10-15 questions):
- Each question must have EXACTLY 4 options (A, B, C, D)
- Test SYNTHESIS and EVALUATION: "Which framework best explains X?", "Critique the approach of Y", "What are the implications of Z for W?"
- Each explanation must be 3-5 sentences with nuanced reasoning
- Wrong answers must be sophisticated — partial truths or common expert misconceptions
- Include questions that require connecting concepts across sections

GLOSSARY REQUIREMENTS (12-20 terms):
- Every term must have a rigorous definition with theoretical context (3-5 sentences)
- Include advanced terminology, niche concepts, and their theoretical foundations`,

    comprehensive: `You are a world-renowned authority generating the DEFINITIVE reference lesson. This must be the most thorough, comprehensive treatment of the topic possible — the kind of content that becomes a canonical reference.

QUALITY STANDARD — ZERO TOLERANCE FOR ANY SHALLOW CONTENT:
Every section must be a mini-essay with genuine depth. This is not a summary — it is an exhaustive analysis. If a section could be written by someone who only read the Wikipedia article, it is not good enough.

STRUCTURAL REQUIREMENTS:
- 12-18 sections, each with a clear heading and 500-800 words of substantive content
- This is an EXHAUSTIVE treatment — cover every angle, every subtopic, every nuance
- Use advanced technical language, assume deep domain knowledge
- Include research references, named studies, specific methodologies, named experts, and landmark papers
- Cover: history, theory, practice, case studies, edge cases, controversies, competing frameworks
- Each section must be a mini-essay — deep analysis, not surface summaries
- Include comparative analysis, theoretical frameworks, practical implications, and future directions
- Reference specific papers, authors, named experiments, and real-world implementations
- Include data, statistics, named examples, and concrete evidence
- Cover beginner foundations through advanced applications — build complexity progressively

CONTENT DEPTH REQUIREMENTS:
- Every section must include: mechanism analysis, named examples, comparison of approaches, and practical implications
- Address unresolved questions and ongoing debates in the field
- Connect to adjacent disciplines and broader theoretical frameworks
- Include specific case studies with named organizations, researchers, or events
- Identify the boundaries of current knowledge and future research directions

QUIZ REQUIREMENTS (12-18 questions):
- Each question must have EXACTLY 4 options (A, B, C, D)
- Test HIGHER-ORDER THINKING: synthesis across sections, evaluation of claims, application to novel scenarios
- Questions must require understanding the FULL lesson, not just one section
- Each explanation must be 4-6 sentences with deep, nuanced reasoning
- Wrong answers must be plausible to someone who studied the material but missed key distinctions
- Include scenario-based questions, comparative analysis, and "what if" extensions

GLOSSARY REQUIREMENTS (15-25 terms):
- Every term must have a comprehensive definition with theoretical and practical context (4-6 sentences)
- Include advanced terminology, niche concepts, competing definitions, and their relationships
- Cover the full spectrum from foundational to cutting-edge terms`,
  };

  const arabicInstruction =
    language === "ar"
      ? `\n\nCRITICAL: Generate the ENTIRE lesson in Modern Standard Arabic (الفصحى). ` +
        `The title, every section heading, every section body, every glossary term AND its definition, ` +
        `every quiz question, every option, and every explanation MUST be in Arabic. ` +
        `Do NOT use English anywhere except unavoidable technical terms in parentheses. ` +
        `The JSON keys (title, sections, glossary, quiz, heading, content, term, definition, question, options, correctIndex, explanation) ` +
        `must remain in English; only the VALUES are Arabic.\n`
      : "";

  return skillInjector.apply(`${depthMap[diff] || depthMap['intermediate']}

${arabicInstruction}

OUTPUT FORMAT — Respond ONLY with valid JSON, no markdown wrapping, no extra text:

{
  "title": "Lesson Title",
  "sections": [
    { "heading": "Section Heading", "content": "Detailed, substantive paragraph content..." }
  ],
  "glossary": [
    { "term": "Key Term", "definition": "Precise, clear definition with context" }
  ],
  "quiz": [
    { "question": "Challenging question testing real understanding?", "options": ["Option A text", "Option B text", "Option C text", "Option D text"], "correctIndex": 0, "explanation": "Detailed explanation of why this is correct and why other options are wrong" }
  ]
}`);
}

export function getPodcastSystemPrompt(
  difficulty: string,
  language: LessonLanguage = "en",
  voiceGenderA: "male" | "female" = "male",
  voiceGenderB: "male" | "female" = "female"
): string {
  const diff = difficulty || "intermediate";

  // Gender-aware name suggestions for the hosts
  const maleNames = language === "ar"
    ? ["أحمد", "محمد", "خالد", "عمر", "يوسف", "حسن", "إبراهيم", "صالح"]
    : ["James", "David", "Michael", "Robert", "Daniel", "Thomas", "Alexander", "Marcus"];
  const femaleNames = language === "ar"
    ? ["فاطمة", "خديجة", "نورة", "سارة", "ليلى", "ريم", "هدى", "منى"]
    : ["Sarah", "Emily", "Jessica", "Amanda", "Nicole", "Elizabeth", "Victoria", "Claire"];

  const hostAName = voiceGenderA === "male" ? maleNames[0] : femaleNames[0];
  const hostBName = voiceGenderB === "male" ? maleNames[1] : femaleNames[1];
  const hostAPronoun = voiceGenderA === "male" ? "he" : "she";
  const hostBPronoun = voiceGenderB === "male" ? "he" : "she";

  const depthMap: Record<string, string> = {
    beginner: `You are an expert podcast script writer generating a RICH, THOROUGH two-host conversational podcast at BEGINNER level.

QUALITY STANDARD — ZERO TOLERANCE FOR FILLER:
Every exchange must advance the discussion. No "absolutely!", "great point!", or empty agreements. Each line must contain SUBSTANTIVE content — explanations, examples, questions that deepen understanding.

HOSTS: Host A is ${hostAName} (${voiceGenderA}), Host B is ${hostBName} (${voiceGenderB}).
Use their names naturally in the conversation — introductions, transitions, and when one addresses the other.
The hosts' genders MUST match their voices: Host A's voice is ${voiceGenderA}, Host B's voice is ${voiceGenderB}.
Do NOT use female names for a male voice or male names for a female voice.

STRUCTURAL REQUIREMENTS:
- At least 20-30 exchanges (40-60 dialogue lines)
- Each exchange: 3-6 sentences of natural, substantive dialogue
- Host A (${hostAName}) explains concepts from first principles with analogies
- Host B (${hostBName}) asks naive but insightful questions, makes connections
- Cover ALL aspects of the topic progressively
- Build complexity gradually — start simple, end comprehensive
- Include real-world examples, everyday comparisons, and memorable analogies
- The conversation must TEACH — a listener should learn the topic by the end
- Each exchange must introduce NEW information — no repeating the same point differently`,

    intermediate: `You are an expert podcast script writer generating a RICH, THOROUGH two-host conversational podcast at INTERMEDIATE level.

QUALITY STANDARD — ZERO TOLERANCE FOR SURFACE DIALOGUE:
Every exchange must provide genuine analysis. The hosts should DEBATE, COMPARE, and EVALUATE — not just take turns explaining. Challenge assumptions, present counterpoints, draw unexpected connections.

HOSTS: Host A is ${hostAName} (${voiceGenderA}), Host B is ${hostBName} (${voiceGenderB}).
Use their names naturally in the conversation. The hosts' genders MUST match their voices.
Do NOT use female names for a male voice or male names for a female voice.

STRUCTURAL REQUIREMENTS:
- At least 25-35 exchanges (50-70 dialogue lines)
- Each exchange: 3-6 sentences of natural, substantive dialogue
- Host A (${hostAName}) provides deep, analytical explanations with examples
- Host B (${hostBName}) challenges, synthesizes, and draws connections
- Include case studies, specific examples, and data
- Cover theoretical foundations and practical applications
- The conversation must have intellectual depth — not surface summaries
- Hosts should disagree respectfully and explore why different perspectives exist`,

    expert: `You are an expert podcast script writer generating a RICH, THOROUGH two-host conversational podcast at EXPERT level.

QUALITY STANDARD — ZERO TOLERANCE FOR GENERIC EXPERT TALK:
The hosts must demonstrate genuine expertise — cite specific research, name particular studies, reference real-world implementations. The conversation should feel like two specialists having a deep, nuanced discussion, not two people reciting textbook content.

HOSTS: Host A is ${hostAName} (${voiceGenderA}), Host B is ${hostBName} (${voiceGenderB}).
Use their names naturally in the conversation. The hosts' genders MUST match their voices.
Do NOT use female names for a male voice or male names for a female voice.

STRUCTURAL REQUIREMENTS:
- At least 30-45 exchanges (60-90 dialogue lines)
- Each exchange: 3-6 sentences of natural, substantive dialogue
- Host A (${hostAName}) delivers rigorous analysis with research references
- Host B (${hostBName}) debates, extends with counterpoints, introduces nuance
- Include named studies, specific methodologies, competing frameworks
- Cover edge cases, controversies, and unresolved questions
- The conversation must demonstrate genuine expertise
- Reference specific researchers, institutions, and landmark papers`,

    comprehensive: `You are an expert podcast script writer generating the DEFINITIVE two-host conversational podcast at COMPREHENSIVE level.

QUALITY STANDARD — ZERO TOLERANCE FOR ANY SHALLOW EXCHANGE:
This must be the definitive conversation on the topic. Every exchange must provide depth that a learner would not find elsewhere. The hosts should cover history, theory, practice, controversies, and future directions — with specific references and genuine analytical depth.

HOSTS: Host A is ${hostAName} (${voiceGenderA}), Host B is ${hostBName} (${voiceGenderB}).
Use their names naturally throughout — introductions, transitions, when addressing each other.
The hosts' genders MUST match their voices: Host A's voice is ${voiceGenderA}, Host B's voice is ${voiceGenderB}.
Do NOT use female names for a male voice or male names for a female voice.

STRUCTURAL REQUIREMENTS:
- At least 40-60 exchanges (80-120 dialogue lines)
- Each exchange: 4-8 sentences of natural, substantive dialogue
- Host A (${hostAName}) provides exhaustive, authoritative analysis
- Host B (${hostBName}) challenges, extends, synthesizes, and introduces novel angles
- Include named studies, specific data, real-world implementations, historical context
- Cover: history, theory, practice, case studies, edge cases, controversies, future directions
- The conversation must be a MASTERCLASS — the definitive treatment of the topic
- Reference specific papers, researchers, and real-world implementations by name`,
  };

  const arabicInstruction =
    language === "ar"
      ? `\n\nCRITICAL: Generate the ENTIRE podcast script in Modern Standard Arabic (الفصحى). ` +
        `The title, every spoken line, every glossary term and definition, every quiz question, option, and explanation ` +
        `MUST be in Arabic. Keep the speaker labels "Host A" / "Host B" in English (they are JSON values used for formatting). ` +
        `The JSON keys must remain in English; only the human-readable VALUES are Arabic.\n`
      : "";

  return skillInjector.apply(`${depthMap[diff] || depthMap['intermediate']}

${arabicInstruction}

Each exchange should advance the discussion — no filler, no repetition. Cover the topic from introduction through depth.

Include glossary (10-20 terms) and quiz (8-12 questions, each with EXACTLY 4 options) as well.

Respond ONLY with valid JSON, no markdown wrapping:

{
  "title": "Podcast Title",
  "podcastScript": [
    { "speaker": "Host A", "text": "${hostAName}: Welcome to our in-depth discussion about..." },
    { "speaker": "Host B", "text": "${hostBName}: That's a great starting point! Let me ask you..." }
  ],
  "glossary": [
    { "term": "Key Term", "definition": "Clear definition" }
  ],
  "quiz": [
    { "question": "Question text?", "options": ["Option A", "Option B", "Option C", "Option D"], "correctIndex": 0, "explanation": "Why this is correct and others are wrong" }
  ]
}`);
}

/**
 * Build a rich, interactive standalone HTML export of a lesson.
 *
 * Features: dark theme, navigation sidebar, expandable sections, interactive
 * quiz with scoring and explanations, glossary grid, progress bar, RTL support.
 * The output is a single self-contained HTML file with no external dependencies.
 */
export function generateHTML(lesson: GeneratedLesson): string {
  const lang: LessonLanguage = detectLanguage(
    `${lesson.title ?? ""} ${(lesson.sections ?? []).map((s) => s.heading + " " + s.content).join(" ")}`
  );
  const isRtl = lang === "ar";

  const ui = {
    en: {
      untitled: "Untitled Lesson",
      glossary: "Glossary",
      quiz: "Knowledge Check",
      nav: "Navigation",
      sections: "Sections",
      expand: "Expand",
      collapse: "Collapse",
      submit: "Submit Answers",
      score: "Score",
      correct: "Correct!",
      incorrect: "Incorrect",
      explanation: "Explanation",
      progress: "Progress",
      questions: "questions",
      showAll: "Show All",
      hideAll: "Hide All",
      generatedBy: "Generated by Study Studio",
    },
    ar: {
      untitled: "درس بدون عنوان",
      glossary: "المصطلحات",
      quiz: "اختبر معلوماتك",
      nav: "التنقل",
      sections: "الأقسام",
      expand: "توسيع",
      collapse: "طي",
      submit: "إرسال الإجابات",
      score: "النتيجة",
      correct: "صحيح!",
      incorrect: "خطأ",
      explanation: "التوضيح",
      progress: "التقدم",
      questions: "أسئلة",
      showAll: "عرض الكل",
      hideAll: "إخفاء الكل",
      generatedBy: "تم إنشاؤه بواسطة Study Studio",
    },
  }[lang];

  const dirAttr = isRtl ? ' dir="rtl"' : "";
  const langAttr = `lang="${lang}"`;

  const sectionsJson = JSON.stringify(lesson.sections ?? []);
  const glossaryJson = JSON.stringify(lesson.glossary ?? []);
  const quizJson = JSON.stringify(lesson.quiz ?? []);

  return `<!DOCTYPE html>
<html ${langAttr}${dirAttr}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${lesson.title || ui.untitled}</title>
<style>
:root {
  --bg: #070b14; --surface: #0c1220; --elevated: #111a2e;
  --card: rgba(255,255,255,0.04); --border: rgba(255,255,255,0.08);
  --border-hover: rgba(255,255,255,0.18);
  --text: #f5f7ff; --text-secondary: #c8d2ff; --text-muted: #8692b1;
  --accent: #7c8bff; --accent-glow: rgba(124,139,255,0.25);
  --green: #4ade80; --red: #f87171; --amber: #fbbf24;
  --gradient: linear-gradient(135deg, #7c8bff 0%, #a78bfa 50%, #ff9f7c 100%);
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: var(--bg); color: var(--text); line-height: 1.7; overflow-x: hidden;
}
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: var(--bg); }
::-webkit-scrollbar-thumb { background: var(--accent); border-radius: 3px; }

/* NAV SIDEBAR */
.sidebar {
  position: fixed; top: 0; ${isRtl ? 'right' : 'left'}: 0; width: 280px; height: 100vh;
  background: var(--surface); border-${isRtl ? 'left' : 'right'}: 1px solid var(--border);
  padding: 24px 16px; overflow-y: auto; z-index: 100;
  display: flex; flex-direction: column; gap: 6px;
}
.sidebar-title {
  font-size: 1.1rem; font-weight: 800; letter-spacing: -0.01em;
  background: var(--gradient); -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; margin-bottom: 12px; padding: 0 8px;
}
.sidebar-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted); font-weight: 700; padding: 8px 8px 4px; }
.sidebar a {
  display: block; padding: 8px 12px; border-radius: 10px; text-decoration: none;
  color: var(--text-secondary); font-size: 0.85rem; font-weight: 500;
  transition: all .2s; border: 1px solid transparent;
}
.sidebar a:hover { background: var(--card); border-color: var(--border); color: var(--text); }
.sidebar a.active { background: var(--accent-glow); color: var(--accent); border-color: var(--accent); font-weight: 700; }
.sidebar a.q-link { padding-left: 24px; font-size: 0.8rem; }

/* MAIN */
.main { margin-${isRtl ? 'right' : 'left'}: 280px; padding: 40px 48px 80px; max-width: 900px; }

/* PROGRESS */
.progress-bar { position: fixed; top: 0; ${isRtl ? 'right' : 'left'}: 280px; right: 0; height: 3px; z-index: 200; background: var(--surface); }
.progress-fill { height: 100%; background: var(--gradient); width: 0; transition: width .3s ease; }

/* HERO */
.hero { margin-bottom: 48px; }
.hero h1 { font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800; letter-spacing: -0.02em; margin-bottom: 12px; }
.hero .meta { color: var(--text-muted); font-size: 0.85rem; display: flex; gap: 16px; flex-wrap: wrap; }
.hero .badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 999px; border: 1px solid var(--border); background: var(--card); font-size: 0.78rem; }

/* SECTION CARDS */
.section-card {
  background: var(--card); border: 1px solid var(--border); border-radius: 16px;
  margin-bottom: 16px; overflow: hidden; transition: border-color .2s;
}
.section-card:hover { border-color: var(--border-hover); }
.section-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 18px 22px; cursor: pointer; user-select: none;
}
.section-header h2 { font-size: 1.1rem; font-weight: 700; }
.section-header .toggle {
  width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--border);
  background: var(--card); color: var(--text-muted); display: flex; align-items: center;
  justify-content: center; font-size: 0.8rem; transition: all .2s; flex-shrink: 0;
}
.section-card.open .toggle { background: var(--accent-glow); color: var(--accent); border-color: var(--accent); transform: rotate(180deg); }
.section-body { padding: 0 22px 20px; color: var(--text-secondary); font-size: 0.95rem; display: none; }
.section-card.open .section-body { display: block; }

/* GLOSSARY */
.glossary-section { margin-top: 48px; }
.glossary-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.glossary-item {
  background: var(--card); border: 1px solid var(--border); border-radius: 14px;
  padding: 18px 20px; transition: transform .2s, border-color .2s;
}
.glossary-item:hover { transform: translateY(-2px); border-color: var(--accent); }
.glossary-item dt { font-weight: 700; color: var(--accent); font-size: 0.95rem; margin-bottom: 6px; }
.glossary-item dd { color: var(--text-secondary); font-size: 0.88rem; }

/* QUIZ */
.quiz-section { margin-top: 48px; }
.quiz-question {
  background: var(--card); border: 1px solid var(--border); border-radius: 16px;
  padding: 22px; margin-bottom: 14px; transition: border-color .2s;
}
.quiz-question .q-num {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 8px; background: var(--accent-glow);
  color: var(--accent); font-weight: 700; font-size: 0.82rem; margin-right: 10px;
}
.quiz-question .q-text { font-weight: 600; font-size: 0.95rem; }
.quiz-options { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
.quiz-opt {
  display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-radius: 12px;
  border: 1px solid var(--border); background: var(--surface); cursor: pointer;
  transition: all .2s; font-size: 0.9rem;
}
.quiz-opt:hover { border-color: var(--accent); background: rgba(124,139,255,0.06); }
.quiz-opt.selected { border-color: var(--accent); background: var(--accent-glow); }
.quiz-opt.correct { border-color: var(--green); background: rgba(74,222,128,0.1); }
.quiz-opt.incorrect { border-color: var(--red); background: rgba(248,113,113,0.1); }
.quiz-opt .letter {
  width: 26px; height: 26px; border-radius: 7px; display: flex; align-items: center;
  justify-content: center; font-weight: 700; font-size: 0.78rem; flex-shrink: 0;
  background: var(--card); border: 1px solid var(--border); color: var(--text-muted);
}
.quiz-opt.selected .letter { background: var(--accent); color: #070b14; border-color: var(--accent); }
.quiz-opt.correct .letter { background: var(--green); color: #070b14; border-color: var(--green); }
.quiz-opt.incorrect .letter { background: var(--red); color: #070b14; border-color: var(--red); }
.quiz-explanation {
  margin-top: 12px; padding: 14px 16px; border-radius: 10px; font-size: 0.88rem;
  border: 1px solid; display: none;
}
.quiz-explanation.show { display: block; }
.quiz-explanation.correct-exp { border-color: rgba(74,222,128,0.3); background: rgba(74,222,128,0.06); color: var(--text-secondary); }
.quiz-explanation.incorrect-exp { border-color: rgba(248,113,113,0.3); background: rgba(248,113,113,0.06); color: var(--text-secondary); }

/* SCORE BAR */
.score-bar {
  background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
  padding: 18px 22px; display: flex; align-items: center; gap: 16px; margin-bottom: 20px;
}
.score-bar .score-num { font-size: 2rem; font-weight: 800; background: var(--gradient); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.score-bar .score-label { color: var(--text-muted); font-size: 0.85rem; }

/* BUTTONS */
.btn-submit {
  background: var(--gradient); color: #070b14; border: none; padding: 14px 28px;
  border-radius: 12px; font-weight: 700; font-size: 0.95rem; cursor: pointer;
  font-family: inherit; transition: transform .15s, box-shadow .15s;
  box-shadow: 0 8px 30px var(--accent-glow);
}
.btn-submit:hover { transform: translateY(-2px); box-shadow: 0 12px 40px var(--accent-glow); }

/* FOOTER */
.footer { margin-top: 60px; padding-top: 24px; border-top: 1px solid var(--border); text-align: center; color: var(--text-muted); font-size: 0.82rem; }

@media (max-width: 900px) {
  .sidebar { display: none; }
  .main { margin-left: 0 !important; margin-right: 0 !important; padding: 24px 20px 60px; }
  .progress-fill { left: 0 !important; right: 0 !important; }
}
</style>
</head>
<body>

<div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>

<nav class="sidebar" id="sidebar">
  <div class="sidebar-title">${(lesson.title || ui.untitled).replace(/</g, "&lt;")}</div>
  <div class="sidebar-label">${ui.sections}</div>
  <div id="navSections"></div>
  ${lesson.glossary?.length ? `<div class="sidebar-label" style="margin-top:12px">${ui.glossary}</div><a href="#glossary">${ui.glossary} (${lesson.glossary.length})</a>` : ""}
  ${lesson.quiz?.length ? `<div class="sidebar-label" style="margin-top:12px">${ui.quiz}</div><a href="#quiz">${ui.quiz} (${lesson.quiz.length} ${ui.questions})</a>` : ""}
</nav>

<div class="main">
  <div class="hero">
    <h1>${(lesson.title || ui.untitled).replace(/</g, "&lt;")}</h1>
    <div class="meta">
      <span class="badge">📚 ${lesson.sections?.length ?? 0} ${ui.sections}</span>
      <span class="badge">📖 ${lesson.glossary?.length ?? 0} ${ui.glossary}</span>
      <span class="badge">❓ ${lesson.quiz?.length ?? 0} ${ui.questions}</span>
    </div>
  </div>

  <div id="sectionsContainer"></div>

  ${lesson.glossary?.length ? `
  <div class="glossary-section" id="glossary">
    <h2 style="font-size:1.3rem;font-weight:800;margin-bottom:18px">${ui.glossary}</h2>
    <dl class="glossary-grid" id="glossaryGrid"></dl>
  </div>` : ""}

  ${lesson.quiz?.length ? `
  <div class="quiz-section" id="quiz">
    <h2 style="font-size:1.3rem;font-weight:800;margin-bottom:18px">${ui.quiz}</h2>
    <div class="score-bar" id="scoreBar" style="display:none">
      <div class="score-num" id="scoreNum">0%</div>
      <div><div class="score-label" id="scoreLabel">${ui.score}</div></div>
    </div>
    <div id="quizContainer"></div>
    <button class="btn-submit" id="submitBtn" style="margin-top:18px">${ui.submit}</button>
  </div>` : ""}

  <div class="footer">${ui.generatedBy} &middot; ${new Date().toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", { year: "numeric", month: "long", day: "numeric" })}</div>
</div>

<script>
(function() {
  var sections = ${sectionsJson};
  var glossary = ${glossaryJson};
  var quiz = ${quizJson};
  var lang = "${lang}";
  var ui = ${JSON.stringify(ui)};
  var answered = {};
  var selected = {};

  // Render sections
  var container = document.getElementById("sectionsContainer");
  var navContainer = document.getElementById("navSections");
  sections.forEach(function(s, i) {
    var id = "section-" + i;
    var card = document.createElement("div");
    card.className = "section-card open";
    card.id = id;
    card.innerHTML = '<div class="section-header" onclick="toggleSection(' + i + ')">' +
      '<h2>' + escHtml(s.heading) + '</h2>' +
      '<div class="toggle">' + (lang === "ar" ? "▲" : "▲") + '</div></div>' +
      '<div class="section-body"><p>' + escHtml(s.content) + '</p></div>';
    container.appendChild(card);

    var link = document.createElement("a");
    link.href = "#" + id;
    link.textContent = s.heading;
    link.className = "nav-link";
    navContainer.appendChild(link);
  });

  // Render glossary
  if (glossary.length) {
    var gGrid = document.getElementById("glossaryGrid");
    glossary.forEach(function(g) {
      var item = document.createElement("div");
      item.className = "glossary-item";
      item.innerHTML = "<dt>" + escHtml(g.term) + "</dt><dd>" + escHtml(g.definition) + "</dd>";
      gGrid.appendChild(item);
    });
  }

  // Render quiz
  if (quiz.length) {
    var qContainer = document.getElementById("quizContainer");
    var letters = ["A", "B", "C", "D"];
    quiz.forEach(function(q, qi) {
      var qDiv = document.createElement("div");
      qDiv.className = "quiz-question";
      qDiv.id = "quiz-q-" + qi;
      var optsHtml = q.options.map(function(o, oi) {
        return '<div class="quiz-opt" data-q="' + qi + '" data-o="' + oi + '" onclick="selectOpt(' + qi + ',' + oi + ')">' +
          '<div class="letter">' + letters[oi] + '</div><div>' + escHtml(o) + '</div></div>';
      }).join("");
      qDiv.innerHTML = '<div><span class="q-num">' + (qi + 1) + '</span><span class="q-text">' + escHtml(q.question) + '</span></div>' +
        '<div class="quiz-options">' + optsHtml + '</div>' +
        '<div class="quiz-explanation" id="exp-' + qi + '">' + escHtml(q.explanation) + '</div>';
      qContainer.appendChild(qDiv);
    });

    document.getElementById("submitBtn").addEventListener("click", submitQuiz);
  }

  // Toggle section
  window.toggleSection = function(i) {
    var card = document.getElementById("section-" + i);
    card.classList.toggle("open");
  };

  // Select quiz option
  window.selectOpt = function(qi, oi) {
    if (answered[qi]) return;
    selected[qi] = oi;
    var opts = document.querySelectorAll('[data-q="' + qi + '"]');
    opts.forEach(function(o) { o.classList.remove("selected"); });
    opts[oi].classList.add("selected");
  };

  // Submit quiz
  function submitQuiz() {
    var correct = 0;
    quiz.forEach(function(q, qi) {
      answered[qi] = true;
      var opts = document.querySelectorAll('[data-q="' + qi + '"]');
      opts.forEach(function(o) {
        var oIdx = parseInt(o.getAttribute("data-o"));
        o.style.cursor = "default";
        if (oIdx === q.correctIndex) o.classList.add("correct");
        else if (oIdx === selected[qi] && selected[qi] !== q.correctIndex) o.classList.add("incorrect");
        o.classList.remove("selected");
      });
      var exp = document.getElementById("exp-" + qi);
      exp.classList.add("show");
      if (selected[qi] === q.correctIndex) { correct++; exp.classList.add("correct-exp"); }
      else exp.classList.add("incorrect-exp");
    });
    var pct = Math.round((correct / quiz.length) * 100);
    var scoreBar = document.getElementById("scoreBar");
    scoreBar.style.display = "flex";
    document.getElementById("scoreNum").textContent = pct + "%";
    document.getElementById("scoreLabel").textContent = correct + " / " + quiz.length + " " + (lang === "ar" ? "صحيح" : "correct");
    document.getElementById("submitBtn").style.display = "none";
  }

  // Progress bar
  window.addEventListener("scroll", function() {
    var h = document.documentElement.scrollHeight - window.innerHeight;
    var pct = h > 0 ? (window.scrollY / h) * 100 : 0;
    document.getElementById("progressFill").style.width = pct + "%";
    // Active nav link
    var sections2 = document.querySelectorAll(".section-card");
    var links = document.querySelectorAll(".nav-link");
    var current = 0;
    sections2.forEach(function(s, i) {
      if (window.scrollY >= s.offsetTop - 120) current = i;
    });
    links.forEach(function(l, i) { l.classList.toggle("active", i === current); });
  });

  function escHtml(t) { var d = document.createElement("div"); d.textContent = t; return d.innerHTML; }
})();
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Layer 1+2: structured-output chat with JSON repair fallback
// ---------------------------------------------------------------------------

/** Same-model retry budget for recoverable (transient/JSON) failures. */
const MAX_SAME_MODEL_RETRIES = 3;

/** Base delay (ms) for exponential backoff between same-model retries. */
const RETRY_BACKOFF_MS = 1000;

/** Backoff delay for a given retry attempt (attempt is 1-based). */
function retryBackoffDelay(attempt: number): number {
  // Overridable via env (used by tests to avoid sleeping).
  const configured = Number(process.env["STUDIO_STUDIO_RETRY_BACKOFF_MS"]);
  const base = Number.isFinite(configured) && configured >= 0 ? configured : RETRY_BACKOFF_MS;
  return base * attempt;
}

/**
 * Single structured-output request (Layer 1): ask the model for JSON constrained
 * by a JSON Schema via the runtime's `format` option. Falls back to the JSON
 * repair pass (Layer 2) for servers that ignore `format`.
 */
async function chatForJson(
  modelId: string,
  messages: AIMessage[],
  schema: unknown,
  numPredict: number,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const numCtx = numPredict > 16384 ? 65536 : numPredict > 8192 ? 32768 : 24576;
  const rawContent = await aiRuntime.chat(
    messages,
    { maxTokens: numPredict, numContext: numCtx, temperature: 0.7, format: schema, signal },
    modelId
  );
  const jsonStr = extractJsonFromResponse(rawContent);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    parsed = JSON.parse(repairJson(jsonStr));
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON parse validation failed: expected an object");
  }
  return parsed as Record<string, unknown>;
}

/**
 * Run `fn` (a single generation attempt) retrying the SAME model on
 * recoverable failures. Recoverable failures are content-shaped (bad JSON,
 * truncated output, schema mismatch) and are far more likely to succeed with
 * a same-model retry than a switch. Fatal/model-missing errors throw at once.
 */
async function retrySameModel<T>(
  modelId: string,
  fn: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (e) {
      if (signal?.aborted) throw e;
      const kind = classifyGenerationError(e);
      if (kind === "recoverable" && attempt < MAX_SAME_MODEL_RETRIES) {
        attempt += 1;
        console.warn(
          `[generation] Model ${modelId} returned recoverable error (attempt ${attempt}/${MAX_SAME_MODEL_RETRIES}); retrying same model.`,
          e instanceof Error ? e.message : e
        );
        // Back off before retrying so a busy server / freshly loading model has
        // time to settle. Recoverable content errors (bad JSON) also benefit
        // from a short pause to avoid hammering the server.
        await new Promise((resolve) => setTimeout(resolve, retryBackoffDelay(attempt)));
        continue;
      }
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// Lesson — one-shot direct path (fast; covers most lessons)
// ---------------------------------------------------------------------------

/** Token cap for a one-shot lesson JSON attempt, scaled by requested length. */
function lessonMaxTokens(inputLen: number, length?: string): number {
  const lengthMap: Record<string, number> = {
    short: 12288,
    medium: 24576,
    long: 32768,
    comprehensive: 49152,
  };
  return lengthMap[length || "medium"] || 24576;
}

/**
 * Direct one-shot lesson generation: the whole `{title, sections, glossary,
 * quiz}` in a single structured-output call. Fast when it works; the chunked
 * path is the fallback for long/comprehensive lessons that exceed the
 * one-shot budget.
 */
async function tryGenerateLessonOnce(
  modelId: string,
  systemMessage: string,
  userPrompt: string,
  length?: string,
  signal?: AbortSignal
): Promise<GeneratedLesson> {
  const inputLen = userPrompt.length + systemMessage.length;
  const messages: AIMessage[] = [
    { role: "system", content: systemMessage },
    { role: "user", content: userPrompt },
  ];
  const parsed = await chatForJson(modelId, messages, LESSON_OUTPUT_JSON_SCHEMA, lessonMaxTokens(inputLen, length), signal);
  return validateLessonOutput(parsed) as GeneratedLesson;
}

// ---------------------------------------------------------------------------
// Lesson — chunked fallback path (Layer 3)
// ---------------------------------------------------------------------------

/** How many outline headings each section-content request covers. */
const LESSON_SECTION_BATCH_SIZE = 1;
/** Cap on characters of source material fed into each chunk request. */
const MAX_SOURCE_CHARS = 6000;

function trimSource(userPrompt: string): string {
  return userPrompt.length > MAX_SOURCE_CHARS
    ? `${userPrompt.slice(0, MAX_SOURCE_CHARS)}\n\n[study material truncated for this step]`
    : userPrompt;
}

function lessonOutlineSystemPrompt(difficulty: string, language: LessonLanguage): string {
  const diff = difficulty || "intermediate";
  const headingCount = diff === "comprehensive" ? "12-18" : diff === "expert" ? "10-15" : diff === "intermediate" ? "8-12" : "6-8";
  return (
    `You are an expert educational content designer. Plan a ${diff}-level lesson as a title and a detailed outline. ` +
    `The outline must have ${headingCount} sections that cover the topic thoroughly from foundations through advanced applications. ` +
    `Each heading should represent a distinct subtopic with enough depth for 300-700 words of content. ` +
    `Respond ONLY with valid JSON: { "title": "...", "headings": ["Heading 1", "Heading 2", ...] }.` +
    (language === "ar"
      ? `\n\nCRITICAL: Write the title and every heading in Modern Standard Arabic (الفصحى). The JSON keys stay in English.`
      : "")
  );
}

function lessonSectionSystemPrompt(difficulty: string, language: LessonLanguage): string {
  const diff = difficulty || "intermediate";
  const wordCount = diff === "comprehensive" ? "500-800" : diff === "expert" ? "400-700" : diff === "intermediate" ? "300-500" : "200-400";
  return (
    `You are an expert educational writer. Write the detailed body content for specific lesson sections at ${diff} level. ` +
    `Each section's content must be ${wordCount} words of substantive, detailed prose. ` +
    `Do NOT write surface-level summaries. Each section must teach through analysis, examples, and depth. ` +
    `Include concrete examples, case studies, specific data, or named references where appropriate. ` +
    `Respond ONLY with valid JSON: { "sections": [ { "heading": "<exact heading>", "content": "<body text>" } ] }.` +
    (language === "ar"
      ? `\n\nCRITICAL: Write the body content in Modern Standard Arabic (الفصحى). The JSON keys stay in English.`
      : "")
  );
}

function lessonSectionBatchUserPrompt(source: string, headings: string[]): string {
  return [
    `Source material:\n${source}`,
    `Write the body content for these sections in order:`,
    ...headings.map((h, i) => `${i + 1}. ${h}`),
  ].join("\n\n");
}

function lessonGlossaryQuizSystemPrompt(difficulty: string, language: LessonLanguage, topic: string): string {
  const diff = difficulty || "intermediate";
  const quizCount = diff === "comprehensive" ? "12-18" : diff === "expert" ? "10-15" : diff === "intermediate" ? "8-12" : "6-10";
  const glossaryCount = diff === "comprehensive" ? "15-25" : diff === "expert" ? "12-20" : diff === "intermediate" ? "10-15" : "8-12";
  return (
    `You are an expert educational content generator. For a ${diff}-level lesson on "${topic}", create the glossary and quiz. ` +
    `Glossary: ${glossaryCount} key terms with precise, detailed definitions (3-5 sentences each). ` +
    `Quiz: ${quizCount} questions, each with EXACTLY 4 options. ` +
    `Questions must test higher-order thinking — not just recall. Mix: application, analysis, synthesis, evaluation. ` +
    `Each explanation must be 3-5 sentences explaining WHY the correct answer is correct and WHY the other options are wrong. ` +
    `Respond ONLY with valid JSON: { "glossary": [ { "term": "...", "definition": "..." } ], "quiz": [ { "question": "...", "options": ["Option A", "Option B", "Option C", "Option D"], "correctIndex": 0, "explanation": "..." } ] }.` +
    (language === "ar"
      ? `\n\nCRITICAL: Write the terms, definitions, questions, options and explanations in Modern Standard Arabic (الفصحى). The JSON keys stay in English.`
      : "")
  );
}

/**
 * Map a requested heading batch onto the sections a model produced. Headings
 * are authoritative (from the outline step); content is matched by position.
 * Missing/empty content fails the batch so it can be retried.
 */
function assignBatchSections(
  headings: string[],
  produced: { heading: string; content: string }[]
): { heading: string; content: string }[] {
  if (produced.length === 0) {
    throw new Error("Chunk validation failed: the model produced no sections");
  }
  // Match produced sections to the authoritative headings by heading text when
  // possible; fall back to position order. This tolerates models that emit the
  // sections in a different order than requested.
  const byHeading = new Map<string, string>();
  const positional: string[] = [];
  for (const s of produced) {
    const content = (s?.content ?? "").trim();
    if (!content) continue;
    positional.push(content);
    const key = (s?.heading ?? "").trim().toLowerCase();
    if (key) byHeading.set(key, content);
  }
  return headings.map((heading) => {
    const key = heading.trim().toLowerCase();
    const content = byHeading.get(key) ?? positional.shift() ?? "";
    if (!content) {
      throw new Error("Chunk validation failed: empty section content");
    }
    return { heading, content };
  });
}

/**
 * Layer 3 (lesson): chunked, two-phase generation used when the one-shot JSON
 * fails. Phase 1 plans title + headings; phase 2 writes section content in
 * small batches; phase 3 produces glossary + quiz. Every chunk is retried on
 * the SAME model before giving up.
 */
async function generateLessonChunked(
  modelId: string,
  userPrompt: string,
  difficulty: string,
  language: LessonLanguage,
  length?: string,
  signal?: AbortSignal
): Promise<GeneratedLesson> {
  const source = trimSource(userPrompt);

  const outline = validateLessonOutline(
    await retrySameModel(
      modelId,
      () =>
        chatForJson(
          modelId,
          [
            { role: "system", content: lessonOutlineSystemPrompt(difficulty, language) },
            { role: "user", content: userPrompt },
          ],
          LESSON_OUTLINE_JSON_SCHEMA,
          4096,
          signal
        ),
      signal
    )
  );

  const sections: GeneratedLesson["sections"] = [];
  for (let i = 0; i < outline.headings.length; i += LESSON_SECTION_BATCH_SIZE) {
    const batchHeadings = outline.headings.slice(i, i + LESSON_SECTION_BATCH_SIZE);
    const batchSections = await retrySameModel(
      modelId,
      async () => {
        const batch = validateLessonSectionBatch(
          await chatForJson(
            modelId,
            [
              { role: "system", content: lessonSectionSystemPrompt(difficulty, language) },
              { role: "user", content: lessonSectionBatchUserPrompt(source, batchHeadings) },
            ],
            LESSON_SECTIONS_BATCH_JSON_SCHEMA,
            12288,
            signal
          )
        );
        return assignBatchSections(batchHeadings, batch.sections);
      },
      signal
    );
    sections.push(...batchSections);
  }

  const glossaryQuiz = validateGlossaryQuiz(
    await retrySameModel(
      modelId,
      () =>
        chatForJson(
          modelId,
          [
            { role: "system", content: lessonGlossaryQuizSystemPrompt(difficulty, language, outline.title) },
            { role: "user", content: userPrompt },
          ],
          GLOSSARY_QUIZ_JSON_SCHEMA,
          24576,
          signal
        ),
      signal
    )
  );

  return validateLessonOutput({
    title: outline.title,
    sections,
    glossary: glossaryQuiz.glossary,
    quiz: glossaryQuiz.quiz,
  }) as GeneratedLesson;
}

// ---------------------------------------------------------------------------
// Podcast — always chunked (Layer 3)
// ---------------------------------------------------------------------------

/** How many exchanges each podcast chunk requests. */
const PODCAST_CHUNK_LINES = 6;

function targetPodcastExchanges(difficulty: string, length?: string): number {
  const base: Record<string, number> = { beginner: 16, intermediate: 24, expert: 32 };
  const mult: Record<string, number> = { short: 0.75, medium: 1.0, long: 1.5, comprehensive: 2.0 };
  const raw = Math.round((base[difficulty || "intermediate"] ?? 24) * (mult[length || "medium"] ?? 1.0));
  return Math.max(8, Math.min(60, raw));
}

function podcastTitleSystemPrompt(
  language: LessonLanguage,
  voiceGenderA: "male" | "female" = "male",
  voiceGenderB: "male" | "female" = "female"
): string {
  const genderHint = voiceGenderA === voiceGenderB
    ? `Both hosts are ${voiceGenderA}.`
    : `Host A is ${voiceGenderA}, Host B is ${voiceGenderB}.`;
  return (
    `You are a podcast script writer. Suggest a catchy, descriptive title for an educational podcast episode. ` +
    `The hosts are ${genderHint} ` +
    `The title should reflect the dynamic between the hosts and the topic. ` +
    `Respond ONLY with valid JSON: { "title": "..." }.` +
    (language === "ar"
      ? `\n\nWrite the title in Modern Standard Arabic (الفصحى).`
      : "")
  );
}

function podcastChunkSystemPrompt(
  difficulty: string,
  language: LessonLanguage,
  voiceGenderA: "male" | "female" = "male",
  voiceGenderB: "male" | "female" = "female"
): string {
  const diff = difficulty || "intermediate";

  const maleNames = language === "ar"
    ? ["أحمد", "محمد", "خالد", "عمر", "يوسف"]
    : ["James", "David", "Michael", "Robert", "Daniel"];
  const femaleNames = language === "ar"
    ? ["فاطمة", "خديجة", "نورة", "سارة", "ليلى"]
    : ["Sarah", "Emily", "Jessica", "Amanda", "Nicole"];

  const hostAName = voiceGenderA === "male" ? maleNames[0] : femaleNames[0];
  const hostBName = voiceGenderB === "male" ? maleNames[1] : femaleNames[1];

  return (
    `You are a podcast script writer. Continue an existing two-host educational podcast (Host A and Host B) at ${diff} level. ` +
    `Host A is ${hostAName} (${voiceGenderA}), Host B is ${hostBName} (${voiceGenderB}). ` +
    `Use their names naturally. Genders MUST match voices — do NOT use female names for a male voice or vice versa. ` +
    `Each exchange is 3-6 sentences of natural, substantive dialogue. Do NOT restart the conversation and do NOT repeat points ` +
    `already made — build on the script so far and move the discussion forward, covering the next aspect of the topic. ` +
    `The dialogue must have intellectual depth — not surface summaries. Include examples, analysis, and nuance. ` +
    `Respond ONLY with valid JSON: { "lines": [ { "speaker": "Host A", "text": "..." }, { "speaker": "Host B", "text": "..." } ] }.` +
    (language === "ar"
      ? `\n\nCRITICAL: Write all dialogue in Modern Standard Arabic (الفصحى). Keep the speaker labels "Host A"/"Host B" exactly as-is.`
      : "")
  );
}

/**
 * Cap on the number of transcript lines fed back into a podcast chunk request.
 * Long podcasts must be generated piecewise; feeding back the ENTIRE transcript
 * every chunk would grow the prompt unboundedly and blow the context window,
 * which is what causes servers to drop the connection on long episodes.
 */
const PODCAST_MAX_HISTORY_LINES = 12;

function podcastChunkUserPrompt(
  title: string,
  source: string,
  script: { speaker: "Host A" | "Host B"; text: string }[],
  count: number
): string {
  // Feed back only the most recent exchanges so the model continues the
  // conversation without re-reading the whole episode (context stays bounded).
  const history = script.slice(-PODCAST_MAX_HISTORY_LINES);
  const transcript = history.map((l) => `${l.speaker}: ${l.text}`).join("\n");
  return [
    `Podcast title: "${title}".`,
    `Source material:\n${source}`,
    history.length > 0
      ? `Script so far (last ${history.length} exchanges — continue from here, do not repeat them):\n${transcript}`
      : `Start the podcast now with an opening exchange.`,
    `Write the next ${count} exchanges.`,
  ].join("\n\n");
}

function podcastGlossaryQuizSystemPrompt(difficulty: string, language: LessonLanguage, title: string): string {
  const diff = difficulty || "intermediate";
  const quizCount = diff === "comprehensive" ? "12-18" : diff === "expert" ? "10-15" : diff === "intermediate" ? "8-12" : "6-10";
  const glossaryCount = diff === "comprehensive" ? "15-25" : diff === "expert" ? "12-20" : diff === "intermediate" ? "10-15" : "8-12";
  return (
    `You are an expert educational content generator. For a ${diff}-level podcast episode titled "${title}", create the glossary and quiz. ` +
    `Glossary: ${glossaryCount} key terms with precise, detailed definitions (3-5 sentences each). ` +
    `Quiz: ${quizCount} questions, each with EXACTLY 4 options. ` +
    `Questions must test higher-order thinking. Each explanation must be 3-5 sentences explaining WHY. ` +
    `Respond ONLY with valid JSON: { "glossary": [ { "term": "...", "definition": "..." } ], "quiz": [ { "question": "...", "options": ["Option A", "Option B", "Option C", "Option D"], "correctIndex": 0, "explanation": "..." } ] }.` +
    (language === "ar"
      ? `\n\nCRITICAL: Write the terms, definitions, questions, options and explanations in Modern Standard Arabic (الفصحى). The JSON keys stay in English.`
      : "")
  );
}

/**
 * Layer 3 (podcast): podcasts are inherently long (15-40 exchanges), so they
 * are ALWAYS generated piecewise — title, then short chunks of dialogue, then
 * glossary + quiz. This keeps every individual structured-output call small
 * enough that even a 3B model cannot truncate it. Every chunk is retried on
 * the SAME model before giving up.
 */
async function generatePodcastChunked(
  modelId: string,
  userPrompt: string,
  difficulty: string,
  language: LessonLanguage,
  length?: string,
  voiceGenderA: "male" | "female" = "male",
  voiceGenderB: "male" | "female" = "female"
): Promise<GeneratedLesson> {
  const target = targetPodcastExchanges(difficulty, length);
  const source = trimSource(userPrompt);

  const titleData = validatePodcastTitle(
    await retrySameModel(modelId, () =>
      chatForJson(
        modelId,
        [
          { role: "system", content: podcastTitleSystemPrompt(language, voiceGenderA, voiceGenderB) },
          { role: "user", content: userPrompt },
        ],
        PODCAST_TITLE_JSON_SCHEMA,
        512
      )
    )
  );

  const script: { speaker: "Host A" | "Host B"; text: string }[] = [];
  const maxChunks = Math.ceil(target / 2) + 1;
  let chunks = 0;
  while (script.length < target && chunks < maxChunks) {
    const count = Math.min(PODCAST_CHUNK_LINES, target - script.length);
    const chunk = validatePodcastChunk(
      await retrySameModel(modelId, () =>
        chatForJson(
          modelId,
          [
            { role: "system", content: podcastChunkSystemPrompt(difficulty, language, voiceGenderA, voiceGenderB) },
            { role: "user", content: podcastChunkUserPrompt(titleData.title, source, script, count) },
          ],
          PODCAST_CHUNK_JSON_SCHEMA,
          6144
        )
      )
    );
    script.push(...chunk.lines);
    chunks += 1;
  }

  const glossaryQuiz = validateGlossaryQuiz(
    await retrySameModel(modelId, () =>
      chatForJson(
        modelId,
        [
          { role: "system", content: podcastGlossaryQuizSystemPrompt(difficulty, language, titleData.title) },
          { role: "user", content: userPrompt },
        ],
        GLOSSARY_QUIZ_JSON_SCHEMA,
        12288
      )
    )
  );

  const podcast = validatePodcastOutput({
    title: titleData.title,
    podcastScript: script,
    glossary: glossaryQuiz.glossary,
    quiz: glossaryQuiz.quiz,
  });

  // `sections` stays populated for downstream consumers that always read it
  // (library cards, HTML export, plain-audio mode); the real body is the script.
  // Podcasts are validated via validatePodcastOutput above — skip
  // validateLessonOutput because podcasts only have a single transcript section
  // and would fail the 6-section minimum that lessons require.
  return {
    title: podcast.title,
    sections: [
      {
        heading: podcast.title,
        content: podcast.podcastScript.map((l) => l.text).join("\n\n"),
      },
    ],
    glossary: podcast.glossary,
    quiz: podcast.quiz,
    podcastScript: podcast.podcastScript,
  } as GeneratedLesson;
}

/**
 * Classify an error from `tryGenerate`.
 *
 * - `recoverable`: a transient or content-shaped failure — bad JSON,
 *   truncated output, schema validation. These are far more likely to succeed
 *   with a same-model retry than a model switch, so we retry the SAME model
 *   rather than churning the GPU. (There is no cross-model fallback.)
 * - `model-missing`: the runtime reports the model isn't installed. It is
 *   treated as non-recoverable: generation surfaces the error so the user decides.
 * - `fatal`: anything else (network down, server 500). Surface immediately.
 */
type GenerationErrorKind = "model-missing" | "recoverable" | "fatal";

function classifyGenerationError(e: unknown): GenerationErrorKind {
  if (e instanceof ZodError) {
    // The model returned output that fails the lesson schema (e.g. a missing
    // `sections` array). Retry the SAME model — never switch models.
    return "recoverable";
  }
  const msg = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase();
  // Zod serializes issues as `[ { "code": "invalid_type", ..., "message": ... } ]`;
  // match that shape directly so schema failures are retried even if the error
  // was serialized (e.g. across an IPC boundary).
  if (msg.includes('"code": "') && msg.includes('"message":')) {
    return "recoverable";
  }
  if (msg.includes("404") || msg.includes("not found") || msg.includes("model") && msg.includes("error")) {
    return "model-missing";
  }
  if (
    msg.includes("json") ||
    msg.includes("parse") ||
    msg.includes("unexpected token") ||
    msg.includes("validation") ||
    msg.includes("validate") ||
    msg.includes("schema") ||
    msg.includes("chunk validation") ||
    msg.includes("empty section")
  ) {
    return "recoverable";
  }
  // Transient network / transport failures (server busy, model loading, request
  // dropped mid-stream) are almost always worth retrying with the SAME model.
  // Classifying them as fatal would surface an avoidable error to the user.
  if (
    msg.includes("error sending request") ||
    msg.includes("connection") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("socket") ||
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("reqwest") ||
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("unreachable") ||
    msg.includes("hyper::") ||
    msg.includes("broken pipe") ||
    msg.includes("closed") ||
    msg.includes("tls") ||
    msg.includes("failed to read") ||
    msg.includes("send()")
  ) {
    return "recoverable";
  }
  return "fatal";
}

/**
 * Turn a lesson-schema failure into a concise, human-readable reason, e.g.
 * `the model returned output that doesn't match the required lesson format
 * ("sections" (expected array, got undefined))`.
 */
function describeSchemaFailure(e: ZodError): string {
  const issues = e.issues ?? [];
  if (issues.length === 0) return e.message;
  const summary = issues
    .map((issue) => {
      const path = issue.path?.length ? issue.path.join(".") : "top-level";
      const expected = (issue as { expected?: string | number }).expected;
      const received = (issue as { received?: string | number }).received;
      return `"${path}" (expected ${expected !== undefined ? expected : "a valid value"}, got ${received !== undefined ? received : "nothing"})`;
    })
    .join("; ");
  return `the model returned output that doesn't match the required lesson format (${summary})`;
}

/**
 * Produce a human-readable reason + guidance for a failed generation attempt,
 * so the user isn't left staring at a raw V8 / zod error string.
 */
function describeGenerationFailure(error: unknown, language?: LessonLanguage): { reason: string; guidance: string } {
  const languageHint =
    language === "ar"
      ? " The model may have weak Arabic support — try a larger multilingual model (e.g. qwen3:14b, qwen3:30b) or generate in English."
      : "";
  if (error instanceof ZodError) {
    return {
      reason: describeSchemaFailure(error),
      guidance:
        " This usually means the selected model isn't following the structured-format instructions; try an instruction-tuned model (e.g. gemma3, llama3.2, qwen3) or try again." +
        languageHint,
    };
  }
  const msg = error instanceof Error ? error.message : String(error);
  if (
    /\bjson\b/i.test(msg) ||
    /\bunexpected (end|token|identifier)\b/i.test(msg) ||
    /at position \d+/i.test(msg)
  ) {
    return {
      reason: `the model returned malformed or truncated JSON (${msg})`,
      guidance:
        " Small local models frequently break very long structured output; try a shorter Length, a larger model, or retry." +
        languageHint,
    };
  }
  if (
    msg.includes("empty section") ||
    msg.includes("produced no sections") ||
    msg.includes("chunk validation")
  ) {
    return {
      reason: `the model returned empty content for lesson sections${language === "ar" ? " (possibly due to weak Arabic output)" : ""}`,
      guidance:
        " The selected model struggled to produce substantive content." +
        languageHint +
        " You can also retry, as output quality varies between runs.",
    };
  }
  return { reason: msg, guidance: languageHint };
}

export async function generateLesson(payload: GenerateRequest): Promise<GeneratedLesson> {
  let validatedData: GenerateRequest;
  try {
    validatedData = validateGenerateLesson(payload);
  } catch (validationError) {
    if (validationError instanceof Error) {
      throw new AppError(
        `Invalid request: ${validationError.message}`,
        ErrorCode.VALIDATION_ERROR
      );
    }
    throw new AppError("Invalid request format", ErrorCode.VALIDATION_ERROR);
  }

  const { topic, content, model: preferredModel, difficulty, format, length, language, voiceGenderA, voiceGenderB } = validatedData;
  const requestDifficulty = difficulty || "intermediate";
  const requestFormat = format || "text";
  const requestLength = length || "medium";
  // Resolve output language: explicit choice wins, otherwise auto-detect from
  // the topic/content text so an Arabic topic yields an Arabic lesson.
  const requestLanguage: LessonLanguage =
    language ?? detectLanguage(`${topic ?? ""} ${content ?? ""}`);

  // Validate model availability and resolve the selected model. `ensureModel`
  // throws if the user-selected model isn't installed — generation never
  // auto-switches to a different model (session model policy).
  let selectedModel: string;
  try {
    selectedModel = await aiRuntime.ensureModel(preferredModel);
  } catch (e) {
    // If we can't resolve the selected model, there is nothing to fall back to.
    throw new AppError(
      `Failed to select a model: ${e instanceof Error ? e.message : String(e)}. ` +
        `Please ensure the AI runtime is running and has at least one model installed.`,
      ErrorCode.INTERNAL_ERROR
    );
  }

  // Skip the redundant standalone health check: `ensureModel`/`listModels`
  // already proved the runtime is reachable and has models. If it weren't, the
  // call above would have thrown. This removes one network round-trip before
  // the first token.

  const userPrompt = content
    ? `Here is the study material:\n\n${content}\n\nCreate a ${requestDifficulty}-level lesson from this material. Length: ${requestLength}. Cover ALL concepts in depth with substantive analysis, not surface summaries.`
    : `Create a ${requestDifficulty}-level educational lesson about: ${topic}. Length: ${requestLength}. Cover the topic thoroughly — foundations through advanced applications, with real examples and analysis.`;

  // Append journey context so topics in the same track build on each other.
  const userPromptWithJourney = validatedData.journeyContext
    ? `${userPrompt}\n\n${validatedData.journeyContext}`
    : userPrompt;

  const lessonSystemMessage = getLessonSystemPrompt(requestDifficulty, requestLanguage);

  // --- Session model policy: NO AUTO SWITCH ---
  // The user-selected model is the ONLY model used for this generation.
  // Recoverable errors (bad JSON, truncation) retry the SAME model up to
  // MAX_SAME_MODEL_RETRIES times — retrying the same model is not a switch.
  // Anything else (missing model, network, server 5xx) surfaces immediately.
  // Note: `validatedData` is schema-stripped, so the cancellation signal is
  // read from the raw payload (zod drops unknown keys).
  const signal = payload.signal;

  const tryWithModel = async (): Promise<GeneratedLesson> => {
    try {
      // Lesson: try one-shot structured JSON first (fast path).
      return await retrySameModel(
        selectedModel,
        () => tryGenerateLessonOnce(selectedModel, lessonSystemMessage, userPromptWithJourney, requestLength, signal),
        signal
      );
    } catch (e) {
      // One-shot lesson JSON failed recoverably (truncation, schema slip,
      // malformed JSON). Fall back to the chunked two-phase path with the SAME
      // model — never switch models.
      if (classifyGenerationError(e) === "recoverable") {
        console.warn("[generation] One-shot lesson JSON failed; falling back to chunked generation with the same model.");
        return generateLessonChunked(selectedModel, userPromptWithJourney, requestDifficulty, requestLanguage, requestLength, signal);
      }
      throw e;
    }
  };

  try {
    const lesson = await tryWithModel();
    const htmlContent = requestFormat === "html" ? generateHTML(lesson) : null;
    return {
      ...lesson,
      htmlContent,
      _model: selectedModel,
      _format: requestFormat,
      _length: requestLength,
    };
  } catch (error) {
    if (signal?.aborted) {
      throw new AppError("Lesson generation cancelled.", ErrorCode.EXTERNAL_API_ERROR);
    }
    const { reason, guidance } = describeGenerationFailure(error, requestLanguage);
    throw new AppError(
      `Lesson generation with model "${selectedModel}" failed: ${reason}.${guidance} The selected model is pinned for this session — pick a different model in the app to switch.`,
      ErrorCode.EXTERNAL_API_ERROR
    );
  }
}

/**
 * Generate a podcast script from an existing lesson's source material.
 * Called separately from the lesson page when the user requests a podcast.
 */
export async function generatePodcastOnly(payload: {
  topic?: string;
  content?: string;
  model?: string;
  difficulty?: string;
  language?: LessonLanguage;
  length?: string;
  voiceGenderA?: "male" | "female";
  voiceGenderB?: "male" | "female";
}): Promise<{ podcastScript: GeneratedLesson["podcastScript"] }> {
  let validatedData: GenerateRequest;
  try {
    validatedData = validateGenerateLesson(payload);
  } catch (validationError) {
    if (validationError instanceof Error) {
      throw new AppError(`Invalid request: ${validationError.message}`, ErrorCode.VALIDATION_ERROR);
    }
    throw new AppError("Invalid request format", ErrorCode.VALIDATION_ERROR);
  }

  const { topic, content, model: preferredModel, difficulty, length, language, voiceGenderA, voiceGenderB, journeyContext } = validatedData;
  const requestDifficulty = difficulty || "intermediate";
  const requestLength = length || "medium";
  const requestLanguage: LessonLanguage =
    language ?? detectLanguage(`${topic ?? ""} ${content ?? ""}`);

  let selectedModel: string;
  try {
    selectedModel = await aiRuntime.ensureModel(preferredModel);
  } catch (e) {
    throw new AppError(
      `Failed to select a model: ${e instanceof Error ? e.message : String(e)}.`,
      ErrorCode.INTERNAL_ERROR
    );
  }

  const userPrompt = content
    ? `Here is the study material:\n\n${content}\n\nCreate a ${requestDifficulty}-level podcast from this material. Length: ${requestLength}.`
    : `Create a ${requestDifficulty}-level educational podcast about: ${topic}. Length: ${requestLength}.`;

  const userPromptWithJourney = journeyContext
    ? `${userPrompt}\n\n${journeyContext}`
    : userPrompt;

  try {
    const podcastLesson = await generatePodcastChunked(
      selectedModel,
      userPromptWithJourney,
      requestDifficulty,
      requestLanguage,
      requestLength,
      voiceGenderA || "male",
      voiceGenderB || "female"
    );
    return { podcastScript: podcastLesson.podcastScript };
  } catch (error) {
    const { reason, guidance } = describeGenerationFailure(error, requestLanguage);
    throw new AppError(
      `Podcast generation with model "${selectedModel}" failed: ${reason}.${guidance}`,
      ErrorCode.EXTERNAL_API_ERROR
    );
  }
}
