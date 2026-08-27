// Shared quiz evaluation orchestration (isomorphic — works in the Tauri
// desktop shell and in a plain browser through the AI Runtime).
import { aiRuntime, extractJsonFromResponse, repairJson } from "./ai-runtime";
import type { AIMessage } from "./ai-runtime";
import { validateEvaluateQuiz } from "./validation";
import { EVALUATION_OUTPUT_JSON_SCHEMA } from "./validation";

export interface QuizSubmission {
  questions: {
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
  }[];
  answers: Record<number, number>;
  difficulty: string;
  lessonTitle: string;
}

export interface EvaluationResult {
  overallScore: number;
  totalQuestions: number;
  correctAnswers: number;
  rating: "excellent" | "good" | "fair" | "needs_review" | "offline";
  feedback: string;
  perQuestion: {
    questionIndex: number;
    userAnswer: number;
    correctAnswer: number;
    isCorrect: boolean;
    explanation: string;
  }[];
}

export async function evaluateQuiz(body: unknown, model?: string): Promise<EvaluationResult> {
  const validated = validateEvaluateQuiz(body) as QuizSubmission;

  const { questions, answers, difficulty, lessonTitle } = validated;

  // Check the selected runtime's health
  const health = await aiRuntime.health();
  if (!health.available) {
    return {
      overallScore: 0,
      totalQuestions: questions.length,
      correctAnswers: 0,
      rating: "offline",
      feedback: "The AI runtime is not running. Start it to get AI-powered evaluation.",
      perQuestion: questions.map((q, i) => ({
        questionIndex: i,
        userAnswer: answers[i] ?? -1,
        correctAnswer: q.correctIndex,
        isCorrect: (answers[i] ?? -1) === q.correctIndex,
        explanation: q.explanation,
      })),
    };
  }

  // Session model policy: evaluation uses ONLY the model the user selected
  // (the lesson's model). If it isn't available we degrade to local scoring —
  // we never auto-switch to a different model.
  let modelToUse: string;
  try {
    modelToUse = model ? await aiRuntime.ensureModel(model) : health.recommendedModel;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.warn(`[evaluation] Model unavailable; using local scoring: ${errMsg}`);
    return buildLocalScoring(questions, answers);
  }

  const perQuestion = questions.map((q, i) => {
    const userAnswer = answers[i];
    const isCorrect = userAnswer === q.correctIndex;
    return {
      questionIndex: i,
      question: q.question,
      options: q.options,
      userAnswer: userAnswer ?? -1,
      correctAnswer: q.correctIndex,
      userAnswerText: userAnswer !== undefined ? q.options[userAnswer] || "Not answered" : "Not answered",
      correctAnswerText: q.options[q.correctIndex],
      isCorrect,
      explanation: q.explanation,
    };
  });

  const correctCount = perQuestion.filter((q) => q.isCorrect).length;
  const total = questions.length;
  const overallScore = total > 0 ? Math.round((correctCount / total) * 100) : 0;

  const evaluationPrompt = `You are an expert educational evaluator. A student has completed a quiz on "${lessonTitle}" at ${difficulty || "intermediate"} level.

For each question, evaluate the student's answer and provide detailed, personalized feedback that will genuinely help them improve their understanding.

Quiz Results (${correctCount}/${total} correct, ${overallScore}%):
${perQuestion.map((q, i) => `
Question ${i + 1}: "${q.question}"
Options: ${q.options.map((o, j) => `${j}) ${o}`).join(", ")}
Student's answer: ${q.userAnswerText} (option ${q.userAnswer})
Correct answer: ${q.correctAnswerText} (option ${q.correctAnswer})
${q.isCorrect ? "CORRECT" : "INCORRECT - " + q.explanation}
`).join("\n")}

Respond ONLY with valid JSON:
{
  "overallScore": ${overallScore},
  "totalQuestions": ${total},
  "correctAnswers": ${correctCount},
  "rating": "${overallScore >= 80 ? "excellent" : overallScore >= 60 ? "good" : overallScore >= 40 ? "fair" : "needs_review"}",
  "feedback": "A paragraph of personalized educational feedback assessing the student's understanding of the topic, identifying specific knowledge gaps, and recommending what to focus on. Be constructive and specific.",
  "perQuestion": [
    {
      "questionIndex": 0,
      "userAnswer": 0,
      "correctAnswer": 0,
      "isCorrect": true,
      "explanation": "Detailed explanation evaluating the student's answer choice and why it was right or wrong. Provide additional context and learning tips for each question."
    }
  ]
}`;

  const messages: AIMessage[] = [
    {
      role: "system",
      content: "You are an expert educational evaluator. Provide detailed, personalized feedback on quiz answers.",
    },
    { role: "user", content: evaluationPrompt },
  ];

  try {
    const rawContent = await aiRuntime.chat(
      messages,
      { temperature: 0.5, maxTokens: 4096, format: EVALUATION_OUTPUT_JSON_SCHEMA },
      modelToUse
    );
    const jsonStr = extractJsonFromResponse(rawContent);
    let evaluation: Record<string, unknown>;
    try {
      evaluation = JSON.parse(jsonStr) as Record<string, unknown>;
    } catch {
      evaluation = JSON.parse(repairJson(jsonStr)) as Record<string, unknown>;
    }

    return {
      ...evaluation,
      perQuestion: (evaluation["perQuestion"] as Array<Record<string, unknown>>).map(
        (_eq: unknown, i: number) => ({
          questionIndex: i,
          userAnswer: answers[i] ?? -1,
          correctAnswer: questions[i]?.correctIndex ?? 0,
          isCorrect: (answers[i] ?? -1) === questions[i]?.correctIndex,
        })
      ),
    } as EvaluationResult;
  } catch (e) {
    const _err = e instanceof Error ? e : new Error(String(e));
    console.warn(`[evaluation] ${modelToUse} failed; using local scoring:`, _err.message);
  }

  // Fallback to non-AI evaluation
  return buildLocalScoring(questions, answers);
}

function buildLocalScoring(
  questions: QuizSubmission["questions"],
  answers: Record<number, number>
): EvaluationResult {
  const perQuestion = questions.map((q, i) => {
    const userAnswer = answers[i];
    const isCorrect = userAnswer === q.correctIndex;
    return {
      questionIndex: i,
      question: q.question,
      options: q.options,
      userAnswer: userAnswer ?? -1,
      correctAnswer: q.correctIndex,
      userAnswerText: userAnswer !== undefined ? q.options[userAnswer] || "Not answered" : "Not answered",
      correctAnswerText: q.options[q.correctIndex],
      isCorrect,
      explanation: q.explanation,
    };
  });

  const correctCount = perQuestion.filter((q) => q.isCorrect).length;
  const total = questions.length;
  const overallScore = total > 0 ? Math.round((correctCount / total) * 100) : 0;

  return {
    overallScore,
    totalQuestions: total,
    correctAnswers: correctCount,
    rating: overallScore >= 80 ? "excellent" : overallScore >= 60 ? "good" : overallScore >= 40 ? "fair" : "needs_review",
    feedback: `You scored ${correctCount} out of ${total} (${overallScore}%). Review the explanations below for each question to improve your understanding.`,
    perQuestion: perQuestion.map((q) => ({
      questionIndex: q.questionIndex,
      userAnswer: q.userAnswer,
      correctAnswer: q.correctAnswer,
      isCorrect: q.isCorrect,
      explanation: q.isCorrect
        ? `Correct! ${q.explanation}`
        : `Incorrect. The correct answer was "${q.correctAnswerText}". ${q.explanation}`,
    })),
  };
}
