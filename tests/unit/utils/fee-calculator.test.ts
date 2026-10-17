import Decimal from "decimal.js";

import { calculatePlatformFee } from "../../../src/utils/fee-calculator.utils";

describe("calculatePlatformFee", () => {
  it("returns zero for 0 bps", () => {
    expect(calculatePlatformFee(new Decimal(1000), 0).equals(new Decimal(0))).toBe(true);
  });

  it("calculates 50 bps as 0.5%", () => {
    expect(calculatePlatformFee(new Decimal(1000), 50).equals(new Decimal(5))).toBe(true);
  });

  it("calculates 150 bps as 1.5%", () => {
    expect(calculatePlatformFee(new Decimal(1000), 150).equals(new Decimal(15))).toBe(true);
  });

  it("calculates 250 bps as 2.5%", () => {
    expect(calculatePlatformFee(new Decimal(1000), 250).equals(new Decimal(25))).toBe(true);
  });

  it("calculates 10000 bps as 100%", () => {
    expect(calculatePlatformFee(new Decimal(1000), 10_000).equals(new Decimal(1000))).toBe(true);
  });

  it("rounds half up to currency precision", () => {
    expect(calculatePlatformFee(new Decimal("10.005"), 10_000).toFixed(2)).toBe("10.01");
    expect(calculatePlatformFee(new Decimal("10.004"), 10_000).toFixed(2)).toBe("10.00");
  });
});
