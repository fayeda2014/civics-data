/**
 * Fetchers for the eight "dynamic" civics answers.
 *
 * Every source here is either an official .gov feed or the national association
 * that the officials themselves belong to. Wikidata was evaluated and rejected:
 * its `officeholder` / `position held` statements return fictional presidents
 * and governors who left office years ago (historical statements routinely lack
 * an end-date qualifier), so it cannot be trusted for answers that ship inside a
 * citizenship-test app. Wikipedia is used only as a *cross-check*, never as the
 * value that gets published.
 *
 * Parsing is deliberately dependency-free. These feeds are stable, and a build
 * that must keep running untouched for years is safer with a regex it owns than
 * with a transitive dependency tree it does not.
 */

const UA =
  "CivicsProBot/1.0 (+https://uscivicstest.us; civics dynamic-answer refresh)";

const TIMEOUT_MS = 30_000;

/** Fetch with a timeout, a descriptive UA, and a hard failure on non-2xx. */
async function get(url, { as = "text" } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": UA, accept: as === "json" ? "application/json" : "*/*" },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return as === "json" ? await res.json() : await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Collapse whitespace and decode the handful of entities these feeds emit. */
function clean(s) {
  return String(s ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8217;|&rsquo;/g, "’")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** First inner text of `<tag>` inside `xml`. */
function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? clean(m[1]) : "";
}

const SUFFIX = /,?\s+(?:Jr|Sr|II|III|IV|V)\.?$/i;

/**
 * Official rosters store names in forms that read badly as a quiz answer:
 * senate.gov files Angus King's first name as "Angus S., Jr.", which naively
 * concatenates to "Angus S., Jr. King". A generational suffix and a trailing
 * lone initial are both dropped, leaving "Angus King" — what the applicant is
 * expected to say. The untouched official form is always kept in `officialName`.
 */
function displayName(first, last) {
  const trimmed = String(first ?? "")
    .replace(SUFFIX, "")
    .replace(/\s+[A-Z]\.?$/, "")
    .trim();
  return `${trimmed} ${last}`.replace(/\s+/g, " ").trim();
}

/**
 * The House Clerk files members who go by their middle name under a bare
 * initial — firstname "J.", middlename "French", lastname "Hill" — which would
 * publish as "J. Hill". In exactly that case the Clerk's own `official-name`
 * ("J. French Hill") is the name the member is actually known by, so it wins.
 */
function memberDisplay({ first, last, official }) {
  if (/^[A-Z]\.?$/.test(String(first ?? "").trim()) && official) {
    return official.replace(SUFFIX, "").trim();
  }
  return displayName(first, last);
}

/* ------------------------------------------------------------------ *
 * President + Vice President — whitehouse.gov
 * ------------------------------------------------------------------ */

export const WHITEHOUSE_URL = "https://www.whitehouse.gov/administration/";

export async function fetchExecutive() {
  const html = await get(WHITEHOUSE_URL);
  const flat = html.replace(/\s+/g, " ");

  // The administration nav renders "President <name>" / "Vice President <name>"
  // as its own link text. Vice President is matched first so that the President
  // pattern cannot swallow it.
  const vp = flat.match(/>\s*Vice President ([A-Z][^<]{1,60}?)\s*<\/a>/);
  const pres = flat.match(/>\s*President ([A-Z][^<]{1,60}?)\s*<\/a>/);

  return {
    president: pres ? clean(pres[1]) : null,
    vicePresident: vp ? clean(vp[1]) : null,
    sourceUrl: WHITEHOUSE_URL,
  };
}

/* ------------------------------------------------------------------ *
 * Speaker of the House — house.gov
 * ------------------------------------------------------------------ */

export const SPEAKER_URL = "https://www.house.gov/leadership";

export async function fetchSpeaker() {
  const html = await get(SPEAKER_URL);
  const flat = html.replace(/\s+/g, " ");

  // The leadership page labels the Speaker's portrait `alt="Speaker <name>"`,
  // then repeats the name in an <h3>. The alt text is the tighter match.
  const alt = flat.match(/alt="Speaker ([^"]{2,60})"/i);
  if (alt) return { speaker: clean(alt[1]), sourceUrl: SPEAKER_URL };

  const heading = flat.match(/Speaker of the House[\s\S]{0,200}?<h3>\s*(?:Rep\.\s*)?([^<]{2,60})<\/h3>/i);
  return { speaker: heading ? clean(heading[1]) : null, sourceUrl: SPEAKER_URL };
}

/* ------------------------------------------------------------------ *
 * Chief Justice — supremecourt.gov
 * ------------------------------------------------------------------ */

export const SCOTUS_URL = "https://www.supremecourt.gov/about/biographies.aspx";

export async function fetchChiefJustice() {
  const html = await get(SCOTUS_URL);
  const flat = html.replace(/\s+/g, " ");

  // Biographies open with "<strong>John G. Roberts, Jr., Chief Justice of the
  // United States,</strong>". The name may itself contain a comma ("Jr."), so
  // everything before the role phrase is taken.
  const m = flat.match(/<strong>\s*([^<]{3,60}?),\s*Chief Justice of the United States\s*,?\s*<\/strong>/i);
  return { chiefJustice: m ? clean(m[1]) : null, sourceUrl: SCOTUS_URL };
}

/* ------------------------------------------------------------------ *
 * Senators — senate.gov (official XML, all 100)
 * ------------------------------------------------------------------ */

export const SENATE_URL =
  "https://www.senate.gov/general/contact_information/senators_cfm.xml";

