import { DataSource } from "typeorm";
import { FeeScheduleService } from "../src/services/fee-schedule.service";
import { FeeSchedule, FeeScheduleHistory } from "../src/models/FeeSchedule.model";
import { createTestDataSource } from "./helpers/test-data-source";

describe("FeeScheduleService", () => {
  let dataSource: DataSource;
  let feeScheduleService: FeeScheduleService;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
    await dataSource.synchronize(true);
    feeScheduleService = new FeeScheduleService(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    // FeeScheduleHistory.feeSchedule FKs back to FeeSchedule, so the child
    // table must be cleared first or sqlite rejects deleting a still-
    // referenced parent row left over from the previous test.
    await dataSource.getRepository(FeeScheduleHistory).clear();
    await dataSource.getRepository(FeeSchedule).clear();
  });

  describe("getCurrentFeeSchedule", () => {
    it("should return the current active fee schedule", async () => {
      const repository = dataSource.getRepository(FeeSchedule);
      const schedule = repository.create({
        investmentFeeBps: 100,
        settlementFeeBps: 50,
        platformFeeBps: 100,
        secondaryMarketFeeBps: 150,
        isActive: true,
        effectiveFrom: new Date(),
      });
      await repository.save(schedule);

      const result = await feeScheduleService.getCurrentFeeSchedule();

      expect(result).toEqual({
        investmentFeeBps: 100,
        settlementFeeBps: 50,
        platformFeeBps: 100,
        secondaryMarketFeeBps: 150,
        effectiveFrom: expect.any(Date),
        effectiveUntil: null,
        isActive: true,
      });
    });

    it("should throw error when no active schedule exists", async () => {
      await expect(feeScheduleService.getCurrentFeeSchedule()).rejects.toMatchObject({
        code: "NO_ACTIVE_FEE_SCHEDULE",
        statusCode: 404,
      });
    });
  });

  describe("updateFeeSchedule", () => {
    it("should update fee rates and create history entry", async () => {
      const repository = dataSource.getRepository(FeeSchedule);
      const schedule = repository.create({
        investmentFeeBps: 100,
        settlementFeeBps: 50,
        platformFeeBps: 100,
        secondaryMarketFeeBps: 150,
        isActive: true,
        effectiveFrom: new Date(),
      });
      await repository.save(schedule);

      const result = await feeScheduleService.updateFeeSchedule(
        {
          investmentFeeBps: 200,
          settlementFeeBps: 75,
          changeReason: "Test update",
        },
        "GDADMINWALLET",
        "admin"
      );

      expect(result.investmentFeeBps).toBe(200);
      expect(result.settlementFeeBps).toBe(75);
      expect(result.platformFeeBps).toBe(100);
      expect(result.secondaryMarketFeeBps).toBe(150);

      const historyRepository = dataSource.getRepository(FeeScheduleHistory);
      const history = await historyRepository.findOne({ where: { actorWallet: "GDADMINWALLET" } });

      expect(history).toBeDefined();
      expect(history?.oldInvestmentFeeBps).toBe(100);
      expect(history?.newInvestmentFeeBps).toBe(200);
      expect(history?.changeReason).toBe("Test update");
    });

    it("should validate fee rate bounds", async () => {
      const repository = dataSource.getRepository(FeeSchedule);
      const schedule = repository.create({
        investmentFeeBps: 100,
        settlementFeeBps: 50,
        platformFeeBps: 100,
        secondaryMarketFeeBps: 150,
        isActive: true,
        effectiveFrom: new Date(),
      });
      await repository.save(schedule);

      await expect(
        feeScheduleService.updateFeeSchedule(
          { investmentFeeBps: 1500 },
          "GDADMINWALLET",
          "admin"
        )
      ).rejects.toMatchObject({ code: "INVALID_FEE_RATE", statusCode: 400 });
    });

    it("should require at least one fee to update", async () => {
      const repository = dataSource.getRepository(FeeSchedule);
      const schedule = repository.create({
        investmentFeeBps: 100,
        settlementFeeBps: 50,
        platformFeeBps: 100,
        secondaryMarketFeeBps: 150,
        isActive: true,
        effectiveFrom: new Date(),
      });
      await repository.save(schedule);

      await expect(
        feeScheduleService.updateFeeSchedule({}, "GDADMINWALLET", "admin")
      ).rejects.toMatchObject({ code: "NO_CHANGES", statusCode: 400 });
    });
  });

  describe("getFeeScheduleHistory", () => {
    it("should return paginated history", async () => {
      const scheduleRepository = dataSource.getRepository(FeeSchedule);
      const schedule = scheduleRepository.create({
        investmentFeeBps: 100,
        settlementFeeBps: 50,
        platformFeeBps: 100,
        secondaryMarketFeeBps: 150,
        isActive: true,
        effectiveFrom: new Date(),
      });
      await scheduleRepository.save(schedule);

      await feeScheduleService.updateFeeSchedule(
        { investmentFeeBps: 200 },
        "GDADMINWALLET1",
        "admin"
      );
      await feeScheduleService.updateFeeSchedule(
        { settlementFeeBps: 75 },
        "GDADMINWALLET2",
        "admin"
      );

      const result = await feeScheduleService.getFeeScheduleHistory({ limit: 10, offset: 0 });

      expect(result.history).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.history[0].actorWallet).toBe("GDADMINWALLET2");
      expect(result.history[1].actorWallet).toBe("GDADMINWALLET1");
    });

    it("should respect pagination parameters", async () => {
      const scheduleRepository = dataSource.getRepository(FeeSchedule);
      const schedule = scheduleRepository.create({
        investmentFeeBps: 100,
        settlementFeeBps: 50,
        platformFeeBps: 100,
        secondaryMarketFeeBps: 150,
        isActive: true,
        effectiveFrom: new Date(),
      });
      await scheduleRepository.save(schedule);

      for (let i = 0; i < 5; i++) {
        await feeScheduleService.updateFeeSchedule(
          { investmentFeeBps: 100 + i * 10 },
          `GDADMINWALLET${i}`,
          "admin"
        );
      }

      const result = await feeScheduleService.getFeeScheduleHistory({ limit: 2, offset: 0 });

      expect(result.history).toHaveLength(2);
      expect(result.total).toBe(5);
    });
  });
});
