import { nextBounceRetryDelayMs, renderEmailTemplate } from "@/lib/email-templates";

describe("renderEmailTemplate", () => {
  it("interpolates dynamic data and appends the unsubscribe link", () => {
    const email = renderEmailTemplate(
      "settlement",
      { invoiceNumber: "INV-1", amount: "100 USDC" },
      "https://app/unsubscribe?t=abc"
    );

    expect(email.subject).toBe("Invoice INV-1 has settled");
    expect(email.body).toContain("Invoice INV-1 settled for 100 USDC.");
    expect(email.body).toContain("Unsubscribe: https://app/unsubscribe?t=abc");
  });

  it("leaves unknown placeholders untouched", () => {
    const email = renderEmailTemplate("invoice_rejected", { invoiceNumber: "INV-2" }, "u");
    expect(email.body).toContain("{{reason}}");
  });
});

describe("nextBounceRetryDelayMs", () => {
  it("backs off exponentially for up to 3 retries", () => {
    expect(nextBounceRetryDelayMs(0)).toBe(60_000);
    expect(nextBounceRetryDelayMs(1)).toBe(120_000);
    expect(nextBounceRetryDelayMs(2)).toBe(240_000);
  });

  it("returns null once retries are exhausted", () => {
    expect(nextBounceRetryDelayMs(3)).toBeNull();
  });
});
