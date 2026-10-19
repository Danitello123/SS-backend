import { AddInvoiceRejection1732000000000 } from "../../src/migrations/1732000000000-AddInvoiceRejection";
import { AddInvoiceFailedStatus1732700000000 } from "../../src/migrations/1732700000000-AddInvoiceFailedStatus";
import { AddInvoiceLifecycleNotificationTypes1732500000000 } from "../../src/migrations/1732500000000-AddInvoiceLifecycleNotificationTypes";
import { AddNotificationDispatchDedupe1732900000000 } from "../../src/migrations/1732900000000-AddNotificationDispatchDedupe";
import { AddSubscriptionNotificationTypes1754000000000 } from "../../src/migrations/1754000000000-AddSubscriptionNotificationTypes";
import { AddUserAdminManagement1732800000000 } from "../../src/migrations/1732800000000-AddUserAdminManagement";

import dataSource from "../../src/config/database";

/**
 * Postgres rejects `ALTER TYPE ... ADD VALUE` with SQLSTATE 25001 when the
 * statement runs inside a transaction block. TypeORM wraps migrations in a
 * transaction unless the migration opts out, so every migration that adds an
 * enum member must declare `transaction = false`.
 */
const ENUM_MIGRATIONS = [
  new AddInvoiceRejection1732000000000(),
  new AddInvoiceLifecycleNotificationTypes1732500000000(),
  new AddInvoiceFailedStatus1732700000000(),
  new AddUserAdminManagement1732800000000(),
  new AddNotificationDispatchDedupe1732900000000(),
  new AddSubscriptionNotificationTypes1754000000000(),
];

function createQueryRunner() {
  const query = jest.fn(async (_sql: string) => []);
  return { query };
}

describe("enum migrations run outside a transaction (#632)", () => {
  it.each(
    ENUM_MIGRATIONS.map((migration) => [migration.name ?? migration.constructor.name, migration])
  )("%s opts out of the managed transaction", (_name, migration) => {
    expect(migration.transaction).toBe(false);
  });

  it("adds the rejected status without a surrounding transaction", async () => {
    const runner = createQueryRunner();
    const migration = new AddInvoiceRejection1732000000000();

    await migration.up(runner as never);

    const statements = runner.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.join("\n")).toContain(
      `ALTER TYPE "public"."invoices_invoicestatus_enum" ADD VALUE IF NOT EXISTS 'rejected'`
    );
    expect(statements.join("\n")).toContain('ADD COLUMN IF NOT EXISTS "rejection_reason"');
  });

  it("is safe to re-run because every statement is guarded", async () => {
    const runner = createQueryRunner();
    await new AddInvoiceRejection1732000000000().up(runner as never);
    await new AddInvoiceRejection1732000000000().up(runner as never);

    for (const [sql] of runner.query.mock.calls) {
      expect(String(sql)).toMatch(/IF NOT EXISTS/);
    }
  });

  it("reverts only the additive column", async () => {
    const runner = createQueryRunner();
    await new AddInvoiceRejection1732000000000().down(runner as never);

    const statements = runner.query.mock.calls.map(([sql]) => String(sql)).join("\n");
    expect(statements).toContain('DROP COLUMN IF EXISTS "rejection_reason"');
    expect(statements).not.toContain("ALTER TYPE");
  });
});

describe("data source migration transaction mode (#632)", () => {
  it("honours per-migration transaction overrides", () => {
    expect(dataSource.options.migrationsTransactionMode).toBe("each");
  });
});
