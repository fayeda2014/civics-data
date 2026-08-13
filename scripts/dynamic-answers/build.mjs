/**
 * Builds the published dynamic-answers database.
 *
 *   node scripts/dynamic-answers/build.mjs [--strict] [--out <dir>]
 *
 * Reads every source, merges manual overrides over the top, validates the
 * result, and writes `civics-dynamic-v1.json` plus a human-readable page.
 *
 * The governing rule is **never regress**. If a source fails or comes back
 * obviously wrong, the previously published value for that field is carried
 * forward and a warning is recorded — a transient 503 from one site must never
 * blank out an answer that the app is serving to someone studying for their
 * interview. `--strict` additionally makes the process exit non-zero when
 * anything failed, so CI can refuse to publish and raise an issue instead.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  fetchExecutive,
  fetchSpeaker,
  fetchChiefJustice,
  fetchSenators,
  fetchRepresentatives,
  fetchGovernors,
  crossCheck,
  WHITEHOUSE_URL,
  SPEAKER_URL,
  SCOTUS_URL,
  SENATE_URL,
  HOUSE_URL,
  NGA_URL,
} from "./sources.mjs";
import { STATES, STATE_NAME_TO_CODE, FIFTY_STATES } from "./states.mjs";
import { renderPage, renderWordPressFragment, renderWordPressScoped } from "./render.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

const SCHEMA_VERSION = 1;
const OUTPUT_BASENAME = "civics-dynamic-v1.json";

/**
 * Where the published feed will live. Point this at a custom subdomain once
 * DNS is in place — the app should never hard-code a github.io host it cannot
 * move off later.
 */
const JSON_URL =
  process.env.CIVICS_JSON_URL ??
  "https://fayeda2014.github.io/civics-data/api/civics-dynamic-v1.json";

/** The full human-readable listing, linked from the shortened WordPress page. */
const PAGE_URL =
  process.env.CIVICS_PAGE_URL ?? "https://fayeda2014.github.io/civics-data/api/";

const args = process.argv.slice(2);
const STRICT = args.includes("--strict");
const OUT_DIR = (() => {
  const i = args.indexOf("--out");
  return i >= 0 && args[i + 1] ? path.resolve(args[i + 1]) : path.join(REPO, "public", "api");
})();

const warnings = [];
const errors = [];
const notices = [];

const warn = (m) => warnings.push(m);
const fail = (m) => errors.push(m);
const note = (m) => notices.push(m);

/** Run a fetcher, converting any throw into a recorded error + null result. */
async function attempt(label, fn) {
  try {
    return await fn();
  } catch (err) {
    fail(`${label}: ${err.message}`);
    return null;
  }
}

/** The last published file, used to carry values forward when a source fails. */
async function loadPrevious() {
  const p = path.join(OUT_DIR, OUTPUT_BASENAME);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(await readFile(p, "utf8"));
  } catch {
    warn("previous published file exists but could not be parsed; ignoring it");
    return null;
  }
}

/**
 * An override may be written as a bare value or as
 * `{ value, reviewBy, reason }`. The long form is preferred for anything tied
 * to a known future event (an election, an inauguration): once `reviewBy`
 * passes, the build warns, so a pinned value cannot quietly outlive its reason.
 */
function normalizeOverride(raw, label) {
  if (raw == null) return null;
  const o = typeof raw === "object" && !Array.isArray(raw) && "value" in raw ? raw : { value: raw };
  if (o.reviewBy && new Date(o.reviewBy) < new Date()) {
    warn(`override for ${label} passed its review date ${o.reviewBy}${o.reason ? ` (${o.reason})` : ""} — re-check it`);
  }
  return o;
}

async function loadOverrides() {
  try {
    const raw = JSON.parse(await readFile(path.join(HERE, "overrides.json"), "utf8"));
    return { national: raw.national ?? {}, states: raw.states ?? {} };
  } catch (err) {
    warn(`overrides.json unreadable (${err.message}); continuing without overrides`);
    return { national: {}, states: {} };
  }
}

/**
 * Build one national field, in priority order: manual override, then the live
 * source, then whatever was published last time.
 */
function nationalField({ key, fetched, sourceUrl, sourceName, overrides, previous }) {
  const override = normalizeOverride(overrides.national?.[key], key);
  if (override) {
    note(`override in effect for ${key}: "${override.value}"${fetched ? ` (source said "${fetched}")` : ""}`);
    if (fetched && fetched === override.value) {
      note(`override for ${key} now matches ${sourceName} — safe to delete from overrides.json`);
    }
    return { value: override.value, source: "manual-override", sourceUrl, confidence: "manual" };
  }

  if (fetched) {
    return { value: fetched, source: sourceName, sourceUrl, confidence: "official" };
  }

  const prior = previous?.national?.[key];
  if (prior?.value) {
    warn(`${key}: could not read ${sourceName}; carrying forward "${prior.value}" from ${previous.generatedAt}`);
    return { ...prior, confidence: "carried-forward", carriedForwardFrom: previous.generatedAt };
  }

  fail(`${key}: no value from ${sourceName} and nothing previously published`);
  return null;
}

