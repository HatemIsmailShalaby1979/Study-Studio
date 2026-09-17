# Study Studio — Design System

The visual and interaction contract for the Study Studio desktop app (`apps/desktop`).

This document is the single source of truth for how Study Studio looks, moves, and
behaves. It is written against the code that exists today. Where the code and this
document disagree, one of them is a bug and the fix is named in
[§11 Known deviations](#11-known-deviations-from-this-document).

**Scope:** the Next.js UI in `apps/desktop/src`. The Tauri shell
(`apps/desktop/src-tauri`) owns windows and native dialogs, not visual style.

---

## 1. Design principles

Study Studio is a study tool, not a dashboard. Four rules decide every visual question.

**Reading is the primary task.** Content surfaces are quiet, high-contrast, and
generously line-spaced. Nothing in the reading path competes with the text.

**The interface never pretends to be the model.** When the app is waiting, it says
what it is waiting for. No fake progress bars, no invented percentages, no spinners
without a label.

**Local-first is visible.** The app's core promise is that inference runs on the
user's machine. Status is always shown as a fact ("3 models", "Local-first"), never
as marketing.

**Restraint over decoration.** One accent color, one radius scale, one shadow scale.
Emoji appear only where they carry meaning as icons, never as paragraph decoration.

### Voice

Interface copy is plain, second person, and specific. Say what happened and what to
do next.

| Write this | Not this |
| --- | --- |
| No local model detected. Start Ollama or LM Studio, or add an online API key in Settings. | Oops! Something went wrong 😢 |
| Model "gemma3:12b" is not available. Load it in your server, or pick another model. | Invalid model selection. |
| Profiling model capabilities… | Loading… |

Never blame the user. Never use "simply", "just", or "easy". If a step is hard, say
what it needs instead.

---

## 2. Color

### 2.1 Architecture

Color is defined once as CSS custom properties in `src/app/globals.css` and exposed to
Tailwind through `tailwind.config.ts`. Components reference **token names**, never hex
values. A hex literal in a component is a defect.

```
globals.css  →  :root { --primary: #6366f1 }        (light)
                .dark  { --primary: #818cf8 }        (dark)
                     ↓
tailwind.config.ts → colors: { primary: "var(--primary)" }
                     ↓
component          → className="text-primary"
```

### 2.2 Surface and text tokens

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `background` | `#f0f4f8` | `#0b1120` | App canvas. Never on a card. |
| `foreground` | `#0f172a` | `#e2e8f0` | Primary text and icons. |
| `card` | `#ffffff` | `#131c31` | Card, input, and button surfaces. |
| `card-border` | `#e2e8f0` | `#1e293b` | Every 1px separator and outline. |
| `sidebar` | `#f8fafc` | `#0f172a` | Recessed surfaces: pills, skeleton tracks. |
| `sidebar-hover` | `#e2e8f0` | `#1e293b` | Hover state for recessed surfaces. |
| `muted` | `#64748b` | `#94a3b8` | Secondary text, labels, helper copy. |

### 2.3 Accent tokens

| Token | Light | Dark | Meaning |
| --- | --- | --- | --- |
| `primary` | `#6366f1` | `#818cf8` | The only brand accent. Selection, focus, primary action. |
| `primary-hover` | `#4f46e5` | `#6366f1` | Gradient end stop and pressed state. |
| `primary-soft` | `#eef2ff` | `#1e2250` | Tinted primary surface: selected card, active badge. |
| `accent-green` | `#22c55e` | `#4ade80` | Available, installed, correct. |
| `accent-red` | `#ef4444` | `#f87171` | Failed, destructive, incorrect. |
| `accent-blue` | `#3b82f6` | `#60a5fa` | Informational, neutral notice. |
| `accent-amber` | `#f59e0b` | `#fbbf24` | Warning, degraded, needs attention. |

### 2.4 Rules

**One accent per view.** `primary` marks the current selection and the single primary
action. If two elements on a screen both read as "the accent", one is wrong.

**Status colors are semantic, never decorative.** Green means available or correct.
Amber means degraded. Red means failed. A red border on a card that is working is a bug.

**Tinted surfaces use the `-soft` token, not opacity.** `bg-primary-soft` in light mode,
`bg-primary-soft/20` in dark. Never `bg-primary/10` — the tint has its own value in each
theme.

**Text on a tinted surface uses the accent itself.** `bg-primary-soft` pairs with
`text-primary`, not `text-foreground`.

**Gradients are reserved.** Exactly one gradient exists: the page title,
`bg-gradient-to-r from-primary to-accent-blue bg-clip-text text-transparent`. Do not
introduce a second.

### 2.5 Contrast requirements

| Pair | Minimum | Notes |
| --- | --- | --- |
| `foreground` on `background` | 4.5:1 | Measured ~15:1 light, ~13:1 dark. |
| `foreground` on `card` | 4.5:1 | |
| `muted` on `card` | 4.5:1 | **Currently ~4.3:1 in light mode.** See §11. |
| `primary` on `primary-soft` | 4.5:1 | |
| `#fff` on `btn-primary` gradient | 4.5:1 | Both stops clear 4.5:1. |

Body text is never `muted`. `muted` is for labels, helper text, and metadata only.

---

## 3. Typography

### 3.1 Family

| Role | Family | Status |
| --- | --- | --- |
| UI and body | Inter | **Loaded.** Self-hosted by `next/font` from `src/app/layout.tsx` as `--font-inter`. |
| Monospace | Geist Mono | **Loaded.** `next/font/local` from `src/app/fonts/GeistMonoVF.woff` as `--font-geist-mono`. One consumer: the Settings input. |

The live stack, in `globals.css` and `tailwind.config.ts`:

```
body        → var(--font-inter, 'Inter'), system-ui, -apple-system, 'Segoe UI',
              Roboto, 'Helvetica Neue', Arial, sans-serif
font-mono   → var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo,
              Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace
```

`next/font` downloads Inter at build time and self-hosts the woff2 files under
`_next/static/media`, so the desktop app never requests a font over the network at
runtime. Verified in the export: 8 Inter `@font-face` rules plus 1 for Geist Mono,
all with `font-display: swap`, and
`<html class="__variable_f367f3 __variable_1235f0">`.

Only the `latin` subset is requested. The system stack after Inter is deliberate,
not leftover: this app generates Arabic lessons and podcast scripts and Inter has no
meaningful Arabic coverage, so those glyphs fall through to the platform font.

**Exported lesson HTML does not use Inter.** `generation.ts` writes a standalone file
with an inline stylesheet; it cannot reach `--font-inter` or the hashed woff2 paths, so
it declares a system stack instead of naming a font it cannot load. Embedding the font
as base64 (~+64 KB per lesson) is the only way to match the app exactly.

> **Do not add `babel.config.js`.** `next/font` requires SWC, and any project-level
> Babel config silently disables SWC — which is what prevented Inter from ever being
> loaded. The build prints `Syntax error: "next/font" requires SWC although Babel is
> being used due to a custom babel config being present.` Jest does not need it
> (it uses `ts-jest`). See §11 D3.

Lesson HTML generated by `src/lib/generation.ts` must carry the same stack so an
exported lesson looks like the app that produced it.

### 3.2 Scale

Tailwind's default scale, used as-is. The app does not define custom sizes.

| Class | px | Use |
| --- | --- | --- |
| `text-[9px]`, `text-[10px]` | 9–10 | Badge counts, inline metadata. Sparingly. |
| `text-xs` | 12 | Labels, helper text, table rows. |
| `text-sm` | 14 | Buttons, controls, secondary body. |
| `text-base` | 16 | Primary body text in cards. |
| `text-lg` | 18 | Card and section headings. |
| `text-4xl` / `text-5xl` | 36 / 48 | Page title only. One per page. |

### 3.3 Weight

`font-medium` (500) for buttons and labels. `font-semibold` (600) for headings.
`font-bold` (700) for the page title only. Never 800+.

### 3.4 Rules

**One `h1` per page, always the gradient title.** Page headers follow the same shape:
a rounded status chip, then the gradient `h1`, then one line of `text-muted` context.

**Sentence case everywhere.** Including headings, buttons, and labels. `Generate
lesson`, not `Generate Lesson`. See §11 for current violations.

**Line height follows role.** Reading content uses `leading-relaxed` or `leading-7`.
UI chrome uses the Tailwind default. Dense metadata may use `leading-tight`.

**Measure caps at 65–75 characters.** Reading surfaces use `max-w-2xl` (672px) or
`max-w-3xl` (768px). Full-width prose is a defect.

**No letter-spacing on body text.** `tracking-tight` is permitted on the page title
only.

---

## 4. Space and layout

### 4.1 Scale

Tailwind's 4px base. Only these steps are used: `0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 6, 8,
12, 16`. Arbitrary values such as `mt-[13px]` are defects.

### 4.2 Page shell

Every page uses the same shell:

```
min-h-screen flex flex-col items-center px-4 pt-20 pb-16
```

`pt-20` clears the fixed NavBar. The content column is `max-w-2xl` (focused, single
column — Generate, Lesson) or `max-w-3xl` (denser, multi-section — Settings, Library).

### 4.3 Vertical rhythm

Sections stack with `mb-6`. Elements inside a card use `mb-4`. Label-to-control spacing
is `mb-1.5`. The last child in a card carries no bottom margin.

### 4.4 Breakpoints

| Name | px | Behaviour |
| --- | --- | --- |
| `sm` | 640 | Two-column grids become available. |
| `md` | 768 | — |
| `lg` | 1024 | — |

Mobile-first. Every grid starts at one column: `grid gap-3 sm:grid-cols-2`. There is no
tablet-specific layout. The Tauri window minimum is 800×600, so the layout must be
correct from 800px up; the browser build must work down to 360px.

### 4.5 Touch and pointer targets

Minimum interactive target is 32×32px, 40×40px for primary actions. Icon-only buttons
carry an `aria-label`. The Tauri window is a desktop target, so hover states are
required, not optional.

---

## 5. Shape and elevation

### 5.1 Radius

| Token | px | Use |
| --- | --- | --- |
| `rounded-lg` | 8 | Inline notices, code, small chips. |
| `rounded-xl` | 12 | Buttons, inputs, selectable cards, panels. |
| `rounded-2xl` / `1rem`–`1.25rem` | 16–20 | `.card` and `.card-lg`. |
| `rounded-full` | — | Badges, pills, avatars, status dots. |

Nesting rule: a child's radius is never larger than its parent's.

### 5.2 Elevation

| Token | Light | Use |
| --- | --- | --- |
| `--shadow-sm` | `0 1px 3px rgba(0,0,0,.06)` | Resting card, resting button. |
| `--shadow-md` | `0 4px 12px rgba(0,0,0,.07)` | Card hover, secondary button hover. |
| `--shadow-lg` | `0 10px 30px rgba(0,0,0,.08)` | Glass surface, overlay. |
| `--shadow-xl` | `0 20px 50px rgba(0,0,0,.1)` | Modal, pulse. |

Dark mode uses deeper, more opaque shadows. Elevation is a **hover affordance** here,
not a hierarchy device: cards rest at `sm` and rise to `md` on hover.

**One elevation change per interaction.** A card that scales, changes shadow, and
changes border on hover is doing too much.

---

## 6. Components

All primitives live in `src/app/globals.css` under `@layer components`. Prefer these
classes over ad-hoc utility piles. Full specs are in the source; the contract is below.

### 6.1 Card

`.card`, `.card-lg`, `.card-glass`

A bordered surface with a 1rem radius, `--card` background, and `--shadow-sm` rising to
`--shadow-md` on hover. `.card-lg` adds padding for the primary content column.
`.card-glass` is reserved for overlays that sit above content.

Cards do not nest. If a card needs a sub-panel, use a bordered `rounded-xl` block or a
`bg-sidebar` recess.

### 6.2 Button

`.btn` plus exactly one variant.

| Variant | Use | Limit |
| --- | --- | --- |
| `.btn-primary` | The single primary action on a screen. | One per view. |
| `.btn-secondary` | Alternative and refresh actions. | — |
| `.btn-ghost` | Tertiary and cancel actions. | — |

`.btn` is 40px tall with a 12px radius. It scales to 0.97 on `:active` and reveals a
10% white overlay on hover. Disabled is 50% opacity with `cursor: not-allowed`.

Size overrides use `!py-1 !px-3` for compact contexts. Never change the radius.

**Destructive actions are not a fourth variant.** A destructive action uses
`.btn-secondary` with `text-accent-red`, and requires a confirmation step.

### 6.3 Input

`.input-field` — textarea, `input`, and `select` all share it. 12px radius, `--card`
background, 0.9375rem text. Focus is `border-color: var(--primary)` plus a 3px
`rgba(99,102,241,.15)` ring.

Every input has a visible `<label>`. Placeholder text is an example, never the label.

**Native `<select>` is a known inconsistency.** It cannot be styled consistently across
platforms inside the Tauri webview. See §11.

### 6.4 Badge

`.badge` plus one variant.

| Variant | Use |
| --- | --- |
| `.badge-primary` | Neutral metadata, counts, categories. |
| `.badge-green` | Positive state: installed, available, connected. |

`badge-secondary` is referenced by the Settings page but **is not defined**. See §11.

### 6.5 Pill

`.pill` — a selectable chip for topic suggestions and language tags. Hover promotes the
border and text to `primary`. Pills are for suggestions and filters, not for navigation.

### 6.6 Status dot

A 8–10px `rounded-full` span, `bg-green-400` (available) or `bg-gray-300` (unavailable),
usually paired with a pulsing ring for "live" states.

**Status is never conveyed by color alone.** Every dot is accompanied by text.

### 6.7 Skeleton

`.skeleton` — a shimmering placeholder on a `--card-border` to `--sidebar` gradient. Use
only where the shape of the incoming content is known. Always pair with a text label:
`Profiling model capabilities…`, not a bare bar.

### 6.8 Selectable card

The pattern used for difficulty, length, language, and provider choices: a
`rounded-xl` bordered button with an emoji, a `text-sm font-semibold` label, and a
`text-[10px] text-muted` description.

```
selected    → border-primary bg-primary-soft
unselected  → border-card-border bg-card hover:border-primary/50
```

These are `role="radio"` semantics in intent but are implemented as buttons. See §11.

---

## 7. Motion

### 7.1 Durations and easing

| Token | Value | Use |
| --- | --- | --- |
| `--dur-fast` | 200ms | Hover, colour, border. |
| `--dur-base` | 300ms | Shadow, opacity. |
| `--dur-slow` | 400ms | Entrance animations. |
| easing | `ease-out` | Everything. |

Nothing animates longer than 400ms. Nothing animates on scroll.

### 7.2 Named animations

| Class | Effect | Use |
| --- | --- | --- |
| `.animate-fade-in` | opacity 0→1, 400ms | Page header. |
| `.animate-slide-up` | opacity 0→1 + translateY 16px→0, 400ms | Cards and sections entering. |
| `.animate-scale-in` | opacity 0→1 + scale .95→1, 300ms | Inline notices and errors. |
| `.skeleton` | shimmer, 1.5s infinite | Loading placeholders. |

Entrance animations fire once, on mount. They are not replayed on state change.

### 7.3 The one loop

`animate-pulse` on the header status dot is the app's only infinite animation besides
the skeleton shimmer. It signals "connected and live".

### 7.4 Reduced motion

`prefers-reduced-motion: reduce` must disable `slideUp`, `scaleIn`, `fadeIn`, the
skeleton shimmer, and the status pulse. Currently unimplemented. See §11.

---

## 8. Dark mode

`darkMode: "class"`. The `dark` class is set on `<html>` by `ThemeProvider`, and
`suppressHydrationWarning` is set on `<html>` in `layout.tsx` to absorb the pre-paint
theme read.

Every color token has a dark value. A component that reads well in light mode and
poorly in dark mode is a token bug, not a component bug — fix the token.

**Never hardcode a light-mode value.** `bg-white`, `text-black`, `border-gray-200`,
and `bg-amber-50` without a `dark:` counterpart are all defects. Tinted notices use the
`bg-{color}-50 dark:bg-{color}-900/15` pairing with a matching
`border-{color}-200 dark:border-{color}-800/30`.

---

## 9. Accessibility

**Contrast.** Body text meets 4.5:1. Large text (18px+ bold, 24px+) meets 3:1. The
`muted` token must be darkened in light mode to clear 4.5:1 on `--card`.

**Focus.** Every interactive element shows a visible focus ring: 2px `primary` at 2px
offset. Never `outline: none` without a replacement. The `.input-field` focus ring is
the reference implementation.

**Keyboard.** Tab order follows reading order. Escape closes overlays. The generate
flow is fully operable without a pointer.

**Semantics.** One `h1` per page; headings descend without skipping. Icon-only buttons
carry `aria-label`. Live regions (`aria-live="polite"`) announce generation status and
errors. Selectable-card groups need `role="radiogroup"` and arrow-key navigation.

**Language and direction.** Arabic content sets `dir="rtl"` and `lang="ar"` on the
content container, not the whole document. `detectLanguage()` in
`src/lib/generation.ts` decides. RTL layouts mirror padding and alignment; they do not
mirror the NavBar's brand mark.

**Motion.** Honour `prefers-reduced-motion` as specified in §7.4.

---

## 10. Content surface specification

Lesson and podcast content is the product. It has stricter rules than the chrome.

**Structure.** Lesson HTML exports as a self-contained document: heading hierarchy,
`max-width` measure, generous line height, and a `system-ui`-first stack that matches
§3.1. It must render identically in the app and in a browser after export.

**Podcast scripts** render as per-speaker blocks with a speaker label and a
`rounded-xl` container. Host A and Host B are visually distinguishable by label and
alignment, not by color alone.

**Quiz items** present four options as full-width selectable rows with a 44px minimum
height, then reveal per-question explanations. Correct and incorrect states use
`accent-green` and `accent-red` with an icon and text, never color alone.

**Long-form reading** never sits on a `card-glass` surface, never uses `text-muted` for
body copy, and never exceeds a 75-character measure.

---

## 11. Known deviations from this document

Each item is a live defect. Fixes are tracked in `AUDIT.md`.

| # | Deviation | Evidence | Impact |
| --- | --- | --- | --- |
| D1 | ~~`bg-primary-soft`, `from-primary-soft`, `to-accent-blue`, `text-accent-red`, `text-accent-green`, `border-accent-green`, `border-accent-red` are used in JSX but absent from `tailwind.config.ts`.~~ | **FIXED** — all 5 tokens added to `colors`; `scripts/check-tokens.mjs` now fails the build if any token utility emits no CSS. | Verified: each previously-zero class emits exactly 1 rule in the export. |
| D2 | ~~`badge-secondary` is used in `settings/page.tsx` but never defined in `globals.css`.~~ | **FIXED** — `.badge-secondary`, `.badge-amber` and `.badge-red` added under `@layer components`. | |
| D3 | ~~Inter is declared in `globals.css` and the exported lesson HTML but is never loaded.~~ | **FIXED** — `next/font` self-hosts Inter as `--font-inter`; 8 `@font-face` rules in the export. | Root cause was `babel.config.js` silently disabling SWC, which blocks `next/font` entirely. That file is removed. |
| D4 | ~~`GeistVF.woff` and `GeistMonoVF.woff` ship in `src/app/fonts/` but are never imported.~~ | **FIXED (Mono)** — `GeistMonoVF.woff` is wired via `next/font/local` and `font-mono` now resolves to it. `GeistVF.woff` (66 KB) remains unused; see the note below. | The one `font-mono` usage had been silently falling back to Tailwind's default stack. |
| D5 | `prefers-reduced-motion` is not handled. | No media query in `globals.css`. | Motion-sensitive users cannot disable the entrance animations. |
| D6 | `muted` (`#64748b`) on `card` (`#ffffff`) measures ~4.3:1. | Below the 4.5:1 requirement in §2.5. | Small muted labels fail WCAG AA. |
| D7 | Page titles, buttons, and section headings use Title Case. | `Pursue Truth`, `Generate Lesson`, `Difficulty Level`. | Contradicts the sentence-case rule in §3.4. |
| D8 | `text-[9px]` and `text-[10px]` are used for real content, not just decoration. | Generate and Settings pages. | Sub-11px text is not reliably legible. |
| D9 | Selectable-card groups are built from `<button>` elements with no `role="radiogroup"` or arrow-key support. | `generate/page.tsx` difficulty, length, and language pickers. | Keyboard and screen-reader users get no group semantics. |

**Open decision — `GeistVF.woff` (66 KB).** `src/app/fonts/GeistVF.woff` is the Geist
*sans* face and is now redundant: body text uses Inter. It is still in the repo and still
unreferenced. Two clean options:

1. **Delete it** — 66 KB of dead weight, Inter is the declared body face.
2. **Adopt Geist as the body face instead of Inter** — swap the `Inter` import in
   `layout.tsx` for a `localFont` pointing at `GeistVF.woff`. Geist is the Vercel
   typeface and pairs with Geist Mono, so this is a coherent choice if the brand
   preference is Geist.

This one is a brand decision, not a defect, so it is left to the owner rather than
guessed at. Do not wire both.

---

## 12. Adoption checklist

Before adding or changing UI:

1. Every colour comes from a token in §2. No hex literals in components.
2. Every new utility class is verified to exist in the compiled CSS
   (`next build`, then grep the emitted stylesheet). This is the check that D1 and D2
   would have caught.
3. One primary action per view. One gradient per page. One `h1` per page.
4. Both themes checked. Every hardcoded colour has a `dark:` counterpart.
5. Focus ring present and visible. Contrast verified against §2.5.
6. Copy follows §1 Voice. Sentence case.
7. `prefers-reduced-motion` respected for any new animation.
8. Tested at 360px, 800px, and 1280px widths.
