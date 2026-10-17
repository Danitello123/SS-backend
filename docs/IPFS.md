# IPFS File Storage and Pinning Workflow

## Overview

The StellarSettle backend utilizes IPFS (InterPlanetary File System) to store and distribute supporting invoice documents, such as PDF invoices, bills of lading, and contracts. To ensure high availability and persistence, we pin these files to IPFS using the Pinata API.

## Pinata API Setup & Environment Variables

To interact with the Pinata API, the backend requires the following environment variables to be configured in your `.env` file:

- `IPFS_JWT`: Your Pinata JWT API key for authentication. This is required for secure access to the Pinata pinning service.
- `IPFS_API_URL`: The base URL for the Pinata API. Generally, this should be `https://api.pinata.cloud`.

**Example `.env` Configuration:**
```env
IPFS_JWT="eyJhbGciOiJIUzI1NiIsInR5cCI..."
IPFS_API_URL="https://api.pinata.cloud"
```

## Document Upload Restrictions

When uploading documents to IPFS via the backend API, several restrictions apply to ensure system stability and performance:

- **File Size Limits**: The maximum allowed file size for a single document is **10MB**. Uploads exceeding this limit will be rejected with an HTTP `413 Payload Too Large` error.
- **Upload Rate Limits**: To prevent abuse and manage API quota with Pinata, the backend enforces a rate limit on IPFS uploads. By default, users are limited to 20 uploads per minute.
- **MIME Type Validation**: Only accepted document types (e.g., `application/pdf`, `image/jpeg`, `image/png`) are processed. The backend validates the MIME type before forwarding the file to Pinata.

## CID Retrieval and Gateway Fallback

Upon successful pinning, Pinata returns a Content Identifier (CID). This CID is a cryptographic hash of the document and serves as its immutable address on the IPFS network.

### Retrieval Process

1. **Upload**: The user uploads a document to the backend API.
2. **Pinning**: The backend pins the document to Pinata and retrieves the CID.
3. **Database Storage**: The CID is stored in the off-chain database linked to the specific invoice record.
4. **Access**: Frontend applications construct an IPFS Gateway URL using the CID to retrieve and display the document.

### Gateway Fallback Resolution

Because public IPFS gateways can sometimes be slow or rate-limited, the application employs a gateway fallback strategy:
- The primary gateway is the project's dedicated Pinata gateway (if configured).
- If the primary gateway fails to resolve the CID within a reasonable timeout, the system automatically falls back to alternative public gateways (e.g., `ipfs.io`, `dweb.link`, `cloudflare-ipfs.com`).
