/**
 * ZIP code → congressional district crosswalk.
 *
 * Question 29 ("Name your U.S. representative") is the only civics answer that
 * depends on sub-state geography, and a ZIP is the only piece of location an
 * applicant can reasonably be asked to type. Without this file a client has to
 * resolve ZIP → district at runtime against third-party geocoders, which means
 * the answer is unavailable offline and silently wrong for the **21.6% of ZIPs
 * that span more than one district** — a centroid lookup picks one and says
 * nothing about the ambiguity.
 *
 * Publishing the crosswalk moves that problem to build time, where it can be
 * validated against the actual roster of seats, and lets a client show "your ZIP
 * covers districts 10 and 12" instead of guessing.
 *
 * Source: OpenSourceActivismTech/us-zipcodes-congress, a ZCTA→CD crosswalk
 * derived from Census TIGER geography. The Census publishes no direct
 * ZCTA-to-congressional-district relationship file (rel2020/zcta520 stops at
 * block/tract/place), and HUD's equivalent requires an API key, which a public
 * unattended build should not depend on. This source is instead verified on
 * every run against the House Clerk's live seat list — see `validate()`.
 */

const CSV_URL =
  "https://raw.githubusercontent.com/OpenSourceActivismTech/us-zipcodes-congress/master/zccd.csv";

const UA =
  "CivicsProBot/1.0 (+https://uscivicstest.us; civics dynamic-answer refresh)";

/**
 * The crosswalk covers the 50 states, DC and Puerto Rico but not the smaller
 * territories. Each of those elects a single non-voting delegate, so the whole
 * territory maps to district 0 and its USPS ZIP range is fixed and public.
 * Hard-coding four ranges is honest here: there is no upstream to drift from.
 */
const TERRITORY_ZIP_RANGES = [
  { code: "VI", start: 801, end: 851 },     // U.S. Virgin Islands, 008xx
  { code: "AS", start: 96799, end: 96799 }, // American Samoa
  { code: "GU", start: 96910, end: 96932 }, // Guam
  { code: "MP", start: 96950, end: 96952 }, // Northern Mariana Islands
];

async function get(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": UA },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** "MI" + 12 -> "MI12". District 0 means at-large or a territorial delegate. */
const encode = (state, district) => `${state}${district}`;

export async function fetchZipDistricts() {
  const csv = await get(CSV_URL);
  const lines = csv.trim().split(/\r?\n/);
  const header = lines[0].split(",").map((h) => h.trim());

  const iState = header.indexOf("state_abbr");
  const iZip = header.indexOf("zcta");
  const iCd = header.indexOf("cd");
  if (iState < 0 || iZip < 0 || iCd < 0) {
    throw new Error(`unexpected crosswalk header: ${lines[0]}`);
  }

  /** @type {Record<string, Set<string>>} */
  const byZip = {};
  let rows = 0;

  for (const line of lines.slice(1)) {
    const f = line.split(",");
    const state = (f[iState] ?? "").trim().toUpperCase();
    const zip = (f[iZip] ?? "").trim().padStart(5, "0");
    const cd = Number((f[iCd] ?? "").trim());
    if (!/^[A-Z]{2}$/.test(state) || !/^\d{5}$/.test(zip) || !Number.isFinite(cd)) continue;
    (byZip[zip] ??= new Set()).add(encode(state, cd));
    rows += 1;
  }

  // Territories the crosswalk omits. Added only where it has no opinion, so a
  // future upstream that does cover them wins instead of being overwritten.
  let territoryZips = 0;
  for (const { code, start, end } of TERRITORY_ZIP_RANGES) {
    for (let n = start; n <= end; n += 1) {
      const zip = String(n).padStart(5, "0");
      if (byZip[zip]) continue;
      byZip[zip] = new Set([encode(code, 0)]);
      territoryZips += 1;
    }
  }

  // Collapse to a string for the common single-district case and an array only
  // where the ZIP genuinely straddles a boundary. That keeps both the bytes and
  // the consuming code simple: `typeof v === "string"` is the unambiguous case.
  /** @type {Record<string, string | string[]>} */
  const zips = {};
  let split = 0;
  for (const zip of Object.keys(byZip).sort()) {
    const list = [...byZip[zip]].sort();
    if (list.length === 1) zips[zip] = list[0];
    else {
      zips[zip] = list;
      split += 1;
    }
  }

  /**
   * A ZIP → state fallback keyed on the first three digits.
   *
   * The crosswalk is built on ZCTAs, which exist only where people live. USPS
   * also issues "unique" ZIPs to single large organisations and PO-box-only
   * ZIPs, and neither has a ZCTA — 20500 (the White House) is not in the map at
   * all. Someone typing one of those would otherwise get nothing.
   *
   * Three digits is the ZIP sectional centre, which is state-aligned almost
   * everywhere, so this recovers the state — and with it the answers to the
   * governor, senator and capital questions. Only the representative still needs
   * a district, and the honest move there is to ask rather than guess. The
   * handful of prefixes that genuinely straddle a state line list both.
   */
  const zip3 = {};
  const zip3sets = {};
  for (const [zip, v] of Object.entries(byZip)) {
    const p = zip.slice(0, 3);
    for (const k of v) (zip3sets[p] ??= new Set()).add(k.slice(0, 2));
  }
  for (const p of Object.keys(zip3sets).sort()) {
    const list = [...zip3sets[p]].sort();
    zip3[p] = list.length === 1 ? list[0] : list;
  }

  return {
    zips,
    zip3,
    stats: {
      sourceRows: rows,
      zipCount: Object.keys(zips).length,
      splitZipCount: split,
      territoryZips,
      zip3Count: Object.keys(zip3).length,
    },
    sourceUrl: CSV_URL,
  };
}

/**
 * Verify the crosswalk describes the Congress we are actually publishing.
 *
 * This is the check that makes an unofficial source safe to use: after a
 * redistricting the crosswalk would reference seats that no longer exist, or
 * omit new ones, and either shows up here as a hard mismatch rather than as a
 * wrong answer in somebody's study session.
 *
 * @param zips        the collapsed map from fetchZipDistricts()
 * @param statesFeed  the `states` object being published this run
 */
export function validate(zips, statesFeed) {
  const real = new Set();
  for (const [code, s] of Object.entries(statesFeed)) {
    for (const d of Object.keys(s.representatives ?? {})) {
      real.add(encode(code, Number(d)));
    }
  }

  const seen = new Set();
  for (const v of Object.values(zips)) {
    for (const k of Array.isArray(v) ? v : [v]) seen.add(k);
  }

  const unknown = [...seen].filter((k) => !real.has(k)).sort();
  const unmapped = [...real].filter((k) => !seen.has(k)).sort();

  return { unknown, unmapped, districtsInCrosswalk: seen.size, districtsLive: real.size };
}
