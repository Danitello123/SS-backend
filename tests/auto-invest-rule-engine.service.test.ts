import { Decimal } from "decimal.js";
import { AutoInvestRuleEngineService } from "../src/services/auto-invest-rule-engine.service";
import { AutoInvestRule } from "../src/models/AutoInvestRule.model";
import { AutoInvestExecution } from "../src/models/AutoInvestExecution.model";
import { Invoice } from "../src/models/Invoice.model";
import { User } from "../src/models/User.model";
import { AutoInvestExecutionStatus, InvoiceStatus, RiskTier } from "../src/types/enums";
import type { AccountBalanceChecker } from "../src/services/stellar/account-balance.service";
import type { InvestmentService } from "../src/services/investment.service";
import type { AppLogger } from "../src/observability/logger";

const NOOP_LOGGER: AppLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => NOOP_LOGGER,
};

function makeRule(overrides: Partial<AutoInvestRule> = {}): AutoInvestRule {
  return {
    id: overrides.id ?? "rule-1",
    investorId: "investor-1",
    category: null,
    minYield: "0.00",
    maxFaceValue: "1000000.0000",
    riskTier: null,
    maxPerInvoice: "500.0000",
    minWalletBalance: "100.0000",
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AutoInvestRule;
}

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: overrides.id ?? "invoice-1",
    sellerId: "issuer-1",
    invoiceNumber: "INV-1",
    customerName: "Acme",
    amount: "1000.0000",
    discountRate: "5.00",
    netAmount: "950.0000",
    dueDate: new Date("2026-03-01T00:00:00Z"),
    ipfsHash: null,
    riskScore: "20.00",
    category: "logistics",
    status: InvoiceStatus.PUBLISHED,
    smartContractId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  } as Invoice;
}

function makeDataSource(rules: AutoInvestRule[], users: User[], executions: AutoInvestExecution[]) {
  return {
    getRepository: (entity: unknown) => {
      if (entity === AutoInvestRule) {
        return {
          find: async (options: { where: { enabled: boolean } }) =>
            rules.filter((rule) => rule.enabled === options.where.enabled),
        };
      }
      if (entity === User) {
        return {
          findOneBy: async (options: { id: string }) => users.find((user) => user.id === options.id) ?? null,
        };
      }
      if (entity === AutoInvestExecution) {
        return {
          create: (data: Partial<AutoInvestExecution>) => data as AutoInvestExecution,
          save: async (execution: AutoInvestExecution) => {
            executions.push(execution);
            return execution;
          },
        };
      }
      throw new Error(`Unexpected entity in test fake: ${String(entity)}`);
    },
  } as unknown as import("typeorm").DataSource;
}

