import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { assertSupportedSqliteRuntime, createRegistry, createExecutionStore, createReturnStore, type ReturnStoreOptions, type RegistryOptions, type CreditRegistry } from "@shellfish/registry";
/** Explicit app bootstrap. Caller owns close and passes the chosen clock and verifier. */
export function openCreditRegistry(path: string, options: RegistryOptions & ReturnStoreOptions = {}): {
    db: Database.Database;
    registry: CreditRegistry;
    execution: ReturnType<typeof createExecutionStore>;
    returns: ReturnType<typeof createReturnStore>;
    close: () => void;
} {
    assertSupportedSqliteRuntime();
    if (path !== ":memory:")
        mkdirSync(dirname(resolve(path)), { recursive: true });
    const db = new Database(path);
    db.pragma("journal_mode = WAL");
    try {
        const registry = createRegistry(db, options);
        const execution = createExecutionStore(db, { now: options.now });
        const returns = createReturnStore(db, { verifyReturnFailure: options.verifyReturnFailure });
        return { db, registry, execution, returns, close: () => db.close() };
    }
    catch (error) {
        db.close();
        throw error;
    }
}
