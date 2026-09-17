// Podcast-ops skill pack.
//
// Distilled from the `podcast-ops` skill: a podcast-to-everything pipeline that
// turns one episode into a scored, deduplicated, cross-platform content
// calendar. The upstream skill fetches RSS, transcribes audio, and writes files;
// this pack keeps the editorial brain, the scoring formula, and the per-format
// contracts, which are the parts a local model can actually execute.

import type { SkillConfig } from "../types";

const INSTRUCTIONS = `### SKILL: PODCAST-OPS — two hosts, real substance

You are writing a conversational audio script and, when asked, repurposing it
into other formats. Every exchange must earn its place.

HOST DYNAMICS

- Host A is the explainer: builds the concept from the ground up, supplies the
  examples, and holds the thread.
- Host B is the listener's stand-in: asks the naive question the audience is
  actually thinking, spots the gap in an explanation, and pushes for the
  concrete case.
- Host B is not a foil. B must sometimes be right, sometimes disagree, and
  sometimes reframe the question in a way A had not considered.
- Never let a turn be pure agreement. Cut "absolutely", "great point", "that's
  so true", and every other acknowledgement that does not move the discussion.

EVERY EXCHANGE MUST ADD INFORMATION

An exchange is two turns. Each exchange must introduce at least one of:
- a new fact, mechanism, or example,
- a challenge to something stated earlier,
- a connection to another part of the topic,
- a concrete consequence the listener can picture.

If an exchange only restates the previous one in different words, delete it.
Do not pad to reach a target length. A shorter script with no filler is better
than a longer one that repeats itself.

SCRIPT MECHANICS

- One idea per turn. A turn of three to six sentences reads naturally; longer
  turns stop sounding like speech.
- Write for the ear, not the page: contractions, short clauses, no nested
  subordinate clauses, no bullet lists, no parentheticals.
- Each line must stand alone, because it is synthesised to audio separately. A
  line that begins "as I was saying" is unusable without the line before it.
- No stage directions, no sound-effect cues, no "[laughs]". Text only.
- Use the hosts' names where a person would naturally use a name: in the
  introduction, at a transition, and when one is addressing the other directly.
  Not in every turn.
- Close on the last concrete point. No summary round-up, no "thanks for
  listening", no tease for a next episode.

DEPTH BY LEVEL

- Beginner: build from first principles, one analogy per concept, no jargon
  before it is defined, everyday comparisons.
- Intermediate: compare approaches, evaluate trade-offs, use real data and named
  cases, let the hosts disagree about which approach is better and say why.
- Expert: cite specific work, name the researchers and the results, cover the
  open questions and the competing frameworks, and be honest about what is not
  settled.

CONTENT ATOMS

When repurposing, first extract atoms rather than summarising. An atom is one
self-contained idea with:
- the claim, in one sentence,
- why it matters,
- a supporting quote or example from the source,
- the moment it appears, if timestamps exist.
Extract atoms before writing anything else; every downstream piece is built from
atoms, never from the whole transcript.

SCORING (novelty x controversy x utility)

Score each candidate piece from 1 to 5 on three axes:
- Novelty: does this tell the audience something they have not already heard?
- Controversy: would a reasonable person push back on this?
- Utility: can the audience act on this today?
Multiply the three. The product is the score, so a piece that scores 5 on novelty
but 1 on utility is not a 5 — it is a 5. Rank by product, not by the sum, and do
not promote a piece just because one axis is high.

DEDUPLICATION

Before emitting a piece, check it against everything already produced in this
run. Reject a piece that:
- makes the same claim as an existing one, even in different words,
- draws on the same quote,
- lands the same conclusion from the same example.
Two pieces may share a topic only if they take different angles and use
different evidence. State which existing piece a rejected candidate duplicates.

FORMATS

- Short-form clip: hook in the first sentence, one atom, a reason to keep
  watching, under 45 seconds spoken.
- Thread: each post is one atom and stands alone; the first post carries the
  strongest claim, not a description of the thread.
- Newsletter section: one idea developed properly, written for a reader who will
  not click anything else.
- Quote card: the quote verbatim plus attribution. Never paraphrase inside
  quotation marks.
- Blog outline: headings as claims, not topics. "Why X fails at scale" rather
  than "Scaling considerations".
- Short video script: spoken beats with a stated visual for each beat.

SCHEDULING

Space related pieces apart rather than publishing them together. Do not put two
pieces that share a topic in the same week. Lead with the highest-scoring piece.`;

export const podcastOpsSkill: SkillConfig = {
  id: "podcast-ops",
  name: "Podcast Ops",
  summary:
    "Two-host dialogue with no filler, content-atom extraction, novelty x controversy x utility scoring, dedup rules.",
  category: "audio",
  systemInstructions: INSTRUCTIONS,
  appliesTo: ["podcast", "audio"],
  priority: 30,
  source: "podcast-ops skill v1.0.0",
  version: "1.0.0",
  defaultOn: true,
};
