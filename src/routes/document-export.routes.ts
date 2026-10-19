import { Router } from "express";
import { DocumentExportController } from "../controllers/document-export.controller";
import type { DocumentExportService } from "../services/document-export.service";
import { createAuthMiddleware } from "../middleware/auth.middleware";
import type { AuthService } from "../services/auth.service";

export interface DocumentExportRouterDependencies {
  documentExportService: DocumentExportService;
  authService: AuthService;
}

export function createDocumentExportRouter({
  documentExportService,
  authService,
}: DocumentExportRouterDependencies): Router {
  const router = Router();
  const controller = new DocumentExportController(documentExportService);
  const authMiddleware = createAuthMiddleware(authService);

  // POST /api/v1/invoices/:id/documents/export - kick off async ZIP generation
  router.post("/:id/documents/export", authMiddleware, controller.requestExport);

  // GET /api/v1/invoices/:id/documents/export/:jobId - poll job status / get the signed download URL
  router.get("/:id/documents/export/:jobId", authMiddleware, controller.getExportStatus);

  // GET /api/v1/invoices/:id/documents/export/:jobId/download?token=... - stream the ZIP
  router.get("/:id/documents/export/:jobId/download", controller.downloadExport);

  return router;
}
