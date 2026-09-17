// Skill injector — composes bound skills into a system prompt.
//
// The session holds one skill set. It is bound once at launch (see
// AIRuntimeProvider) and re-bound only when the model, provider, or the user's
// explicit selection changes. Every generation request then calls
// `skillInjector.apply(systemPrompt)`, which prepends the composed skills.
//
// Composition is deterministic: skills are ordered by ascending priority, so the
// same selection always produces the same prompt. That makes generation
// reproducible and the injection testable.

import { defaultSkill, getSkill, skillsForIntent } from "./registry";
import type {
  ActiveSkillSummary,
  InjectedSkillContext,
  SkillConfig,
  SkillIntent,
} from "./types";

export interface BindOptions {
  /** Model the skills are bound to. Re-binding happens when this changes. */
  modelName: string;
  /** Provider that will serve the requests. */
  providerId?: string;
  /**
   * Explicit skill ids to bind. When omitted, the default set for `intent`
   * is used.
   */
  skillIds?: string[];
  /** Intent used to resolve the skill set when `skillIds` is omitted. */
  intent?: SkillIntent;
}

/** Separator between skill blocks. Kept plain so it reads as structure, not content. */
const SEPARATOR = "\n\n---\n\n";

/**
 * Session-level skill context manager.
 *
 * Holds the composed skill set and re-injects only when the binding changes —
 * `bind` is a no-op returning the existing context when the model, provider, and
 * resolved skill ids are unchanged.
 */
export class SkillInjector {
  private context: InjectedSkillContext | null = null;

  /**
   * Bind a skill set. Returns the new context, or the existing one when nothing
   * that affects the prompt has changed.
   */
  bind(options: BindOptions): InjectedSkillContext {
    const providerId = options.providerId ?? "auto";
    const skills = this.resolveSkills(options);
    const ids = skills.map((s) => s.id).join("|");

    if (
      this.context &&
      this.context.modelName === options.modelName &&
      this.context.providerId === providerId &&
      this.context.skills.map((s) => s.id).join("|") === ids
    ) {
      return this.context;
    }

    this.context = {
      modelName: options.modelName,
      providerId,
      skills,
      injectedAt: Date.now(),
    };
    return this.context;
  }

  /** Resolve the skill list for a bind call, honouring explicit ids. */
  private resolveSkills(options: BindOptions): SkillConfig[] {
    if (options.skillIds && options.skillIds.length > 0) {
      const resolved = options.skillIds
        .map((id) => getSkill(id))
        .filter((s): s is SkillConfig => Boolean(s));
      // Dedup by id, preserving the first occurrence.
      const seen = new Set<string>();
      const unique = resolved.filter((s) => {
        if (seen.has(s.id)) return false;
        seen.add(s.id);
        return true;
      });
      if (unique.length > 0) {
        return unique.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
      }
    }
    return skillsForIntent(options.intent ?? "lesson");
  }

  /** The active skill context, if any. */
  current(): InjectedSkillContext | null {
    return this.context;
  }

  /** Ids of the bound skills, in injection order. */
  activeIds(): string[] {
    return this.context?.skills.map((s) => s.id) ?? [];
  }

  /** React-state-safe summary of the bound skills. */
  summaries(): ActiveSkillSummary[] {
    return (this.context?.skills ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      summary: s.summary,
    }));
  }

  /**
   * Prepend the bound skills to a system prompt.
   *
   * Returns the prompt unchanged when nothing is bound, so a caller that never
   * binds still works — the pre-registry behaviour.
   */
  apply(systemPrompt: string): string {
    if (!this.context || this.context.skills.length === 0) return systemPrompt;
    return composePrompt(this.context.skills, systemPrompt);
  }

  /**
   * Compose skills for a specific intent without changing the session binding.
   * Used by paths that must always carry their own skills regardless of what the
   * user has selected — the podcast pipeline is the main one.
   */
  applyForIntent(systemPrompt: string, intent: SkillIntent): string {
    const skills = skillsForIntent(intent);
    if (skills.length === 0) return systemPrompt;
    return composePrompt(skills, systemPrompt);
  }

  reset(): void {
    this.context = null;
  }
}

/** Build the final prompt: a provenance header, then each skill, then the task. */
function composePrompt(skills: SkillConfig[], systemPrompt: string): string {
  const header =
    `<!-- STUDY STUDIO · ${skills.length} skill pack${skills.length === 1 ? "" : "s"} active: ` +
    `${skills.map((s) => s.id).join(", ")} -->`;

  const blocks = skills.map((s) => s.systemInstructions.trim());
  return [header, ...blocks, systemPrompt.trim()].filter(Boolean).join(SEPARATOR);
}

/**
 * Bind the launch-time default skill set.
 *
 * Called once from `AIRuntimeProvider` when the runtime reports it can generate,
 * so the app is skill-guided from the first request without the user touching
 * the selector. Returns a summary safe to store in React state.
 */
export function bindDefaultSkills(options: {
  model: string;
  providerId?: string;
  intent?: SkillIntent;
}): ActiveSkillSummary[] {
  skillInjector.bind({
    modelName: options.model || "auto",
    providerId: options.providerId,
    intent: options.intent ?? "lesson",
  });
  return skillInjector.summaries();
}

/** Bind an explicit selection (the user's choice in the UI). */
export function bindSkills(
  modelName: string,
  skillIds: string[],
  providerId?: string
): ActiveSkillSummary[] {
  skillInjector.bind({
    modelName: modelName || "auto",
    providerId,
    skillIds: skillIds.length > 0 ? skillIds : [defaultSkill.id],
  });
  return skillInjector.summaries();
}

/** Singleton for the whole app session. */
export const skillInjector = new SkillInjector();