describe("AutoInvestRuleEngineService", () => {
  const investor = { id: "investor-1", stellarAddress: "GINVESTOR" } as User;

  it("executes a matching rule and records an EXECUTED event with the investment id", async () => {
    const rule = makeRule();
    const invoice = makeInvoice();
    const executions: AutoInvestExecution[] = [];
    const createInvestment = jest.fn().mockResolvedValue({ id: "investment-1" });
    const balanceChecker: AccountBalanceChecker = { getBalance: jest.fn().mockResolvedValue(new Decimal(500)) };

    const engine = new AutoInvestRuleEngineService({
      dataSource: makeDataSource([rule], [investor], executions),
      investmentService: { createInvestment } as unknown as InvestmentService,
      balanceChecker,
      logger: NOOP_LOGGER,
    });

    await engine.evaluateInvoice(invoice);

    expect(createInvestment).toHaveBeenCalledWith({
      invoiceId: invoice.id,
      investorId: rule.investorId,
      investmentAmount: "500.0000", // min(maxPerInvoice=500, netAmount=950)
    });
    expect(executions).toHaveLength(1);
    expect(executions[0]).toMatchObject({
      ruleId: rule.id,
      invoiceId: invoice.id,
      investorId: rule.investorId,
      investmentId: "investment-1",
      status: AutoInvestExecutionStatus.EXECUTED,
      amount: "500.0000",
    });
  });

  it("caps the investment at the invoice's remaining netAmount when it is smaller than maxPerInvoice", async () => {
    const rule = makeRule({ maxPerInvoice: "500.0000" });
    const invoice = makeInvoice({ netAmount: "200.0000" });
    const createInvestment = jest.fn().mockResolvedValue({ id: "investment-1" });
    const balanceChecker: AccountBalanceChecker = { getBalance: jest.fn().mockResolvedValue(new Decimal(1000)) };

    const engine = new AutoInvestRuleEngineService({
      dataSource: makeDataSource([rule], [investor], []),
      investmentService: { createInvestment } as unknown as InvestmentService,
      balanceChecker,
      logger: NOOP_LOGGER,
    });

    await engine.evaluateInvoice(invoice);

    expect(createInvestment).toHaveBeenCalledWith(
      expect.objectContaining({ investmentAmount: "200.0000" }),
    );
  });

  it("skips execution and records SKIPPED_INSUFFICIENT_BALANCE when the wallet is below the rule's floor", async () => {
    const rule = makeRule({ minWalletBalance: "1000.0000" });
    const invoice = makeInvoice();
    const executions: AutoInvestExecution[] = [];
    const createInvestment = jest.fn();
    const balanceChecker: AccountBalanceChecker = { getBalance: jest.fn().mockResolvedValue(new Decimal(50)) };

    const engine = new AutoInvestRuleEngineService({
      dataSource: makeDataSource([rule], [investor], executions),
      investmentService: { createInvestment } as unknown as InvestmentService,
      balanceChecker,
      logger: NOOP_LOGGER,
    });

    await engine.evaluateInvoice(invoice);

    expect(createInvestment).not.toHaveBeenCalled();
    expect(executions).toHaveLength(1);
    expect(executions[0]!.status).toBe(AutoInvestExecutionStatus.SKIPPED_INSUFFICIENT_BALANCE);
  });

  it("records FAILED when createInvestment throws, without throwing itself", async () => {
    const rule = makeRule();
    const invoice = makeInvoice();
    const executions: AutoInvestExecution[] = [];
    const createInvestment = jest.fn().mockRejectedValue(new Error("Invoice already fully funded"));
    const balanceChecker: AccountBalanceChecker = { getBalance: jest.fn().mockResolvedValue(new Decimal(500)) };

    const engine = new AutoInvestRuleEngineService({
      dataSource: makeDataSource([rule], [investor], executions),
      investmentService: { createInvestment } as unknown as InvestmentService,
      balanceChecker,
      logger: NOOP_LOGGER,
    });

    await expect(engine.evaluateInvoice(invoice)).resolves.toBeUndefined();
    expect(executions[0]).toMatchObject({
      status: AutoInvestExecutionStatus.FAILED,
      reason: "Invoice already fully funded",
    });
  });

  it.each([
    ["category mismatch", makeRule({ category: "retail" })],
    ["yield below the rule's minimum", makeRule({ minYield: "10.00" })], // invoice discountRate is 5.00
    ["face value above the rule's cap", makeRule({ maxFaceValue: "500.0000" })], // invoice amount is 1000
    ["risk tier mismatch", makeRule({ riskTier: RiskTier.HIGH })], // invoice riskScore 20 -> LOW
  ])("does not execute or record anything when the rule doesn't match (%s)", async (_label, rule) => {
    const invoice = makeInvoice();
    const executions: AutoInvestExecution[] = [];
    const createInvestment = jest.fn();
    const balanceChecker: AccountBalanceChecker = { getBalance: jest.fn() };

    const engine = new AutoInvestRuleEngineService({
      dataSource: makeDataSource([rule], [investor], executions),
      investmentService: { createInvestment } as unknown as InvestmentService,
      balanceChecker,
      logger: NOOP_LOGGER,
    });

    await engine.evaluateInvoice(invoice);

    expect(createInvestment).not.toHaveBeenCalled();
    expect(executions).toHaveLength(0);
  });

  it("executes every matching rule independently, across different investors", async () => {
    const ruleA = makeRule({ id: "rule-a", investorId: "investor-1", maxPerInvoice: "100.0000" });
    const ruleB = makeRule({ id: "rule-b", investorId: "investor-2", maxPerInvoice: "200.0000" });
    const investorB = { id: "investor-2", stellarAddress: "GINVESTORB" } as User;
    const invoice = makeInvoice({ netAmount: "950.0000" });
    const executions: AutoInvestExecution[] = [];
    const createInvestment = jest
      .fn()
      .mockResolvedValueOnce({ id: "investment-a" })
      .mockResolvedValueOnce({ id: "investment-b" });
    const balanceChecker: AccountBalanceChecker = { getBalance: jest.fn().mockResolvedValue(new Decimal(1000)) };

    const engine = new AutoInvestRuleEngineService({
      dataSource: makeDataSource([ruleA, ruleB], [investor, investorB], executions),
      investmentService: { createInvestment } as unknown as InvestmentService,
      balanceChecker,
      logger: NOOP_LOGGER,
    });

    await engine.evaluateInvoice(invoice);

    expect(createInvestment).toHaveBeenCalledTimes(2);
    expect(executions).toHaveLength(2);
    expect(executions.map((e) => e.status)).toEqual([
      AutoInvestExecutionStatus.EXECUTED,
      AutoInvestExecutionStatus.EXECUTED,
    ]);
  });

  it("one rule failing does not prevent another matching rule from executing", async () => {
    const ruleA = makeRule({ id: "rule-a", investorId: "investor-1" });
    const ruleB = makeRule({ id: "rule-b", investorId: "investor-2" });
    const investorB = { id: "investor-2", stellarAddress: "GINVESTORB" } as User;
    const invoice = makeInvoice();
    const executions: AutoInvestExecution[] = [];
    const createInvestment = jest
      .fn()
      .mockRejectedValueOnce(new Error("capacity exceeded"))
      .mockResolvedValueOnce({ id: "investment-b" });
    const balanceChecker: AccountBalanceChecker = { getBalance: jest.fn().mockResolvedValue(new Decimal(1000)) };

    const engine = new AutoInvestRuleEngineService({
      dataSource: makeDataSource([ruleA, ruleB], [investor, investorB], executions),
      investmentService: { createInvestment } as unknown as InvestmentService,
      balanceChecker,
      logger: NOOP_LOGGER,
    });

    await engine.evaluateInvoice(invoice);

    expect(executions.map((e) => e.status)).toEqual([
      AutoInvestExecutionStatus.FAILED,
      AutoInvestExecutionStatus.EXECUTED,
    ]);
  });
});
