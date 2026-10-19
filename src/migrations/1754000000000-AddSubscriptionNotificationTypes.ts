import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds the subscription lifecycle notification types to the PostgreSQL enum.
 */
export class AddSubscriptionNotificationTypes1754000000000 implements MigrationInterface {
  name = "AddSubscriptionNotificationTypes1754000000000";

  /** Postgres rejects ALTER TYPE ... ADD VALUE inside a transaction (SQLSTATE 25001). */
  transaction = false as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const value of ["subscription", "subscription_expiring"]) {
      await queryRunner.query(
        `ALTER TYPE "public"."notifications_notificationtype_enum" ADD VALUE IF NOT EXISTS '${value}';`
      );
    }
  }

  public async down(): Promise<void> {
    // Postgres cannot drop enum values; rows may already use them.
  }
}
