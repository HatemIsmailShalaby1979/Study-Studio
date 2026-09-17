import { render, screen, waitFor, act } from "@testing-library/react";
import { AIRuntimeProvider, useAIRuntime } from "@/components/AIRuntimeProvider";
import { initializeRuntime } from "@/lib/api";
import { aiRuntime } from "@/lib/ai-runtime";
import { hasApiKey } from "@/lib/ai-runtime/providerStore";
import { bindDefaultSkills } from "@/lib/skills";
import { isTtsAvailable } from "@/lib/tts";
import type { AIProviderStatus } from "@/lib/ai-runtime/types";
import type { ActiveSkillSummary } from "@/lib/skills/types";
import { noCapabilities } from "@/lib/ai-runtime/capabilities";

// This component is the app's central wiring and had 10.5% statement / 0% branch
// coverage — low enough to hide a provably dead branch. See AUDIT.md P1-2 and
// the plan's item 2.2 (target: >= 60%).
//
// Routing itself is covered exhaustively in ai-runtime/__tests__/routing.test.ts.
// What is tested here is the wiring: that the provider feeds routing the right
// inputs, survives a failed handshake, and binds skills exactly once.

jest.mock("@/lib/api", () => ({ initializeRuntime: jest.fn() }));
jest.mock("@/lib/ai-runtime/providerStore", () => ({
  applyStoredConfigs: jest.fn(),
  hasApiKey: jest.fn(),
}));
jest.mock("@/lib/ai-runtime", () => ({
  aiRuntime: {
    discoverAll: jest.fn(),
    session: { setProvider: jest.fn() },
  },
}));
jest.mock("@/lib/skills", () => ({ bindDefaultSkills: jest.fn() }));
jest.mock("@/lib/tts", () => ({ isTtsAvailable: jest.fn() }));

const mockInit = initializeRuntime as jest.MockedFunction<typeof initializeRuntime>;
const mockHasApiKey = hasApiKey as jest.MockedFunction<typeof hasApiKey>;
const mockBind = bindDefaultSkills as jest.MockedFunction<typeof bindDefaultSkills>;
const mockTts = isTtsAvailable as jest.MockedFunction<typeof isTtsAvailable>;
// The mocked singleton — refreshProviders and setActiveProvider talk to it.
const mockAiRuntime = aiRuntime as unknown as {
  discoverAll: jest.Mock<Promise<AIProviderStatus[]>, []>;
  session: { setProvider: jest.Mock };
};
const mockSetProvider = mockAiRuntime.session.setProvider;

const SKILLS: ActiveSkillSummary[] = [
  { id: "education", name: "Education", category: "education" },
  { id: "humanizer", name: "Humanizer", category: "writing" },
];

function status(providerId: string, available = true): AIProviderStatus {
  return {
    providerId,
    available,
    models: [],
    recommendedModel: "",
    capabilities: noCapabilities(),
  };
}

function initResult(over: Partial<Awaited<ReturnType<typeof initializeRuntime>>> = {}) {
  return {
    available: true,
    models: [{ id: "model-a", name: "Model A" }],
    recommendedModel: "model-a",
    providerStatuses: [status("lm-studio")],
    activeProviderId: "lm-studio",
    ...over,
  };
}

/** Renders the whole context as testable text. */
function Probe() {
  const ctx = useAIRuntime();
  return (
    <div>
      <span data-testid="initialized">{String(ctx.initialized)}</span>
      <span data-testid="initializing">{String(ctx.initializing)}</span>
      <span data-testid="canGenerate">{String(ctx.canGenerate)}</span>
      <span data-testid="mode">{ctx.mode}</span>
      <span data-testid="needsApiKey">{String(ctx.needsApiKey)}</span>
      <span data-testid="available">{String(ctx.available)}</span>
      <span data-testid="activeProviderId">{ctx.activeProviderId}</span>
      <span data-testid="modelCount">{String(ctx.models.length)}</span>
      <span data-testid="recommendedModel">{ctx.recommendedModel}</span>
      <span data-testid="loadedModel">{ctx.loadedModel}</span>
      <span data-testid="didLoadModel">{String(ctx.didLoadModel)}</span>
      <span data-testid="modelLoadMessage">{ctx.modelLoadMessage ?? ""}</span>
      <span data-testid="message">{ctx.message ?? ""}</span>
      <span data-testid="skills">{ctx.activeSkills.map((s) => s.id).join(",")}</span>
      <span data-testid="ttsAvailable">{String(ctx.ttsAvailable)}</span>
      <button data-testid="refresh" onClick={() => ctx.refresh()}>
        refresh
      </button>
      <button data-testid="rescan" onClick={() => ctx.refreshProviders()}>
        rescan
      </button>
      <button data-testid="pin-openai" onClick={() => ctx.setActiveProvider("openai")}>
        pin openai
      </button>
      <button data-testid="pin-lmstudio" onClick={() => ctx.setActiveProvider("lm-studio")}>
        pin lm-studio
      </button>
    </div>
  );
}

