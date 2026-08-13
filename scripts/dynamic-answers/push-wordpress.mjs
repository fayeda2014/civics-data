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

const TOKEN = process.env.WPCOM_TOKEN;
const SITE_ID = process.env.WPCOM_SITE_ID ?? "253454740";
const PAGE_ID = process.env.WPCOM_PAGE_ID ?? "295";

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
  console.error(`WordPress push failed: HTTP ${res.status}`);
  console.error((await res.text()).slice(0, 500));
  process.exit(1);
}

const json = await res.json();
console.log(`WordPress page ${PAGE_ID} updated (${content.length} bytes) — ${json.link ?? ""}`);
