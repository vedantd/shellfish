import type Database from "better-sqlite3";
import type { NetworkMode } from "@shellfish/schemas";
import { assertSupportedSqliteRuntime, RegistryError } from "./registry.js";

export interface SignerLaneInput {
  operationId: string;
  mode: NetworkMode;
  network: string;
  accounts: string[];
}
export interface SignerLaneGuard {
  acquired: true;
  operationId: string;
  lanes: { key: string; fence: number }[];
}
export type SignerLaneClaim = SignerLaneGuard | {
  acquired: false;
  blockedAccount: string;
};
interface OperationRow {
  mode: NetworkMode;
  network: string;
  accounts_json: string;
}
interface LaneRow {
  lane_key: string;
  operation_id: string;
  fence: number;
  active: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS credit_signer_operations (
  operation_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  network TEXT NOT NULL,
  accounts_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS credit_signer_lanes (
  lane_key TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  network TEXT NOT NULL,
  account TEXT NOT NULL,
  operation_id TEXT NOT NULL REFERENCES credit_signer_operations(operation_id),
  fence INTEGER NOT NULL,
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  UNIQUE(mode,network,account)
);
`;

function identity(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}
function laneKey(mode: NetworkMode, network: string, account: string): string {
  // JSON tuples avoid delimiter ambiguity. Account spelling remains case-sensitive.
  return JSON.stringify([mode, network, account]);
}

/**
 * Serialize all operations using the same signer sequence account. No clock, TTL,
 * takeover, signature or submission lives here. The caller holds a separate worker
 * fence, retains these lanes for unresolved signed attempts, and releases only after
 * its trusted adapter establishes a conclusive outcome.
 */
export function createSignerLaneStore(db: Database.Database) {
  assertSupportedSqliteRuntime();
  db.exec(SCHEMA);

  function operation(operationId: string): OperationRow | undefined {
    return db.prepare("SELECT mode,network,accounts_json FROM credit_signer_operations WHERE operation_id=?")
      .get(operationId) as OperationRow | undefined;
  }
  function lane(key: string): LaneRow | undefined {
    return db.prepare("SELECT lane_key,operation_id,fence,active FROM credit_signer_lanes WHERE lane_key=?")
      .get(key) as LaneRow | undefined;
  }
  function input(raw: SignerLaneInput): SignerLaneInput {
    if (!raw || !identity(raw.operationId) || !identity(raw.network) ||
        (raw.mode !== "LIVE_DEVNET" && raw.mode !== "SIMULATED_LOAN") ||
        !Array.isArray(raw.accounts) || !raw.accounts.length || !raw.accounts.every(identity))
      throw new RegistryError("INVALID_SIGNER_LANE_INPUT");
    return { operationId: raw.operationId, mode: raw.mode, network: raw.network,
      accounts: [...new Set(raw.accounts)].sort() };
  }

  function claim(raw: SignerLaneInput): SignerLaneClaim {
    const request = input(raw);
    const accountsJson = JSON.stringify(request.accounts);
    return db.transaction((): SignerLaneClaim => {
      const prior = operation(request.operationId);
      if (prior && (prior.mode !== request.mode || prior.network !== request.network || prior.accounts_json !== accountsJson))
        throw new RegistryError("SIGNER_OPERATION_BINDING_MISMATCH");

      const rows = request.accounts.map(account => ({ account,
        key: laneKey(request.mode, request.network, account) }));
      // Inspect every account before writing anything, so a refusal retains no subset.
      for (const row of rows) {
        const existing = lane(row.key);
        if (existing?.active === 1 && existing.operation_id !== request.operationId)
          return { acquired: false, blockedAccount: row.account };
      }
      if (!prior) db.prepare("INSERT INTO credit_signer_operations(operation_id,mode,network,accounts_json) VALUES(?,?,?,?)")
        .run(request.operationId, request.mode, request.network, accountsJson);

      const claimed = rows.map(row => {
        const existing = lane(row.key);
        if (existing?.active === 1) {
          if (!Number.isSafeInteger(existing.fence) || existing.fence < 1)
            throw new RegistryError("SIGNER_FENCE_EXHAUSTED");
          return { key: row.key, fence: existing.fence };
        }
        const fence = existing ? existing.fence + 1 : 1;
        if (!Number.isSafeInteger(fence) || fence < 1)
          throw new RegistryError("SIGNER_FENCE_EXHAUSTED");
        db.prepare(`INSERT INTO credit_signer_lanes(lane_key,mode,network,account,operation_id,fence,active)
          VALUES(?,?,?,?,?,?,1) ON CONFLICT(lane_key) DO UPDATE SET
          operation_id=excluded.operation_id,fence=excluded.fence,active=1`)
          .run(row.key, request.mode, request.network, row.account, request.operationId, fence);
        return { key: row.key, fence };
      });
      return { acquired: true, operationId: request.operationId, lanes: claimed };
    }).immediate();
  }

  function guardRows(guard: SignerLaneGuard): LaneRow[] {
    if (!guard || guard.acquired !== true || !identity(guard.operationId) || !Array.isArray(guard.lanes) ||
        !guard.lanes.length || guard.lanes.some(row => !row || typeof row.key !== "string" ||
          !Number.isSafeInteger(row.fence) || row.fence < 1))
      throw new RegistryError("INVALID_SIGNER_LANE_GUARD");
    const owner = operation(guard.operationId);
    if (!owner) throw new RegistryError("STALE_SIGNER_LANE_GUARD");
    const accounts = JSON.parse(owner.accounts_json) as string[];
    const expected = accounts.map(account => laneKey(owner.mode, owner.network, account));
    if (expected.length !== guard.lanes.length || expected.some((key, i) => guard.lanes[i].key !== key))
      throw new RegistryError("INVALID_SIGNER_LANE_GUARD");
    const rows = guard.lanes.map(row => lane(row.key));
    if (rows.some((row, i) => !row || row.active !== 1 || row.operation_id !== guard.operationId || row.fence !== guard.lanes[i].fence))
      throw new RegistryError("STALE_SIGNER_LANE_GUARD");
    return rows as LaneRow[];
  }

  function assertClaim(guard: SignerLaneGuard): void {
    db.transaction(() => { guardRows(guard); })();
  }

  function release(guard: SignerLaneGuard): boolean {
    return db.transaction(() => {
      let rows: LaneRow[];
      try { rows = guardRows(guard); }
      catch (error) {
        if (error instanceof RegistryError && error.code === "STALE_SIGNER_LANE_GUARD") return false;
        throw error;
      }
      for (const row of rows) db.prepare("UPDATE credit_signer_lanes SET active=0 WHERE lane_key=? AND operation_id=? AND fence=? AND active=1")
        .run(row.lane_key, guard.operationId, row.fence);
      return true;
    }).immediate();
  }

  return { claim, assertClaim, release };
}

export type SignerLaneStore = ReturnType<typeof createSignerLaneStore>;
