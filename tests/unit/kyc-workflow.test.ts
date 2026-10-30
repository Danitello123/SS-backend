import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { KycService } from "../../src/services/kyc.service";
import { createKycRouter } from "../../src/routes/kyc.routes";
import { createAdminRouter } from "../../src/routes/admin/admin.routes";
import { createInvoiceRouter } from "../../src/routes/invoice.routes";
import { createErrorMiddleware } from "../../src/middleware/error.middleware";
import { logger } from "../../src/observability/logger";
import { KYCStatus, KYCVerificationType, UserType, InvoiceStatus } from "../../src/types/enums";
import { User } from "../../src/models/User.model";
import { KYCVerification } from "../../src/models/KYCVerification.model";
import { KycHistory } from "../../src/models/KycHistory.model";

describe("KYC Document Submission & Verification Workflow (#475)", () => {
  const JWT_SECRET = "test-secret-key-475";
  const ADMIN_KEY = "test-admin-api-key";

  const SELLER_ID = "seller-uuid-1";
  const SELLER_WALLET = "GSELLER111111111111111111111111111111111111111111111111111";

  const ADMIN_ID = "admin-uuid-1";
  const ADMIN_WALLET = "GADMIN1111111111111111111111111111111111111111111111111111";

  const OTHER_SELLER_ID = "seller-uuid-2";
  const OTHER_SELLER_WALLET = "GSELLER222222222222222222222222222222222222222222222222222";

  let sellerToken: string;
  let otherSellerToken: string;
  let adminToken: string;

  let users: any[];
  let verifications: any[];
  let history: any[];
  let idCounter = 100;

  let mockDataSource: any;
  let kycService: KycService;
  let mockAuthService: any;
  let mockInvoiceService: any;
  let app: express.Application;

  function makeUser(overrides: Partial<any> = {}) {
    return {
      id: overrides.id || `user-${++idCounter}`,
      stellarAddress: overrides.stellarAddress || `GWALLET${idCounter}`,
      email: overrides.email ?? "test@example.com",
      userType: overrides.userType ?? UserType.SELLER,
      kycStatus: overrides.kycStatus ?? KYCStatus.PENDING,
      isKycVerified: overrides.isKycVerified ?? false,
      isSuspended: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  function makeVerification(overrides: Partial<any> = {}) {
    return {
      id: overrides.id || `verif-${++idCounter}`,
      userId: overrides.userId || SELLER_ID,
      wallet: overrides.wallet || SELLER_WALLET,
      verificationType: overrides.verificationType || KYCVerificationType.BUSINESS,
      status: overrides.status || KYCStatus.PENDING,
      documents: overrides.documents || null,
      verifiedAt: overrides.verifiedAt || null,
      ...overrides,
    };
  }

  function matchesCondition(record: any, cond: any): boolean {
    if (!cond) return true;
    for (const [key, val] of Object.entries(cond)) {
      if (val && typeof val === "object" && "_type" in (val as any)) {
        // TypeORM FindOperator e.g. In([...])
        const op = val as any;
        if (op._type === "in" && Array.isArray(op._value)) {
          if (!op._value.includes(record[key])) return false;
        }
      } else if (record[key] !== val) {
        return false;
      }
    }
    return true;
  }

  function buildFakeDataSource() {
    const userRepo = {
      findOne: jest.fn(async (options: any) => {
        const where = options?.where;
        if (Array.isArray(where)) {
          return users.find((u) => where.some((cond) => matchesCondition(u, cond))) || null;
        }
        return users.find((u) => matchesCondition(u, where)) || null;
      }),
      findOneBy: jest.fn(async (where: any) => {
        return users.find((u) => matchesCondition(u, where)) || null;
      }),
      update: jest.fn(async (id: string, updates: any) => {
        const user = users.find((u) => u.id === id || u.stellarAddress === id);
        if (user) {
          Object.assign(user, updates, { updatedAt: new Date() });
        }
      }),
      save: jest.fn(async (entity: any) => {
        const idx = users.findIndex((u) => u.id === entity.id);
        if (idx >= 0) {
          users[idx] = { ...users[idx], ...entity, updatedAt: new Date() };
          return users[idx];
        }
        users.push(entity);
        return entity;
      }),
    };

    const verifRepo = {
      findOne: jest.fn(async (options: any) => {
        const where = options?.where;
        let candidates: any[] = [];
        if (Array.isArray(where)) {
          candidates = verifications.filter((v) => where.some((cond) => matchesCondition(v, cond)));
        } else {
          candidates = verifications.filter((v) => matchesCondition(v, where));
        }
        if (candidates.length === 0) return null;
        return candidates[candidates.length - 1]; // Latest
      }),
      findOneBy: jest.fn(async (where: any) => {
        return verifications.find((v) => matchesCondition(v, where)) || null;
      }),
      create: jest.fn((data: any) => ({
        id: data.id || `verif-${++idCounter}`,
        ...data,
      })),
      save: jest.fn(async (entity: any) => {
        const idx = verifications.findIndex((v) => v.id === entity.id);
        if (idx >= 0) {
          verifications[idx] = { ...verifications[idx], ...entity };
          return verifications[idx];
        }
        verifications.push(entity);
        return entity;
      }),
    };

    const histRepo = {
      find: jest.fn(async (options: any) => {
        const where = options?.where;
        return history.filter((h) => matchesCondition(h, where)).reverse();
      }),
      findOne: jest.fn(async (options: any) => {
        const where = options?.where;
        let candidates: any[] = [];
        if (Array.isArray(where)) {
          candidates = history.filter((h) => where.some((cond) => matchesCondition(h, cond)));
        } else {
          candidates = history.filter((h) => matchesCondition(h, where));
        }
        if (candidates.length === 0) return null;
        return candidates[candidates.length - 1];
      }),
      create: jest.fn((data: any) => ({
        id: data.id || `hist-${++idCounter}`,
        createdAt: new Date(),
        ...data,
      })),
      save: jest.fn(async (entity: any) => {
        history.push(entity);
        return entity;
      }),
    };

    const manager = {
      getRepository: jest.fn((entityClass: any) => {
        if (entityClass === User || entityClass?.name === "User") return userRepo;
        if (entityClass === KYCVerification || entityClass?.name === "KYCVerification")
          return verifRepo;
        if (entityClass === KycHistory || entityClass?.name === "KycHistory") return histRepo;
        return {
          findOne: jest.fn(),
          findOneBy: jest.fn(),
          save: jest.fn(),
          create: jest.fn((d) => d),
        };
      }),
    };

    return {
      isInitialized: true,
      query: jest.fn().mockResolvedValue([]),
      transaction: jest.fn(async (cb: any) => cb(manager)),
      getRepository: manager.getRepository,
    };
  }

  beforeEach(() => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.ADMIN_API_KEY = ADMIN_KEY;

    users = [
      makeUser({
        id: SELLER_ID,
        stellarAddress: SELLER_WALLET,
        userType: UserType.SELLER,
        kycStatus: KYCStatus.PENDING,
        isKycVerified: false,
      }),
      makeUser({
        id: ADMIN_ID,
        stellarAddress: ADMIN_WALLET,
        userType: UserType.ADMIN,
        kycStatus: KYCStatus.APPROVED,
        isKycVerified: true,
      }),
      makeUser({
        id: OTHER_SELLER_ID,
        stellarAddress: OTHER_SELLER_WALLET,
        userType: UserType.SELLER,
        kycStatus: KYCStatus.PENDING,
        isKycVerified: false,
      }),
    ];

    verifications = [];
    history = [];

    mockDataSource = buildFakeDataSource();

    mockAuthService = {
      getCurrentUser: jest.fn(async (token: string) => {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        const user = users.find(
          (u) => u.id === decoded.sub || u.stellarAddress === decoded.stellarAddress
        );
        if (!user) throw new Error("User not found");
        return user;
      }),
    };

    sellerToken = jwt.sign(
      { sub: SELLER_ID, stellarAddress: SELLER_WALLET, userType: UserType.SELLER },
      JWT_SECRET
    );

    otherSellerToken = jwt.sign(
      { sub: OTHER_SELLER_ID, stellarAddress: OTHER_SELLER_WALLET, userType: UserType.SELLER },
      JWT_SECRET
    );

    adminToken = jwt.sign(
      { sub: ADMIN_ID, stellarAddress: ADMIN_WALLET, userType: UserType.ADMIN },
      JWT_SECRET
    );

    kycService = new KycService(mockDataSource, "webhook-secret", logger);

    mockInvoiceService = {
      createInvoice: jest.fn(async (input: any) => ({
        id: "inv-123",
        status: InvoiceStatus.DRAFT,
        ...input,
      })),
      submitInvoiceForReview: jest.fn(async ({ invoiceId, sellerId }: any) => ({
        id: invoiceId,
        sellerId,
        status: InvoiceStatus.PENDING,
      })),
      findInvoiceWithSeller: jest.fn(),
      getInvoiceById: jest.fn(),
    };

    app = express();
    app.use(express.json());

    const kycRouter = createKycRouter(kycService, mockAuthService);
    app.use("/api/v1/kyc", kycRouter);
    app.use("/kyc", kycRouter);

    const adminRouter = createAdminRouter({
      dataSource: mockDataSource,
      allowedCidrs: [],
      authService: mockAuthService,
      kycService,
      invoiceService: mockInvoiceService,
    });
    app.use("/api/v1/admin", adminRouter);
    app.use("/admin", adminRouter);

    const invoiceConfig = {
      ipfs: {
        apiUrl: "https://api.pinata.cloud",
        jwt: "jwt",
        maxFileSizeMB: 10,
        allowedMimeTypes: ["application/pdf", "image/png", "image/jpeg"],
        uploadRateLimit: { windowMs: 900000, maxUploads: 10 },
      },
      kyc: {
        skipVerification: false, // Enforce KYC verification!
      },
      admin: {
        ipWhitelist: [],
      },
    };

    const invoiceRouter = createInvoiceRouter({
      invoiceService: mockInvoiceService,
      config: invoiceConfig as any,
      authService: mockAuthService,
    });
    app.use("/api/v1/invoices", invoiceRouter);
    app.use("/invoices", invoiceRouter);

    app.use(createErrorMiddleware(logger));
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
    delete process.env.ADMIN_API_KEY;
  });

  describe("1. POST /kyc/submit", () => {
    const validCidsPayload = {
      businessName: "Acme Global Trade",
      businessRegistrationNumber: "BRN-998877",
      taxId: "TAX-12345",
      contactEmail: "compliance@acme.com",
      contactPhone: "+1234567890",
      documentCids: [
        "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
        "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
      ],
    };

    it("accepts seller details and IPFS document CIDs and sets status to pending", async () => {
      const res = await request(app)
        .post("/kyc/submit")
        .set("Authorization", `Bearer ${sellerToken}`)
        .send(validCidsPayload)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe(KYCStatus.PENDING);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.status).toBe(KYCStatus.PENDING);
      expect(res.body.data.documents.documentCids).toEqual(validCidsPayload.documentCids);
      expect(res.body.data.documents.sellerDetails.businessName).toBe("Acme Global Trade");
      expect(res.body.data.documents.sellerDetails.businessRegistrationNumber).toBe("BRN-998877");

      // Verify user kycStatus in database updated to PENDING
      const seller = users.find((u) => u.id === SELLER_ID);
      expect(seller.kycStatus).toBe(KYCStatus.PENDING);
      expect(seller.isKycVerified).toBe(false);
    });

    it("works via /api/v1/kyc/submit as well", async () => {
      const res = await request(app)
        .post("/api/v1/kyc/submit")
        .set("Authorization", `Bearer ${otherSellerToken}`)
        .send({
          businessName: "Other Corp",
          documentCids: ["QmSomeValidIpfsCid12345"],
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe(KYCStatus.PENDING);
    });

    it("rejects unauthenticated requests with 401", async () => {
      await request(app)
        .post("/kyc/submit")
        .send(validCidsPayload)
        .expect(401);
    });

    it("rejects requests missing document CIDs with 422", async () => {
      const res = await request(app)
        .post("/kyc/submit")
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({
          businessName: "No Documents LLC",
        })
        .expect(422);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
    });

    it("blocks new submission when a verification is already pending (409 Conflict)", async () => {
      verifications.push(
        makeVerification({
          userId: SELLER_ID,
          wallet: SELLER_WALLET,
          status: KYCStatus.PENDING,
        })
      );

      const res = await request(app)
        .post("/kyc/submit")
        .set("Authorization", `Bearer ${sellerToken}`)
        .send(validCidsPayload)
        .expect(409);

      expect(res.body.error.message).toContain("already pending");
    });

    it("blocks new submission when a verification is already approved (409 Conflict)", async () => {
      verifications.push(
        makeVerification({
          userId: SELLER_ID,
          wallet: SELLER_WALLET,
          status: KYCStatus.APPROVED,
        })
      );

      const res = await request(app)
        .post("/kyc/submit")
        .set("Authorization", `Bearer ${sellerToken}`)
        .send(validCidsPayload)
        .expect(409);

      expect(res.body.error.message).toContain("already approved");
    });

    it("allows re-submission on rejected status, resets status to pending and clears rejection reason", async () => {
      // Seed a rejected verification with rejection reason
      const existingVerif = makeVerification({
        id: "verif-rejected-1",
        userId: SELLER_ID,
        wallet: SELLER_WALLET,
        status: KYCStatus.REJECTED,
        documents: {
          rejectionReason: "Certificate of incorporation expired",
          documentCids: ["QmOldDoc"],
        },
      });
      verifications.push(existingVerif);

      const seller = users.find((u) => u.id === SELLER_ID);
      seller.kycStatus = KYCStatus.REJECTED;

      const newSubmissionPayload = {
        businessName: "Acme Global Trade Renewed",
        documentCids: ["QmNewFreshCertificate1234567890"],
      };

      const res = await request(app)
        .post("/kyc/submit")
        .set("Authorization", `Bearer ${sellerToken}`)
        .send(newSubmissionPayload)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe(KYCStatus.PENDING);
      expect(res.body.data.status).toBe(KYCStatus.PENDING);
      expect(res.body.data.documents.rejectionReason).toBeNull();
      expect(res.body.data.documents.documentCids).toEqual(["QmNewFreshCertificate1234567890"]);

      // Verify the user state in database was reset to pending
      expect(seller.kycStatus).toBe(KYCStatus.PENDING);
      expect(seller.isKycVerified).toBe(false);

      // Verify old rejected verification was archived to history
      expect(history.length).toBeGreaterThanOrEqual(1);
      const archived = history.find((h) => h.userId === SELLER_ID && h.status === KYCStatus.REJECTED);
      expect(archived).toBeDefined();
      expect(archived.rejectionReason).toBe("Certificate of incorporation expired");
    });
  });

  describe("2. GET /kyc/status", () => {
    it("returns 401 when request is unauthenticated", async () => {
      await request(app).get("/kyc/status").expect(401);
    });

    it("returns pending status and null rejection reason for pending verification", async () => {
      verifications.push(
        makeVerification({
          userId: SELLER_ID,
          wallet: SELLER_WALLET,
          status: KYCStatus.PENDING,
          documents: {
            documentCids: ["QmPendingDoc123"],
          },
        })
      );

      const res = await request(app)
        .get("/kyc/status")
        .set("Authorization", `Bearer ${sellerToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe(KYCStatus.PENDING);
      expect(res.body.rejectionReason).toBeNull();
      expect(res.body.data.status).toBe(KYCStatus.PENDING);
      expect(res.body.data.rejectionReason).toBeNull();
      expect(res.body.data.wallet).toBe(SELLER_WALLET);
    });

    it("returns rejected status and rejection reason when verification is rejected", async () => {
      verifications.push(
        makeVerification({
          userId: SELLER_ID,
          wallet: SELLER_WALLET,
          status: KYCStatus.REJECTED,
          documents: {
            rejectionReason: "ID blurry and expired proof of address",
            documentCids: ["QmBlurryDoc"],
          },
        })
      );
      const seller = users.find((u) => u.id === SELLER_ID);
      seller.kycStatus = KYCStatus.REJECTED;

      const res = await request(app)
        .get("/kyc/status")
        .set("Authorization", `Bearer ${sellerToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe(KYCStatus.REJECTED);
      expect(res.body.rejectionReason).toBe("ID blurry and expired proof of address");
      expect(res.body.data.status).toBe(KYCStatus.REJECTED);
      expect(res.body.data.rejectionReason).toBe("ID blurry and expired proof of address");
    });

    it("returns approved status and null rejection reason when verification is approved", async () => {
      verifications.push(
        makeVerification({
          userId: SELLER_ID,
          wallet: SELLER_WALLET,
          status: KYCStatus.APPROVED,
          verifiedAt: new Date(),
        })
      );
      const seller = users.find((u) => u.id === SELLER_ID);
      seller.kycStatus = KYCStatus.APPROVED;
      seller.isKycVerified = true;

      const res = await request(app)
        .get("/kyc/status")
        .set("Authorization", `Bearer ${sellerToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe(KYCStatus.APPROVED);
      expect(res.body.rejectionReason).toBeNull();
    });

    it("clears rejection reason after re-submission when checked via GET /kyc/status", async () => {
      // 1. Initial rejected verification
      verifications.push(
        makeVerification({
          userId: SELLER_ID,
          wallet: SELLER_WALLET,
          status: KYCStatus.REJECTED,
          documents: {
            rejectionReason: "Document illegible",
          },
        })
      );
      const seller = users.find((u) => u.id === SELLER_ID);
      seller.kycStatus = KYCStatus.REJECTED;

      // Check status is rejected
      let statusRes = await request(app)
        .get("/kyc/status")
        .set("Authorization", `Bearer ${sellerToken}`)
        .expect(200);
      expect(statusRes.body.status).toBe(KYCStatus.REJECTED);
      expect(statusRes.body.rejectionReason).toBe("Document illegible");

      // 2. Re-submit new documents
      await request(app)
        .post("/kyc/submit")
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({
          businessName: "Acme Fixed",
          documentCids: ["QmClearDocument12345"],
        })
        .expect(201);

      // 3. Status is now pending and rejection reason is cleared (null)
      statusRes = await request(app)
        .get("/kyc/status")
        .set("Authorization", `Bearer ${sellerToken}`)
        .expect(200);

      expect(statusRes.body.status).toBe(KYCStatus.PENDING);
      expect(statusRes.body.rejectionReason).toBeNull();
      expect(statusRes.body.data.rejectionReason).toBeNull();
    });
  });

  describe("3. Admin PATCH /kyc/:id/review", () => {
    let pendingVerifId: string;

    beforeEach(() => {
      const v = makeVerification({
        id: "verif-review-test-1",
        userId: SELLER_ID,
        wallet: SELLER_WALLET,
        status: KYCStatus.PENDING,
        documents: {
          documentCids: ["QmReviewDoc123"],
        },
      });
      verifications.push(v);
      pendingVerifId = v.id;
    });

    it("rejects unauthorized caller (no key or admin token) with 401 or 403", async () => {
      await request(app)
        .patch(`/kyc/${pendingVerifId}/review`)
        .send({ status: "approved" })
        .expect(401);

      // Regular seller token without admin role gets 403
      await request(app)
        .patch(`/kyc/${pendingVerifId}/review`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({ status: "approved" })
        .expect(403);
    });

    it("allows admin with x-admin-key header to approve KYC", async () => {
      const res = await request(app)
        .patch(`/kyc/${pendingVerifId}/review`)
        .set("x-admin-key", ADMIN_KEY)
        .send({ status: "approved" })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe(KYCStatus.APPROVED);
      expect(res.body.data.status).toBe(KYCStatus.APPROVED);
      expect(res.body.rejectionReason).toBeNull();

      // Verify user updated to approved
      const seller = users.find((u) => u.id === SELLER_ID);
      expect(seller.kycStatus).toBe(KYCStatus.APPROVED);
      expect(seller.isKycVerified).toBe(true);

      // Verify history recorded
      expect(history.some((h) => h.status === KYCStatus.APPROVED)).toBe(true);
    });

    it("allows admin with JWT token to approve KYC", async () => {
      const res = await request(app)
        .patch(`/kyc/${pendingVerifId}/review`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ action: "approve" })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe(KYCStatus.APPROVED);
    });

    it("allows admin to reject KYC with reason", async () => {
      const res = await request(app)
        .patch(`/kyc/${pendingVerifId}/review`)
        .set("x-admin-key", ADMIN_KEY)
        .send({
          status: "rejected",
          reason: "Tax ID does not match registered company name",
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe(KYCStatus.REJECTED);
      expect(res.body.rejectionReason).toBe("Tax ID does not match registered company name");
      expect(res.body.data.documents.rejectionReason).toBe(
        "Tax ID does not match registered company name"
      );

      // Verify user updated to rejected
      const seller = users.find((u) => u.id === SELLER_ID);
      expect(seller.kycStatus).toBe(KYCStatus.REJECTED);
      expect(seller.isKycVerified).toBe(false);

      // Verify history recorded with rejection reason
      const histEntry = history.find((h) => h.status === KYCStatus.REJECTED);
      expect(histEntry).toBeDefined();
      expect(histEntry.rejectionReason).toBe("Tax ID does not match registered company name");
    });

    it("rejects with 400 when rejection reason is missing on reject", async () => {
      const res = await request(app)
        .patch(`/kyc/${pendingVerifId}/review`)
        .set("x-admin-key", ADMIN_KEY)
        .send({
          status: "rejected",
          // reason missing!
        })
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it("rejects with 400 when status is neither approved nor rejected", async () => {
      const res = await request(app)
        .patch(`/kyc/${pendingVerifId}/review`)
        .set("x-admin-key", ADMIN_KEY)
        .send({
          status: "pending_again",
        })
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it("works via admin router mount /api/v1/admin/kyc/:id/review", async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/kyc/${pendingVerifId}/review`)
        .set("x-admin-key", ADMIN_KEY)
        .send({
          status: "approved",
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe(KYCStatus.APPROVED);
    });
  });

  describe("4. Invoice Submission KYC Gating", () => {
    const validInvoicePayload = {
      title: "Supplier Inventory Batch #9900",
      description: "Inventory batch",
      faceValue: 50000,
      fundingTarget: 47500,
      yieldBps: 500,
      fundingDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      ipfsDocumentUrl: "ipfs://QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
    };

    it("blocks invoice submission with 403 when seller KYC is pending", async () => {
      const seller = users.find((u) => u.id === SELLER_ID);
      seller.kycStatus = KYCStatus.PENDING;
      seller.isKycVerified = false;

      const res = await request(app)
        .post("/invoices")
        .set("Authorization", `Bearer ${sellerToken}`)
        .send(validInvoicePayload)
        .expect(403);

      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe("KYC_APPROVAL_REQUIRED");
      expect(mockInvoiceService.createInvoice).not.toHaveBeenCalled();
    });

    it("blocks invoice submission with 403 when seller KYC is rejected", async () => {
      const seller = users.find((u) => u.id === SELLER_ID);
      seller.kycStatus = KYCStatus.REJECTED;
      seller.isKycVerified = false;

      const res = await request(app)
        .post("/invoices")
        .set("Authorization", `Bearer ${sellerToken}`)
        .send(validInvoicePayload)
        .expect(403);

      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe("KYC_APPROVAL_REQUIRED");
    });

    it("permits invoice submission when seller KYC is approved", async () => {
      const seller = users.find((u) => u.id === SELLER_ID);
      seller.kycStatus = KYCStatus.APPROVED;
      seller.isKycVerified = true;

      const approvedToken = jwt.sign(
        {
          sub: SELLER_ID,
          stellarAddress: SELLER_WALLET,
          userType: UserType.SELLER,
          kycStatus: KYCStatus.APPROVED,
          isKycVerified: true,
        },
        JWT_SECRET
      );

      const res = await request(app)
        .post("/invoices")
        .set("Authorization", `Bearer ${approvedToken}`)
        .send(validInvoicePayload)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(mockInvoiceService.createInvoice).toHaveBeenCalled();
      expect(mockInvoiceService.submitInvoiceForReview).toHaveBeenCalled();
    });
  });
});
