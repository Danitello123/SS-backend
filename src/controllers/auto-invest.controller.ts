import { Response } from "express";
import { AuthenticatedRequest } from "../types/auth";
import { AutoInvestRulesService } from "../services/auto-invest-rules.service";
import { RiskTier } from "../types/enums";

export class AutoInvestController {
  constructor(private readonly autoInvestRulesService: AutoInvestRulesService) {}

  createRule = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } });
      }

      const { category, minYield, maxFaceValue, riskTier, maxPerInvoice, minWalletBalance } = req.body;

      if (!minYield || !maxFaceValue || !maxPerInvoice) {
        return res.status(400).json({
          error: {
            code: "MISSING_FIELDS",
            message: "minYield, maxFaceValue and maxPerInvoice are required",
          },
        });
      }

      if (riskTier && !Object.values(RiskTier).includes(riskTier)) {
        return res.status(400).json({
          error: {
            code: "INVALID_RISK_TIER",
            message: `riskTier must be one of: ${Object.values(RiskTier).join(", ")}`,
          },
        });
      }

      const rule = await this.autoInvestRulesService.createRule({
        investorId: user.id,
        category: category ?? null,
        minYield,
        maxFaceValue,
        riskTier: riskTier ?? null,
        maxPerInvoice,
        minWalletBalance,
      });

      return res.status(201).json({ success: true, data: rule });
    } catch (err: unknown) {
      return respondWithError(res, err);
    }
  };

  listRules = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } });
      }

      const rules = await this.autoInvestRulesService.listRules(user.id);
      return res.status(200).json({ success: true, data: rules });
    } catch (err: unknown) {
      return respondWithError(res, err);
    }
  };

  deleteRule = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } });
      }

      await this.autoInvestRulesService.deleteRule(user.id, req.params.ruleId as string);
      return res.status(204).send();
    } catch (err: unknown) {
      return respondWithError(res, err);
    }
  };
}

function respondWithError(res: Response, err: unknown) {
  const statusCode =
    (err as { statusCode?: number }).statusCode || (err as { status?: number }).status || 500;
  return res.status(statusCode).json({
    error: {
      code: (err as { code?: string }).code || "INTERNAL_ERROR",
      message: (err as { message?: string }).message || "Internal server error",
    },
  });
}
