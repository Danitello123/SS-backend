import { DataSource } from "typeorm";
import { InvestmentService } from "../../../src/services/investment.service";
import { Investment } from "../../../src/models/Investment.model";
import { InvestmentStatus, InvoiceStatus } from "../../../src/types/enums";

describe("InvestmentService.calculateInvestorAnalytics", () => {
  let mockDataSource: jest.Mocked<DataSource>;
  let mockInvestmentRepository: { find: jest.Mock };
  let investmentService: InvestmentService;

  beforeEach(() => {
    mockInvestmentRepository = {
      find: jest.fn(),
    };

    mockDataSource = {
      getRepository: jest.fn().mockReturnValue(mockInvestmentRepository),
    } as any;

    investmentService = new InvestmentService(mockDataSource);
  });

  it("should return zero metrics for an investor with no investments", async () => {
    mockInvestmentRepository.find.mockResolvedValue([]);

    const result = await investmentService.calculateInvestorAnalytics("investor-empty");

    expect(result).toEqual({
      totalDeployedCapital: "0.0000",
      totalProfitEarned: "0.0000",
      pendingPayouts: "0.0000",
      projectedTotalReturn: "0.0000",
      weightedAverageApy: "0.00",
      statusDistribution: {
        pending: 0,
        confirmed: 0,
        settled: 0,
        cancelled: 0,
        overdue: 0,
      },
      monthlyPerformance: [],
    });
  });

  it("should calculate correct weighted APY, totals, and distributions for active and settled investments", async () => {
    const mockInvestments = [
      {
        id: "inv-1",
        investorId: "investor-1",
        investmentAmount: "1000.0000",
        expectedReturn: "1050.0000",
        actualReturn: null,
        status: InvestmentStatus.CONFIRMED,
        createdAt: new Date("2026-01-15T10:00:00Z"),
        invoice: {
          id: "invoice-1",
          discountRate: "5.00",
          dueDate: new Date("2026-12-31T00:00:00Z"),
          status: InvoiceStatus.FUNDED,
        },
      },
      {
        id: "inv-2",
        investorId: "investor-1",
        investmentAmount: "2000.0000",
        expectedReturn: "2200.0000",
        actualReturn: null,
        status: InvestmentStatus.PENDING,
        createdAt: new Date("2026-01-20T10:00:00Z"),
        invoice: {
          id: "invoice-2",
          discountRate: "10.00",
          dueDate: new Date("2026-12-31T00:00:00Z"),
          status: InvoiceStatus.PUBLISHED,
        },
      },
      {
        id: "inv-3",
        investorId: "investor-1",
        investmentAmount: "500.0000",
        expectedReturn: "550.0000",
        actualReturn: "550.0000",
        status: InvestmentStatus.SETTLED,
        createdAt: new Date("2026-02-10T10:00:00Z"),
        invoice: {
          id: "invoice-3",
          discountRate: "10.00",
          dueDate: new Date("2026-02-01T00:00:00Z"),
          status: InvoiceStatus.SETTLED,
        },
      },
    ];

    mockInvestmentRepository.find.mockResolvedValue(mockInvestments as any);

    const result = await investmentService.calculateInvestorAnalytics("investor-1");

    // Total deployed capital = 1000 + 2000 = 3000
    expect(result.totalDeployedCapital).toBe("3000.0000");

    // Pending payouts = 1050 + 2200 = 3250
    expect(result.pendingPayouts).toBe("3250.0000");

    // Total profit earned from settled = 550 - 500 = 50
    expect(result.totalProfitEarned).toBe("50.0000");

    // Weighted APY: (1000 * 5 + 2000 * 10) / 3000 = 25000 / 3000 = 8.33%
    expect(result.weightedAverageApy).toBe("8.33");

    expect(result.statusDistribution).toEqual({
      pending: 1,
      confirmed: 1,
      settled: 1,
      cancelled: 0,
      overdue: 0,
    });

    expect(result.monthlyPerformance).toHaveLength(2);
    expect(result.monthlyPerformance[0].month).toBe("2026-01");
    expect(result.monthlyPerformance[0].investedAmount).toBe("3000.0000");
    expect(result.monthlyPerformance[1].month).toBe("2026-02");
    expect(result.monthlyPerformance[1].profit).toBe("50.0000");
  });

  it("should correctly flag overdue investments when due date is past", async () => {
    const pastDate = new Date("2020-01-01T00:00:00Z");
    const mockInvestments = [
      {
        id: "inv-overdue",
        investorId: "investor-2",
        investmentAmount: "1000.0000",
        expectedReturn: "1100.0000",
        actualReturn: null,
        status: InvestmentStatus.CONFIRMED,
        createdAt: new Date("2020-01-01T10:00:00Z"),
        invoice: {
          id: "invoice-old",
          discountRate: "10.00",
          dueDate: pastDate,
          status: InvoiceStatus.FUNDED,
        },
      },
    ];

    mockInvestmentRepository.find.mockResolvedValue(mockInvestments as any);

    const result = await investmentService.calculateInvestorAnalytics("investor-2");
    expect(result.statusDistribution.overdue).toBe(1);
    expect(result.statusDistribution.confirmed).toBe(1);
  });
});
