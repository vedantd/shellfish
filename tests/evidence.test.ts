import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalJson, withoutFields, type EvidencePassport } from "../packages/schemas/src/index.ts";
import { completedHistoryMonths, createEvidenceService, validateEvidencePassport, type PerformanceEventInput } from "../packages/evidence/src/index.ts";

const seed = JSON.parse(readFileSync(resolve(import.meta.dirname, "../fixtures/evidence-passport.json"), "utf8")) as EvidencePassport;
const clock = () => new Date("2026-10-24T18:13:00Z");
const hash = (value: unknown): string => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
function attestation(passport: EvidencePassport): EvidencePassport {
  return { ...passport, evidence_hash: hash(withoutFields(passport, ["signature", "evidence_hash"])) };
}
const event = (eventId = "event-1"): PerformanceEventInput => ({ eventId, subjectId: seed.subject_id,
  loanId: "sim:loan-1", eventType: "on_time", amount: "100.00", observedAt: "2026-10-24T18:12:00Z" });

describe("explicit evidence source", () => {
  it("returns the enrolled fixture without sharing mutable state", async () => {
    const service = createEvidenceService({ passports: [seed], now: clock, hash });
    const found = await service.getEvidencePassport(seed.subject_id);
    expect(found).toEqual(seed);
    found.history.on_time = 999;
    expect((await service.getEvidencePassport(seed.subject_id)).history.on_time).toBe(8);
    await expect(service.getEvidencePassport("unknown-subject")).rejects.toMatchObject({ code: "DENY_IDENTITY" });
  });
  it("rejects altered content and duplicate subjects", () => {
    expect(() => createEvidenceService({ passports: [{ ...seed, optional_tier: "forged" }], now: clock, hash }))
      .toThrow("content commitment changed");
    expect(() => createEvidenceService({ passports: [seed, seed], now: clock, hash })).toThrow("Duplicate seeded subject");
  });
  it("rejects stale and future-issued evidence at the injected clock", () => {
    expect(() => validateEvidencePassport(seed, new Date(seed.expires_at), hash)).toThrow("expired");
    expect(() => validateEvidencePassport(seed, new Date("2026-10-24T17:59:00Z"), hash)).toThrow("future-dated");
    expect(() => validateEvidencePassport(seed, new Date("invalid"), hash)).toThrow("Invalid evidence clock");
  });
  it("rejects fabricated history months and impossible observation dates", () => {
    const impossible = attestation({ ...seed, history: { ...seed.history, accepted_history_months: 12 } });
    expect(() => validateEvidencePassport(impossible, clock(), hash)).toThrow("observation dates");
    const future = attestation({ ...seed, history: { ...seed.history, observation_end: "2026-10-25T18:00:00Z" } });
    expect(() => validateEvidencePassport(future, clock(), hash)).toThrow("observation dates");
    expect(completedHistoryMonths("2026-04-24T18:00:00Z", "2026-10-24T17:59:59Z")).toBe(5);
    expect(completedHistoryMonths("2026-04-24T18:00:00Z", "2026-10-24T18:00:00Z")).toBe(6);
    expect(completedHistoryMonths("2026-10-24T18:00:00Z", "2026-04-24T18:00:00Z")).toBe(-1);
  });
  it("rechecks freshness on each lookup", async () => {
    let instant = clock();
    const service = createEvidenceService({ passports: [seed], now: () => instant, hash });
    await service.getEvidencePassport(seed.subject_id);
    instant = new Date(seed.expires_at);
    await expect(service.getEvidencePassport(seed.subject_id)).rejects.toMatchObject({ code: "DENY_EVIDENCE_STALE" });
  });
  it("requires a trusted performance attestor and rejects malformed events", async () => {
    const service = createEvidenceService({ passports: [seed], now: clock, hash });
    await expect(service.recordPerformanceEvent(event())).rejects.toMatchObject({ code: "PERFORMANCE_ATTESTATION_REQUIRED" });
    const configured = createEvidenceService({ passports: [seed], now: clock, hash, attestPerformance: async (_, current) => current });
    await expect(configured.recordPerformanceEvent({ ...event(), amount: "-100.00" })).rejects.toMatchObject({ code: "DENY_TRANSACTION_MISMATCH" });
    await expect(configured.recordPerformanceEvent({ ...event(), observedAt: "2027-01-01T00:00:00Z" })).rejects.toMatchObject({ code: "DENY_TRANSACTION_MISMATCH" });
  });
  it("serializes trusted updates and applies each event once", async () => {
    let calls = 0;
    const service = createEvidenceService({ passports: [seed], now: clock, hash,
      attestPerformance: async (verified, current) => {
        calls++;
        await Promise.resolve();
        return attestation({ ...current, issued_at: verified.observedAt, evidence_version: `trusted-${calls}`,
          history: { ...current.history, on_time: current.history.on_time + 1 } });
      } });
    const first = event(), second = event("event-2");
    await Promise.all([service.recordPerformanceEvent(first), service.recordPerformanceEvent(first), service.recordPerformanceEvent(second)]);
    expect(calls).toBe(2);
    const result = await service.getEvidencePassport(seed.subject_id);
    expect(result.history.on_time).toBe(10);
    expect(result.history.accepted_history_months).toBe(6);
    expect(result.known_exposure).toEqual(seed.known_exposure);
    await expect(service.recordPerformanceEvent({ ...first, amount: "101.00" })).rejects.toMatchObject({ code: "DENY_IDEMPOTENCY_CONFLICT" });
  });
  it("rejects attestor identity changes and counter inflation without changing evidence", async () => {
    const service = createEvidenceService({ passports: [seed], now: clock, hash,
      attestPerformance: async (_, current) => attestation({ ...current, evidence_version: "bad-update",
        history: { ...current.history, on_time: current.history.on_time + 2 } }) });
    await expect(service.recordPerformanceEvent(event())).rejects.toMatchObject({ code: "DENY_TRANSACTION_MISMATCH" });
    expect(await service.getEvidencePassport(seed.subject_id)).toEqual(seed);
    const wrongSubject = createEvidenceService({ passports: [seed], now: clock, hash,
      attestPerformance: async (_, current) => attestation({ ...current, evidence_version: "bad-subject", subject_id: "another-subject" }) });
    await expect(wrongSubject.recordPerformanceEvent(event())).rejects.toMatchObject({ code: "DENY_TRANSACTION_MISMATCH" });
  });
});

