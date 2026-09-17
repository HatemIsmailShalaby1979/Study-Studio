#!/usr/bin/env node
// Version-consistency guard.
//
// The version lives in FOUR manifests:
//   package.json                        (repo root)
//   apps/desktop/package.json           (the app)
//   apps/desktop/src-tauri/tauri.conf.json  (the desktop bundle)
//   apps/desktop/src-tauri/Cargo.toml   (the Rust crate)
//
// Nothing keeps them in step. A release that bumps three of the four ships an
// installer whose reported version disagrees with the crate that built it — the
// kind of drift that is invisible until someone is debugging a bug report
// against the wrong build. This script makes the mismatch loud instead.
//
// Usage: npm run check:versions
// Exits 0 when all four agree, 1 otherwise.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");

/** Every place the version is declared, with a regex to pull it out. */
const MANIFESTS = [
  { path: "package.json", label: "root package.json", re: /"version"\s*:\s*"([^"]+)"/ },
  {
    path: "apps/desktop/package.json",
    label: "desktop package.json",
    re: /"version"\s*:\s*"([^"]+)"/,
  },
  {
    path: "apps/desktop/src-tauri/tauri.conf.json",
    label: "tauri.conf.json",
    re: /"version"\s*:\s*"([^"]+)"/,
  },
  {
    path: "apps/desktop/src-tauri/Cargo.toml",
    label: "Cargo.toml",
    // Match the `version = "x"` under [package], not a dependency's version.
    re: /^\s*version\s*=\s*"([^"]+)"/m,
  },
];

function main() {
  const found = [];

  for (const m of MANIFESTS) {
    const full = join(ROOT, m.path);
    if (!existsSync(full)) {
      console.error(`check:versions — missing manifest: ${m.path}`);
      process.exit(1);
    }
    const match = readFileSync(full, "utf8").match(m.re);
    if (!match) {
      console.error(`check:versions — could not read a version from ${m.path}`);
      process.exit(1);
    }
    found.push({ label: m.label, version: match[1] });
  }

  const unique = [...new Set(found.map((f) => f.version))];
  const width = Math.max(...found.map((f) => f.label.length));

  for (const f of found) {
    console.log(`  ${f.label.padEnd(width)}  ${f.version}`);
  }

  if (unique.length > 1) {
    console.error(
      `\ncheck:versions — the manifests disagree: ${unique.join(", ")}.\n` +
        "Bump all of them together, or generate one from another."
    );
    process.exit(1);
  }

  console.log(`\ncheck:versions — OK. All ${found.length} manifests at ${unique[0]}.`);
  process.exit(0);
}

main();
