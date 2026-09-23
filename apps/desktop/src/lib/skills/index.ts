// Skill system public surface.
//
// Application code imports from here — never from a definition file directly.
//
//   import { skillInjector, skillsForIntent, bindDefaultSkills } from "@/lib/skills";
//
// This module replaces the previous single-file `src/lib/skills.ts`, which held
// six hardcoded entries and supported one active skill. The registry now carries
// the education, open-lesson, podcast-ops, notebooklm-studio, and humanizer packs
// alongside the original ones, and composition is multi-skill and
// intent-routed. See AUDIT.md phase 4.

export {
  ALL_SKILLS,
  getSkill,
  hasSkill,
  listSkills,
  skillsForIntent,
  defaultSkillSet,
  allTaskSkillSet,
  isMidSizeLocalModel,
} from "./registry";

export {
  SkillInjector,
  skillInjector,
  bindDefaultSkills,
  bindSkills,
  type BindOptions,
} from "./injector";

export type {
  SkillConfig,
  SkillIntent,
  SkillCategory,
  ActiveSkillSummary,
  InjectedSkillContext,
  VoicePresets,
} from "./types";

// Individual packs, for callers that want to reference one directly.
export { humanizerSkill } from "./definitions/humanizer";
export { educationSkill } from "./definitions/education";
export { openLessonSkill } from "./definitions/openLesson";
export { podcastOpsSkill } from "./definitions/podcastOps";
export { notebooklmStudioSkill } from "./definitions/notebooklmStudio";
export {
  defaultSkill,
  storytellingSkill,
  podcastHostingSkill,
  universalLanguageSkill,
} from "./definitions/base";