function renderProvider() {
  return render(
    <AIRuntimeProvider>
      <Probe />
    </AIRuntimeProvider>
  );
}

const text = (id: string) => screen.getByTestId(id).textContent;

async function settle() {
  // Generous timeout: the default 1s is tight enough that this suite flaked
  // occasionally when the full run put 28 suites in parallel. Waiting for the
  // handshake to finish is the point — the timeout is not what is under test.
  await waitFor(() => expect(text("initialized")).toBe("true"), { timeout: 5000 });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHasApiKey.mockReturnValue(false);
  mockTts.mockResolvedValue(false);
  mockBind.mockReturnValue(SKILLS);
});

describe("AIRuntimeProvider — successful handshake", () => {
  it("marks itself initialized and exposes the resolved models", async () => {
    mockInit.mockResolvedValue(initResult());
    renderProvider();
    await settle();

    expect(text("initializing")).toBe("false");
    expect(text("available")).toBe("true");
    expect(text("canGenerate")).toBe("true");
    expect(text("modelCount")).toBe("1");
    expect(text("recommendedModel")).toBe("model-a");
    expect(text("activeProviderId")).toBe("lm-studio");
  });

  it("reports offline mode for a local runtime", async () => {
    mockInit.mockResolvedValue(initResult());
    renderProvider();
    await settle();
    expect(text("mode")).toBe("offline");
    expect(text("needsApiKey")).toBe("false");
  });

  it("surfaces the model-load fields from the handshake", async () => {
    mockInit.mockResolvedValue(
      initResult({
        loadedModel: "ibm/granite-4-h-tiny",
        didLoadModel: true,
        modelLoadMessage: "Loaded into memory.",
      })
    );
    renderProvider();
    await settle();

    expect(text("loadedModel")).toBe("ibm/granite-4-h-tiny");
    expect(text("didLoadModel")).toBe("true");
    expect(text("modelLoadMessage")).toBe("Loaded into memory.");
  });

  it("treats an online provider with a stored key as able to generate", async () => {
    mockInit.mockResolvedValue(
      initResult({
        providerStatuses: [status("openai")],
        activeProviderId: "openai",
      })
    );
    mockHasApiKey.mockImplementation((id) => id === "openai");

    renderProvider();
    await settle();

    expect(text("canGenerate")).toBe("true");
    expect(text("mode")).toBe("online");
    expect(text("needsApiKey")).toBe("false");
  });

  it("prompts for an API key when only an unusable online provider is reachable", async () => {
    mockInit.mockResolvedValue(
      initResult({ providerStatuses: [status("openai")], activeProviderId: "" })
    );
    mockHasApiKey.mockReturnValue(false);

    renderProvider();
    await settle();

    expect(text("canGenerate")).toBe("false");
    expect(text("needsApiKey")).toBe("true");
  });

  it("prompts for an API key when nothing at all is reachable", async () => {
    mockInit.mockResolvedValue(
      initResult({
        available: false,
        models: [],
        providerStatuses: [status("lm-studio", false)],
        activeProviderId: "",
      })
    );
    renderProvider();
    await settle();

    expect(text("canGenerate")).toBe("false");
    expect(text("mode")).toBe("unavailable");
    expect(text("needsApiKey")).toBe("true");
  });

  it("upgrades to hybrid when a local TTS engine is detected alongside an online LLM", async () => {
    mockInit.mockResolvedValue(
      initResult({ providerStatuses: [status("openai")], activeProviderId: "openai" })
    );
    mockHasApiKey.mockImplementation((id) => id === "openai");
    mockTts.mockResolvedValue(true);

    renderProvider();
    await settle();

    await waitFor(() => expect(text("ttsAvailable")).toBe("true"), { timeout: 5000 });
    expect(text("mode")).toBe("hybrid");
  });
});

