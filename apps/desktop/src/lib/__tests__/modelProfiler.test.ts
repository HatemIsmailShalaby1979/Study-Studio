import {
  validateModelForTask,
  fetchModelProfile,
  profileAndValidate,
} from "@/lib/modelProfiler";
import { aiRuntime } from "@/lib/ai-runtime";
import type { AIModelProfile } from "@/lib/ai-runtime";

// The "Patriot Check" gate. It had zero coverage, and the audit noted it
// "almost never fires" because getModelProfile returned null for most providers
// — which this module treats as suitable. LM Studio now returns real metadata,
// so the gate is live for the runtime the user actually has.

jest.mock("@/lib/ai-runtime", () => ({
  aiRuntime: { getModelProfile: jest.fn() },
}));

const mockGetProfile = aiRuntime.getModelProfile as jest.MockedFunction<
  typeof aiRuntime.getModelProfile
>;

function profile(over: Partial<AIModelProfile> = {}): AIModelProfile {
  return {
    id: "test-model",
    parameters: "7B",
    contextWindow: 32768,
    supportsTools: true,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("validateModelForTask — lesson", () => {
  it("passes a model with a comfortable context window", () => {
    expect(validateModelForTask(profile({ contextWindow: 32768 }), "lesson")).toEqual({
      suitable: true,
    });
  });

  it("passes at exactly the 8192-token floor", () => {
    expect(validateModelForTask(profile({ contextWindow: 8192 }), "lesson").suitable).toBe(true);
  });

  it("rejects one token below the floor, naming the model and the requirement", () => {
    const result = validateModelForTask(profile({ id: "tiny-2k", contextWindow: 8191 }), "lesson");
    expect(result.suitable).toBe(false);
    expect(result.message).toContain("tiny-2k");
    expect(result.message).toContain("8191");
    expect(result.message).toContain("8192");
  });

  it("rejects an embedding-sized window — the real case on this machine", () => {
    // text-embedding-nomic-embed-text-v1.5 reports max_context_length 2048.
    const result = validateModelForTask(
      profile({ id: "text-embedding-nomic-embed-text-v1.5", contextWindow: 2048 }),
      "lesson"
    );
    expect(result.suitable).toBe(false);
  });
});

describe("validateModelForTask — podcast", () => {
  it("holds a longer podcast to the higher 16384 floor", () => {
    const model = profile({ contextWindow: 12000 });
    expect(validateModelForTask(model, "lesson").suitable).toBe(true);
    expect(validateModelForTask(model, "podcast").suitable).toBe(false);
  });

  it("passes at exactly the 16384-token floor", () => {
    expect(validateModelForTask(profile({ contextWindow: 16384 }), "podcast").suitable).toBe(true);
  });

  it("mentions the task by name in the rejection message", () => {
    const result = validateModelForTask(profile({ contextWindow: 4096 }), "podcast");
    expect(result.message).toContain("podcast");
  });

  it("defaults to the lesson task when none is given", () => {
    // 12000 fails podcast but passes lesson — so the default must be lesson.
    expect(validateModelForTask(profile({ contextWindow: 12000 })).suitable).toBe(true);
  });
});

describe("validateModelForTask — unknown profile", () => {
  it("fails open for a null profile and says so", () => {
    // Documented behaviour: an unknown model is assumed suitable rather than
    // blocked. Asserted here so the decision is deliberate, not accidental.
    expect(validateModelForTask(null)).toEqual({ suitable: true });
    expect(validateModelForTask(null, "podcast")).toEqual({ suitable: true });
  });
});

describe("fetchModelProfile", () => {
  it("delegates to the runtime rather than any provider", async () => {
    mockGetProfile.mockResolvedValue(profile());
    await expect(fetchModelProfile("model-a")).resolves.toEqual(profile());
    expect(mockGetProfile).toHaveBeenCalledWith("model-a");
  });

  it("propagates null for an unknown model", async () => {
    mockGetProfile.mockResolvedValue(null);
    await expect(fetchModelProfile("nope")).resolves.toBeNull();
  });
});

describe("profileAndValidate", () => {
  it("returns the profile alongside a passing validation", async () => {
    mockGetProfile.mockResolvedValue(profile({ contextWindow: 32768 }));
    const { profile: p, validation } = await profileAndValidate("model-a", "lesson");
    expect(p?.id).toBe("test-model");
    expect(validation.suitable).toBe(true);
  });

  it("returns a failing validation for an undersized model", async () => {
    mockGetProfile.mockResolvedValue(profile({ contextWindow: 2048 }));
    const { validation } = await profileAndValidate("model-a", "lesson");
    expect(validation.suitable).toBe(false);
  });

  it("passes when the runtime cannot profile the model at all", async () => {
    mockGetProfile.mockResolvedValue(null);
    const { profile: p, validation } = await profileAndValidate("model-a", "lesson");
    expect(p).toBeNull();
    expect(validation.suitable).toBe(true);
  });
});
