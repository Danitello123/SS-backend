# Local Soroban Contract Testnet Deployment & Backend Integration

This guide provides step-by-step instructions for developers to set up local Soroban tools, deploy contracts from `SS-contracts` to the Stellar testnet, update the backend environment variables, and run end-to-end local tests.

## 1. Prerequisites & Toolchain Setup

Before starting, ensure you have the Rust toolchain and the Soroban CLI installed.

### Install Rust
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown
```

### Install Soroban CLI
```bash
cargo install --locked soroban-cli
```

### Generate a Testnet Keypair
You will need a testnet account funded by Friendbot to deploy contracts.
```bash
# Generate keys and fund via friendbot
soroban config identity generate alice
soroban config network add --global testnet \
  --rpc-url https://soroban-testnet.stellar.org:443 \
  --network-passphrase "Test SDF Network ; September 2015"

# Fund the account
curl "https://friendbot.stellar.org/?addr=$(soroban config identity address alice)"
```

## 2. Deploying Contracts

1. Clone the `SS-contracts` repository alongside the backend.
```bash
git clone https://github.com/StellarState/SS-contracts.git ../SS-contracts
cd ../SS-contracts
```

2. Compile and run the deployment script.
```bash
# Build the contracts
make build

# Run the deployment script to Testnet
./scripts/deploy.sh --network testnet --source alice
```

3. Extract the deployed contract IDs from the terminal output. You should see something like:
```text
Deployed Escrow Contract: C...ABC
Deployed Token Contract: C...XYZ
Deployed Payment Distributor: C...123
```

## 3. Backend Environment Configuration

Return to the `SS-backend` directory and update your `.env` file with the newly deployed contract IDs.

```env
# Soroban Contract IDs
ESCROW_CONTRACT_ID="C...ABC"
TOKEN_CONTRACT_ID="C...XYZ"
PAYMENT_DISTRIBUTOR_CONTRACT_ID="C...123"

# Stellar Network Config
STELLAR_NETWORK="testnet"
STELLAR_RPC_URL="https://soroban-testnet.stellar.org:443"
```

## 4. End-to-End Local Testing Workflow

To verify the full integration, step through the following API flow locally using Postman or `curl`.

1. **Publish Invoice**: Create a new invoice and trigger the escrow initialization.
   - `POST /api/v1/invoices`
2. **Invest**: Simulate an investor funding the invoice.
   - `POST /api/v1/investments` -> This calls the `invoice-escrow` contract.
3. **Payment**: Distribute the funds upon maturity.
   - `POST /api/v1/payments/distribute` -> This invokes the `payment-distributor` contract.

## Troubleshooting Common Errors

- **`HostFunctionError`**: This often occurs if the transaction payload doesn't match the contract's expected arguments. Double-check your XDR encoding and parameter types.
- **`TxExpired`**: The transaction took too long to be submitted to the network. Increase the timeout limits or ensure your local internet connection is stable.
- **`SequenceNumberTooLow`**: Another transaction was submitted with the same sequence number. Fetch the latest sequence number for your account before submitting.
