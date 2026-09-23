import { ZodError } from "zod";
import {
  classifyGenerationError,
  describeGenerationFailure,
  describeSchemaFailure,
} from "@/lib/generation/errors";
import { ReasoningBudgetExhaustedError } from "@/lib/ai-runtime/providers/openaiCompatible";

// `describeGenerationFailure` is the only thing standing between a raw provider
// error and the user, and it had no direct test. The branch added here matters
// most: a local runtime that refuses to load the model returns a 400 whose body
// is the server's own JSON, and that body used to be shown verbatim.

describe("classifyGenerationError", () => {
  it("treats a schema failure as recoverable", () => {
    const error = new ZodError([
      { code: "invalid_type", expected: "array", received: "undefined", path: ["sections"], message: "Required" },
    ]);

    expect(classifyGenerationError(error)).toBe("recoverable");
  });

  it("treats malformed JSON as recoverable", () => {
    expect(classifyGenerationError(new Error("Unexpected token < in JSON"))).toBe("recoverable");
  });

  it("treats a transport failure as recoverable", () => {
    expect(classifyGenerationError(new Error("error sending request: connection reset"))).toBe(
      "recoverable"
    );
  });

  it("treats a missing model as non-recoverable", () => {
    expect(classifyGenerationError(new Error("404 model not found"))).toBe("model-missing");
  });

  it("treats anything unrecognised as fatal", () => {
    expect(classifyGenerationError(new Error("something else entirely"))).toBe("fatal");
  });
});

describe("describeSchemaFailure", () => {
  it("names the failing path and what was expected", () => {
    const error = new ZodError([
      { code: "invalid_type", expected: "array", received: "undefined", path: ["sections"], message: "Required" },
    ]);

    const message = describeSchemaFailure(error);

    expect(message).toContain('"sections"');
    expect(message).toContain("expected array");
    expect(message).toContain("got undefined");
  });

  it("falls back to the raw message when there are no issues", () => {
    // `ZodError.message` is a getter, so it cannot be seeded — assert the
    // fallback returns whatever the error itself carries.
    const error = new ZodError([]);

    expect(describeSchemaFailure(error)).toBe(error.message);
  });
});

describe("describeGenerationFailure — model load failures", () => {
  /**
   * The exact shape LM Studio returns when it cannot fit a model, wrapped the
   * way the OpenAI-compatible provider wraps it. The user must not be shown the
   * body — they need to know the model could not be loaded and what to do.
   */
  const loadFailure = new Error(
    'OpenAI error (400): {"error":{"message":"Failed to load model \\"qwen/qwen3.5-9b\\". ' +
      'Error: Model loading was stopped due to insufficient system resources.",' +
      '"type":"invalid_request_error"}}'
  );

  it("explains that the model could not be loaded into memory", () => {
    const { reason, guidance } = describeGenerationFailure(loadFailure);

    expect(reason).toMatch(/could not load this model into memory/i);
    expect(guidance).toMatch(/smaller model/i);
  });

  it("states that the app did not switch models behind the user's back", () => {
    const { guidance } = describeGenerationFailure(loadFailure);

    expect(guidance).toMatch(/never switches models/i);
  });

  it("does not leak the raw provider JSON into the reason", () => {
    const { reason } = describeGenerationFailure(loadFailure);

    expect(reason).not.toContain("invalid_request_error");
  });

  it("recognises the native load-endpoint failure code", () => {
    const { reason } = describeGenerationFailure(
      new Error('{"error":{"type":"model_load_failed","message":"boom"}}')
    );

    expect(reason).toMatch(/could not load this model into memory/i);
  });

  it("adds the Arabic hint when the lesson is Arabic", () => {
    const { reason } = describeGenerationFailure(loadFailure, "ar");

    expect(reason).toMatch(/RAM/i);
  });

  it("leaves unrelated failures on the generic path", () => {
    const { reason } = describeGenerationFailure(new Error("disk on fire"));

    expect(reason).toBe("disk on fire");
  });
});

describe("reasoning-budget starvation", () => {
  /**
   * Built from the REAL error class rather than a hand-written message string,
   * so this suite fails if the class and the classifier ever drift apart. The
   * message is the contract between them, and a paraphrase here would keep
   * passing while the app stopped recognising the real thing.
   */
  const starvation = new ReasoningBudgetExhaustedError(512, 512);

  it("is classified fatal, not recoverable", () => {
    // A reasoning model that overruns its budget overruns it identically on
    // every attempt, so retrying spends the same budget three more times for
    // the same empty answer. It arrives looking like a formatting slip, which
    // is exactly why it needs its own rule.
    expect(classifyGenerationError(starvation)).toBe("fatal");
  });

  it("is not mistaken for a JSON or transport problem", () => {
    expect(classifyGenerationError(starvation)).not.toBe("recoverable");
    expect(classifyGenerationError(starvation)).not.toBe("model-missing");
  });

  it("names the real cause instead of blaming the model's formatting", () => {
    const { reason } = describeGenerationFailure(starvation);

    expect(reason).toMatch(/whole response budget on internal reasoning/i);
    expect(reason).toMatch(/never produced an answer/i);
  });

  it("tells the user what they can actually do about it", () => {
    const { guidance } = describeGenerationFailure(starvation);

    expect(guidance).toMatch(/answer directly/i);
  });
});

