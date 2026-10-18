import { DataSource } from "typeorm";
import { SecondaryMarketService } from "../src/services/secondary-market.service";
import { Invoice } from "../src/models/Invoice.model";
import { Investment } from "../src/models/Investment.model";
import { SecondaryListing } from "../src/models/SecondaryListing.model";
import { InvestmentStatus, InvoiceStatus, ListingStatus } from "../src/types/enums";

describe("SecondaryMarketService", () => {
  const invoice = { id: "invoice-1", status: InvoiceStatus.FUNDED } as Invoice;
  const investments = [
    { investmentAmount: "100.0000", status: InvestmentStatus.CONFIRMED } as Investment,
  ];
  const existingListing = {
    quantity: "60.0000",
    status: ListingStatus.ACTIVE,
  } as SecondaryListing;
  let manager: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let service: SecondaryMarketService;

  beforeEach(() => {
    manager = {
      findOne: jest.fn().mockResolvedValue(invoice),
      find: jest.fn((entity: typeof Investment | typeof SecondaryListing) =>
        Promise.resolve(entity === Investment ? investments : [existingListing])
      ),
      create: jest.fn((_entity, values) => values),
      save: jest.fn((listing) => Promise.resolve({ id: "listing-new", ...listing })),
    };
    const dataSource = {
      transaction: jest.fn((callback) => callback(manager)),
    } as unknown as DataSource;
    service = new SecondaryMarketService(dataSource);
  });

  const listingInput = {
    invoiceId: "invoice-1",
    sellerWallet: "seller-wallet",
    quantity: "50",
    pricePerFraction: "2",
    expiresAt: new Date(Date.now() + 60_000),
  };

  it("rejects a listing that overlaps the seller's existing active listings", async () => {
    await expect(service.createListing(listingInput)).rejects.toMatchObject({
      code: "INSUFFICIENT_HOLDINGS",
      statusCode: 400,
    });

    expect(manager.find).toHaveBeenCalledWith(
      Investment,
      expect.objectContaining({
        lock: { mode: "pessimistic_write" },
      })
    );
    expect(manager.find).toHaveBeenCalledWith(
      SecondaryListing,
      expect.objectContaining({
        where: expect.objectContaining({
          invoiceId: listingInput.invoiceId,
          sellerWallet: listingInput.sellerWallet,
          status: ListingStatus.ACTIVE,
        }),
      })
    );
    expect(manager.save).not.toHaveBeenCalled();
  });

  it("allows listing exactly the remaining unlisted holdings", async () => {
    const result = await service.createListing({ ...listingInput, quantity: "40" });

    expect(result.quantity).toBe("40.0000");
    expect(manager.save).toHaveBeenCalledTimes(1);
  });

  it("rejects creating listings for settled invoices", async () => {
    manager.findOne.mockResolvedValue({ ...invoice, status: InvoiceStatus.SETTLED });

    await expect(service.createListing(listingInput)).rejects.toMatchObject({
      code: "INVALID_INVOICE_STATUS",
      statusCode: 400,
    });
    expect(manager.save).not.toHaveBeenCalled();
  });
});

describe("SecondaryMarketService.buyListing", () => {
  const invoice = { id: "invoice-1", status: InvoiceStatus.FUNDED } as Invoice;
  let listing: SecondaryListing;
  let sellerInvestment: Investment;
  let manager: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let service: SecondaryMarketService;

  beforeEach(() => {
    listing = {
      id: "listing-1",
      invoiceId: "invoice-1",
      sellerWallet: "seller-wallet",
      quantity: "60.0000",
      pricePerFraction: "2.0000",
      totalPrice: "120.0000",
      status: ListingStatus.ACTIVE,
      expiresAt: new Date(Date.now() + 60_000),
      isExpired: () => false,
    } as SecondaryListing;
    sellerInvestment = {
      id: "investment-seller",
      invoiceId: "invoice-1",
      investorId: "seller-id",
      investorWallet: "seller-wallet",
      investmentAmount: "100.0000",
      expectedReturn: "120.0000",
      status: InvestmentStatus.CONFIRMED,
    } as Investment;
    manager = {
      findOne: jest.fn((entity: typeof SecondaryListing | typeof Invoice) =>
        Promise.resolve(entity === SecondaryListing ? listing : invoice)
      ),
      find: jest.fn().mockResolvedValue([sellerInvestment]),
      create: jest.fn((_entity, values) => values),
      save: jest.fn(async (entity) => entity),
    };
    const dataSource = {
      transaction: jest.fn((callback) => callback(manager)),
    } as unknown as DataSource;
    service = new SecondaryMarketService(dataSource);
  });

  it("transfers partial holdings and proportional expected return to the buyer", async () => {
    const result = await service.buyListing({
      listingId: "listing-1",
      buyerWallet: "buyer-wallet",
      buyerId: "buyer-id",
      quantity: "25",
    });

    expect(sellerInvestment).toMatchObject({
      investmentAmount: "75.0000",
      expectedReturn: "90.0000",
      status: InvestmentStatus.CONFIRMED,
    });
    expect(manager.create).toHaveBeenCalledWith(
      Investment,
      expect.objectContaining({
        invoiceId: "invoice-1",
        investorId: "buyer-id",
        investorWallet: "buyer-wallet",
        investmentAmount: "25.0000",
        expectedReturn: "30.0000",
        status: InvestmentStatus.CONFIRMED,
        transactionHash: null,
      })
    );
    expect(listing).toMatchObject({
      quantity: "35.0000",
      totalPrice: "70.0000",
      status: ListingStatus.ACTIVE,
    });
    expect(result).toEqual({
      listingId: "listing-1",
      buyerWallet: "buyer-wallet",
      quantity: "25.0000",
      totalPrice: "50.0000",
    });
    expect(result).not.toHaveProperty("transactionHash");
  });

  it("marks a fully transferred seller investment and listing as complete", async () => {
    listing.quantity = "100.0000";

    await service.buyListing({
      listingId: "listing-1",
      buyerWallet: "buyer-wallet",
      buyerId: "buyer-id",
    });

    expect(sellerInvestment).toMatchObject({
      investmentAmount: "0.0000",
      expectedReturn: "0.0000",
      status: InvestmentStatus.CANCELLED,
    });
    expect(listing.status).toBe(ListingStatus.SOLD);
    expect(listing.quantity).toBe("100.0000");
  });

  it("rejects purchases after the invoice is settled", async () => {
    manager.findOne.mockImplementation((entity: typeof SecondaryListing | typeof Invoice) =>
      Promise.resolve(
        entity === SecondaryListing
          ? listing
          : { ...invoice, status: InvoiceStatus.SETTLED }
      )
    );

    await expect(
      service.buyListing({
        listingId: "listing-1",
        buyerWallet: "buyer-wallet",
        buyerId: "buyer-id",
      })
    ).rejects.toMatchObject({
      code: "INVALID_INVOICE_STATUS",
      statusCode: 400,
    });

    expect(manager.save).not.toHaveBeenCalled();
  });
});