describe("AIRuntimeProvider — failed handshake", () => {
  it("settles into a usable empty state instead of hanging or crashing", async () => {
    mockInit.mockRejectedValue(new Error("LM Studio is not running"));

    renderProvider();
    await settle();

    expect(text("initializing")).toBe("false");
    expect(text("canGenerate")).toBe("false");
    expect(text("available")).toBe("false");
    expect(text("modelCount")).toBe("0");
    expect(text("message")).toBe("LM Studio is not running");
  });

  it("falls back to a generic message for a non-Error rejection", async () => {
    mockInit.mockRejectedValue("plain string failure");

    renderProvider();
    await settle();

    expect(text("message")).toBe("AI runtime initialization failed");
  });

  it("does not bind skills when the runtime cannot generate", async () => {
    mockInit.mockRejectedValue(new Error("down"));
    renderProvider();
    await settle();

    expect(mockBind).not.toHaveBeenCalled();
    expect(text("skills")).toBe("");
  });
});

describe("AIRuntimeProvider — skill auto-binding", () => {
  it("binds the default skill set once the runtime can generate", async () => {
    mockInit.mockResolvedValue(
      initResult({ loadedModel: "granite", activeProviderId: "lm-studio" })
    );
    renderProvider();
    await settle();

    expect(mockBind).toHaveBeenCalledTimes(1);
    // The loaded model is preferred over the recommendation when present.
    expect(mockBind).toHaveBeenCalledWith({ model: "granite", providerId: "lm-studio" });
    expect(text("skills")).toBe("education,humanizer");
  });

  it("falls back to the recommended model when nothing was loaded", async () => {
    mockInit.mockResolvedValue(initResult({ recommendedModel: "model-a" }));
    renderProvider();
    await settle();

    expect(mockBind).toHaveBeenCalledWith({ model: "model-a", providerId: "lm-studio" });
  });

  it("does not re-bind on refresh, so a manual choice is not clobbered", async () => {
    mockInit.mockResolvedValue(initResult());
    renderProvider();
    await settle();
    expect(mockBind).toHaveBeenCalledTimes(1);

    await act(async () => {
      screen.getByTestId("refresh").click();
    });
    await waitFor(() => expect(mockInit).toHaveBeenCalledTimes(2), { timeout: 5000 });

    // The guard: still exactly one binding despite a second init pass.
    expect(mockBind).toHaveBeenCalledTimes(1);
  });

  it("survives a binding failure without breaking initialisation", async () => {
    mockInit.mockResolvedValue(initResult());
    mockBind.mockImplementation(() => {
      throw new Error("registry exploded");
    });

    renderProvider();
    await settle();

    // Init still completed and generation is still allowed.
    expect(text("initialized")).toBe("true");
    expect(text("canGenerate")).toBe("true");
    expect(text("skills")).toBe("");
  });
});

