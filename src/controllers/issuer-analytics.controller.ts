import { Request, Response } from "express";
import { IssuerAnalyticsService, isValidAnalyticsRange } from "../services/issuer-analytics.service";

export class IssuerAnalyticsController {
  constructor(private readonly issuerAnalyticsService: IssuerAnalyticsService) {}

  getAnalytics = async (req: Request, res: Response) => {
    try {
      const wallet = req.params.wallet as string;
      const rangeParam = (req.query.range as string | undefined) ?? "30d";

      if (!isValidAnalyticsRange(rangeParam)) {
        return res.status(400).json({
          error: {
            code: "INVALID_RANGE",
            message: `range must be one of: 30d, 90d, all. Got "${rangeParam}".`,
          },
        });
      }

      const analytics = await this.issuerAnalyticsService.getAnalyticsByWallet(wallet, rangeParam);

      return res.status(200).json({
        success: true,
        data: analytics,
      });
    } catch (err: unknown) {
      const statusCode =
        (err as { statusCode?: number }).statusCode ||
        (err as { status?: number }).status ||
        500;
      return res.status(statusCode).json({
        error: {
          code: (err as { code?: string }).code || "INTERNAL_ERROR",
          message: (err as { message?: string }).message || "Internal server error",
        },
      });
    }
  };
}
