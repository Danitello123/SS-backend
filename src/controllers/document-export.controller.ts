import { Request, Response } from "express";
import { AuthenticatedRequest } from "../types/auth";
import { DocumentExportService } from "../services/document-export.service";

export class DocumentExportController {
  constructor(private readonly documentExportService: DocumentExportService) {}

  requestExport = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const invoiceId = req.params.id as string;
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } });
      }

      const { jobId } = await this.documentExportService.requestExport(invoiceId, user.id);

      return res.status(202).json({
        success: true,
        data: { jobId, status: "processing" },
      });
    } catch (err: unknown) {
      return respondWithError(res, err);
    }
  };

  getExportStatus = async (req: Request, res: Response) => {
    try {
      const jobId = req.params.jobId as string;
      const job = this.documentExportService.getJobStatus(jobId);
      if (!job) {
        return res.status(404).json({ error: { code: "export_job_not_found", message: "Export job not found" } });
      }

      const data: Record<string, unknown> = { jobId: job.id, status: job.status };
      if (job.status === "completed" && job.downloadToken) {
        data.downloadUrl = `/api/v1/invoices/${job.invoiceId}/documents/export/${job.id}/download?token=${job.downloadToken}`;
        data.expiresAt = new Date(job.downloadTokenExpiresAt!).toISOString();
      }
      if (job.status === "failed") {
        data.error = job.error;
      }

      return res.status(200).json({ success: true, data });
    } catch (err: unknown) {
      return respondWithError(res, err);
    }
  };

  downloadExport = async (req: Request, res: Response) => {
    try {
      const jobId = req.params.jobId as string;
      const token = req.query.token as string | undefined;
      if (!token) {
        return res.status(400).json({ error: { code: "missing_token", message: "token query param is required" } });
      }

      const zipPath = this.documentExportService.getDownloadPath(jobId, token);
      return res.download(zipPath, `${jobId}.zip`);
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
