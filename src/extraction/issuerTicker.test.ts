import { resolveIssuerTicker } from "./issuerTicker";

/** Every input below was filed as `issuerTradingSymbol` and is in the published dataset. */
describe("resolveIssuerTicker", () => {
  it.each([
    ["AAPL", "AAPL"],
    ["BRK.B", "BRK.B"],
    ["GEF-B", "GEF-B"],
    [" msft ", "MSFT"],
    ["vicr", "VICR"],
    ['"""OMEX"""', "OMEX"],
    ["(SIRI)", "SIRI"],
    ["NYSE: KRC", "KRC"],
    ["NYSE:FLG", "FLG"],
    ["NASDAQ:SVC", "SVC"],
    ["ASX:LNW", "LNW"],
    ["BF'B", "BF.B"],
    ["N O G", "NOG"],
  ])("cleans %j to %j", (filed, expected) => {
    expect(resolveIssuerTicker(filed)).toBe(expected);
  });

  it.each([
    ["LEN, LEN.B", "LEN"],
    ["WLY, WLYB", "WLY"],
    ["GEF,GEF.B", "GEF"],
    ["Z AND ZG", "Z"],
    ["BIO BIO.B", "BIO"],
    ["CRDA CRDB", "CRDA"],
    ["MOGA/MOGB", "MOGA"],
    ["GTII/GTBIF", "GTII"],
    ["OPGN,OPGNW", "OPGN"],
  ])("takes the first class from the list %j", (filed, expected) => {
    expect(resolveIssuerTicker(filed)).toBe(expected);
  });

  it.each(["MTLp", "CELGr", "WRKw"])("keeps the lowercase class letter in %j", (filed) => {
    expect(resolveIssuerTicker(filed)).toBe(filed);
  });

  it.each([null, undefined, "", "   ", "none", "None", "n/a", "N/A", "NA", "1314152", "GRAYBAR", "NOT TRADED"])(
    "returns null for %j, which names no listed symbol",
    (filed) => {
      expect(resolveIssuerTicker(filed)).toBeNull();
    }
  );
});
