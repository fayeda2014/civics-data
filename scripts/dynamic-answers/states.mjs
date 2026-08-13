/**
 * The fixed half of the state data: name, postal code, and capital.
 *
 * Capitals are deliberately NOT scraped. A state capital is set by state
 * constitution or statute and has not changed anywhere in the US since Oklahoma
 * moved to Oklahoma City in 1910, so fetching one every night buys nothing and
 * adds a failure mode. They are verified once, here, in version control.
 *
 * `answerNote` covers the states whose USCIS answer is not simply the capital
 * city name — the territories and DC, which have no state capital at all.
 */

export const STATES = [
  { code: "AL", name: "Alabama", capital: "Montgomery" },
  { code: "AK", name: "Alaska", capital: "Juneau" },
  { code: "AZ", name: "Arizona", capital: "Phoenix" },
  { code: "AR", name: "Arkansas", capital: "Little Rock" },
  { code: "CA", name: "California", capital: "Sacramento" },
  { code: "CO", name: "Colorado", capital: "Denver" },
  { code: "CT", name: "Connecticut", capital: "Hartford" },
  { code: "DE", name: "Delaware", capital: "Dover" },
  { code: "FL", name: "Florida", capital: "Tallahassee" },
  { code: "GA", name: "Georgia", capital: "Atlanta" },
  { code: "HI", name: "Hawaii", capital: "Honolulu" },
  { code: "ID", name: "Idaho", capital: "Boise" },
  { code: "IL", name: "Illinois", capital: "Springfield" },
  { code: "IN", name: "Indiana", capital: "Indianapolis" },
  { code: "IA", name: "Iowa", capital: "Des Moines" },
  { code: "KS", name: "Kansas", capital: "Topeka" },
  { code: "KY", name: "Kentucky", capital: "Frankfort" },
  { code: "LA", name: "Louisiana", capital: "Baton Rouge" },
  { code: "ME", name: "Maine", capital: "Augusta" },
  { code: "MD", name: "Maryland", capital: "Annapolis" },
  { code: "MA", name: "Massachusetts", capital: "Boston" },
  { code: "MI", name: "Michigan", capital: "Lansing" },
  { code: "MN", name: "Minnesota", capital: "Saint Paul" },
  { code: "MS", name: "Mississippi", capital: "Jackson" },
  { code: "MO", name: "Missouri", capital: "Jefferson City" },
  { code: "MT", name: "Montana", capital: "Helena" },
  { code: "NE", name: "Nebraska", capital: "Lincoln" },
  { code: "NV", name: "Nevada", capital: "Carson City" },
  { code: "NH", name: "New Hampshire", capital: "Concord" },
  { code: "NJ", name: "New Jersey", capital: "Trenton" },
  { code: "NM", name: "New Mexico", capital: "Santa Fe" },
  { code: "NY", name: "New York", capital: "Albany" },
  { code: "NC", name: "North Carolina", capital: "Raleigh" },
  { code: "ND", name: "North Dakota", capital: "Bismarck" },
  { code: "OH", name: "Ohio", capital: "Columbus" },
  { code: "OK", name: "Oklahoma", capital: "Oklahoma City" },
  { code: "OR", name: "Oregon", capital: "Salem" },
  { code: "PA", name: "Pennsylvania", capital: "Harrisburg" },
  { code: "RI", name: "Rhode Island", capital: "Providence" },
  { code: "SC", name: "South Carolina", capital: "Columbia" },
  { code: "SD", name: "South Dakota", capital: "Pierre" },
  { code: "TN", name: "Tennessee", capital: "Nashville" },
  { code: "TX", name: "Texas", capital: "Austin" },
  { code: "UT", name: "Utah", capital: "Salt Lake City" },
  { code: "VT", name: "Vermont", capital: "Montpelier" },
  { code: "VA", name: "Virginia", capital: "Richmond" },
  { code: "WA", name: "Washington", capital: "Olympia" },
  { code: "WV", name: "West Virginia", capital: "Charleston" },
  { code: "WI", name: "Wisconsin", capital: "Madison" },
  { code: "WY", name: "Wyoming", capital: "Cheyenne" },

  // DC and the territories have no state capital and no US senators. USCIS
  // publishes a specific answer for these applicants, reproduced verbatim.
  {
    code: "DC",
    name: "District of Columbia",
    capital: null,
    territory: true,
    answerNote: "D.C. is not a state and does not have a capital.",
  },
  {
    code: "PR",
    name: "Puerto Rico",
    capital: "San Juan",
    territory: true,
    answerNote: "Puerto Rico is a territory, not a state.",
  },
  {
    code: "GU",
    name: "Guam",
    capital: "Hagåtña",
    territory: true,
    answerNote: "Guam is a territory, not a state.",
  },
  {
    code: "VI",
    name: "U.S. Virgin Islands",
    capital: "Charlotte Amalie",
    territory: true,
    answerNote: "The U.S. Virgin Islands is a territory, not a state.",
  },
  {
    code: "AS",
    name: "American Samoa",
    capital: "Pago Pago",
    territory: true,
    answerNote: "American Samoa is a territory, not a state.",
  },
  {
    code: "MP",
    name: "Northern Mariana Islands",
    capital: "Saipan",
    territory: true,
    answerNote: "The Northern Mariana Islands is a territory, not a state.",
  },
];

/** "North Dakota" -> "ND", for matching scraped sources that print full names. */
export const STATE_NAME_TO_CODE = Object.fromEntries(
  STATES.map((s) => [s.name, s.code])
);

// NGA and several other listings label DC's chief executive by the district's
// own name rather than a state name.
STATE_NAME_TO_CODE["Washington, D.C."] = "DC";
STATE_NAME_TO_CODE["District of Columbia"] = "DC";
STATE_NAME_TO_CODE["U.S. Virgin Islands"] = "VI";
STATE_NAME_TO_CODE["US Virgin Islands"] = "VI";
STATE_NAME_TO_CODE["Virgin Islands"] = "VI";
STATE_NAME_TO_CODE["Commonwealth of the Northern Mariana Islands"] = "MP";
STATE_NAME_TO_CODE["Northern Mariana Islands"] = "MP";

/** Codes for the 50 states, used by the "did we get everything?" validators. */
export const FIFTY_STATES = STATES.filter((s) => !s.territory).map((s) => s.code);