export async function fetchSenators() {
  const xml = await get(SENATE_URL);
  const byState = {};
  let count = 0;

  for (const block of xml.match(/<member>[\s\S]*?<\/member>/g) ?? []) {
    const state = tag(block, "state").toUpperCase();
    const first = tag(block, "first_name");
    const last = tag(block, "last_name");
    if (!state || !last) continue;

    (byState[state] ??= []).push({
      name: displayName(first, last),
      officialName: `${first} ${last}`.replace(/\s+/g, " ").trim(),
      lastName: last,
      party: tag(block, "party"),
      bioguideId: tag(block, "bioguide_id"),
      leadershipPosition: tag(block, "leadership_position") || undefined,
    });
    count += 1;
  }

  // The feed is already alphabetical by last name; make that explicit so the
  // published order cannot drift if senate.gov ever reorders the document.
  for (const list of Object.values(byState)) {
    list.sort((a, b) => a.lastName.localeCompare(b.lastName));
  }

  return { byState, count, sourceUrl: SENATE_URL };
}

/* ------------------------------------------------------------------ *
 * Representatives — clerk.house.gov (official XML, every seat)
 * ------------------------------------------------------------------ */

export const HOUSE_URL = "https://clerk.house.gov/xml/lists/MemberData.xml";

/** Territories send non-voting delegates; they are published but flagged. */
const NON_VOTING = new Set(["DC", "AS", "GU", "MP", "PR", "VI"]);

/**
 * The Clerk uses its own two-letter codes, which are not all USPS codes:
 * American Samoa is "AQ" here but "AS" everywhere else in this project.
 */
const CLERK_CODE_FIXUPS = { AQ: "AS" };

export async function fetchRepresentatives() {
  const xml = await get(HOUSE_URL);

  const byState = {};
  let voting = 0;
  let vacant = 0;

  for (const block of xml.match(/<member>[\s\S]*?<\/member>/g) ?? []) {
    const sd = tag(block, "statedistrict");
    if (!sd) continue;

    const raw = sd.slice(0, 2).toUpperCase();
    const state = CLERK_CODE_FIXUPS[raw] ?? raw;
    // "AK00" is At-Large; the Clerk writes district 00 for both At-Large seats
    // and territorial delegates. 0 is kept as the key so callers can look up an
    // At-Large state without knowing its district number.
    const district = Number(sd.slice(2));
    const first = tag(block, "firstname");
    const last = tag(block, "lastname");

    const isNonVoting = NON_VOTING.has(state);

    // A vacant seat is published as a vacancy rather than dropped. Silently
    // omitting it would leave the app showing a stale predecessor — or nothing
    // at all — to someone who lives in that district.
    const official = tag(block, "official-name");
    const entry = last
      ? {
          district,
          name: memberDisplay({ first, last, official }),
          officialName: official || `${first} ${last}`.trim(),
          lastName: last,
          party: tag(block, "party"),
          bioguideId: tag(block, "bioguideID"),
        }
      : { district, name: null, vacant: true };

    if (isNonVoting) entry.nonVoting = true;
    if (!last) vacant += 1;
    else if (!isNonVoting) voting += 1;

    (byState[state] ??= {})[String(district)] = entry;
  }

  const congress = tag(xml, "congress-num");
  const publishDate = tag(xml, "publish-date");

  return {
    byState,
    votingCount: voting,
    vacantCount: vacant,
    seatCount: voting + vacant,
    congress,
    publishDate,
    sourceUrl: HOUSE_URL,
  };
}

/* ------------------------------------------------------------------ *
 * Governors — National Governors Association
 * ------------------------------------------------------------------ */

export const NGA_URL = "https://www.nga.org/governors/";

export async function fetchGovernors(stateNameToCode) {
  const html = await get(NGA_URL);
  const flat = html.replace(/\s+/g, " ");

  const byState = {};
  const unmatched = [];

  // Each card renders as:
  //   <small class="state">North Dakota</small> Gov. Kelly Armstrong </div>
  const re = /<small class="state">\s*([^<]+?)\s*<\/small>\s*(?:Gov\.|Governor)\s*([^<]+?)\s*<\/div>/gi;
  for (const m of flat.matchAll(re)) {
    const stateName = clean(m[1]);
    const name = clean(m[2]);
    const code = stateNameToCode[stateName];
    if (!code) {
      unmatched.push(stateName);
      continue;
    }
    byState[code] = { name, title: "Governor" };
  }

  return { byState, unmatched, sourceUrl: NGA_URL };
}

/* ------------------------------------------------------------------ *
 * Cross-check — Wikipedia (never published, only used to raise warnings)
 * ------------------------------------------------------------------ */

const WIKI = "https://en.wikipedia.org/api/rest_v1/page/html/";

/**
 * Confirm a parsed name actually appears in the Wikipedia article that tracks
 * that office. This catches the failure mode that matters most: a source page
 * gets restyled, the regex silently latches onto the wrong element, and a
 * plausible-looking but wrong name ships. Surname matching keeps it tolerant of
 * "J.D." vs "JD" and middle-initial differences.
 */
export async function crossCheck(article, expectedNames) {
  let html;
  try {
    html = await get(WIKI + encodeURIComponent(article));
  } catch (err) {
    return { article, ok: null, reason: `cross-check unavailable: ${err.message}`, missing: [] };
  }
  const text = clean(html).toLowerCase();

  const missing = expectedNames
    .filter(Boolean)
    .filter((full) => {
      const surname = String(full).trim().split(/\s+/).pop().toLowerCase();
      return surname.length > 2 && !text.includes(surname);
    });

  return { article, ok: missing.length === 0, missing, sourceUrl: WIKI + article };
}