describe("AIRuntimeProvider — refreshProviders (Settings 'Re-scan')", () => {
  it("re-discovers providers, pins the first available one, and updates routing", async () => {
    mockInit.mockResolvedValue(initResult({ providerStatuses: [], activeProviderId: "" }));
    mockAiRuntime.discoverAll.mockResolvedValue([
      { ...status("lm-studio"), models: [{ id: "m1", name: "M1" }], recommendedModel: "m1" },
    ]);

    renderProvider();
    await settle();

    await act(async () => {
      screen.getByTestId("rescan").click();
    });

    await waitFor(() => expect(text("activeProviderId")).toBe("lm-studio"), { timeout: 5000 });
    expect(mockSetProvider).toHaveBeenCalledWith("lm-studio");
    expect(text("canGenerate")).toBe("true");
    expect(text("available")).toBe("true");
    expect(text("modelCount")).toBe("1");
    expect(text("recommendedModel")).toBe("m1");
  });

  it("prefers a local provider over an online one even when both answer", async () => {
    mockInit.mockResolvedValue(initResult({ providerStatuses: [], activeProviderId: "" }));
    mockHasApiKey.mockImplementation((id) => id === "openai");
    mockAiRuntime.discoverAll.mockResolvedValue([
      { ...status("openai"), models: [{ id: "gpt", name: "GPT" }] },
      { ...status("lm-studio"), models: [{ id: "m1", name: "M1" }] },
    ]);

    renderProvider();
    await settle();

    await act(async () => {
      screen.getByTestId("rescan").click();
    });

    await waitFor(() => expect(text("activeProviderId")).toBe("lm-studio"), { timeout: 5000 });
  });

  it("falls back to an online provider when no local runtime answers", async () => {
    mockInit.mockResolvedValue(initResult({ providerStatuses: [], activeProviderId: "" }));
    mockHasApiKey.mockImplementation((id) => id === "openai");
    mockAiRuntime.discoverAll.mockResolvedValue([
      { ...status("lm-studio", false), models: [] },
      { ...status("openai"), models: [{ id: "gpt", name: "GPT" }] },
    ]);

    renderProvider();
    await settle();

    await act(async () => {
      screen.getByTestId("rescan").click();
    });

    await waitFor(() => expect(text("activeProviderId")).toBe("openai"), { timeout: 5000 });
    expect(text("mode")).toBe("online");
  });

  it("surfaces the 'no local server' guidance when nothing answers", async () => {
    mockInit.mockResolvedValue(initResult({ providerStatuses: [], activeProviderId: "" }));
    mockAiRuntime.discoverAll.mockResolvedValue([status("lm-studio", false)]);

    renderProvider();
    await settle();

    await act(async () => {
      screen.getByTestId("rescan").click();
    });

    await waitFor(() => expect(text("activeProviderId")).toBe(""), { timeout: 5000 });
    expect(text("message")).toMatch(/no local model server detected/i);
    expect(text("canGenerate")).toBe("false");
  });

  it("does not crash when discovery itself throws", async () => {
    mockInit.mockResolvedValue(initResult({ providerStatuses: [], activeProviderId: "" }));
    mockAiRuntime.discoverAll.mockRejectedValue(new Error("discovery exploded"));

    renderProvider();
    await settle();

    await act(async () => {
      screen.getByTestId("rescan").click();
    });

    // Init state is preserved rather than the component blowing up.
    expect(text("initialized")).toBe("true");
  });
});

describe("AIRuntimeProvider — setActiveProvider (Settings pin)", () => {
  it("pins an available provider and swaps the model list with it", async () => {
    mockInit.mockResolvedValue(
      initResult({
        providerStatuses: [
          { ...status("lm-studio"), models: [{ id: "m1", name: "M1" }], recommendedModel: "m1" },
          { ...status("openai"), models: [{ id: "gpt", name: "GPT" }], recommendedModel: "gpt" },
        ],
        activeProviderId: "lm-studio",
      })
    );
    mockHasApiKey.mockImplementation((id) => id === "openai");

    renderProvider();
    await settle();
    expect(text("activeProviderId")).toBe("lm-studio");

    await act(async () => {
      screen.getByTestId("pin-openai").click();
    });

    expect(text("activeProviderId")).toBe("openai");
    expect(text("recommendedModel")).toBe("gpt");
    expect(mockSetProvider).toHaveBeenCalledWith("openai");
  });

  it("refuses to pin an unavailable provider, so it cannot hijack routing", async () => {
    mockInit.mockResolvedValue(
      initResult({
        providerStatuses: [status("lm-studio"), status("openai", false)],
        activeProviderId: "lm-studio",
      })
    );

    renderProvider();
    await settle();

    await act(async () => {
      screen.getByTestId("pin-openai").click();
    });

    // Stays on the working provider; session was never told to switch.
    expect(text("activeProviderId")).toBe("lm-studio");
    expect(mockSetProvider).not.toHaveBeenCalledWith("openai");
  });
});

describe("AIRuntimeProvider — TTS detection", () => {
  it("reports TTS unavailable when the probe throws", async () => {
    mockInit.mockResolvedValue(initResult());
    mockTts.mockRejectedValue(new Error("no tts in this shell"));

    renderProvider();
    await settle();

    // Must not throw, and must not claim TTS works.
    await waitFor(() => expect(text("ttsAvailable")).toBe("false"), { timeout: 5000 });
    expect(text("mode")).toBe("offline");
  });
});
