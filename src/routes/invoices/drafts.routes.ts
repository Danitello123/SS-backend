import { Router } from "express";
import { createInvoiceDraftController } from "@/controllers/invoice-draft.controller";
import type { InvoiceDraftService } from "@/services/invoice-draft.service";
import { createAuthMiddleware } from "@/middleware/auth.middleware";
import type { AuthService } from "@/services/auth.service";

export function createInvoiceDraftsRouter({
  draftService,
  authService,
}: {
  draftService: InvoiceDraftService;
  authService: AuthService;
}): Router {
  const router = Router();
  const controller = createInvoiceDraftController(draftService);
  const authenticateJWT = createAuthMiddleware(authService);

  // PUT /invoices/drafts/:id - upsert draft
  router.put("/drafts/:id", authenticateJWT, (req, res, next) => {
    controller.saveDraft(req, res, next);
  });

  // PUT /invoices/drafts - create new draft (no id)
  router.put("/drafts", authenticateJWT, (req, res, next) => {
    controller.saveDraft(req, res, next);
  });

  // GET /invoices/drafts - list all drafts
  router.get("/drafts", authenticateJWT, (req, res, next) => {
    controller.listDrafts(req, res, next);
  });

  // GET /invoices/drafts/:id - get draft data
  router.get("/drafts/:id", authenticateJWT, (req, res, next) => {
    controller.getDraft(req, res, next);
  });

  // DELETE /invoices/drafts/:id - delete draft
  router.delete("/drafts/:id", authenticateJWT, (req, res, next) => {
    controller.deleteDraft(req, res, next);
  });

  return router;
}
