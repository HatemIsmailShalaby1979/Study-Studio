import { render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "@/components/ThemeProvider";
import DiagnosticQuiz from "@/components/DiagnosticQuiz";
import type { DiagnosticQuiz as DiagnosticQuizModel } from "@/types";

jest.mock("@/lib/quizEngine", () => ({
  ...jest.requireActual("@/lib/quizEngine"),
  generateDiagnosticQuiz: jest.fn(),
}));

jest.mock("@/lib/helixEvents", () => ({
  appendEvalEvent: jest.fn(),
  createEvalEvent: jest.fn((_: string, fields: Record<string, unknown>) => ({ event_id: "mock", timestamp: "2025-01-01T00:00:00Z", __event_type__: "mock", source: "study-studio", ...fields })),
  EVENT_TYPES: { quizCreated: "quiz_created", answerSubmitted: "answer_submitted", quizResult: "quiz_result" },
}));

const mockQuiz: DiagnosticQuizModel = {
  quizId: "test_quiz_123",
  topic: "Quantum Computing",
  title: "Quantum Computing",
  createdAt: new Date().toISOString(),
  questions: [
    {
      id: "q1",
      type: "multiple_choice",
      prompt: "What is a qubit?",
      options: ["Classical bit", "Quantum bit", "Byte", "Register"],
      correctIndex: 1,
      explanation: "A qubit is a quantum bit.",
    },
    {
      id: "q2",
      type: "fill_blank",
      prompt: "Superposition allows a qubit to be in ___ states at once.",
      answer: "multiple",
      explanation: "Superposition means multiple states.",
    },
    {
      id: "q3",
      type: "translation",
      prompt: "Translate 'superposition' into Arabic.",
      answer: "تراكب",
      explanation: "Superposition is تراكب in Arabic.",
      languageTerm: "superposition",
    },
  ],
};

const renderDiagnostic = (overrides?: { onFinish?: () => void; onExit?: () => void }) => {
  const onFinish = overrides?.onFinish ?? jest.fn();
  const onExit = overrides?.onExit ?? jest.fn();
  return { onFinish, onExit, ...render(
    <ThemeProvider>
      <DiagnosticQuiz
        lessonTitle="Quantum Computing"
        topicText="Qubits use superposition."
        glossary={[{ term: "qubit", definition: "A quantum bit." }]}
        language="en"
        onFinish={onFinish}
        onExit={onExit}
      />
    </ThemeProvider>
  )};
};

beforeEach(() => {
  jest.clearAllMocks();
  (require("@/lib/quizEngine").generateDiagnosticQuiz as jest.Mock).mockResolvedValue(mockQuiz);
});

describe("DiagnosticQuiz", () => {
  it("shows loading state then renders quiz questions", async () => {
    renderDiagnostic();

    expect(screen.getByText("Crafting a quick diagnostic quiz...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("What is a qubit?")).toBeInTheDocument();
    });

    expect(screen.getByText("Classical bit")).toBeInTheDocument();
    expect(screen.getByText("Quantum bit")).toBeInTheDocument();
    expect(screen.getByText("3 quick questions")).toBeInTheDocument();
  });

  it("renders the exit quiz button", async () => {
    renderDiagnostic();
    await waitFor(() => {
      expect(screen.getByText("Exit quiz")).toBeInTheDocument();
    });
  });

  it("calls onExit when exit button clicked", async () => {
    const { onExit } = renderDiagnostic();
    await waitFor(() => {
      expect(screen.getByText("Exit quiz")).toBeInTheDocument();
    });
    screen.getByText("Exit quiz").click();
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("shows error message when generation fails", async () => {
    (require("@/lib/quizEngine").generateDiagnosticQuiz as jest.Mock).mockRejectedValue(new Error("Ollama offline"));
    renderDiagnostic();
    await waitFor(() => {
      expect(screen.getByText("Ollama offline")).toBeInTheDocument();
    });
  });
});
