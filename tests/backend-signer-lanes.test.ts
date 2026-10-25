import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { createSignerLaneStore, type SignerLaneClaim, type SignerLaneGuard, type SignerLaneInput } from "../packages/registry/src/signer-lanes.ts";

const require = createRequire(new URL("../services/api/package.json", import.meta.url));
const Database = require("better-sqlite3");
const connections: InstanceType<typeof Database>[] = [];
const folders: string[] = [];
afterEach(() => {
  for (const db of connections.splice(0)) if (db.open) db.close();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});
function connection(path = ":memory:") {
  const db = new Database(path); connections.push(db);
  db.pragma("foreign_keys = ON"); db.pragma("busy_timeout = 5000");
  return { db, lanes: createSignerLaneStore(db) };
}
function file() {
  const folder = mkdtempSync(resolve(tmpdir(), "shellfish-signer-lanes-"));
  folders.push(folder); return resolve(folder, "lanes.db");
}
function request(operationId: string, accounts = ["rBorrower", "rBroker"]): SignerLaneInput {
  return { operationId, mode: "LIVE_DEVNET", network: "devnet", accounts };
}
function acquired(claim: ReturnType<ReturnType<typeof createSignerLaneStore>["claim"]>): SignerLaneGuard {
  expect(claim.acquired).toBe(true);
  if (!claim.acquired) throw new Error("Expected acquired lanes");
  return claim;
}

