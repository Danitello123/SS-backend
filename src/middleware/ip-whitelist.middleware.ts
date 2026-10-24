import type { NextFunction, Request, Response } from "express";
import ipRangeCheck from "ip-range-check";

export function ipWhitelistMiddleware(allowedCidrs: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const forwardedFor = req.headers["x-forwarded-for"];
    const forwardedIp =
      typeof forwardedFor === "string"
        ? forwardedFor.split(",")[0]?.trim()
        : forwardedFor?.[0]?.split(",")[0]?.trim();
    const clientIp = req.ip || forwardedIp || req.socket.remoteAddress;

    if (!clientIp || !ipRangeCheck(clientIp, allowedCidrs)) {
      res.status(403).json({
        error: "Access denied: IP address not authorized.",
      });
      return;
    }

    next();
  };
}
