/**
 * Pushes the freshly rendered page into the WordPress page at
 * uscivicstest.us/current-answers.
 *
 *   node scripts/dynamic-answers/push-wordpress.mjs [--compact] [--dry-run]
 *
 * Required environment:
 *   WPCOM_TOKEN    WordPress.com OAuth2 bearer token with `posts` scope
 *   WPCOM_SITE_ID  numeric site id           (default 253454740)
 *   WPCOM_PAGE_ID  numeric page id to update (default 295)
 *
 * Without WPCOM_TOKEN this exits 0 without doing anything, so the scheduled
 * refresh still publishes the JSON feed and the GitHub Pages copy on a repo that
 * has not been given WordPress credentials.
 *
 * Only the page *content* is sent. Title, slug, menu position and published
 * state are left alone, so this can never publish a page the user has chosen to
 * keep as a draft, and never renames one they have retitled.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

const args = process.argv.slice(2);
const COMPACT = args.includes("--compact");
const DRY_RUN = args.includes("--dry-run");

const SITE_ID = process.env.WPCOM_SITE_ID ?? "253454740";
const PAGE_ID = process.env.WPCOM_PAGE_ID ?? "295";

/**
 * The token is obtained by hand from an OAuth redirect, where it arrives as a
 * URL fragment: `#access_token=XXX&expires_in=...&token_type=bearer`. Copying
 * that out of an address bar very easily picks up the `access_token=` prefix,
 * the trailing `&...` parameters, a leading `#`, or a stray newline — and
 * WordPress answers every one of those with the same opaque
 * `oauth2_invalid_token`.
 *
 * So: repair what is unambiguously repairable, and describe the *shape* of what
 * is left when it still fails. Nothing here ever prints the value itself; a CI
 * log is not a place for a live credential, and GitHub's `***` masking only
 * covers the exact stored string, not a substring of it.
 */
function normalizeToken(raw) {
  if (!raw) return { token: null, notes: [] };
  const notes = [];
  let t = raw.trim();
  if (t !== raw) notes.push("stripped surrounding whitespace/newline");

  if (t.startsWith("#") || t.startsWith("?")) {
    t = t.slice(1);
    notes.push("stripped a leading '#' or '?' — that is URL-fragment syntax, not part of the token");
  }

  // A pasted fragment (or full redirect URL) still contains the parameter name.
  const m = t.match(/(?:^|[#?&])access_token=([^&\s]+)/);
  if (m) {
    t = m[1];
    notes.push("extracted the value from an `access_token=...` fragment");
  }

  if (/%[0-9A-Fa-f]{2}/.test(t)) {
    try {
      const decoded = decodeURIComponent(t);
      if (decoded !== t) {
        t = decoded;
        notes.push("percent-decoded the value");
      }
    } catch {
      notes.push("value contains '%' but is not valid percent-encoding — left as-is");
    }
  }

  return { token: t, notes };
}

/** A description of the token that is safe to print in a public CI log. */
function describeShape(t) {
  return [
    `length=${t.length}`,
    `charset=${/^[\w.~-]+$/.test(t) ? "url-safe" : "contains punctuation/symbols"}`,
    /\s/.test(t) ? "CONTAINS WHITESPACE" : null,
    t.includes("&") ? "CONTAINS '&' — likely still a URL fragment" : null,
    t.includes("=") ? "CONTAINS '=' — likely still a key=value pair" : null,
    /token_type|expires_in|site_id|scope=/.test(t) ? "CONTAINS other OAuth params" : null,
  ]
    .filter(Boolean)
    .join(", ");
}

const { token: TOKEN, notes } = normalizeToken(process.env.WPCOM_TOKEN);
for (const n of notes) console.log(`note: ${n}`);

if (!TOKEN && !DRY_RUN) {
  console.log("WPCOM_TOKEN not set — skipping the WordPress push.");
  process.exit(0);
}

const file = COMPACT ? "wordpress-compact.html" : "wordpress-inline.html";
const fragment = await readFile(path.join(REPO, "public", "api", file), "utf8");

// WordPress.com Simple sites strip <style> and <script> from post content, so
// the fragment must already be inline-styled. Guard rather than silently
// publishing a page whose styling will be thrown away.
if (/<style[\s>]|<script[\s>]/i.test(fragment)) {
  console.error(`${file} contains <style> or <script>, which this host strips. Refusing to push.`);
  process.exit(1);
}

const content = `<!-- wp:html -->\n${fragment}\n<!-- /wp:html -->`;

if (DRY_RUN) {
  console.log(`dry run — would push ${content.length} bytes from ${file} to page ${PAGE_ID}`);
  process.exit(0);
}

const res = await fetch(
  `https://public-api.wordpress.com/wp/v2/sites/${SITE_ID}/pages/${PAGE_ID}`,
  {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ content }),
  }
);

if (!res.ok) {
  const body = (await res.text()).slice(0, 500);
  console.error(`WordPress push failed: HTTP ${res.status}`);
  console.error(body);

  if (res.status === 401) {
    console.error("");
    console.error(`The token WordPress rejected has: ${describeShape(TOKEN)}`);
    console.error("");
    console.error("A WordPress.com access token is a single opaque string. If the shape above");
    console.error("mentions whitespace, '&', '=' or other OAuth parameters, the secret still");
    console.error("holds part of the redirect URL rather than just the token.");
    console.error("");
    console.error("Re-authorize and copy ONLY the value between `access_token=` and the next `&`:");
    console.error(`  https://public-api.wordpress.com/oauth2/authorize?client_id=145694&redirect_uri=https%3A%2F%2Fuscivicstest.us&response_type=token&blog=${SITE_ID}`);
    console.error("");
    console.error("Also check it is the access token and not the application's Client Secret —");
    console.error("the two sit next to each other on the app page and are easy to confuse.");
  }
  process.exit(1);
}

const json = await res.json();
console.log(`WordPress page ${PAGE_ID} updated (${content.length} bytes) — ${json.link ?? ""}`);