import { createRequire } from "node:module";
import { gitaRoutes } from "../services/api/src/routes/gita.ts";
const apiRequire=createRequire(new URL("../services/api/package.json",import.meta.url));
const Fastify=apiRequire("fastify");

describe("credit API fixture integration",()=>{
  it("serves evidence, distinct lender decisions and the exact match",async()=>{
    const app=Fastify();await app.register(gitaRoutes,{mode:"SIMULATED_LOAN"});
    const address=await app.listen({host:"127.0.0.1",port:0});
    try {
      const passport=await fetch(`${address}/v1/evidence/${encodeURIComponent(seed.subject_id)}`);
      expect(passport.status).toBe(200);expect(await passport.json()).toEqual(seed);
      const a=await fetch(`${address}/v1/lenders/lender-A/evaluate`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({subject_id:seed.subject_id})});
      const b=await fetch(`${address}/v1/lenders/lender-B/evaluate`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({subject_id:seed.subject_id})});
      const aBody=await a.json() as {decision:string;offer:unknown};
      const bBody=await b.json() as {decision:string};
      expect(aBody.decision).toBe("APPROVE");expect(bBody.decision).toBe("DECLINE");
      const mandate=JSON.parse(readFileSync(resolve(import.meta.dirname,"../fixtures/mandate.json"),"utf8"));
      const matched=await fetch(`${address}/v1/offers/match`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({mandate,offers:[aBody.offer],evidence:seed})});
      const matchBody=await matched.json() as {compatible:boolean;envelope_hash:string};
      expect(matched.status).toBe(200);expect(matchBody.compatible).toBe(true);
      expect(matchBody.envelope_hash).toBe(JSON.parse(readFileSync(resolve(import.meta.dirname,"../fixtures/offer-match.json"),"utf8")).envelope_hash);
    } finally {await app.close();}
  });
  it("reports missing native sources and malformed inputs without authorizing",async()=>{
    const native=Fastify();await native.register(gitaRoutes,{mode:"LIVE_DEVNET"});
    const sim=Fastify();await sim.register(gitaRoutes,{mode:"SIMULATED_LOAN"});
    const nativeAddress=await native.listen({host:"127.0.0.1",port:0});
    const simAddress=await sim.listen({host:"127.0.0.1",port:0});
    try {
      const missing=await fetch(`${nativeAddress}/v1/evidence/${seed.subject_id}`);
      expect(missing.status).toBe(503);expect((await missing.json() as {code:string}).code).toBe("CREDIT_SOURCE_NOT_CONFIGURED");
      const invalid=await fetch(`${simAddress}/v1/offers/match`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({mandate:{},offers:[]})});
      expect(invalid.status).toBe(400);expect((await invalid.json() as {code:string}).code).toBe("DENY_TRANSACTION_MISMATCH");
      const unknown=await fetch(`${simAddress}/v1/evidence/not-enrolled`);
      expect(unknown.status).toBe(404);expect((await unknown.json() as {code:string}).code).toBe("DENY_IDENTITY");
    } finally {await native.close();await sim.close();}
  });
});