async function main() {
  const startedAt = new Date().toISOString();
  const previous = await loadPrevious();
  const overrides = await loadOverrides();

  // All six sources are independent — fetch them concurrently so one slow site
  // does not serialise the whole run.
  const [exec, speaker, scotus, senate, house, governors] = await Promise.all([
    attempt("whitehouse.gov", fetchExecutive),
    attempt("house.gov/leadership", fetchSpeaker),
    attempt("supremecourt.gov", fetchChiefJustice),
    attempt("senate.gov", fetchSenators),
    attempt("clerk.house.gov", fetchRepresentatives),
    attempt("nga.org", () => fetchGovernors(STATE_NAME_TO_CODE)),
  ]);

  /* ---------------- national ---------------- */

  const national = {};
  const nationalSpecs = [
    { key: "president", fetched: exec?.president, sourceUrl: WHITEHOUSE_URL, sourceName: "whitehouse.gov" },
    { key: "vicePresident", fetched: exec?.vicePresident, sourceUrl: WHITEHOUSE_URL, sourceName: "whitehouse.gov" },
    { key: "speaker", fetched: speaker?.speaker, sourceUrl: SPEAKER_URL, sourceName: "house.gov" },
    { key: "chiefJustice", fetched: scotus?.chiefJustice, sourceUrl: SCOTUS_URL, sourceName: "supremecourt.gov" },
  ];

  for (const spec of nationalSpecs) {
    const field = nationalField({ ...spec, overrides, previous });
    if (field) national[spec.key] = { ...field, verifiedAt: startedAt };
  }

  /* ---------------- states ---------------- */

  const states = {};

  for (const s of STATES) {
    const rawOv = overrides.states?.[s.code] ?? {};
    const ov = {
      governor: normalizeOverride(rawOv.governor, `${s.code}.governor`)?.value,
      senators: normalizeOverride(rawOv.senators, `${s.code}.senators`)?.value,
      representatives: rawOv.representatives,
    };
    const prior = previous?.states?.[s.code];

    const entry = {
      name: s.name,
      capital: s.capital,
      ...(s.territory ? { territory: true } : {}),
      ...(s.answerNote ? { answerNote: s.answerNote } : {}),
    };

    /* governor */
    const govFetched = governors?.byState?.[s.code]?.name ?? null;
    if (ov.governor) {
      entry.governor = ov.governor;
      entry.governorSource = "manual-override";
      if (govFetched === ov.governor) {
        note(`override for ${s.code} governor now matches nga.org — safe to delete`);
      } else if (govFetched) {
        warn(
          `${s.code} governor override "${ov.governor}" CONTRADICTS nga.org, which says "${govFetched}". ` +
            `Confirm the source is actually wrong before trusting the override.`
        );
      }
    } else if (govFetched) {
      entry.governor = govFetched;
      entry.governorSource = "nga.org";
    } else if (prior?.governor) {
      entry.governor = prior.governor;
      entry.governorSource = "carried-forward";
      warn(`${s.code}: no governor from nga.org; carried forward "${prior.governor}"`);
    } else if (!s.territory) {
      fail(`${s.code}: no governor available from any source`);
    }

    // DC's chief executive is a mayor, not a governor, and the NGA roster does
    // not carry DC at all. The correct USCIS answer here is the absence itself,
    // so the note is set whether or not a name was supplied via override.
    if (s.code === "DC") {
      entry.governorNote = "Washington, D.C. does not have a governor. D.C. has a mayor.";
      if (entry.governor) entry.governorTitle = "Mayor";
    }

    /* senators — only the 50 states have them */
    const senFetched = senate?.byState?.[s.code] ?? null;
    if (s.territory) {
      // Checked before any source: having no senators is a fact about the
      // territory, not a failed lookup, and must not be reported as one.
      entry.senators = [];
      entry.senatorsNote = `${s.name} does not have U.S. Senators.`;
    } else if (ov.senators) {
      entry.senators = ov.senators;
      entry.senatorsSource = "manual-override";
      const fetchedNames = senFetched?.map((x) => x.name) ?? [];
      if (fetchedNames.length && fetchedNames.join("|") !== [...ov.senators].join("|")) {
        // senate.gov is the roster of sitting members; disagreeing with it is
        // almost always the override being out of date rather than a mis-parse.
        warn(
          `${s.code} senators override [${ov.senators.join(", ")}] CONTRADICTS senate.gov, ` +
            `which lists [${senFetched.map((x) => `${x.name} (${x.bioguideId})`).join(", ")}]. ` +
            `Check the raw feed before trusting the override.`
        );
      }
    } else if (senFetched) {
      entry.senators = senFetched.map((x) => x.name);
      entry.senatorsDetail = senFetched;
      entry.senatorsSource = "senate.gov";
    } else if (prior?.senators?.length) {
      entry.senators = prior.senators;
      entry.senatorsDetail = prior.senatorsDetail;
      entry.senatorsSource = "carried-forward";
      warn(`${s.code}: no senators from senate.gov; carried forward previous pair`);
    } else {
      fail(`${s.code}: no senators available from any source`);
    }

    /* representatives */
    const repFetched = house?.byState?.[s.code] ?? null;
    if (repFetched) {
      // `null` means the seat is genuinely vacant, which is different from the
      // key being absent (unknown). Consumers should say "this seat is
      // currently vacant" rather than fall back to a stale name.
      entry.representatives = Object.fromEntries(
        Object.entries(repFetched).map(([d, r]) => [d, r.vacant ? null : r.name])
      );
      entry.representativesDetail = repFetched;
      entry.representativesSource = "clerk.house.gov";
    } else if (prior?.representatives) {
      entry.representatives = prior.representatives;
      entry.representativesDetail = prior.representativesDetail;
      entry.representativesSource = "carried-forward";
      warn(`${s.code}: no representatives from clerk.house.gov; carried forward`);
    }

    // Per-district overrides land on top of whichever source won.
    if (ov.representatives) {
      entry.representatives = { ...(entry.representatives ?? {}), ...ov.representatives };
      entry.representativesSource = "manual-override";
    }

    // At-Large states have exactly one seat, published under district 0. Naming
    // it explicitly saves the app a special case.
    if (entry.representatives && Object.keys(entry.representatives).length === 1 && entry.representatives["0"]) {
      entry.atLarge = true;
    }

    states[s.code] = entry;
  }

  /* ---------------- validation ---------------- */

  if (senate && senate.count !== 100) {
    fail(`senate.gov returned ${senate.count} senators, expected 100`);
  }
  if (house && house.seatCount !== 435) {
    // Seats, not members: 435 is fixed by apportionment, so a different number
    // means the feed or the parser is wrong, not that someone resigned.
    fail(`clerk.house.gov yielded ${house.seatCount} voting seats, expected exactly 435`);
  }
  if (house?.vacantCount) {
    note(`${house.vacantCount} House seat(s) currently vacant; published as vacancies`);
  }
  if (governors?.unmatched?.length) {
    warn(`nga.org listed states this build could not map: ${governors.unmatched.join(", ")}`);
  }

  const missingGov = FIFTY_STATES.filter((c) => !states[c]?.governor);
  if (missingGov.length) fail(`missing governor for: ${missingGov.join(", ")}`);

  const wrongSenators = FIFTY_STATES.filter((c) => (states[c]?.senators?.length ?? 0) !== 2);
  if (wrongSenators.length) fail(`expected exactly 2 senators for: ${wrongSenators.join(", ")}`);

  const missingReps = FIFTY_STATES.filter(
    (c) => !states[c]?.representatives || Object.keys(states[c].representatives).length === 0
  );
  if (missingReps.length) fail(`missing representatives for: ${missingReps.join(", ")}`);

  /* ---------------- independent cross-check ---------------- */

  const checks = await Promise.all([
    crossCheck("President_of_the_United_States", [national.president?.value]),
    crossCheck("Vice_President_of_the_United_States", [national.vicePresident?.value]),
    crossCheck("Speaker_of_the_United_States_House_of_Representatives", [national.speaker?.value]),
    crossCheck("Chief_Justice_of_the_United_States", [national.chiefJustice?.value]),
    crossCheck(
      "List_of_current_United_States_governors",
      FIFTY_STATES.map((c) => states[c]?.governor)
    ),
  ]);

  for (const c of checks) {
    if (c.ok === false) {
      warn(`cross-check FAILED against Wikipedia "${c.article}": not found there — ${c.missing.join(", ")}`);
    } else if (c.ok === null) {
      note(`cross-check skipped for "${c.article}": ${c.reason}`);
    }
  }

  /* ---------------- emit ---------------- */

  const payload = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: startedAt,
    // Kept in sync with the app's own `dynamicKind` union so a consumer can map
    // a card straight onto this document without a translation table.
    dynamicKinds: [
      "president",
      "vicePresident",
      "speaker",
      "chiefJustice",
      "governor",
      "senators",
      "representative",
      "capital",
    ],
    congress: house?.congress ?? previous?.congress ?? null,
    national,
    states,
    meta: {
      sources: [
        { name: "whitehouse.gov", url: WHITEHOUSE_URL, provides: ["president", "vicePresident"] },
        { name: "house.gov", url: SPEAKER_URL, provides: ["speaker"] },
        { name: "supremecourt.gov", url: SCOTUS_URL, provides: ["chiefJustice"] },
        { name: "senate.gov", url: SENATE_URL, provides: ["senators"] },
        { name: "clerk.house.gov", url: HOUSE_URL, provides: ["representative"], publishDate: house?.publishDate ?? null },
        { name: "nga.org", url: NGA_URL, provides: ["governor"] },
        { name: "repository constant", url: null, provides: ["capital"] },
      ],
      crossChecks: checks,
      warnings,
      errors,
      notices,
      ok: errors.length === 0,
    },
  };

  /**
   * A second, slimmer document for the app itself. The full file carries party,
   * bioguide ids, per-field provenance and cross-check results — useful for the
   * web page and for auditing, but roughly five times the bytes a phone on a
   * weak connection needs to answer eight questions.
   */
  const compact = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: startedAt,
    congress: payload.congress,
    national: Object.fromEntries(Object.entries(national).map(([k, v]) => [k, v.value])),
    states: Object.fromEntries(
      Object.entries(states).map(([code, s]) => [
        code,
        {
          name: s.name,
          capital: s.capital,
          governor: s.governor ?? null,
          senators: s.senators ?? [],
          representatives: s.representatives ?? {},
          ...(s.territory ? { territory: true } : {}),
          ...(s.atLarge ? { atLarge: true } : {}),
          ...(s.governorNote ? { governorNote: s.governorNote } : {}),
          ...(s.senatorsNote ? { senatorsNote: s.senatorsNote } : {}),
          ...(s.answerNote ? { answerNote: s.answerNote } : {}),
        },
      ])
    ),
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, OUTPUT_BASENAME), JSON.stringify(payload, null, 2) + "\n", "utf8");
  await writeFile(path.join(OUT_DIR, "civics-dynamic-v1.min.json"), JSON.stringify(compact) + "\n", "utf8");
  await writeFile(path.join(OUT_DIR, "index.html"), renderPage(payload), "utf8");
  // Two WordPress renderings: the scoped-<style> one is the default (far fewer
  // bytes), the all-inline one is the fallback for hosts that strip <style>
  // from post content.
  await writeFile(path.join(OUT_DIR, "wordpress-scoped.html"), renderWordPressScoped(payload, { jsonUrl: JSON_URL }), "utf8");
  await writeFile(
    path.join(OUT_DIR, "wordpress-inline.html"),
    renderWordPressFragment(payload, { jsonUrl: JSON_URL, fullUrl: PAGE_URL }),
    "utf8"
  );
  // Same page without the ~440 per-district names: small enough to paste by
  // hand, which is how the WordPress page gets seeded before the automated
  // push has credentials.
  await writeFile(
    path.join(OUT_DIR, "wordpress-compact.html"),
    renderWordPressFragment(payload, { jsonUrl: JSON_URL, fullUrl: PAGE_URL, rosters: false }),
    "utf8"
  );

  /* ---------------- report ---------------- */

  const line = (icon, list) => list.forEach((m) => console.log(`  ${icon} ${m}`));
  console.log(`\ndynamic-answers build — ${startedAt}`);
  console.log(`  output: ${path.join(OUT_DIR, OUTPUT_BASENAME)}`);
  console.log(`  president=${national.president?.value ?? "—"}  vp=${national.vicePresident?.value ?? "—"}`);
  console.log(`  speaker=${national.speaker?.value ?? "—"}  chiefJustice=${national.chiefJustice?.value ?? "—"}`);
  console.log(`  senators=${senate?.count ?? 0}  seats=${house?.seatCount ?? 0} (${house?.vacantCount ?? 0} vacant)  governors=${Object.keys(governors?.byState ?? {}).length}`);
  if (notices.length) { console.log(`\nnotices (${notices.length}):`); line("·", notices); }
  if (warnings.length) { console.log(`\nwarnings (${warnings.length}):`); line("!", warnings); }
  if (errors.length) { console.log(`\nERRORS (${errors.length}):`); line("x", errors); }
  console.log("");

  if (errors.length && STRICT) {
    console.error("strict mode: refusing to publish a build with errors");
    process.exit(1);
  }
}

await main();
