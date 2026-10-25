import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { assertSupportedSqliteRuntime, createRegistry, createExecutionStore, createReturnStore, type ReturnStoreOptions, type RegistryOptions, type CreditRegistry, contentHash } from "@shellfish/registry";
import type { NetworkMode } from "@shellfish/schemas";
import { createUiStateStore } from "./ui-state.js";
import { createRequestView } from "./request-view.js";
/** Explicit app bootstrap. Caller owns close and passes the chosen clock and verifier. */
export function openCreditRegistry(path: string, options: RegistryOptions & ReturnStoreOptions & { uiMode?: NetworkMode; uiNetwork?: string } = {}): {
    db: Database.Database;
    registry: CreditRegistry;
    execution: ReturnType<typeof createExecutionStore>;
    returns: ReturnType<typeof createReturnStore>;
    uiState: ReturnType<typeof createUiStateStore>;
    requestViews: ReturnType<typeof createRequestView>;
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
        const uiState = createUiStateStore(db, { hash: contentHash, now: options.now, mode: options.uiMode, network: options.uiNetwork });
        const requestViews = createRequestView(db, registry, uiState);
        return { db, registry, execution, returns, uiState, requestViews, close: () => db.close() };
    }
    catch (error) {
        db.close();
        throw error;
    }
}
