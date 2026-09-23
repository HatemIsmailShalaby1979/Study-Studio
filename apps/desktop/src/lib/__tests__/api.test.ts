import { initializeRuntime, generateLesson } from "@/lib/api";
import { aiRuntime } from "@/lib/ai-runtime";
import { isTauri } from "@/lib/tauri";
import type { AIProviderStatus } from "@/lib/ai-runtime/types";

jest.mock("@/lib/tauri", () => ({
  isTauri: jest.fn(() => false),
  invokeTauri: jest.fn(),
}));

jest.mock("@/lib/ai-runtime", () => ({
  aiRuntime: {
    startRuntime: jest.fn(),
    listModels: jest.fn(),
    getRecommendedModel: jest.fn(),
    ensureModel: jest.fn(),
    ensureModelLoaded: jest.fn(),
    supportsModelLoading: jest.fn(),
    chat: jest.fn(),
    discoverAll: jest.fn(),
    session: {
      setProvider: jest.fn(),
      getProvider: jest.fn(() => null),
      setModel: jest.fn(),
      getModel: jest.fn(() => null),
    },
    providers: { all: () => [] },
  },
  extractJsonFromResponse: (raw: string) => raw,
  repairJson: (text: string) => text,
}));

const mockedRuntime = aiRuntime as jest.Mocked<typeof aiRuntime>;
const mockIsTauri = isTauri as jest.MockedFunction<typeof isTauri>;

/** A minimal available-provider status. */
function status(providerId: string, modelId = "m"): AIProviderStatus {
  return {
    providerId,
    available: true,
    models: [{ id: modelId, name: modelId }],
    recommendedModel: modelId,
    capabilities: {} as AIProviderStatus["capabilities"],
  };
}

describe("initializeRuntime", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsTauri.mockReturnValue(false);
  });

  it("reports not available with guidance when the runtime has zero models", async () => {
    jest.useFakeTimers();
    try {
      mockedRuntime.listModels.mockResolvedValue([]);
      mockedRuntime.discoverAll.mockResolvedValue([]);

      const resultPromise = initializeRuntime();
      await jest.advanceTimersByTimeAsync(10_000);
      const result = await resultPromise;

      expect(result.available).toBe(false);
      expect(result.models).toEqual([]);
      expect(result.recommendedModel).toBe("");
      expect(result.message).toMatch(/no models|no local model/i);
      expect(result.activeProviderId).toBe("");
      expect(mockedRuntime.getRecommendedModel).not.toHaveBeenCalled();
      expect(mockedRuntime.session.setProvider).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("reports available with the recommended model when models exist", async () => {
    mockedRuntime.listModels.mockResolvedValue([
      { id: "gemma3:12b", name: "gemma3:12b", size: 8100000000 },
    ]);
    mockedRuntime.discoverAll.mockResolvedValue([
      {
        providerId: "ollama",
        available: true,
        models: [{ id: "gemma3:12b", name: "gemma3:12b", size: 8100000000 }],
        recommendedModel: "gemma3:12b",
        capabilities: {},
        message: "OK",
      },
    ]);

    const result = await initializeRuntime();

    expect(result.available).toBe(true);
    expect(result.models).toEqual([{ id: "gemma3:12b", name: "gemma3:12b", size: 8100000000 }]);
    expect(result.recommendedModel).toBe("gemma3:12b");
    expect(result.activeProviderId).toBe("ollama");
    expect(mockedRuntime.session.setProvider).toHaveBeenCalledWith("ollama");
  });

  it("does not ask a runtime to start, or re-list models, when one already answered", async () => {
    // Regression: the handshake used to list models against a single hardcoded
    // provider five times, two seconds apart, before discovery had run — then
    // spawn and poll a local runtime unconditionally. On a machine with LM
    // Studio up and Ollama absent that was ~20-30 s of probing nothing, on
    // every launch, while the model the user had selected sat ready.
    mockIsTauri.mockReturnValue(true);
    mockedRuntime.discoverAll.mockResolvedValue([status("lm-studio", "granite")]);

    const result = await initializeRuntime();

    expect(mockedRuntime.discoverAll).toHaveBeenCalledTimes(1);
    expect(mockedRuntime.startRuntime).not.toHaveBeenCalled();
    expect(mockedRuntime.listModels).not.toHaveBeenCalled();
    expect(result.activeProviderId).toBe("lm-studio");
    expect(result.models).toEqual([{ id: "granite", name: "granite", size: undefined }]);
  });

  it("boots a local runtime, then re-discovers, when nothing local answered", async () => {
    mockIsTauri.mockReturnValue(true);
    mockedRuntime.discoverAll
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([status("lm-studio", "granite")]);

    const result = await initializeRuntime();

    expect(mockedRuntime.startRuntime).toHaveBeenCalledTimes(1);
    expect(mockedRuntime.discoverAll).toHaveBeenCalledTimes(2);
    expect(result.activeProviderId).toBe("lm-studio");
  });

  it("prefers a local provider over an online one when both answer", async () => {
    mockedRuntime.discoverAll.mockResolvedValue([status("openai", "gpt"), status("lm-studio", "granite")]);

    const result = await initializeRuntime();

    expect(result.activeProviderId).toBe("lm-studio");
  });
});

describe("generateLesson cancellation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("threads the cancellation signal to the runtime and rejects cleanly on abort", async () => {
    mockedRuntime.ensureModel.mockResolvedValue("gemma3:12b");
    mockedRuntime.chat.mockImplementation(async (_messages, options) => {
      return new Promise((_resolve, reject) => {
        if (options?.signal?.aborted) {
          reject(new DOMException("aborted", "AbortError"));
          return;
        }
        options?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });

    const controller = new AbortController();
    const promise = generateLesson({
      topic: "Quantum Computing",
      model: "gemma3:12b",
      signal: controller.signal,
    });
    controller.abort();

    await expect(promise).rejects.toThrow(/cancelled/i);
    expect(mockedRuntime.chat).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ signal: controller.signal }),
      "gemma3:12b"
    );
  });
});
