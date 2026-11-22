/**
 * How a Form 3/4/5 `officerTitle` reads, and the `isCeo` column `insider_filings` carries from it. The title is
 * classified per filing, so a role is always the one printed on that filing, never a later one.
 *
 * Deterministic text classification of an SEC machine field; no model is involved.
 *
 * What reads as CEO: the issuer's own chief executive, including interim, acting and co-CEOs, with any other
 * titles listed beside it ("President and CEO", "CEO-President", "CEO of the Company"). What does not:
 * former, retired, incoming, deputy, vice and assistant CEOs; a CEO-elect or CEO-designate; people who work for
 * the CEO ("Chief of Staff to the CEO", "Office of the CEO"); relatives of the CEO; and a CEO of a region,
 * division, subsidiary or other named unit ("CEO, Americas", "CEO of Subsidiary Bank"), which needs review. A
 * title that names no CEO, including SEC's "See Remarks" placeholder whose text lives elsewhere in the filing,
 * is unrecognized: unknown, never CEO.
 */
export enum InsiderOfficerTitleRole {
  CEO = "ceo",
  /** Former, retired, incoming, elect, designate, deputy, assistant or vice CEO; staff or a relative of the CEO. */
  FORMER_OR_NON_CEO = "former_or_non_ceo",
  /** A CEO of a subsidiary, division or region, or a title the rule cannot place. */
  SCOPE_REVIEW = "scope_review",
  UNRECOGNIZED = "unrecognized",
}

/**
 * Hand-bumped whenever the rule below changes what any title reads as. It names the rule in the data
 * (`ceoTitleRule` on `insider_filings`), so a change forces every published year to be rewritten under one rule.
 */
export const INSIDER_CEO_CLASSIFIER_VERSION = 2;

/** The rule's name in the lake: every `isCeo` value is stamped with the rule that computed it. */
export const INSIDER_CEO_TITLE_RULE = `ceo-title${INSIDER_CEO_CLASSIFIER_VERSION}`;

/**
 * Words that open a further title of the same person after a CEO mention, including the abbreviations filers
 * use ("CEO, Dir", "CEO & Chmn", "CEO/Chrmn", "CEO & COB", "CEO, EVP", "CEO, Sr. Partner").
 */
const CEO_SUFFIX_WORDS = new Set([
  "and", "president", "pres", "chairman", "chairwoman", "chairperson", "chair", "cochairman", "chmn", "chrmn", "chm",
  "cob", "director", "dir", "founder", "cofounder", "chief", "executive", "co", "member", "officer", "principal",
  "vice", "evp", "svp", "sr", "senior", "treasurer", "treas", "secretary", "sec", "cfo", "coo", "cto", "cio",
  "board", "trustee", "managing", "general", "partner", "interim", "acting", "sole", "see",
]);
/**
 * Words naming a unit of the company rather than a further title: a CEO followed by one ("CEO, Acme Bank",
 * "CEO Europe") runs that unit and needs review.
 */
const UNIT_WORDS = new Set([
  "subsidiary", "subsidiaries", "division", "divisional", "segment", "unit", "units", "region", "regional", "bank",
  "insurance", "operations", "international", "americas", "america", "europe", "emea", "apac", "asia", "pacific",
  "latam", "china", "japan", "india", "uk", "canada", "mexico", "brazil", "germany", "france",
]);
/** "CEO of" the issuer itself, as filers name it; any other entity after "of" scopes the CEO. */
const ISSUER_ITSELF = /^(?:the\s+)?(?:company|registrant|issuer|corporation|partnership|trust|fund)(?=\s*(?:$|[,;&/(-]|\band\b))/;
/** Regions and units anywhere in the title make it a scoped CEO. */
const SCOPED = /subsidi|division|regional|\bregion\b|north america|south america|\bamericas\b|europe|\bemea\b|\bapac\b|asia|latam|latin america/;
const CEO_MENTION = /\b(?:ceos?|chief\s+exec(?:utive)?(?:\s+officer)?)\b/g;
const NOT_THE_CEO = new RegExp([
  "\\bformer\\b", "\\bretired\\b", "\\bemeritus\\b", "\\bincoming\\b", "\\bex[- ]ceo\\b",
  "\\b(?:deputy|assistant|asst|vice)[ -]+(?:ceo|chief exec)",
  "\\bto (?:the )?(?:ceo|chief exec)", "\\boffice of (?:the )?(?:ceo|chief exec)",
  // An incoming CEO named before taking office ("CEO-Elect", "CEO Designate", "CEO (elect)").
  "\\b(?:ceo|chief exec(?:utive)?(?: officer)?)[ -]*\\(?(?:elect|designate)\\b",
  // A relative of the CEO, or anything the CEO owns ("CEO's spouse", "Spouse of CEO").
  "\\b(?:ceo|chief exec(?:utive)?(?: officer)?)'s\\b", "\\b(?:spouse|wife|husband|son|daughter|relative|family)\\b",
].join("|"));

function normalized(title: string | null): string {
  return (title ?? "")
    .toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/\bc\.e\.o\.?/g, "ceo")
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .split("executiveofficer")
    .join("executive officer")
    .trim();
}

/** Whether what follows one CEO mention scopes it to something other than the issuer. */
function scopedAfter(rest: string): boolean {
  const separator = /^\s*(,|-|\/|&|of\b)?\s*/.exec(rest);
  const after = rest.slice(separator?.[0].length ?? 0);
  if (separator?.[1] === "of") return /^[a-z]/.test(after) && !ISSUER_ITSELF.test(after);
  // The words up to the next separator: a further title of the same person, or the unit the CEO runs.
  const words = (/^[a-z' ]+/.exec(after)?.[0] ?? "").trim().split(" ").filter(Boolean);
  const [first] = words;
  if (first === undefined || CEO_SUFFIX_WORDS.has(first)) return false;
  return words.some((word) => UNIT_WORDS.has(word));
}

export function insiderOfficerTitleRole(title: string | null): InsiderOfficerTitleRole {
  const text = normalized(title);
  const mentions = [...text.matchAll(CEO_MENTION)];
  if (!mentions.length) return InsiderOfficerTitleRole.UNRECOGNIZED;
  if (NOT_THE_CEO.test(text)) return InsiderOfficerTitleRole.FORMER_OR_NON_CEO;
  if (SCOPED.test(text)) return InsiderOfficerTitleRole.SCOPE_REVIEW;
  if (mentions.some((mention) => scopedAfter(text.slice((mention.index ?? 0) + mention[0].length)))) {
    return InsiderOfficerTitleRole.SCOPE_REVIEW;
  }
  return InsiderOfficerTitleRole.CEO;
}

/** The `isCeo` lake column: the filing's own title reads as the issuer's chief executive. */
export function insiderTitleIsCeo(title: string | null): boolean {
  return insiderOfficerTitleRole(title) === InsiderOfficerTitleRole.CEO;
}

/** The two `insider_filings` columns a filing row carries for its own `officerTitle`. */
export function insiderCeoColumns(title: string | null): { isCeo: boolean; ceoTitleRule: string } {
  return { isCeo: insiderTitleIsCeo(title), ceoTitleRule: INSIDER_CEO_TITLE_RULE };
}
