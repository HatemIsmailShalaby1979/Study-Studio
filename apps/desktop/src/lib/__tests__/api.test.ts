import { initializeRuntime, generateLesson } from "@/lib/api";
import { aiRuntime } from "@/lib/ai-runtime";

jest.mock("@/lib/ai-runtime", () => ({
  aiRuntime: {
    startRuntime: jest.fn(),
    listModels: jest.fn(),
    getRecommendedModel: jest.fn(),
    ensureModel: jest.fn(),
    chat: jest.fn(),
    discoverAll: jest.fn(),
    session: { setProvider: jest.fn() },
    providers: { all: () => [] },
  },
  extractJsonFromResponse: (raw: string) => raw,
  repairJson: (text: string) => text,
}));

const mockedRuntime = aiRuntime as jest.Mocked<typeof aiRuntime>;

describe("initializeRuntime", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