describe("durable cross-operation signer account lanes", () => {
  it("sorts and deduplicates all signer accounts in one claim", () => {
    const { lanes } = connection();
    const guard = acquired(lanes.claim(request("origin:A", ["rBorrower", "rBroker", "rBorrower"])));
    expect(guard.lanes).toHaveLength(2);
    expect(guard.lanes.map(l => JSON.parse(l.key)[2])).toEqual(["rBorrower", "rBroker"]);
    lanes.assertClaim(guard);
  });

  it("retains the same operation fences across connections and reopen recovery", () => {
    const path = file(), a = connection(path), first = acquired(a.lanes.claim(request("origin:A")));
    const b = connection(path);
    expect(b.lanes.claim(request("origin:A", ["rBroker", "rBorrower"]))).toEqual(first);
    a.db.close(); b.db.close();
    const reopened = connection(path);
    expect(reopened.lanes.claim(request("origin:A"))).toEqual(first);
    reopened.lanes.assertClaim(first);
    expect(reopened.lanes.claim(request("repay:B", ["rBorrower"]))).toEqual({ acquired: false, blockedAccount: "rBorrower" });
  });

  it("a blocked multi-account claim creates no partial lane or operation", () => {
    const { db, lanes } = connection();
    acquired(lanes.claim(request("origin:A", ["rBroker"])));
    expect(lanes.claim(request("origin:B", ["rBorrower", "rBroker"]))).toEqual({ acquired: false, blockedAccount: "rBroker" });
    expect(db.prepare("SELECT count(*) AS n FROM credit_signer_operations WHERE operation_id='origin:B'").get().n).toBe(0);
    acquired(lanes.claim(request("repay:C", ["rBorrower"])));
  });

  it("release is fenced and stale cleanup cannot clear the next operation", () => {
    const { lanes } = connection();
    const first = acquired(lanes.claim(request("origin:A")));
    expect(lanes.release(first)).toBe(true);
    expect(lanes.release(first)).toBe(false);
    const next = acquired(lanes.claim(request("repay:B")));
    expect(next.lanes.map(l => l.fence)).toEqual([2, 2]);
    expect(lanes.release(first)).toBe(false);
    expect(() => lanes.assertClaim(first)).toThrow("STALE_SIGNER_LANE_GUARD");
    lanes.assertClaim(next);
  });

  it("a stable operation cannot change its account set, mode or network", () => {
    const { lanes } = connection(); acquired(lanes.claim(request("origin:A")));
    for (const changed of [request("origin:A", ["rBorrower"]), { ...request("origin:A"), network: "testnet" },
      { ...request("origin:A"), mode: "SIMULATED_LOAN" as const }])
      expect(() => lanes.claim(changed)).toThrow("SIGNER_OPERATION_BINDING_MISMATCH");
  });

  it("same-operation reuse after conclusive release cannot make an old guard valid again", () => {
    const { lanes } = connection();
    const first = acquired(lanes.claim(request("origin:A")));
    expect(lanes.release(first)).toBe(true);
    const next = acquired(lanes.claim(request("origin:A")));
    expect(next.lanes.map(l => l.fence)).toEqual([2, 2]);
    expect(lanes.release(first)).toBe(false);
    lanes.assertClaim(next);
  });

  it("a fence overflow rolls back every account and the new operation binding", () => {
    const { db, lanes } = connection();
    const first = acquired(lanes.claim(request("origin:A", ["rA", "rB"])));
    lanes.release(first);
    db.prepare("UPDATE credit_signer_lanes SET fence=? WHERE account='rB'").run(Number.MAX_SAFE_INTEGER);
    expect(() => lanes.claim(request("origin:B", ["rA", "rB"]))).toThrow("SIGNER_FENCE_EXHAUSTED");
    expect(db.prepare("SELECT fence,active,operation_id FROM credit_signer_lanes WHERE account='rA'").get()).toEqual({ fence: 1, active: 0, operation_id: "origin:A" });
    expect(db.prepare("SELECT count(*) AS n FROM credit_signer_operations WHERE operation_id='origin:B'").get().n).toBe(0);
  });

  it("mode, network and case-sensitive account identity separate lanes", () => {
    const { lanes } = connection(); acquired(lanes.claim(request("native:A", ["rAccount"])));
    acquired(lanes.claim({ ...request("sim:B", ["rAccount"]), mode: "SIMULATED_LOAN" }));
    acquired(lanes.claim({ ...request("native:C", ["rAccount"]), network: "testnet" }));
    acquired(lanes.claim(request("native:D", ["raccount"])));
  });

  it("rejects subset, duplicate, reordered and forged guards without unlocking any lane", () => {
    const { lanes } = connection(); const good = acquired(lanes.claim(request("origin:A")));
    for (const bad of [ { ...good, lanes: good.lanes.slice(0, 1) }, { ...good, lanes: [good.lanes[0], good.lanes[0]] },
      { ...good, lanes: [...good.lanes].reverse() }, { ...good, lanes: good.lanes.map(l => ({ ...l, fence: 0 })) } ])
      expect(() => lanes.release(bad)).toThrow("INVALID_SIGNER_LANE_GUARD");
    expect(lanes.release({ ...good, lanes: good.lanes.map(l => ({ ...l, fence: l.fence + 1 })) })).toBe(false);
    lanes.assertClaim(good);
  });

  it("rejects empty or malformed input before acquiring a lane", () => {
    const { db, lanes } = connection();
    for (const raw of [ { ...request("A"), operationId: "" }, request("A", []), request("A", [" "]),
      { ...request("A"), network: " devnet" }, { ...request("A"), mode: "MAINNET" } ])
      expect(() => lanes.claim(raw as SignerLaneInput)).toThrow("INVALID_SIGNER_LANE_INPUT");
    expect(db.prepare("SELECT count(*) AS n FROM credit_signer_lanes").get().n).toBe(0);
  });

  it("two simultaneous process connections have exactly one owner and no partial loser", async () => {
    const path = file(), main = connection(path); main.db.pragma("journal_mode=WAL");
    const barrier = new SharedArrayBuffer(4), signal = new Int32Array(barrier);
    const root = resolve(import.meta.dirname, "..");
    const code = `
      const {parentPort,workerData}=require('node:worker_threads');
      const {pathToFileURL}=require('node:url');
      const {resolve}=require('node:path');
      (async()=>{
        const {loadSourceRuntime}=await import(pathToFileURL(resolve(workerData.root,'fixtures/consumer-acceptance/source-runtime.mjs')).href);
        const runtime=await loadSourceRuntime(workerData.root);
        const {createSignerLaneStore}=await import(pathToFileURL(resolve(workerData.root,'packages/registry/src/signer-lanes.ts')).href);
        const db=new runtime.Database(workerData.path);db.pragma('busy_timeout=5000');
        const lanes=createSignerLaneStore(db);const signal=new Int32Array(workerData.barrier);
        parentPort.postMessage({type:'ready'});Atomics.wait(signal,0,0);
        const claim=lanes.claim({operationId:workerData.id,mode:'LIVE_DEVNET',network:'devnet',accounts:workerData.accounts});
        parentPort.postMessage({type:'result',claim});db.close();
      })().catch(e=>{parentPort.postMessage({type:'error',message:e.message});process.exitCode=1;});
    `;
    const workers = [
      new Worker(code, { eval: true, execArgv: [], workerData: { root, path, barrier, id: "origin:race", accounts: ["rShared", "rOrigin"] } }),
      new Worker(code, { eval: true, execArgv: [], workerData: { root, path, barrier, id: "repay:race", accounts: ["rShared", "rRepay"] } }),
    ];
    let ready = 0;
    let results: SignerLaneClaim[];
    try {
      results = await Promise.all(workers.map(worker => new Promise<SignerLaneClaim>((res, rej) => {
        worker.on("error", rej); worker.on("message", message => {
          if (message.type === "ready" && ++ready === 2) { Atomics.store(signal, 0, 1); Atomics.notify(signal, 0, 2); }
          if (message.type === "result") res(message.claim);
          if (message.type === "error") rej(new Error(message.message));
        });
      })));
    } finally { await Promise.all(workers.map(worker => worker.terminate())); }
    expect(results.filter(r => r.acquired)).toHaveLength(1);
    expect(main.db.prepare("SELECT count(*) AS n FROM credit_signer_lanes WHERE active=1").get().n).toBe(2);
    const loserAccount = results[0].acquired ? "rRepay" : "rOrigin";
    acquired(main.lanes.claim(request("next:free", [loserAccount])));
  }, 15000);
});
