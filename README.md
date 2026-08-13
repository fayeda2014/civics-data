# Current answers to the civics questions that change

Eight of the 128 questions on the USCIS civics test do not have a fixed answer —
they depend on who currently holds office and where the applicant lives. This
repository keeps those answers current, rebuilt daily from official US
government sources, and publishes them as JSON and as a readable web page.

Human-readable page: <https://data.uscivicstest.us/api/>

## The feed

| URL | For | Transfer size |
|---|---|---|
| [`api/civics-dynamic-v1.min.json`](https://data.uscivicstest.us/api/civics-dynamic-v1.min.json) | apps — the answers | 7 KB gzipped |
| [`api/zip-districts-v1.json`](https://data.uscivicstest.us/api/zip-districts-v1.json) | apps — ZIP → district, so no runtime geocoding | 97 KB gzipped |
| [`api/civics-dynamic-v1.json`](https://data.uscivicstest.us/api/civics-dynamic-v1.json) | auditing — per-field provenance, party, bioguide ids, cross-check results | — |

Together those two files answer all eight questions with **no other network
call**: fetch them once, cache both, and the app works offline afterwards. The
answers change a few times a year; the crosswalk changes only on redistricting,
so it can be cached far longer.

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "2026-08-13T01:18:46.739Z",
  "congress": "119",
  "national": {
    "president": "…", "vicePresident": "…",
    "speaker": "…",   "chiefJustice": "…"
  },
  "states": {
    "CA": {
      "name": "California",
      "capital": "Sacramento",
      "governor": "…",
      "senators": ["…", "…"],
      "representatives": { "1": "…", "14": null }   // null = seat vacant
    }
  }
}
```

The questions covered are 23 (your senators), 29 (your representative), 30
(Speaker), 38 (President), 39 (Vice President), 57 (Chief Justice), 61 (your
governor) and 62 (your state capital).

### Looking someone up by ZIP

```js
const answers = await (await fetch(".../civics-dynamic-v1.min.json")).json();
const { zips, zip3 } = await (await fetch(".../zip-districts-v1.json")).json();

const hit = zips["48126"];                       // "MI12" | ["MI12","MI13"] | undefined
if (hit) {
  const options = (Array.isArray(hit) ? hit : [hit]).map((k) => {
    const state = k.slice(0, 2), district = k.slice(2);
    return { state, district, name: answers.states[state].representatives[district] };
  });
  // options.length > 1 → this ZIP straddles a boundary. Ask which district;
  // do not pick one silently. name === null → that seat is currently vacant.
} else {
  const st = zip3["205"];                        // fallback: PO-box / unique ZIPs
  // Gives state (so governor, senators, capital are answerable) but not district.
}
```

**21.6% of ZIPs span more than one congressional district**, so the multi-value
case is common, not exotic — 48126 covers both MI-12 and MI-13, and 90210 covers
three. Resolving a ZIP to a single district by taking its centroid, which is what
a geocoder does, is wrong for roughly one user in five.

All 50 states plus DC and the five inhabited territories are included.
Territories carry notes for the answers that do not apply to them — DC has a
mayor rather than a governor, and no territory has US Senators.

## Sources

Every published value comes from an official government feed or the national
association the officials belong to.

| Field | Source |
|---|---|
| Senators (100) | [senate.gov XML](https://www.senate.gov/general/contact_information/senators_cfm.xml) |
| Representatives (435 seats + 6 delegates) | [clerk.house.gov XML](https://clerk.house.gov/xml/lists/MemberData.xml) |
| Speaker | [house.gov/leadership](https://www.house.gov/leadership) |
| President, Vice President | [whitehouse.gov](https://www.whitehouse.gov/administration/) |
| Chief Justice | [supremecourt.gov](https://www.supremecourt.gov/about/biographies.aspx) |
| Governors (55) | [nga.org](https://www.nga.org/governors/) |
| State capitals | verified constant in `states.mjs` |
| ZIP → district | [us-zipcodes-congress](https://github.com/OpenSourceActivismTech/us-zipcodes-congress) (ZCTA→CD, from Census TIGER) |

The ZIP crosswalk is the one source that is not itself official: the Census
publishes no direct ZCTA-to-congressional-district relationship file, and HUD's
equivalent needs an API key, which an unattended public build should not depend
on. It is therefore checked against the House Clerk's live seat list on **every
run** — if it references a district that does not exist, or misses one that does,
the build fails rather than publishing. That is what catches a stale crosswalk
after a redistricting.

**Wikidata was evaluated and rejected.** Its `officeholder` (P1308) and `position
held` (P39) statements return fictional presidents alongside real ones, and
historical governors routinely lack an end-date qualifier, so a "current
officeholder" query returned officials who had left office years earlier.
Filtering to preferred rank gave one row per state but left half of them empty.
It is not safe for answers people study against.

**State capitals are not fetched.** A capital is fixed by state constitution or
statute and none has moved since Oklahoma in 1910. Fetching one nightly would add
a failure mode and buy nothing.

## Stale beats wrong

- **Never regress.** If a source fails, the previously published value is carried
  forward and marked `confidence: "carried-forward"`. A transient outage cannot
  blank out an answer someone is studying against.
- **Structural validation.** Exactly 100 senators; exactly 435 voting House
  seats; two senators for each of the 50 states; a governor for each. A count
  that is off means the parser broke, and the build refuses to publish.
- **Vacancies are published, not hidden.** A vacant seat is `null` — distinct
  from a missing key.
- **Independent cross-check.** Each national officeholder and all 50 governors
  are checked against the corresponding Wikipedia article on every run. A
  mismatch raises a warning; it never silently changes a value.
- **Manual overrides win, and are audited.** `scripts/dynamic-answers/overrides.json`
  pins a value over any source, for the morning after an inauguration or a
  resignation the Clerk has not published yet. The build warns whenever an
  override contradicts its source, and again once the source catches up, so a
  pin cannot quietly outlive its reason.

## Running it

```bash
node scripts/dynamic-answers/build.mjs          # rebuild into public/api/
node scripts/dynamic-answers/build.mjs --strict # non-zero exit if anything failed
```

No dependencies and no install step — plain Node (18+).

## Accuracy

This is a best-effort mirror of public government data, not an official source,
and it is not affiliated with USCIS or any government agency. Answer with the
officeholder in place on the day of your interview, and confirm anything
time-sensitive against the official sources linked above. Corrections are
welcome via an issue.

Published by [CivicsPro](https://uscivicstest.us).
