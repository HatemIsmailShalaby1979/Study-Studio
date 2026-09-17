// The single sanctioned console sink for production code.
//
// Why: `no-console` is on for `src/**`, which is correct — an accidental
// `console.log` left in a render path is noise in the user's devtools and in
// the Tauri log. But Study Studio genuinely wants a handful of startup
// diagnostics (which provider came up, whether a model was loaded, why a load
// failed). Rather than scatter eslint-disable comments, every intentional
// production log goes through here.
//
// The rule is therefore still meaningful: a bare `console.log` anywhere else in
// `src/**` is a warning. Tests are exempted via an `.eslintrc.json` override.
//
// `no-console` is disabled for this file only.

/* eslint-disable no-console */

/** Diagnostic output. Visible in the webview devtools and the Tauri console. */
export function log(...args: unknown[]): void {
  console.log(...args);
}

/** Same as `log`, but for verbose per-call tracing that is usually off. */
export function trace(...args: unknown[]): void {
  if (process.env["NEXT_PUBLIC_DEBUG"] === "true") console.log(...args);
}

/* eslint-enable no-console */
