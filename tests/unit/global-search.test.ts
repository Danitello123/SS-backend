import { groupSearchResults, isStellarTxHash } from "@/lib/global-search";

describe("isStellarTxHash", () => {
  it("matches a 64 character hex hash only", () => {
    expect(isStellarTxHash("a".repeat(64))).toBe(true);
    expect(isStellarTxHash("a".repeat(63))).toBe(false);
    expect(isStellarTxHash("invoice")).toBe(false);
  });
});

describe("groupSearchResults", () => {
  it("returns the top 3 invoices, top 3 issuers and top 1 transaction", () => {
    const result = groupSearchResults([1, 2, 3, 4], ["a", "b", "c", "d"], ["x", "y"]);
    expect(result).toEqual({ invoices: [1, 2, 3], issuers: ["a", "b", "c"], transactions: ["x"] });
  });
});