import { openFixtureCreditBackend } from "../services/api/src/db/fixtures.ts";
describe("persistent registry service wiring",()=>{
  it("uses the same registry balances through the HTTP consumer",async()=>{
    const backend=openFixtureCreditBackend(":memory:");
    const app=Fastify();await app.register(gitaRoutes,{mode:"SIMULATED_LOAN",services:backend.services});
    const address=await app.listen({host:"127.0.0.1",port:0});
    try {
      const before=await fetch(`${address}/v1/facilities/facility-A-001`);
      expect((await before.json() as {headroomMinor:string}).headroomMinor).toBe("400000");
      const reservation=JSON.parse(readFileSync(resolve(import.meta.dirname,"../fixtures/reservation.json"),"utf8"));
      backend.registry.reserveRequest(reservation.request);
      const after=await fetch(`${address}/v1/facilities/facility-A-001`);
      expect((await after.json() as {headroomMinor:string}).headroomMinor).toBe("200000");
      expect(backend.registry.getRequest(reservation.request.request_id).originalBondU).toBe("720000000");
    } finally {await app.close();backend.close();}
  });
  it("serves status and curve quotes from the same backend without changing signed evidence",async()=>{
    const backend=openFixtureCreditBackend(":memory:"),app=Fastify();
    await app.register(gitaRoutes,{mode:"SIMULATED_LOAN",services:backend.services});
    const address=await app.listen({host:"127.0.0.1",port:0});
    try {
      const base=`${address}/v1/facilities/facility-A-001`;
      const before=await (await fetch(`${base}/credit-status`)).json() as {exposure_for_curve_minor:string;portfolio:{reputation:{available_u:string}}};
      expect(before.exposure_for_curve_minor).toBe("100000");expect(before.portfolio.reputation.available_u).toBe("760000000");
      const response=await fetch(`${base}/quote`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({principal_minor:"200000",max_stake_u:"720000000"})});
      expect(response.status).toBe(200);expect(await response.json()).toMatchObject({bond_u:"720000000",fits_registry_limits:true,grants_permission:false,reservation_required:true});
      expect(await (await fetch(`${base}/credit-status`)).json()).toEqual(before);
      const reservation=JSON.parse(readFileSync(resolve(import.meta.dirname,"../fixtures/reservation.json"),"utf8"));
      backend.registry.reserveRequest(reservation.request);
      const after=await (await fetch(`${base}/credit-status`)).json() as {exposure_for_curve_minor:string;portfolio:{reputation:{available_u:string;reserved_u:string}}};
      expect(after.exposure_for_curve_minor).toBe("300000");expect(after.portfolio.reputation).toMatchObject({available_u:"40000000",reserved_u:"720000000"});
      const attested=await (await fetch(`${address}/v1/evidence/${seed.subject_id}`)).json();
      expect(attested).toEqual(seed);
      const bad=await fetch(`${base}/quote`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({principal_minor:"2000.00"})});
      expect(bad.status).toBe(400);
      const missing=await fetch(`${address}/v1/facilities/missing/credit-status`);expect(missing.status).toBe(404);
    } finally {await app.close();backend.close();}
  });
  it("rejects missing registry sources and native/simulation mode mismatches",async()=>{
    const empty=Fastify();await empty.register(gitaRoutes,{mode:"LIVE_DEVNET"});
    const backend=openFixtureCreditBackend(":memory:"),wrong=Fastify();
    await wrong.register(gitaRoutes,{mode:"LIVE_DEVNET",services:backend.services});
    const emptyAddress=await empty.listen({host:"127.0.0.1",port:0}),wrongAddress=await wrong.listen({host:"127.0.0.1",port:0});
    try {
      for(const suffix of ["","/credit-status","/quote"]) {
        const options=suffix==="/quote"?{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({principal_minor:"100"})}:{};
        const noSource=await fetch(`${emptyAddress}/v1/facilities/facility-A-001${suffix}`,options);
        expect(noSource.status).toBe(503);
        const mismatch=await fetch(`${wrongAddress}/v1/facilities/facility-A-001${suffix}`,options);
        expect(mismatch.status).toBe(400);expect(await mismatch.json()).toMatchObject({code:"DENY_UNSUPPORTED_NETWORK"});
      }
    } finally {await empty.close();await wrong.close();backend.close();}
  });
});
