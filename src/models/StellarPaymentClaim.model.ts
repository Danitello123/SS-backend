import { Entity, PrimaryColumn, Column } from "typeorm";

@Entity("stellar_payment_claims")
export class StellarPaymentClaim {
  @PrimaryColumn({ name: "stellar_tx_hash", type: "varchar", length: 64 })
  stellarTxHash!: string;

  @PrimaryColumn({ name: "stellar_operation_index", type: "integer" })
  stellarOperationIndex!: number;

  @Column({ name: "investment_id", type: "uuid", nullable: true })
  investmentId!: string | null;

  @Column({ name: "transaction_id", type: "uuid", nullable: true })
  transactionId!: string | null;
}
