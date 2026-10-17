import { stroopsToXlm, xlmToStroops } from "../../../src/utils/unit-conversion.utils";

describe("Unit Conversion Utilities", () => {
  describe("stroopsToXlm", () => {
    it('should convert 0 stroops (bigint) to "0.0000000"', () => {
      expect(stroopsToXlm(0n)).toBe("0.0000000");
    });

    it('should convert 0 stroops (string) to "0.0000000"', () => {
      expect(stroopsToXlm("0")).toBe("0.0000000");
    });

    it('should convert 1 stroop (bigint) to "0.0000001"', () => {
      expect(stroopsToXlm(1n)).toBe("0.0000001");
    });

    it('should convert 1 stroop (string) to "0.0000001"', () => {
      expect(stroopsToXlm("1")).toBe("0.0000001");
    });

    it('should convert 10,000,000 stroops to "1.0000000"', () => {
      expect(stroopsToXlm(10000000n)).toBe("1.0000000");
      expect(stroopsToXlm("10000000")).toBe("1.0000000");
    });

    it("should convert 100,000 XLM (1,000,000,000,000 stroops) correctly", () => {
      expect(stroopsToXlm(1000000000000n)).toBe("100000.0000000");
      expect(stroopsToXlm("1000000000000")).toBe("100000.0000000");
    });

    it("should handle fractional representation without precision loss", () => {
      expect(stroopsToXlm(123456789n)).toBe("12.3456789");
    });

    it("should throw an Error for non-numeric input strings", () => {
      expect(() => stroopsToXlm("invalid")).toThrow();
    });
  });

  describe("xlmToStroops", () => {
    it("should convert 0 XLM (number) to 0n", () => {
      expect(xlmToStroops(0)).toBe(0n);
    });

    it("should convert 0 XLM (string) to 0n", () => {
      expect(xlmToStroops("0")).toBe(0n);
    });

    it("should convert 0.0000001 XLM to 1n stroop", () => {
      expect(xlmToStroops(0.0000001)).toBe(1n);
      expect(xlmToStroops("0.0000001")).toBe(1n);
    });

    it("should convert 1 XLM to 10,000,000n stroops", () => {
      expect(xlmToStroops(1)).toBe(10000000n);
      expect(xlmToStroops("1")).toBe(10000000n);
    });

    it("should convert 100,000 XLM to 1,000,000,000,000n stroops", () => {
      expect(xlmToStroops(100000)).toBe(1000000000000n);
      expect(xlmToStroops("100000")).toBe(1000000000000n);
    });

    it("should prevent floating-point precision loss for tricky decimals", () => {
      expect(xlmToStroops("12.3456789")).toBe(123456789n);
      expect(xlmToStroops(0.1 + 0.2)).toBe(3000000n);
    });

    it("should throw an Error for non-numeric input strings", () => {
      expect(() => xlmToStroops("invalid")).toThrow();
    });
  });
});
