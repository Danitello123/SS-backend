import type { NextFunction, Request, Response } from "express";

import { AdminRole, UserType } from "../types/enums";
import type { AuthenticatedRequest } from "../types/auth";
import type { CreatorKeyService } from "../services/creator-key.service";
import type { KeyMergeProposalService } from "../services/key-merge-proposal.service";
import { HttpError } from "../utils/http-error";

export interface KeyMergeProposalRequest extends Request {
  params: { id: string; proposalId?: string };
  query: { status?: string; limit?: string; cursor?: string };
}

const MERGE_STATUS_FILTERS = ["all", "pending", "completed", "executed"] as const;

export function isCreatorRole(userType: unknown): boolean {
  return userType === UserType.SELLER || userType === UserType.BOTH;
}

export async function isKeyCreator(
  req: Request,
  creatorKeyService: CreatorKeyService,
  keyId: string
): Promise<boolean> {
  const user = (req as AuthenticatedRequest).user;
  if (!user) return false;

  const userTypeStr = String(user.userType).toLowerCase();
  if (
    userTypeStr === "admin" ||
    user.userType === UserType.ADMIN ||
    (user.userType as unknown) === AdminRole.ADMIN
  ) {
    return true;
  }

  try {
    const detail = await creatorKeyService.getKeyDetail(keyId);
    const requester = user.stellarAddress?.toLowerCase();
    const candidates = [detail.creatorWallet, detail.creatorId].map((v) => v?.toLowerCase());

    return Boolean(requester && candidates.includes(requester));
  } catch (error) {
    if (error instanceof HttpError && error.statusCode === 404) {
      throw error;
    }
    return false;
  }
}

export function createKeyMergeProposalController(
  creatorKeyService: CreatorKeyService,
  keyMergeProposalService: KeyMergeProposalService
) {
  return {
    /**
     * GET /keys/:id/merge-proposals
     * Lists pending and completed merge proposals with vote tallies and migration summaries.
     * Enforces Admin and Creator access per endpoint.
     */
    async getMergeProposals(
      req: KeyMergeProposalRequest,
      res: Response,
      next: NextFunction
    ): Promise<void> {
      try {
        const user = (req as AuthenticatedRequest).user;
        if (!user) {
          throw new HttpError(401, "Authentication required.");
        }

        const userTypeStr = String(user.userType).toLowerCase();
        const isAdmin =
          userTypeStr === "admin" ||
          user.userType === UserType.ADMIN ||
          (user.userType as unknown) === AdminRole.ADMIN;

        // If creatorKeyService is available, verify key exists & user is creator
        let isCreator = false;
        if (creatorKeyService) {
          isCreator = await isKeyCreator(req, creatorKeyService, req.params.id);
        } else {
          isCreator = isCreatorRole(user.userType);
        }

        if (!isAdmin && !isCreator) {
          throw new HttpError(403, "Admin or creator access required.");
        }

        const status = req.query.status ? String(req.query.status).toLowerCase() : "all";
        if (!(MERGE_STATUS_FILTERS as readonly string[]).includes(status)) {
          throw new HttpError(400, `status must be one of: ${MERGE_STATUS_FILTERS.join(", ")}`);
        }

        const rawLimit =
          req.query.limit !== undefined ? parseInt(String(req.query.limit), 10) : undefined;
        const limit =
          rawLimit !== undefined && Number.isFinite(rawLimit) && rawLimit > 0
            ? rawLimit
            : undefined;
        const cursor = req.query.cursor ? String(req.query.cursor) : undefined;

        const result = await keyMergeProposalService.listForKey(req.params.id, {
          status,
          limit,
          cursor,
        });

        res.status(200).json({
          success: true,
          data: result,
          meta: result.meta,
        });
      } catch (error) {
        next(error);
      }
    },

    /**
     * GET /keys/:id/merge-proposals/:proposalId
     * Returns a single merge proposal with vote tally and migration details.
     */
    async getMergeProposalById(
      req: KeyMergeProposalRequest,
      res: Response,
      next: NextFunction
    ): Promise<void> {
      try {
        const user = (req as AuthenticatedRequest).user;
        if (!user) {
          throw new HttpError(401, "Authentication required.");
        }

        const userTypeStr = String(user.userType).toLowerCase();
        const isAdmin =
          userTypeStr === "admin" ||
          user.userType === UserType.ADMIN ||
          (user.userType as unknown) === AdminRole.ADMIN;

        let isCreator = false;
        if (creatorKeyService) {
          isCreator = await isKeyCreator(req, creatorKeyService, req.params.id);
        } else {
          isCreator = isCreatorRole(user.userType);
        }

        if (!isAdmin && !isCreator) {
          throw new HttpError(403, "Admin or creator access required.");
        }

        const proposalId = req.params.proposalId ?? req.params.id;
        const proposal = await keyMergeProposalService.getProposal(proposalId);

        res.status(200).json({
          success: true,
          data: proposal,
        });
      } catch (error) {
        next(error);
      }
    },
  };
}
