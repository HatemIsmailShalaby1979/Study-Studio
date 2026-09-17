#!/usr/bin/env node
// Token guard — fails when a Tailwind colour utility used in src/ emits no CSS.
//
// Why this exists: Tailwind only generates a utility for colours declared in
// tailwind.config.ts. A class like `bg-primary-soft` used in JSX compiles to
// nothing if `primary-soft` is missing from the config, and neither TypeScript
// nor ESLint can see that. Study Studio shipped 60 such usages before this
// guard existed (see AUDIT.md P0-1).
//
// Usage:
//   npm run build:prod          # produce out/
//   npm run check:tokens        # verify every token utility resolved
//
// Exits 0 when clean, 1 with a per-class report otherwise.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SRC = join(ROOT, "src");
const CSS_DIR = join(ROOT, "out", "_next", "static", "css");

/** Colour token names declared in globals.css that must be usable as utilities. */
const TOKENS = [
  "background",
  "foreground",
  "card",
  "card-border",
  "primary",
  "primary-hover",
  "primary-soft",
  "sidebar",
  "sidebar-hover",
  "muted",
  "accent-green",
  "accent-red",
  "accent-blue",
  "accent-amber",
];

/** Utility prefixes that consume a colour token. */
const PREFIXES = ["bg", "text", "border", "from", "to", "via", "ring", "fill", "stroke"];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (/\.(tsx?|jsx?|mdx)$/.test(name)) out.push(full);
  }
  return out;
}

/** Find every `<prefix>-<token>` occurrence, with the file and line it came from. */
function collectUsages() {
  const pattern = new RegExp(
    `\\b(${PREFIXES.join("|")})-(${TOKENS.join("|")})(?![\\w-])`,
    "g"
  );
  const usages = new Map(); // class -> [{ file, line }]

  for (const file of walk(SRC)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const match of line.matchAll(pattern)) {
        const cls = `${match[1]}-${match[2]}`;
        if (!usages.has(cls)) usages.set(cls, []);
        usages.get(cls).push({ file: relative(ROOT, file).split(sep).join("/"), line: i + 1 });
      }
    });
  }
  return usages;
}

/**
 * Read every emitted stylesheet and return their combined text.
 *
 * Reading only the first file would be wrong: Next.js can emit more than one
 * stylesheet (per-route chunks), and a stale file left in `out/` from an
 * earlier build would make a broken class look emitted. The union of all
 * files is the correct question to ask — "did this utility get compiled
 * anywhere in this build?".
 */
function findStylesheet() {
  if (!existsSync(CSS_DIR)) return null;
  const files = readdirSync(CSS_DIR).filter((f) => f.endsWith(".css"));
  if (files.length === 0) return null;
  const sheet = files.map((f) => readFileSync(join(CSS_DIR, f), "utf8")).join("\n");
  return { sheet, fileCount: files.length };
}

function main() {
  const found = findStylesheet();
  if (!found) {
    console.error(
      "check:tokens — no compiled stylesheet found.\n" +
        "Run `npm run build:prod` first (it emits out/_next/static/css/)."
    );
    process.exit(1);
  }
  const { sheet, fileCount } = found;

  const usages = collectUsages();
  const broken = [];

  for (const [cls, sites] of usages) {
    // A utility is "emitted" when its class selector appears in the output.
    //
    // The trailing guard matters: a naive `sheet.includes(".bg-card")` also
    // matches `.bg-card-border`, so a genuinely missing `bg-card` would be
    // reported as fine. Requiring a non-identifier character after the name
    // (end of selector, `{`, `,`, `\` for an escaped variant modifier, space)
    // makes the check exact.
    const escaped = cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const selector = new RegExp(`\\.${escaped}(?![\\w-])`);
    if (!selector.test(sheet)) broken.push({ cls, sites });
  }

  if (broken.length === 0) {
    console.log(
      `check:tokens — OK. ${usages.size} token utilities resolved across ${fileCount} stylesheet(s).`
    );
    process.exit(0);
  }

  console.error(`check:tokens — ${broken.length} token utilities emit no CSS:\n`);
  for (const { cls, sites } of broken.sort((a, b) => b.sites.length - a.sites.length)) {
    console.error(`  ${cls}  (${sites.length} usage${sites.length === 1 ? "" : "s"})`);
    for (const s of sites.slice(0, 5)) console.error(`      ${s.file}:${s.line}`);
    if (sites.length > 5) console.error(`      … and ${sites.length - 5} more`);
  }
  console.error(
    "\nAdd the missing token to `colors` in tailwind.config.ts, then rebuild.\n" +
      "See DESIGN.md §11 and AUDIT.md P0-1."
  );
  process.exit(1);
}

main();
