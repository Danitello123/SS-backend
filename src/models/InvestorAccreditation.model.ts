import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

export enum AccreditationTier {
  UNACCREDITED = "unaccredited",
  ACCREDITED = "accredited",
  QUALIFIED = "qualified",
}

export const ACCREDITATION_LIMITS: Record<AccreditationTier, number> = {
  [AccreditationTier.UNACCREDITED]: 100_000,
  [AccreditationTier.ACCREDITED]: 1_000_000,
  [AccreditationTier.QUALIFIED]: 10_000_000,
};

@Entity("investor_accreditations")
@Index("idx_investor_accreditation_wallet", ["walletAddress"], { unique: true })
export class InvestorAccreditation {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 256, unique: true })
  walletAddress!: string;

  @Column({
    type: "enum",
    enum: AccreditationTier,
    default: AccreditationTier.UNACCREDITED,
  })
  tier!: AccreditationTier;

  @Column({ type: "timestamp", nullable: true })
  verificationDate!: Date | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  verificationSource!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
