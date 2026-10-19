import express from "express";
import request from "supertest";
import { createNetworkContextMiddleware } from "@/middleware/network-context.middleware";
import { createErrorMiddleware, notFoundMiddleware } from "@/middleware/error.middleware";
import type { NetworkAwareRequest } from "@/types/network";
import type { StellarNetworksConfig } from "@/config/stellar-networks";
import { logger } from "@/observability/logger";

const NETWORKS_CONFIG: StellarNetworksConfig = {
  mainnet: {
    network: "mainnet",
    horizonUrl: "https://horizon.stellar.org",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    contractId: "CMAINNETCONTRACT",
  },
  testnet: {
    network: "testnet",
    horizonUrl: "https://horizon-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CTESTNETCONTRACT",
  },
};

function buildApp() {
  const app = express();
  app.use(createNetworkContextMiddleware(NETWORKS_CONFIG));
  app.get("/probe", (req, res) => {
    const network = (req as NetworkAwareRequest).stellarNetwork;
    res.status(200).json({ network });
  });
  app.use(notFoundMiddleware);
  app.use(createErrorMiddleware(logger));
  return app;
}

describe("network context middleware (#588)", () => {
  const app = buildApp();

  it("routes to mainnet endpoints when X-Stellar-Network is mainnet", async () => {
    const res = await request(app).get("/probe").set("X-Stellar-Network", "mainnet");

    expect(res.status).toBe(200);
    expect(res.body.network).toEqual(NETWORKS_CONFIG.mainnet);
  });

  it("routes to testnet endpoints when X-Stellar-Network is testnet", async () => {
    const res = await request(app).get("/probe").set("X-Stellar-Network", "testnet");

    expect(res.status).toBe(200);
    expect(res.body.network).toEqual(NETWORKS_CONFIG.testnet);
  });

  it("defaults to mainnet when the header is missing", async () => {
    const res = await request(app).get("/probe");

    expect(res.status).toBe(200);
    expect(res.body.network).toEqual(NETWORKS_CONFIG.mainnet);
  });

  it("is case-insensitive", async () => {
    const res = await request(app).get("/probe").set("X-Stellar-Network", "TestNet");

    expect(res.status).toBe(200);
    expect(res.body.network).toEqual(NETWORKS_CONFIG.testnet);
  });

  it("returns 400 with a clear message for an invalid network value", async () => {
    const res = await request(app).get("/probe").set("X-Stellar-Network", "futurenet");

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("futurenet");
    expect(res.body.error.message).toContain("mainnet");
    expect(res.body.error.message).toContain("testnet");
  });
});
