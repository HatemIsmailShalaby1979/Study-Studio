// Prompt construction for lesson and podcast generation.
//
// Extracted from `generation.ts` (plan item 5.1). Every function here is pure:
// the only dependency is `skillInjector`, so this module has no transport,
// runtime or storage imports and is trivially unit-testable.
//
// Skill injection happens at these call sites rather than once at the top of a
// request, deliberately: the chunked fallback path must carry the same
// methodology as the one-shot path, so each prompt builder applies its own
// packs.

import { skillInjector } from "../skills";

/** Language a lesson is generated in. Detection lives here too. */
export type LessonLanguage = "ar" | "en";

/**
 * A generation request. Lives in this leaf module rather than in the
 * `../generation` barrel so that `podcast.ts` and `lesson.ts` can depend on the
 * type without reaching back up into the entry point that imports them.
 */
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

/**
 * Detect whether a string contains Arabic script (core block U+0600-U+06FF).
 * Mirrors the detection in `tts.rs::default_voice_for` so UI, generation, and
 * TTS all agree on what counts as "Arabic".
 */
export function detectLanguage(text: string): LessonLanguage {
  return /[\u0600-\u06FF]/.test(text ?? "") ? "ar" : "en";
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

/**
 * Cap on characters of source material fed into a single chunk request.
 * Shared by the lesson chunked path and the podcast path, which is why it lives
 * here rather than in either generator module.
 */
const MAX_SOURCE_CHARS = 6000;

/**
 * Truncate source material for a chunk request, with an explicit marker so the
 * truncation is visible in the prompt rather than silent.
 */
export function trimSource(userPrompt: string): string {
  return userPrompt.length > MAX_SOURCE_CHARS
    ? `${userPrompt.slice(0, MAX_SOURCE_CHARS)}\n\n[study material truncated for this step]`
    : userPrompt;
}

export function lessonOutlineSystemPrompt(difficulty: string, language: LessonLanguage): string {
  const diff = difficulty || "intermediate";
  const headingCount = diff === "comprehensive" ? "12-18" : diff === "expert" ? "10-15" : diff === "intermediate" ? "8-12" : "6-8";
  // Skill injection is applied here too, not only on the one-shot path: a lesson
  // that falls back to chunked generation must carry the same methodology.
  return skillInjector.apply(
    `You are an expert educational content designer. Plan a ${diff}-level lesson as a title and a detailed outline. ` +
    `The outline must have ${headingCount} sections that cover the topic thoroughly from foundations through advanced applications. ` +
    `Each heading should represent a distinct subtopic with enough depth for 300-700 words of content. ` +
    `Respond ONLY with valid JSON: { "title": "...", "headings": ["Heading 1", "Heading 2", ...] }.` +
    (language === "ar"
      ? `\n\nCRITICAL: Write the title and every heading in Modern Standard Arabic (الفصحى). The JSON keys stay in English.`
      : "")
  );
}

export function lessonSectionSystemPrompt(difficulty: string, language: LessonLanguage): string {
  const diff = difficulty || "intermediate";
  const wordCount = diff === "comprehensive" ? "500-800" : diff === "expert" ? "400-700" : diff === "intermediate" ? "300-500" : "200-400";
  return skillInjector.apply(
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

export function lessonSectionBatchUserPrompt(source: string, headings: string[]): string {
  return [
    `Source material:\n${source}`,
    `Write the body content for these sections in order:`,
    ...headings.map((h, i) => `${i + 1}. ${h}`),
  ].join("\n\n");
}

export function lessonGlossaryQuizSystemPrompt(difficulty: string, language: LessonLanguage, topic: string): string {
  const diff = difficulty || "intermediate";
  const quizCount = diff === "comprehensive" ? "12-18" : diff === "expert" ? "10-15" : diff === "intermediate" ? "8-12" : "6-10";
  const glossaryCount = diff === "comprehensive" ? "15-25" : diff === "expert" ? "12-20" : diff === "intermediate" ? "10-15" : "8-12";
  return skillInjector.apply(
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

export function podcastTitleSystemPrompt(
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

export function podcastChunkSystemPrompt(
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

  // Podcast chunks always carry the podcast skill set, resolved by intent rather
  // than by whatever the user bound for lessons. A podcast generated from the
  // lesson page must still follow podcast methodology.
  return skillInjector.applyForIntent(
    `You are a podcast script writer. Continue an existing two-host educational podcast (Host A and Host B) at ${diff} level. ` +
    `Host A is ${hostAName} (${voiceGenderA}), Host B is ${hostBName} (${voiceGenderB}). ` +
    `Use their names naturally. Genders MUST match voices — do NOT use female names for a male voice or vice versa. ` +
    `Each exchange is 3-6 sentences of natural, substantive dialogue. Do NOT restart the conversation and do NOT repeat points ` +
    `already made — build on the script so far and move the discussion forward, covering the next aspect of the topic. ` +
    `The dialogue must have intellectual depth — not surface summaries. Include examples, analysis, and nuance. ` +
    `Respond ONLY with valid JSON: { "lines": [ { "speaker": "Host A", "text": "..." }, { "speaker": "Host B", "text": "..." } ] }.` +
    (language === "ar"
      ? `\n\nCRITICAL: Write all dialogue in Modern Standard Arabic (الفصحى). Keep the speaker labels "Host A"/"Host B" exactly as-is.`
      : ""),
    "podcast"
  );
}

/**
 * How many trailing script lines are fed back to the model as conversation
 * history. Bounded so a long podcast does not blow the context window.
 */
const PODCAST_MAX_HISTORY_LINES = 12;

export function podcastChunkUserPrompt(
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

export function podcastGlossaryQuizSystemPrompt(difficulty: string, language: LessonLanguage, title: string): string {
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
