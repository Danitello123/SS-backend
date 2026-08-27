import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

@Entity("soroban_indexer_checkpoints")
export class SorobanIndexerCheckpoint {
  @PrimaryColumn({ name: "indexer_id", type: "varchar", length: 512 })
  indexerId!: string;

  @Column({ name: "ledger_sequence", type: "bigint" })
  ledgerSequence!: string;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
