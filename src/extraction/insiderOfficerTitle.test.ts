import {
  INSIDER_CEO_CLASSIFIER_VERSION,
  INSIDER_CEO_TITLE_RULE,
  InsiderOfficerTitleRole,
  insiderCeoColumns,
  insiderOfficerTitleRole,
  insiderTitleIsCeo,
} from "./insiderOfficerTitle";

const { CEO, FORMER_OR_NON_CEO, SCOPE_REVIEW, UNRECOGNIZED } = InsiderOfficerTitleRole;

/** The golden table. A change here is a rule change: bump INSIDER_CEO_CLASSIFIER_VERSION with it. */
const GOLDEN: Array<[string | null, InsiderOfficerTitleRole]> = [
  // The issuer's own chief executive, with any other titles beside it.
  ["Chief Executive Officer", CEO],
  ["Chief Executive", CEO],
  ["President and CEO", CEO],
  ["Chairman & CEO", CEO],
  ["Vice Chairman and CEO", CEO],
  ["CEO, President", CEO],
  ["CEO-President", CEO],
  ["CEO - Chairman", CEO],
  ["CEO – Chairman", CEO],
  ["CEO/President", CEO],
  ["President, CEO and Director", CEO],
  ["CEO and Chief Financial Officer", CEO],
  ["CEO (Principal Executive Officer)", CEO],
  ["CEO of the Company", CEO],
  ["CEO of the Issuer", CEO],
  // Abbreviated further titles of the same person.
  ["CEO, Dir", CEO],
  ["CEO, Director", CEO],
  ["CEO & Chmn", CEO],
  ["CEO/Chrmn", CEO],
  ["CEO, Chm", CEO],
  ["CEO & COB", CEO],
  ["CEO, EVP", CEO],
  ["CEO, SVP", CEO],
  ["CEO, Sr. Partner", CEO],
  ["CEO, Pres.", CEO],
  ["CEO, Treas.", CEO],
  ["CEO & Sec", CEO],
  ["CEO, COO", CEO],
  ["CEO and CFO", CEO],
  ["CEO, Founder", CEO],
  ["CEO & Chairwoman", CEO],
  ["CEO, Chair", CEO],
  ["CEO, Partner", CEO],
  ["CEO, Board Member", CEO],
  ["Chief Executive Officer of the Registrant", CEO],
  ["President & Chief Executive Officer of the Corporation", CEO],
  ["C.E.O.", CEO],
  // Interim, acting and co-CEOs are the chief executive while they hold the title.
  ["Interim CEO", CEO],
  ["Acting Chief Executive Officer", CEO],
  ["Co-CEO", CEO],
  // Not the chief executive.
  ["Former CEO", FORMER_OR_NON_CEO],
  ["Retired CEO", FORMER_OR_NON_CEO],
  ["Incoming CEO", FORMER_OR_NON_CEO],
  ["CEO-Elect", FORMER_OR_NON_CEO],
  ["CEO Elect", FORMER_OR_NON_CEO],
  ["CEO-Designate", FORMER_OR_NON_CEO],
  ["CEO Designate", FORMER_OR_NON_CEO],
  ["CEO (elect)", FORMER_OR_NON_CEO],
  ["President and CEO-Elect", FORMER_OR_NON_CEO],
  ["Chief Executive Officer-Elect", FORMER_OR_NON_CEO],
  ["Deputy CEO", FORMER_OR_NON_CEO],
  ["Vice CEO", FORMER_OR_NON_CEO],
  ["Senior Advisor to the CEO", FORMER_OR_NON_CEO],
  ["Assistant to the CEO", FORMER_OR_NON_CEO],
  ["Chief of Staff to the CEO", FORMER_OR_NON_CEO],
  ["Office of the CEO", FORMER_OR_NON_CEO],
  ["CEO's spouse", FORMER_OR_NON_CEO],
  ["CEO’s Spouse", FORMER_OR_NON_CEO],
  ["Spouse of CEO", FORMER_OR_NON_CEO],
  // A CEO of a region, division, subsidiary or other named unit.
  ["CEO of Subsidiary Bank", SCOPE_REVIEW],
  ["CEO Europe", SCOPE_REVIEW],
  ["CEO, Americas", SCOPE_REVIEW],
  ["CEO, North America", SCOPE_REVIEW],
  ["Regional CEO", SCOPE_REVIEW],
  ["EVP & CEO of XYZ Bank", SCOPE_REVIEW],
  ["Chief Executive Officer, Acme Insurance", SCOPE_REVIEW],
  ["CEO of Trust Company", SCOPE_REVIEW],
  ["CEO of the Trust Company", SCOPE_REVIEW],
  // No CEO named: unknown, never CEO. SEC's "See Remarks" puts the real title elsewhere in the filing.
  ["See Remarks", UNRECOGNIZED],
  ["See remarks below", UNRECOGNIZED],
  ["Chief Financial Officer", UNRECOGNIZED],
  ["Executive Vice President", UNRECOGNIZED],
  ["", UNRECOGNIZED],
  [null, UNRECOGNIZED],
];

describe("insiderOfficerTitleRole", () => {
  it.each(GOLDEN)("reads %p as %p", (title, role) => {
    expect(insiderOfficerTitleRole(title)).toBe(role);
  });

  it("marks isCeo exactly for the CEO rows of the golden table", () => {
    for (const [title, role] of GOLDEN) expect(insiderTitleIsCeo(title)).toBe(role === CEO);
  });

  it("names the rule version the lake stamps", () => {
    expect(INSIDER_CEO_CLASSIFIER_VERSION).toBe(2);
    expect(INSIDER_CEO_TITLE_RULE).toBe("ceo-title2");
  });

  it("stamps every filing's CEO flag with the rule that computed it", () => {
    expect(insiderCeoColumns("President and CEO")).toEqual({ isCeo: true, ceoTitleRule: "ceo-title2" });
    expect(insiderCeoColumns("CEO-Elect")).toEqual({ isCeo: false, ceoTitleRule: "ceo-title2" });
    expect(insiderCeoColumns(null)).toEqual({ isCeo: false, ceoTitleRule: "ceo-title2" });
  });
});
