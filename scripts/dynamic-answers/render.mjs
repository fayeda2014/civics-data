/**
 * Renders the published JSON two ways:
 *
 *   renderPage()               — a standalone, self-contained page (GitHub Pages)
 *   renderWordPressFragment()  — the same content as a body fragment using only
 *                                inline styles, because WordPress.com Simple
 *                                sites run post content through KSES and strip
 *                                <style> and <script> blocks.
 *
 * Colours follow the app's "Civic Dignity" direction: navy, crimson, ivory,
 * serif restraint, no gradients or glows.
 */

const NAVY = "#1B2950";
const CRIMSON = "#B3272D";
const IVORY = "#F4EFE5";
const INK = "#12182B";
const MUTED = "#5A6274";
const RULE = "#D8D2C4";

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
};

const NATIONAL_LABELS = {
  president: ["President of the United States", "Q38"],
  vicePresident: ["Vice President of the United States", "Q39"],
  speaker: ["Speaker of the House of Representatives", "Q30"],
  chiefJustice: ["Chief Justice of the United States", "Q57"],
};

/** Ordered rows for the state table, 50 states first, then DC + territories. */
function stateRows(data) {
  return Object.entries(data.states).sort(([, a], [, b]) => {
    if (!!a.territory !== !!b.territory) return a.territory ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Multi-district states get their full roster behind a <details>. Question 29
 * asks for *your* representative, so the page is not finished until every
 * district is on it — but 435 names expanded by default would bury the rest of
 * the table. If a host strips <details> the names simply render inline, which
 * is worse-looking but never wrong.
 */
function repSummary(entry, { rosters = true } = {}) {
  if (!entry.representatives) return "—";
  const keys = Object.keys(entry.representatives).sort((a, b) => Number(a) - Number(b));

  if (entry.atLarge) {
    const only = entry.representatives["0"];
    return only
      ? `${esc(only)} <em>(At Large)</em>`
      : `<span style="color:${CRIMSON}">Vacant (At Large)</span>`;
  }

  const vacant = keys.filter((k) => !entry.representatives[k]);
  const heading =
    `${keys.length} districts` +
    (vacant.length
      ? ` <span style="color:${CRIMSON}">· district ${vacant.map(esc).join(", ")} vacant</span>`
      : "");

  if (!rosters) return heading;

  // Classed rather than inline-styled: at 441 rows the repeated style attribute
  // is most of the page weight. Without the stylesheet these still read fine,
  // just without the aligned district column.
  const rows = keys
    .map((k) => {
      const name = entry.representatives[k];
      // The space after </b> is load-bearing: WordPress.com strips <style>, and
      // without it an unstyled row renders as "1Barry Moore". Where the
      // stylesheet does apply, `min-width` on the <b> aligns the column anyway.
      return `<div class="rep"><b>${esc(k)}</b> ${
        name ? esc(name) : `<span class="vacant">Vacant</span>`
      }</div>`;
    })
    .join("");

  return `<details><summary>${heading}</summary><div class="reps">${rows}</div></details>`;
}

/* ------------------------------------------------------------------ *
 * Shared content blocks
 * ------------------------------------------------------------------ */

function nationalRowsHTML(data, { inline }) {
  const td = inline
    ? ` style="padding:10px 12px;border-bottom:1px solid ${RULE};vertical-align:top"`
    : "";
  return Object.entries(NATIONAL_LABELS)
    .map(([key, [label, qid]]) => {
      const f = data.national[key];
      if (!f) return "";
      const src = f.source === "manual-override" ? "manually set" : esc(f.source);
      return `<tr>
  <td${td}><strong>${esc(label)}</strong><br><span style="color:${MUTED};font-size:13px">${qid} · ${src}</span></td>
  <td${td}><span style="font-size:19px">${esc(f.value)}</span></td>
</tr>`;
    })
    .join("\n");
}

function stateRowsHTML(data, { inline, rosters = true }) {
  const td = inline
    ? ` style="padding:9px 12px;border-bottom:1px solid ${RULE};vertical-align:top"`
    : "";
  return stateRows(data)
    .map(([code, s]) => {
      const senators = s.senators?.length
        ? s.senators.map(esc).join("<br>")
        : `<span style="color:${MUTED}">${esc(s.senatorsNote ?? "—")}</span>`;
      const govLabel = s.governor
        ? s.governorTitle
          ? `${esc(s.governor)} <em>(${esc(s.governorTitle)})</em>`
          : esc(s.governor)
        : `<span style="color:${MUTED}">${esc(s.governorNote ?? "—")}</span>`;
      return `<tr>
  <td${td}><strong>${esc(s.name)}</strong><br><span style="color:${MUTED};font-size:13px">${esc(code)}</span></td>
  <td${td}>${esc(s.capital ?? "—")}</td>
  <td${td}>${govLabel}</td>
  <td${td}>${senators}</td>
  <td${td}>${repSummary(s, { rosters })}</td>
</tr>`;
    })
    .join("\n");
}

function sourcesHTML(data, { inline }) {
  const li = inline ? ` style="margin:0 0 6px 0"` : "";
  return data.meta.sources
    .map((s) => {
      const link = s.url
        ? `<a href="${esc(s.url)}" style="color:${NAVY}">${esc(s.name)}</a>`
        : `${esc(s.name)}`;
      return `<li${li}>${link} — ${s.provides.map(esc).join(", ")}</li>`;
    })
    .join("\n");
}

/* ------------------------------------------------------------------ *
 * Standalone page (GitHub Pages)
 * ------------------------------------------------------------------ */

export function renderPage(data) {
  const jsonName = "civics-dynamic-v1.json";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Current Answers — US Civics Test (CivicsPro)</title>
<meta name="description" content="The current officeholders behind the eight civics questions whose answers change: President, Vice President, Speaker, Chief Justice, your governor, senators, and representative.">
<style>
  :root {
    --navy:${NAVY}; --crimson:${CRIMSON}; --ivory:${IVORY};
    --ink:${INK}; --muted:${MUTED}; --rule:${RULE};
    --bg:#FFFFFF; --card:${IVORY};
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg:#0E1424; --card:#161E33; --ink:#EFEADF; --muted:#9AA3B8;
      --rule:#2A3350; --navy:#C9D4F0;
    }
  }
  * { box-sizing:border-box }
  body {
    margin:0; background:var(--bg); color:var(--ink);
    font:16px/1.55 ui-serif, Georgia, "Times New Roman", serif;
  }
  .wrap { max-width:1080px; margin:0 auto; padding:40px 20px 72px }
  header { border-bottom:3px solid var(--crimson); padding-bottom:20px; margin-bottom:8px }
  h1 { font-size:30px; margin:0 0 6px; color:var(--navy); letter-spacing:-.01em }
  h2 { font-size:21px; margin:40px 0 12px; color:var(--navy) }
  .sub { color:var(--muted); margin:0 }
  .stamp {
    display:inline-block; margin-top:14px; padding:7px 13px; border:1px solid var(--rule);
    background:var(--card); border-radius:4px; font-size:14px;
    font-family:ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .scroll { overflow-x:auto; -webkit-overflow-scrolling:touch }
  table { border-collapse:collapse; width:100%; min-width:640px; font-size:15px }
  th {
    text-align:left; padding:10px 12px; border-bottom:2px solid var(--navy);
    font-size:12px; letter-spacing:.09em; text-transform:uppercase; color:var(--navy);
    font-family:system-ui, -apple-system, sans-serif; white-space:nowrap;
  }
  td { padding:10px 12px; border-bottom:1px solid var(--rule); vertical-align:top }
  tbody tr:nth-child(even) { background:color-mix(in srgb, var(--card) 55%, transparent) }
  code, .mono { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:14px }
  pre {
    background:var(--card); border:1px solid var(--rule); border-radius:5px;
    padding:14px; overflow-x:auto; font-size:13.5px;
  }
  a { color:var(--crimson) }
  summary { cursor:pointer }
  .reps { margin-top:6px; font-size:14px }
  .rep { padding:2px 0 }
  .rep b { color:var(--muted); display:inline-block; min-width:2.6em; font-weight:400 }
  .vacant { color:var(--crimson) }
  .note {
    border-left:3px solid var(--crimson); background:var(--card);
    padding:12px 16px; margin:18px 0; font-size:15px;
  }
  ul { padding-left:20px }
  footer { margin-top:56px; padding-top:20px; border-top:1px solid var(--rule); color:var(--muted); font-size:14px }
</style>
</head>
<body>
<div class="wrap">

<header>
  <h1>Current Answers to the Civics Questions That Change</h1>
  <p class="sub">Eight of the 128 USCIS civics questions do not have a fixed answer. This page holds the current one for every state, refreshed automatically from official government sources.</p>
  <div class="stamp">Last refreshed ${esc(fmtDate(data.generatedAt))} · ${esc(data.congress ? data.congress + "th Congress" : "")}</div>
</header>

<div class="note">
  <strong>Studying for your interview?</strong> Answer with the officeholder in place on the day of <em>your</em> interview.
  If an election or appointment has just happened, check the linked official source below — this page follows those sources, not the other way around.
</div>

<h2>National officeholders</h2>
<div class="scroll"><table>
  <thead><tr><th>Question</th><th>Current answer</th></tr></thead>
  <tbody>
${nationalRowsHTML(data, { inline: false })}
  </tbody>
</table></div>

<h2>By state</h2>
<p class="sub" style="font-size:15px">Questions 23 (your senators), 29 (your representative), 61 (your governor) and 62 (your state capital).</p>
<div class="scroll"><table>
  <thead><tr><th>State</th><th>Capital</th><th>Governor</th><th>U.S. Senators</th><th>U.S. Representative</th></tr></thead>
  <tbody>
${stateRowsHTML(data, { inline: false })}
  </tbody>
</table></div>

<h2>Machine-readable feed</h2>
<p>The app reads this same data as JSON. It is regenerated on a schedule and is free to use.</p>
<pre><code>${esc(jsonName)}</code></pre>
<p>Every field carries the source it came from and the timestamp it was verified, so a consumer can tell an officially-sourced answer from one carried forward after a source outage.</p>

<h2>Where this comes from</h2>
<ul>
${sourcesHTML(data, { inline: false })}
</ul>
<p style="font-size:15px;color:var(--muted)">
  State capitals are held as a verified constant rather than fetched: a capital is fixed by state constitution or statute and none has moved since 1910.
  Governor and national officeholder values are additionally cross-checked against Wikipedia on every run; a disagreement raises a warning rather than publishing silently.
</p>

<footer>
  Published by CivicsPro · <a href="https://uscivicstest.us">uscivicstest.us</a><br>
  Not affiliated with USCIS or any government agency. Always confirm current officeholders with the official sources linked above.
</footer>

</div>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ *
 * WordPress fragment, scoped-<style> variant
 *
 * Roughly a third the bytes of the inline-style variant, because the table
 * styling is stated once instead of on every cell. Preferred when the host
 * keeps <style> inside a Custom HTML block; fall back to
 * renderWordPressFragment() if it gets stripped.
 * ------------------------------------------------------------------ */

export function renderWordPressScoped(data, { jsonUrl } = {}) {
  const R = "cp-dyn"; // every rule is scoped to this wrapper so nothing leaks
  return `<style>
.${R}{color:${INK};font-size:16px;line-height:1.55}
.${R} h2{color:${NAVY};font-size:21px;margin:36px 0 10px}
.${R} .muted{color:${MUTED}}
.${R} .stamp{display:inline-block;padding:7px 13px;border:1px solid ${RULE};background:${IVORY};border-radius:4px;font-size:14px}
.${R} .note{border-left:3px solid ${CRIMSON};background:${IVORY};padding:12px 16px;margin:18px 0}
.${R} .scroll{overflow-x:auto}
.${R} table{border-collapse:collapse;width:100%;min-width:640px;font-size:15px}
.${R} th{text-align:left;padding:10px 12px;border-bottom:2px solid ${NAVY};font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:${NAVY};white-space:nowrap}
.${R} td{padding:9px 12px;border-bottom:1px solid ${RULE};vertical-align:top}
.${R} tbody tr:nth-child(even){background:rgba(244,239,229,.5)}
.${R} .code{color:${MUTED};font-size:13px}
.${R} .vacant{color:${CRIMSON}}
.${R} summary{cursor:pointer}
.${R} .reps{margin-top:6px;font-size:14px}
.${R} .rep{padding:2px 0}
.${R} .rep b{color:${MUTED};display:inline-block;min-width:2.6em;font-weight:400}
.${R} a{color:${CRIMSON}}
</style>
<div class="${R}">

<p class="muted">Eight of the 128 USCIS civics questions do not have a fixed answer &mdash; they depend on who is in office and where you live. This page holds the current answer for every state, refreshed automatically from official government sources.</p>

<p class="stamp">Last refreshed <strong>${esc(fmtDate(data.generatedAt))}</strong>${data.congress ? ` &middot; ${esc(data.congress)}th Congress` : ""}</p>

<div class="note"><strong>Studying for your interview?</strong> Answer with the officeholder in place on the day of <em>your</em> interview. If an election or appointment has just happened, check the official sources linked at the bottom of this page.</div>

<h2>National officeholders</h2>
<div class="scroll"><table>
<thead><tr><th>Question</th><th>Current answer</th></tr></thead>
<tbody>
${nationalRowsHTML(data, { inline: false })}
</tbody></table></div>

<h2>By state</h2>
<p class="muted">Questions 23 (your senators), 29 (your representative), 61 (your governor) and 62 (your state capital).</p>
<div class="scroll"><table>
<thead><tr><th>State</th><th>Capital</th><th>Governor</th><th>U.S. Senators</th><th>U.S. Representative</th></tr></thead>
<tbody>
${stateRowsHTML(data, { inline: false })}
</tbody></table></div>

<h2>Machine-readable feed</h2>
<p>The CivicsPro app reads this same data as JSON${jsonUrl ? ` from <a href="${esc(jsonUrl)}">${esc(jsonUrl)}</a>` : ""}. Every field carries the source it came from and the time it was verified.</p>

<h2>Where this comes from</h2>
<ul>
${sourcesHTML(data, { inline: false })}
</ul>
<p class="muted" style="font-size:15px">State capitals are held as a verified constant rather than fetched &mdash; a capital is fixed by state constitution or statute, and none has moved since 1910. Governors and national officeholders are cross-checked against a second source on every run; a disagreement raises a warning instead of publishing silently.</p>

<p class="muted" style="font-size:14px">Not affiliated with USCIS or any government agency. Always confirm current officeholders with the official sources linked above.</p>

</div>
`;
}

/* ------------------------------------------------------------------ *
 * WordPress fragment (inline styles only — survives KSES)
 * ------------------------------------------------------------------ */

/**
 * @param {object}  opts
 * @param {string}  opts.jsonUrl   link to the machine-readable feed
 * @param {string}  opts.fullUrl   link to the full page, used when rosters are off
 * @param {boolean} opts.rosters   include every district's representative
 *                                 (~440 names, ~40 KB) or just the district count
 */
export function renderWordPressFragment(data, { jsonUrl, fullUrl, rosters = true } = {}) {
  // Tables are wrapped in Gutenberg's own `wp-block-table` markup so the active
  // block theme styles the cells. That is what keeps this variant to a
  // reasonable size: without it, every one of ~2,500 cells would have to carry
  // its own style attribute. Only the header row and the accent colours are
  // stated explicitly, since those are the parts a theme will not guess.
  const th = `style="text-align:left;border-bottom:2px solid ${NAVY};font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:${NAVY};white-space:nowrap"`;
  const wrap = (inner) =>
    `<figure class="wp-block-table"><table style="width:100%;font-size:15px">${inner}</table></figure>`;

  return `<p style="color:${MUTED};margin:0 0 18px 0">Eight of the 128 USCIS civics questions do not have a fixed answer &mdash; they depend on who is in office and where you live. This page holds the current answer for every state, refreshed automatically from official government sources.</p>

<p style="display:inline-block;padding:7px 13px;border:1px solid ${RULE};background:${IVORY};border-radius:4px;font-size:14px;color:${INK}">Last refreshed <strong>${esc(fmtDate(data.generatedAt))}</strong>${data.congress ? ` &middot; ${esc(data.congress)}th Congress` : ""}</p>

<div style="border-left:3px solid ${CRIMSON};background:${IVORY};padding:12px 16px;margin:18px 0;color:${INK}">
<strong>Studying for your interview?</strong> Answer with the officeholder in place on the day of <em>your</em> interview. If an election or appointment has just happened, check the official sources linked at the bottom of this page.
</div>

<h2 style="color:${NAVY}">National officeholders</h2>
${wrap(`<thead><tr><th ${th}>Question</th><th ${th}>Current answer</th></tr></thead><tbody>${nationalRowsHTML(data, { inline: false })}</tbody>`)}

<h2 style="color:${NAVY}">By state</h2>
<p style="color:${MUTED};font-size:15px">Questions 23 (your senators), 29 (your representative), 61 (your governor) and 62 (your state capital).${
    rosters || !fullUrl
      ? ""
      : ` Every district's representative by name is on <a href="${esc(fullUrl)}" style="color:${CRIMSON}">the full listing</a>.`
  }</p>
${wrap(`<thead><tr><th ${th}>State</th><th ${th}>Capital</th><th ${th}>Governor</th><th ${th}>U.S. Senators</th><th ${th}>U.S. Representative</th></tr></thead><tbody>${stateRowsHTML(data, { inline: false, rosters })}</tbody>`)}

<h2 style="color:${NAVY}">Machine-readable feed</h2>
<p>The CivicsPro app reads this same data as JSON${jsonUrl ? ` from <a href="${esc(jsonUrl)}" style="color:${CRIMSON}">${esc(jsonUrl)}</a>` : ""}. Every field carries the source it came from and the time it was verified.</p>

<h2 style="color:${NAVY}">Where this comes from</h2>
<ul>
${sourcesHTML(data, { inline: true })}
</ul>
<p style="font-size:15px;color:${MUTED}">State capitals are held as a verified constant rather than fetched &mdash; a capital is fixed by state constitution or statute, and none has moved since 1910. Governors and national officeholders are cross-checked against a second source on every run; a disagreement raises a warning instead of publishing silently.</p>

<p style="font-size:14px;color:${MUTED}">Not affiliated with USCIS or any government agency. Always confirm current officeholders with the official sources linked above.</p>
`;
}
