import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { ScenarioFixture, ReservationFixture, BondCasesFixture, CreditStatus, CreditQuote, withoutFields } from "../packages/schemas/src/index.ts";
import { createRegistry, quoteRepBondU, maximumPrincipalMinor, calculateRepGrowthU, contentHash,
  APPROVED_REP_POLICY_HASH, projectMptPayment, type RegistryEvent } from "../packages/registry/src/index.ts";
const require=createRequire(new URL("../services/api/package.json",import.meta.url));
const Database=require("better-sqlite3");
const root=resolve(import.meta.dirname,"..");
const load=(name:string)=>JSON.parse(readFileSync(resolve(root,"fixtures",name),"utf8"));
const scenario=ScenarioFixture.parse(load("scenario.json"));
const request=ReservationFixture.parse(load("reservation.json")).request;
const vectors=BondCasesFixture.parse(load("rep-bond-cases.json"));
const origin=Math.floor(Date.parse(scenario.clock)/1000);
const day=86400;
const connections: InstanceType<typeof Database>[]=[];
const folders:string[]=[];
afterEach(()=>{for(const db of connections.splice(0))db.close();for(const dir of folders.splice(0))rmSync(dir,{recursive:true,force:true});});
function setup(raw=scenario,path=":memory:") {
  const db=new Database(path);connections.push(db);let now=origin;
  const registry=createRegistry(db,{now:()=>new Date(now*1000)});
  registry.seedScenario(raw,"sim:borrower-harbor-supply");
  const binding={principalId:raw.principal_id,network:raw.network,asset:raw.loan_asset};
  return {db,registry,binding,advance:(seconds:number)=>{now=seconds;},snapshot:()=>registry.getPortfolio(binding)};
}
function variant(n:string,p=request.principal_minor) {
  return {...request,request_id:`req-${n}`,idempotency_key:`key-${n}`,mandate_id:`mandate-${n}`,nonce:`nonce-${n}`,principal_minor:p};
}
function stake(id=request.request_id,eventId=`stake:${id}`):RegistryEvent {
  return {eventId,kind:"STAKE_VALIDATED",requestId:id,occurredAt:origin,
    stake:{amountU:"720000000",repAsset:scenario.rep_asset,sender:"sim:borrower-harbor-supply",destination:scenario.rep_asset.issuer,
      requestHash:contentHash(request),partialPayment:false}};
}
async function active(s=setup(),id=request.request_id,p=request.principal_minor) {
  const input=id===request.request_id?request:variant(id,p);
  s.registry.reserveRequest(input);
  const st=stake(input.request_id);st.stake!.requestHash=contentHash(input);st.stake!.amountU=s.registry.getRequest(input.request_id).originalBondU;
  await s.registry.applyEvent(st);
  const eventId=`origin:${input.request_id}`,loanId=`loan:${input.request_id}`;
  await s.registry.applyEvent({eventId,kind:"ORIGINATION_VALIDATED",requestId:input.request_id,occurredAt:origin,
    loan:{loanId,maturityAt:origin+90*day,graceSeconds:60}});
  return {...s,loanId,eventId,originHash:`sim:${eventId}`,input};
}
function pay(a:Awaited<ReturnType<typeof active>>,eventId:string,at:number,reduction:string,full=true,previous=a.eventId):RegistryEvent {
  return {eventId,kind:"REPAYMENT",loanId:a.loanId,occurredAt:at,
    repayment:{principalReductionMinor:reduction,fullContractualRepayment:full,onTime:true},
    history:{complete:true,originHash:a.originHash,previousEventId:previous}};
}

describe("native Payment projections from the completed Devnet session",()=>{
  const capture=load("xrpl-poc-replay/native-result-2026-10-25T08-52-39-891Z-c8c11959.json");
  const payment=(label:string)=>capture.transactions.find((t:{label:string})=>t.label===label).evidence.tx_json;
  it("reads the observed API v2 DeliverMax REP seed, redemption and return in exact atomic units",()=>{
    expect(capture.result).toBe("PASS");expect(capture.server.network_id).toBe(2);
    for(const [label,amountU,from,to] of [
      ["rep-seed","1000000000",capture.accounts.repIssuer,capture.accounts.borrower],
      ["rep-redeem","240000000",capture.accounts.borrower,capture.accounts.repIssuer],
      ["rep-restore","240000008",capture.accounts.repIssuer,capture.accounts.borrower],
    ])expect(projectMptPayment(payment(label))).toEqual({sender:from,destination:to,issuanceId:capture.rep_asset.mpt_issuance_id,amountU});
  });
  it("treats Amount and DeliverMax as aliases without accepting disagreement or route semantics",()=>{
    const observed=payment("rep-restore"),{DeliverMax,...base}=observed;
    const expected=projectMptPayment(observed);
    expect(projectMptPayment({...base,Amount:DeliverMax})).toEqual(expected);
    expect(projectMptPayment({...observed,Amount:DeliverMax})).toEqual(expected);
    expect(()=>projectMptPayment({...observed,Amount:{...DeliverMax,value:"1"}})).toThrow("PAYMENT_AMOUNT_ALIAS_CONFLICT");
    for(const change of [{Flags:131072},{SendMax:DeliverMax},{DeliverMin:DeliverMax},{Paths:[]},
      {DeliverMax:{...DeliverMax,value:240000008}},{DeliverMax:{...DeliverMax,value:"240.000008"}}])
      expect(()=>projectMptPayment({...observed,...change})).toThrow("INVALID_MPT_PAYMENT");
  });
  it("never interprets the recorded LoanPay maximum as a REP Payment or principal reduction",()=>{
    const tx=payment("loan-repay");expect(tx.Amount.value).toBe("2000");
    expect(capture.repayment.actual_debit_native_units).toBe("1015");
    expect(capture.repayment.principal_reduction_native_units).toBe("1000");
    expect(()=>projectMptPayment(tx)).toThrow("INVALID_MPT_PAYMENT");
    expect(calculateRepGrowthU({intervals:[{principalMinor:100000n,elapsedSeconds:11n}],eligible:true,
      remainingRollingBudgetU:20000000n,survivingRepU:1000000000n})).toBe(8n);
  });
});
async function returnCredit(s:ReturnType<typeof setup>,creditId:string,eventId="return") {
  const credit=s.registry.getReturnCredits(s.binding).find(c=>c.creditId===creditId)!;
  return s.registry.applyEvent({eventId,kind:"RETURN_VALIDATED",creditId,occurredAt:origin+90*day,
    returned:{amountU:credit.amountU,repAsset:scenario.rep_asset,sender:scenario.rep_asset.issuer,destination:"sim:borrower-harbor-supply",partialPayment:false}});
}

describe("exact reputation policy",()=>{
  it("matches every approved quotation and binary-searches actual free budget",()=>{
    expect(APPROVED_REP_POLICY_HASH).toBe(contentHash(load("rep-policy.json")));
    for(const c of vectors.quote_cases)expect(quoteRepBondU(BigInt(c.exposure_minor),BigInt(c.principal_minor))).toBe(BigInt(c.expected_bond_u));
    expect(maximumPrincipalMinor({exposureMinor:0n,availableRepU:1000000000n,monetaryUpperBoundMinor:999999n})).toBe(309016n);
    expect(quoteRepBondU(0n,309016n)).toBeLessThanOrEqual(1000000000n);
    expect(quoteRepBondU(0n,309017n)).toBeGreaterThan(1000000000n);
  });
  it("rounds one increment upward and preserves principal-time fractions",()=>{
    expect(quoteRepBondU(1n,1n)).toBe(2001n);
    const intervals=[{principalMinor:200000n,elapsedSeconds:30n*86400n},{principalMinor:150000n,elapsedSeconds:60n*86400n}];
    expect(calculateRepGrowthU({intervals,eligible:true,remainingRollingBudgetU:20000000n,survivingRepU:1000000000n})).toBe(10000000n);
    expect(calculateRepGrowthU({intervals,eligible:true,remainingRollingBudgetU:5000000n,survivingRepU:1000000000n})).toBe(5000000n);
    expect(calculateRepGrowthU({intervals,eligible:true,remainingRollingBudgetU:20000000n,survivingRepU:1199000000n})).toBe(1000000n);
  });
});

describe("registry credit status and read-only quotations",()=>{
  it("exposes a coherent all-bucket status and the exact 720 REP quote without reserving",()=>{
    const s=setup(),before=s.snapshot(),status=s.registry.getCreditStatus(request.facility_id);
    expect(CreditStatus.parse(status)).toEqual(status);
    expect(status).toMatchObject({mode:"SIMULATED_LOAN",principal_id:scenario.principal_id,asset:scenario.loan_asset,
      rep_asset:scenario.rep_asset,money_scale:"100",rep_scale:1000000,coverage:"participating_sources_only",
      exposure_for_curve_minor:"100000",facility:{headroom_minor:"400000"}});
    expect(status.portfolio.reputation).toEqual(before.reputation);
    const quote=s.registry.quoteCredit(request.facility_id,{principal_minor:"200000",max_stake_u:"720000000"});
    expect(CreditQuote.parse(quote)).toEqual(quote);
    expect(quote).toMatchObject({bond_u:"720000000",exposure_before_minor:"100000",available_rep_u:"760000000",
      maximum_additional_principal_minor:"200000",fits_registry_limits:true,reason_codes:[],grants_permission:false,reservation_required:true});
    expect(quote.quote_hash).toBe(contentHash(withoutFields(quote,["quote_hash"])));
    expect(s.registry.quoteCredit(request.facility_id,{principal_minor:"200000"}).maximum_additional_principal_minor).toBe("209016");
    expect(s.snapshot()).toEqual(before);
    expect(s.db.prepare("SELECT count(*) n FROM credit_requests").get().n).toBe(0);
    expect(s.db.prepare("SELECT count(*) n FROM credit_mandate_uses").get().n).toBe(0);
  });
  it("prices unresolved exposure across facilities and reprices at the actual reservation",()=>{
    const s=setup();s.registry.addFacility(s.binding,{facilityId:"other-credit-view",lenderId:"other-lender",approvedLimitMinor:"500000"});
    const old=s.registry.quoteCredit(request.facility_id,{principal_minor:"100000"});expect(old.bond_u).toBe("320000000");
    s.registry.reserveRequest({...variant("other-view","100000"),facility_id:"other-credit-view"});
    const status=s.registry.getCreditStatus(request.facility_id),next=s.registry.quoteCredit(request.facility_id,{principal_minor:"100000"});
    expect(status.facility.reserved_minor).toBe("0");expect(status.portfolio.facility_reserved_minor).toBe("100000");
    expect(status.exposure_for_curve_minor).toBe("200000");expect(next.bond_u).toBe("400000000");
    expect(next.exposure_version).toBeGreaterThan(old.exposure_version);expect(next.quote_hash).not.toBe(old.quote_hash);
    expect(s.registry.reserveRequest(variant("consume-view","100000")).originalBondU).toBe("400000000");
  });
  it("reports facility, free REP and user stake-cap bounds without counting pending returns as free REP",async()=>{
    const a=await active();a.advance(origin+90*day);await a.registry.applyEvent(pay(a,"credit-view-pay",origin+90*day,"200000"));
    const status=a.registry.getCreditStatus(request.facility_id);
    expect(status.portfolio.reputation).toMatchObject({available_u:"40000000",pending_return_u:"732000000"});
    const rep=a.registry.quoteCredit(request.facility_id,{principal_minor:"100000"});
    expect(rep.reason_codes).toEqual(["DENY_REP_CAPACITY"]);
    const all=a.registry.quoteCredit(request.facility_id,{principal_minor:"500000",max_stake_u:"0"});
    expect(all.reason_codes).toEqual(["DENY_CAPACITY","DENY_REP_CAPACITY","DENY_REP_CONSENT"]);
    expect(all.maximum_additional_principal_minor).toBe("0");
    const credit=a.registry.getReturnCredits(a.binding)[0];await returnCredit(a,credit.creditId,"credit-view-return");
    const restored=a.registry.quoteCredit(request.facility_id,{principal_minor:"100000"});
    expect(restored.fits_registry_limits).toBe(true);expect(restored.available_rep_u).toBe("772000000");
    expect(BigInt(restored.maximum_additional_principal_minor)).toBeGreaterThan(BigInt(rep.maximum_additional_principal_minor));
  });
  it("keeps defaulted debt visible and returns zero borrowable capacity after suspension",async()=>{
    const a=await active();a.advance(origin+90*day+61);
    await a.registry.applyEvent({eventId:"credit-view-default",kind:"DEFAULT",loanId:a.loanId,occurredAt:origin+90*day+61,
      history:{complete:true,originHash:a.originHash,previousEventId:a.eventId}});
    const status=a.registry.getCreditStatus(request.facility_id),quote=a.registry.quoteCredit(request.facility_id,{principal_minor:"100"});
    expect(status.portfolio.defaulted_principal_minor).toBe("200000");
    expect(status.portfolio.reputation).toMatchObject({forfeited_u:"720000000",suspended:true});
    expect(quote).toMatchObject({fits_registry_limits:false,reason_codes:["DENY_SUSPENDED"],maximum_additional_principal_minor:"0"});
  });
  it("rejects malformed quote units and returns detached status values",()=>{
    const s=setup();
    for(const input of [{principal_minor:"0"},{principal_minor:200000},{principal_minor:"2000.00"},
      {principal_minor:"200000",max_stake_u:"-1"},{principal_minor:"200000",authorize:true}])
      expect(()=>s.registry.quoteCredit(request.facility_id,input)).toThrow();
    const status=s.registry.getCreditStatus(request.facility_id);status.portfolio.reputation.available_u="0";
    expect(s.registry.getCreditStatus(request.facility_id).portfolio.reputation.available_u).toBe("760000000");
    expect(()=>s.registry.getCreditStatus("unknown-facility")).toThrow("NOT_FOUND");
  });
});

describe("atomic registry and persistent requests",()=>{
  it("seeds idempotently and holds both budgets exactly once",()=>{
    const s=setup();s.registry.seedScenario(scenario,"sim:borrower-harbor-supply");
    const r=s.registry.reserveRequest(request),again=s.registry.reserveRequest(request);
    expect(again).toEqual(r);expect(r.originalBondU).toBe("720000000");
    expect(s.snapshot().reputation).toMatchObject({available_u:"40000000",reserved_u:"720000000",bonded_u:"240000000"});
    expect(s.registry.getFacility(request.facility_id).headroomMinor).toBe("200000");
    expect(s.snapshot().reserved_principal_minor).toBe("200000");
  });
  it("rejects changed payload, used mandate and consumed nonce without changing balances",()=>{
    const s=setup();s.registry.reserveRequest(request);const before=s.snapshot();
    expect(()=>s.registry.reserveRequest({...request,principal_minor:"199900"})).toThrow("DENY_IDEMPOTENCY_CONFLICT");
    expect(()=>s.registry.reserveRequest({...request,request_id:"other",idempotency_key:"other"})).toThrow("DENY_REPLAY");
    expect(()=>s.registry.reserveRequest({...variant("new"),nonce:request.nonce})).toThrow("DENY_REPLAY");
    expect(s.snapshot()).toEqual(before);
  });
  it("rolls back a denied request and rejects changed policy or REP consent",()=>{
    const s=setup(),before=s.snapshot();
    expect(()=>s.registry.reserveRequest({...request,max_stake_u:"719999999"})).toThrow("DENY_REP_CONSENT");
    expect(()=>s.registry.reserveRequest({...request,policy_hash:"sha256:"+"f".repeat(64)})).toThrow("DENY_REP_CONSENT");
    expect(s.snapshot()).toEqual(before);
    expect(s.db.prepare("SELECT count(*) n FROM credit_mandate_uses").get().n).toBe(0);
    expect(s.registry.reserveRequest(request).originalBondU).toBe("720000000");
  });
  it("reprices a second request against unresolved exposure",()=>{
    const s=setup();const one=s.registry.reserveRequest(variant("one","100000"));
    const two=s.registry.reserveRequest(variant("two","100000"));
    expect(one.originalBondU).toBe("320000000");expect(two.originalBondU).toBe("400000000");
    expect(s.snapshot().reputation.available_u).toBe("40000000");
  });
  it("persists a reservation across reopening the file",()=>{
    const dir=mkdtempSync(resolve(tmpdir(),"shellfish-registry-"));folders.push(dir);const file=resolve(dir,"test.db");
    const s=setup(scenario,file);const r=s.registry.reserveRequest(request);s.db.close();connections.pop();
    const db=new Database(file);connections.push(db);const registry=createRegistry(db,{now:()=>new Date(origin*1000)});
    expect(registry.reserveRequest(request)).toEqual(r);
  });
  const finalRaceCases=[...vectors.race_cases.filter(c=>c.expected_success_count===1),{
    case_id:"baton-2500-against-4000",facility_headroom_minor:"400000",expected_second_reason:"DENY_CAPACITY",
    requests:[{mandate_id:"baton-race-m-1",nonce:"baton-race-n-1",principal_minor:"250000"},
      {mandate_id:"baton-race-m-2",nonce:"baton-race-n-2",principal_minor:"250000"}],
  }];
  for(const vector of finalRaceCases)it(`runs simultaneous SQL writers for ${vector.case_id}`,async()=>{
    const dir=mkdtempSync(resolve(tmpdir(),"shellfish-race-"));folders.push(dir);const file=resolve(dir,"race.db");
    const seed=structuredClone(scenario);
    if(vector.case_id==="baton-2500-against-4000") {
      seed.opening_loans=[];seed.opening.active_principal_minor="0";seed.opening.facility_committed_minor="0";
      seed.opening.reputation.bonded_u="0";seed.opening.reputation.available_u="1000000000";
    }
    seed.facility.limit_minor=(BigInt(seed.opening.facility_committed_minor)+BigInt(vector.facility_headroom_minor)).toString();
    const s=setup(seed,file);s.db.pragma("journal_mode = WAL");
    const barrier=new SharedArrayBuffer(4),control=new Int32Array(barrier);
    let readyCount=0;
    const results=vector.requests.map((q,i)=>new Promise<{ok:boolean;code?:string}>((done,reject)=>{
      const worker=new Worker(`const {workerData,parentPort}=require('node:worker_threads'); const {createRequire}=require('node:module');
        const req=createRequire(workerData.packagePath);const Database=req('better-sqlite3');
        (async()=>{const {createRegistry}=await import(workerData.registryUrl);const db=new Database(workerData.file);const r=createRegistry(db,{now:()=>new Date(workerData.now)});
        parentPort.postMessage({ready:true});Atomics.wait(new Int32Array(workerData.barrier),0,0);
        try{r.reserveRequest(workerData.input);parentPort.postMessage({ok:true});}catch(e){parentPort.postMessage({ok:false,code:e.code});}finally{db.close();}})();`,
        {eval:true,workerData:{packagePath:resolve(root,"services/api/package.json"),registryUrl:new URL("../packages/registry/dist/index.js",import.meta.url).href,
          file,now:origin*1000,barrier,input:{...variant(`${vector.case_id}-${i}`,q.principal_minor),mandate_id:q.mandate_id,nonce:q.nonce,
            max_stake_u:vector.case_id==="baton-2500-against-4000"?"1000000000":request.max_stake_u}}});
      let outcome:{ok:boolean;code?:string}|undefined;
      worker.on("message",msg=>{if(msg.ready){readyCount+=1;if(readyCount===2){Atomics.store(control,0,1);Atomics.notify(control,0);}}else outcome=msg;});
      worker.on("error",reject);
      worker.on("exit",code=>{if(code===0&&outcome)done(outcome);else reject(new Error(`Worker exited ${code}`));});
    }));
    const observed=await Promise.all(results);
    expect(observed.filter(r=>r.ok)).toHaveLength(1);expect(observed.find(r=>!r.ok)?.code).toBe(vector.expected_second_reason);
    if(vector.case_id==="baton-2500-against-4000") {
      expect(s.registry.getFacility(request.facility_id)).toMatchObject({reservedMinor:"250000",headroomMinor:"150000"});
      expect(s.snapshot().reputation).toMatchObject({available_u:"250000000",reserved_u:"750000000"});
      expect(s.db.prepare("SELECT count(*) n FROM credit_mandate_uses").get().n).toBe(1);
    }
  });
});

describe("verified outcome accounting",()=>{
  it("requires exact stake and retains uncertain exposure",async()=>{
    const s=setup();s.registry.reserveRequest(request);const bad=stake();bad.stake!.amountU="719999999";
    await expect(s.registry.applyEvent(bad)).rejects.toThrow("DENY_STAKE_PROOF");
    await expect(s.registry.applyEvent({eventId:"unbacked",kind:"ORIGINATION_VALIDATED",requestId:request.request_id,occurredAt:origin,
      loan:{loanId:"bad",maturityAt:origin+day,graceSeconds:60}})).rejects.toThrow("STAKE_REQUIRED");
    const before=s.snapshot();await s.registry.applyEvent({eventId:"unknown",kind:"UNKNOWN",requestId:request.request_id,occurredAt:origin});
    expect(s.snapshot()).toEqual(before);expect(s.registry.getRequest(request.request_id).state).toBe("RECONCILING");
  });
  it("commits original bond once, rewards clean closure and waits for issuer return",async()=>{
    const a=await active();expect(a.snapshot().reputation.bonded_u).toBe("960000000");a.advance(origin+90*day);
    const event=pay(a,"pay",origin+90*day,"200000");await a.registry.applyEvent(event);const after=a.snapshot();
    await a.registry.applyEvent(event);expect(a.snapshot()).toEqual(after);
    expect(after.reputation).toMatchObject({available_u:"40000000",bonded_u:"240000000",pending_return_u:"732000000",growth_u:"12000000"});
    const credit=a.registry.getReturnCredits(a.binding)[0];await returnCredit(a,credit.creditId);
    expect(a.snapshot().reputation).toMatchObject({available_u:"772000000",pending_return_u:"0"});
  });
  it("does not reprice the original bond after partial repayment",async()=>{
    const a=await active();a.advance(origin+90*day);
    await a.registry.applyEvent(pay(a,"partial",origin+30*day,"50000",false));
    expect(a.snapshot().reputation.bonded_u).toBe("960000000");
    await a.registry.applyEvent(pay(a,"closed",origin+90*day,"150000",true,"partial"));
    expect(a.registry.getReturnCredits(a.binding)[0]).toMatchObject({amountU:"730000000",growthU:"10000000"});
  });
  it("rejects incomplete/out-of-order history before awarding appreciation",async()=>{
    const a=await active();a.advance(origin+90*day);const event=pay(a,"out-of-order",origin+90*day,"150000",true,"unseen-partial");
    await expect(a.registry.applyEvent(event)).rejects.toThrow("Backfill complete ordered history");
    expect(a.registry.getReturnCredits(a.binding)).toEqual([]);expect(a.snapshot().reputation.growth_u).toBe("0");
  });
  it("retains burned REP as owed after conclusive origination failure",async()=>{
    const s=setup();s.registry.reserveRequest(request);await s.registry.applyEvent(stake());
    await s.registry.applyEvent({eventId:"failed",kind:"FAIL_AFTER_BURN",requestId:request.request_id,occurredAt:origin,conclusive:true});
    expect(s.snapshot().reputation).toMatchObject({available_u:"40000000",reserved_u:"0",pending_return_u:"720000000",growth_u:"0"});
    expect(s.registry.getFacility(request.facility_id).headroomMinor).toBe("400000");
  });
  it("forfeits the original bond on default and keeps defaulted liability",async()=>{
    const a=await active();a.advance(origin+90*day+61);
    await a.registry.applyEvent({eventId:"default",kind:"DEFAULT",loanId:a.loanId,occurredAt:origin+90*day+61,
      history:{complete:true,originHash:a.originHash,previousEventId:a.eventId}});
    expect(a.snapshot().reputation).toMatchObject({available_u:"40000000",bonded_u:"240000000",forfeited_u:"720000000",suspended:true});
    expect(a.snapshot().defaulted_principal_minor).toBe("200000");
    expect(()=>a.registry.reserveRequest(variant("after-default","100"))).toThrow("DENY_SUSPENDED");
  });
  it("rejects simulated native receipts",async()=>{
    const s=setup();s.registry.reserveRequest(request);const e=stake();e.native={txHash:"A".repeat(64),ledgerIndex:1,transactionIndex:0,validated:true,result:"tesSUCCESS",transactionType:"Payment"};
    await expect(s.registry.applyEvent(e)).rejects.toThrow("SIMULATION_CANNOT_CLAIM_NATIVE_PROOF");
  });
});

describe("regression controls at cross-component boundaries",()=>{
  it("aggregates exposure across participating facilities without reseeding REP",()=>{
    const s=setup();s.registry.addFacility(s.binding,{facilityId:"facility-other",lenderId:"lender-other",approvedLimitMinor:"500000"});
    s.registry.reserveRequest(variant("first","100000"));
    const second=s.registry.reserveRequest({...variant("second","100000"),facility_id:"facility-other"});
    expect(second.originalBondU).toBe("400000000");expect(s.snapshot().reputation.available_u).toBe("40000000");
  });
  it("rejects a second REP seed through another asset or wallet",()=>{
    const s=setup(),other=structuredClone(scenario);other.loan_asset={currency:"EUR",issuer:"sim:eur"};other.facility.asset=other.loan_asset;
    expect(()=>s.registry.seedScenario(other,"sim:another-wallet")).toThrow("PRINCIPAL_ALREADY_ENROLLED");
    const person=structuredClone(scenario);person.principal_id="another-principal";
    expect(()=>s.registry.seedScenario(person,"sim:borrower-harbor-supply")).toThrow("PRINCIPAL_ALREADY_ENROLLED");
    expect(s.snapshot().reputation.seed_u).toBe("1000000000");
  });
  it("rejects return-credit substitution against another active loan",async()=>{
    const a=await active();a.advance(origin+90*day);await a.registry.applyEvent(pay(a,"closed",origin+90*day,"200000"));
    const credit=a.registry.getReturnCredits(a.binding)[0],before=a.snapshot();
    await expect(a.registry.applyEvent({eventId:"misbound-return",kind:"RETURN_VALIDATED",creditId:credit.creditId,
      loanId:scenario.opening_loans[0].loan_id,occurredAt:origin+90*day,
      returned:{amountU:credit.amountU,repAsset:scenario.rep_asset,sender:scenario.rep_asset.issuer,destination:"sim:borrower-harbor-supply",partialPayment:false}}))
      .rejects.toThrow("INVALID_EVENT_BINDING");
    expect(a.snapshot()).toEqual(before);expect(a.registry.getLoan(scenario.opening_loans[0].loan_id).state).toBe("ACTIVE");
  });
  it("returns never-burned reservations only after conclusive cancellation",async()=>{
    const s=setup();s.registry.reserveRequest(request);
    await expect(s.registry.applyEvent({eventId:"not-proven",kind:"CANCEL_BEFORE_BURN",requestId:request.request_id,occurredAt:origin}))
      .rejects.toThrow("CONCLUSIVE_FAILURE_REQUIRED");
    await s.registry.applyEvent({eventId:"proven",kind:"CANCEL_BEFORE_BURN",requestId:request.request_id,occurredAt:origin,conclusive:true});
    expect(s.snapshot().reputation).toMatchObject({available_u:"760000000",reserved_u:"0"});
    expect(()=>s.registry.reserveRequest({...request,request_id:"new",idempotency_key:"new"})).toThrow("DENY_REPLAY");
  });
  it("uses the verified next due date for native-style default timing",async()=>{
    const s=setup();s.registry.reserveRequest(request);await s.registry.applyEvent(stake());
    await s.registry.applyEvent({eventId:"origin-due",kind:"ORIGINATION_VALIDATED",requestId:request.request_id,occurredAt:origin,
      loan:{loanId:"loan-due",maturityAt:origin+90*day,nextPaymentDueAt:origin+30*day,graceSeconds:60}});
    s.advance(origin+30*day+61);
    const event:RegistryEvent={eventId:"default-due",kind:"DEFAULT",loanId:"loan-due",occurredAt:origin+30*day+60,
      history:{complete:true,originHash:"sim:origin-due",previousEventId:"origin-due"}};
    await expect(s.registry.applyEvent(event)).rejects.toThrow("DEFAULT_TOO_SOON");
    await s.registry.applyEvent({...event,eventId:"after-grace",occurredAt:origin+30*day+61});
    expect(s.snapshot().reputation.suspended).toBe(true);
  });
  it("records a real origination fact after another loan suspends the principal",async()=>{
    const s=setup();
    for(const n of ["one","two"]){const r=variant(n,"100000");s.registry.reserveRequest(r);
      const event=stake(r.request_id);event.stake!.amountU=s.registry.getRequest(r.request_id).originalBondU;event.stake!.requestHash=contentHash(r);await s.registry.applyEvent(event);}
    await s.registry.applyEvent({eventId:"origin-one",kind:"ORIGINATION_VALIDATED",requestId:"req-one",occurredAt:origin,
      loan:{loanId:"loan-one",maturityAt:origin+10,graceSeconds:0}});
    s.advance(origin+12);
    await s.registry.applyEvent({eventId:"default-one",kind:"DEFAULT",loanId:"loan-one",occurredAt:origin+11,
      history:{complete:true,originHash:"sim:origin-one",previousEventId:"origin-one"}});
    await s.registry.applyEvent({eventId:"origin-two",kind:"ORIGINATION_VALIDATED",requestId:"req-two",occurredAt:origin+12,
      loan:{loanId:"loan-two",maturityAt:origin+90*day,graceSeconds:0}});
    expect(s.registry.getRequest("req-two").state).toBe("ACTIVE");expect(s.snapshot().reputation.suspended).toBe(true);
    expect(s.snapshot().reputation).toMatchObject({reserved_u:"0",bonded_u:"640000000",forfeited_u:"320000000"});
  });
  it("rejects native bootstrap and event claims without the trusted verifier",async()=>{
    const s=setup(),seed=structuredClone(scenario) as Record<string,unknown>;
    delete seed.provenance;delete seed.native_signing_permitted;seed.mode="LIVE_DEVNET";
    await expect(s.registry.initializeNativePortfolio(seed,"native-borrower",{})).rejects.toThrow("NATIVE_SEED_REQUIRES_VERIFIED_SYNC");
  });
});

describe("verified impairment schedule and default timing",()=>{
  function servicing(a:Awaited<ReturnType<typeof active>>,kind:"IMPAIRMENT"|"UNIMPAIRMENT",eventId:string,at:number,next:number,previous=a.eventId):RegistryEvent {
    return {eventId,kind,loanId:a.loanId,occurredAt:at,servicing:{nextPaymentDueAt:next},
      history:{complete:true,originHash:a.originHash,previousEventId:previous}};
  }
  it("defaults against the persisted revised due date and preserves the original bond",async()=>{
    const a=await active();a.advance(origin+30*day+61);
    const impaired=servicing(a,"IMPAIRMENT","impaired-due",origin+30*day,origin+30*day);
    await a.registry.applyEvent(impaired);const after=a.registry.getLoan(a.loanId);
    await a.registry.applyEvent(impaired);expect(a.registry.getLoan(a.loanId)).toEqual(after);
    expect(after).toMatchObject({next_due_time:origin+30*day,original_bond_u:"720000000",ever_impaired:1});
    expect(a.snapshot().reputation.bonded_u).toBe("960000000");
    const event:RegistryEvent={eventId:"revised-default",kind:"DEFAULT",loanId:a.loanId,occurredAt:origin+30*day+60,
      history:{complete:true,originHash:a.originHash,previousEventId:impaired.eventId}};
    await expect(a.registry.applyEvent(event)).rejects.toThrow("DEFAULT_TOO_SOON");
    await a.registry.applyEvent({...event,occurredAt:origin+30*day+61});
    expect(a.snapshot().reputation).toMatchObject({forfeited_u:"720000000",bonded_u:"240000000",suspended:true});
    expect(a.snapshot().defaulted_principal_minor).toBe("200000");
  });
  it("restores the verified due date without restoring appreciation eligibility",async()=>{
    const a=await active();a.advance(origin+90*day);
    const impaired=servicing(a,"IMPAIRMENT","impaired-history",origin+30*day,origin+30*day);
    await a.registry.applyEvent(impaired);
    const restored=servicing(a,"UNIMPAIRMENT","restored-history",origin+31*day,origin+90*day,impaired.eventId);
    await a.registry.applyEvent(restored);
    expect(a.registry.getLoan(a.loanId)).toMatchObject({next_due_time:origin+90*day,maturity_time:origin+90*day,ever_impaired:1});
    const before=a.snapshot();
    await expect(a.registry.applyEvent({eventId:"old-date-default",kind:"DEFAULT",loanId:a.loanId,occurredAt:origin+31*day+61,
      history:{complete:true,originHash:a.originHash,previousEventId:restored.eventId}})).rejects.toThrow("DEFAULT_TOO_SOON");
    expect(a.snapshot()).toEqual(before);
    await a.registry.applyEvent(pay(a,"impaired-full-repayment",origin+90*day,"200000",true,restored.eventId));
    expect(a.registry.getReturnCredits(a.binding)[0]).toMatchObject({amountU:"720000000",growthU:"0",state:"OWED"});
  });
  it("rejects invalid or unordered servicing without changing the loan or balances",async()=>{
    const a=await active();a.advance(origin+31*day);const before=a.registry.getLoan(a.loanId),snapshot=a.snapshot();
    await expect(a.registry.applyEvent(servicing(a,"UNIMPAIRMENT","never-impaired",origin+30*day,origin+90*day))).rejects.toThrow("LOAN_NOT_PREVIOUSLY_IMPAIRED");
    for(const next of [origin-1,Number.MAX_SAFE_INTEGER]) {
      await expect(a.registry.applyEvent(servicing(a,"IMPAIRMENT",`invalid-due-${next}`,origin+30*day,next))).rejects.toThrow("INVALID_SCHEDULE");
    }
    await expect(a.registry.applyEvent(servicing(a,"IMPAIRMENT","fractional-due",origin+30*day,origin+0.5))).rejects.toThrow("safe integers");
    await expect(a.registry.applyEvent(servicing(a,"IMPAIRMENT","missing-history-event",origin+30*day,origin+30*day,"unknown")))
      .rejects.toThrow("Backfill complete ordered history");
    expect(a.registry.getLoan(a.loanId)).toEqual(before);expect(a.snapshot()).toEqual(snapshot);
  });
  it("requires the native verified post-servicing schedule and LoanManage type",async()=>{
    // Explicit verifier mocks test the local boundary. No native ledger fact is claimed.
    const db=new Database(":memory:");connections.push(db);let now=origin;
    const registry=createRegistry(db,{now:()=>new Date(now*1000),verifyNativePortfolio:async()=>{},verifyNativeEvent:async()=>{}});
    const raw=structuredClone(scenario) as Record<string,any>;delete raw.provenance;delete raw.native_signing_permitted;
    raw.mode="LIVE_DEVNET";raw.opening_loans=[];raw.opening.active_principal_minor="0";raw.opening.facility_committed_minor="0";
    raw.opening.reputation.bonded_u="0";raw.opening.reputation.available_u="1000000000";
    await registry.initializeNativePortfolio(raw,"rNativeScheduleMock",{testOnly:true});
    const input={...variant("native-schedule","100000"),mode:"LIVE_DEVNET" as const};registry.reserveRequest(input);
    const native=(letter:string,index:number,type:string)=>({txHash:letter.repeat(64),ledgerIndex:index,transactionIndex:0,validated:true,result:"tesSUCCESS" as const,transactionType:type});
    await registry.applyEvent({eventId:"schedule-stake",kind:"STAKE_VALIDATED",requestId:input.request_id,occurredAt:origin,
      stake:{amountU:registry.getRequest(input.request_id).originalBondU,repAsset:input.rep_asset,sender:"rNativeScheduleMock",destination:input.rep_asset.issuer,requestHash:contentHash(input),partialPayment:false},
      native:native("1",100,"Payment")});
    const loanId="native-schedule-loan",originHash="2".repeat(64);
    await registry.applyEvent({eventId:"schedule-origin",kind:"ORIGINATION_VALIDATED",requestId:input.request_id,occurredAt:origin,
      loan:{loanId,maturityAt:origin+90*day,nextPaymentDueAt:origin+90*day,graceSeconds:60},native:native("2",101,"LoanSet")});
    now=origin+30*day;
    const event:RegistryEvent={eventId:"native-schedule-impair",kind:"IMPAIRMENT",loanId,occurredAt:now,
      history:{complete:true,originHash,previousEventId:"schedule-origin"},native:native("3",102,"LoanManage")};
    const before=registry.getLoan(loanId);
    await expect(registry.applyEvent(event)).rejects.toThrow("SERVICING_SCHEDULE_REQUIRED");
    await expect(registry.applyEvent({...event,native:native("3",102,"LoanPay"),servicing:{nextPaymentDueAt:now}})).rejects.toThrow("INVALID_NATIVE_TRANSACTION_TYPE");
    expect(registry.getLoan(loanId)).toEqual(before);
    await registry.applyEvent({...event,servicing:{nextPaymentDueAt:now}});
    expect(registry.getLoan(loanId)).toMatchObject({next_due_time:now,ever_impaired:1});
    now=origin+31*day;
    await registry.applyEvent({eventId:"native-schedule-unimpair",kind:"UNIMPAIRMENT",loanId,occurredAt:now,
      servicing:{nextPaymentDueAt:origin+90*day},history:{complete:true,originHash,previousEventId:event.eventId},native:native("4",103,"LoanManage")});
    expect(registry.getLoan(loanId)).toMatchObject({next_due_time:origin+90*day,ever_impaired:1});
  });
});

// Add this import to tests/registry.test.ts. The cases reuse its existing setup helpers.
import { createExecutionStore, createReturnStore, type ReturnGuard, type ReturnFailureEvidence } from "../packages/registry/src/index.ts";

describe("durable request execution attempts", () => {
  const stakeAttempt = {
    phase: "STAKE" as const, attemptHash: "sim:stake-attempt", signedBlob: "sim:signed-stake",
    sequence: 10, lastLedgerSequence: 100, commitment: contentHash(request),
  };
  function acquired(store: ReturnType<typeof createExecutionStore>, owner: string) {
    const guard = store.claimExecution(request.request_id, owner);
    if (!guard.acquired) throw new Error("Expected execution ownership");
    return guard;
  }
  it("has one executor and one immutable attempt per request phase", () => {
    const s = setup(); s.registry.reserveRequest(request);
    const store = createExecutionStore(s.db, { now: () => new Date(origin * 1000) });
    const guard = acquired(store, "instance-A");
    expect(store.claimExecution(request.request_id, "instance-A")).toEqual(guard);
    expect(store.claimExecution(request.request_id, "instance-B").acquired).toBe(false);
    const saved = store.persistAttempt(guard, stakeAttempt);
    expect(store.persistAttempt(guard, stakeAttempt)).toEqual(saved);
    for (const delta of [{ signedBlob: "sim:changed" }, { attemptHash: "sim:changed" },
      { sequence: 11 }, { lastLedgerSequence: 101 }, { commitment: "sha256:" + "a".repeat(64) }]) {
      expect(() => store.persistAttempt(guard, { ...stakeAttempt, ...delta })).toThrow("IMMUTABLE_ATTEMPT_CONFLICT");
    }
    expect(s.db.prepare("SELECT count(*) n FROM credit_attempts").get().n).toBe(1);
  });
  it("fences stale owners after an explicit release and reacquisition", () => {
    const s = setup(); s.registry.reserveRequest(request);
    const store = createExecutionStore(s.db, { now: () => new Date(origin * 1000) });
    const a = acquired(store, "instance-A"); store.persistAttempt(a, stakeAttempt);
    expect(store.releaseExecution(a)).toBe(true);
    const b = acquired(store, "instance-B"); expect(b.fence).toBe(a.fence + 1);
    expect(() => store.persistAttempt(a, stakeAttempt)).toThrow("STALE_EXECUTION_GUARD");
    expect(() => store.releaseExecution(a)).toThrow("STALE_EXECUTION_GUARD");
    expect(store.persistAttempt(b, stakeAttempt).attemptHash).toBe(stakeAttempt.attemptHash);
  });
  it("updates attempt status without releasing any accounting reservation", () => {
    const s = setup(); s.registry.reserveRequest(request);
    const store = createExecutionStore(s.db, { now: () => new Date(origin * 1000) });
    const guard = acquired(store, "instance-A"); store.persistAttempt(guard, stakeAttempt);
    const before = s.snapshot();
    store.markAttemptState(guard, "STAKE", "SUBMITTED");
    store.markAttemptState(guard, "STAKE", "RECONCILING");
    expect(() => store.markAttemptState(guard, "STAKE", "PERSISTED")).toThrow("INVALID_ATTEMPT_TRANSITION");
    store.markAttemptState(guard, "STAKE", "FAILED");
    expect(s.snapshot()).toEqual(before);
    expect(() => store.markAttemptState(guard, "STAKE", "VALIDATED")).toThrow("INVALID_ATTEMPT_TRANSITION");
    expect(() => store.persistAttempt(guard, { ...stakeAttempt, attemptHash: "sim:replacement" })).toThrow("IMMUTABLE_ATTEMPT_CONFLICT");
  });
  it("requires stake before a new LoanSet attempt and resumes the same saved attempt after expiry", () => {
    const s = setup(); s.registry.reserveRequest(request); let now = origin * 1000;
    const store = createExecutionStore(s.db, { now: () => new Date(now) });
    const guard = acquired(store, "instance-A");
    const loan = { ...stakeAttempt, phase: "LOAN" as const, attemptHash: "sim:loan-attempt",
      signedBlob: "sim:signed-loan", sequence: 11, commitment: "sha256:" + "a".repeat(64) };
    expect(() => store.persistAttempt(guard, loan)).toThrow("STAKE_REQUIRED");
    s.db.prepare("UPDATE credit_requests SET stake_hash='sim:verified',state='STAKE_VALIDATED' WHERE request_id=?").run(request.request_id);
    const fields={TransactionType:"LoanSet",PrincipalRequested:"2000",Sequence:11,LastLedgerSequence:100};
    loan.commitment=store.freezePreparedAction(guard,{commercialTermsHash:request.commercial_terms_hash,preparedFields:fields});
    expect(store.freezePreparedAction(guard,{commercialTermsHash:request.commercial_terms_hash,preparedFields:fields})).toBe(loan.commitment);
    expect(()=>store.freezePreparedAction(guard,{commercialTermsHash:request.commercial_terms_hash,preparedFields:{...fields,Sequence:12}})).toThrow("PREPARED_ACTION_CONFLICT");
    const saved = store.persistAttempt(guard, loan);
    now = Date.parse(request.expires_at) + 1000;
    s.db.prepare("UPDATE credit_requests SET state='ACTIVE' WHERE request_id=?").run(request.request_id);
    expect(store.persistAttempt(guard, loan)).toEqual(saved);
  });
  it("reads the same attempt and executor claim after file reopen", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "shellfish-attempts-")); folders.push(dir);
    const file = resolve(dir, "test.db"), s = setup(scenario, file);
    s.registry.reserveRequest(request);
    const store = createExecutionStore(s.db, { now: () => new Date(origin * 1000) });
    const guard = acquired(store, "instance-A"), saved = store.persistAttempt(guard, stakeAttempt);
    store.markAttemptState(guard, "STAKE", "RECONCILING");
    s.db.close(); connections.pop();
    const reopened = new Database(file); connections.push(reopened);
    const recovered = createExecutionStore(reopened, { now: () => new Date(origin * 1000) });
    expect(recovered.getAttempt(request.request_id, "STAKE")).toEqual({ ...saved, state: "RECONCILING" });
    expect(recovered.claimExecution(request.request_id, "instance-B").acquired).toBe(false);
  });
});

describe("durable REP issuer returns", () => {
  async function owed(s=setup(), n="one", extra:Partial<typeof request>={}) {
    const input={...variant(`return-${n}`,"10000"),...extra};
    s.registry.reserveRequest(input);
    const burn=stake(input.request_id);burn.stake!.amountU=s.registry.getRequest(input.request_id).originalBondU;
    burn.stake!.requestHash=contentHash(input);burn.stake!.repAsset=input.rep_asset;
    await s.registry.applyEvent(burn);
    await s.registry.applyEvent({eventId:`failed:${n}`,kind:"FAIL_AFTER_BURN",requestId:input.request_id,occurredAt:origin,conclusive:true});
    const credit=s.registry.getReturnCredits({principalId:input.principal_id,network:input.network,asset:input.asset}).find(c=>c.requestId===input.request_id)!;
    return {s,credit,store:createReturnStore(s.db)};
  }
  function guard(store:ReturnType<typeof createReturnStore>, creditId:string, owner="return-worker-A"):ReturnGuard {
    const result=store.claimReturn(creditId,owner);if(!result.acquired)throw new Error("Expected return ownership");return result;
  }
  function signed(store:ReturnType<typeof createReturnStore>,g:ReturnGuard,n="one",sequence=10) {
    return {attemptHash:`sim:return-${n}`,signedBlob:`sim:signed-return-${n}`,firstLedgerSequence:100,
      preparedFields:store.prepareReturnPayment(g,{sequence,lastLedgerSequence:104,feeDrops:"12"})};
  }
  function returned(creditId:string,amountU:string,attemptHash:string,eventId="returned"):RegistryEvent {
    return {eventId,kind:"RETURN_VALIDATED",creditId,occurredAt:origin,
      returned:{attemptHash,amountU,repAsset:scenario.rep_asset,sender:scenario.rep_asset.issuer,
        destination:"sim:borrower-harbor-supply",partialPayment:false}};
  }
  it("persists an immutable credit-bound payment and retains pending REP for unknown outcomes",async()=>{
    const {s,credit,store}=await owed(),g=guard(store,credit.creditId),input=signed(store,g);
    const before=s.snapshot(),saved=store.persistReturnAttempt(g,input);
    expect(store.persistReturnAttempt(g,input)).toEqual(saved);
    expect(saved.preparedFields.Amount).toEqual({mpt_issuance_id:scenario.rep_asset.mpt_issuance_id,value:credit.amountU});
    expect(()=>store.persistReturnAttempt(g,{...input,signedBlob:"sim:changed"})).toThrow("IMMUTABLE_RETURN_CONFLICT");
    expect(()=>store.persistReturnAttempt(g,{...input,attemptHash:"sim:new"})).toThrow("RETURN_RECONCILIATION_REQUIRED");
    store.markReturnUncertain(g,saved.attemptHash,"SUBMITTED");store.markReturnUncertain(g,saved.attemptHash,"RECONCILING");
    expect(()=>store.markReturnUncertain(g,saved.attemptHash,"SUBMITTED")).toThrow("INVALID_RETURN_TRANSITION");
    expect(s.snapshot()).toEqual(before);expect(s.registry.getReturnCredits(s.binding)[0].state).toBe("OWED");
  });
  it("rejects alternate delivery, issuer, memo, ticket, amount and native-looking simulation attempts",async()=>{
    const {credit,store}=await owed(),g=guard(store,credit.creditId),input=signed(store,g);
    for(const fields of [{Flags:131072},{Destination:"sim:someone-else"},{Account:"sim:other-issuer"},
      {Amount:{mpt_issuance_id:scenario.rep_asset.mpt_issuance_id,value:"1"}},{Memos:[]},{TicketSequence:5},
      {SendMax:"1"},{DeliverMin:"1"},{Paths:[]},{TxnSignature:"AA"},{Delegate:"sim:delegate"},{Fee:"0"}]) {
      expect(()=>store.persistReturnAttempt(g,{...input,preparedFields:{...input.preparedFields,...fields}})).toThrow("INVALID_RETURN_PAYMENT");
    }
    expect(()=>store.persistReturnAttempt(g,{...input,attemptHash:"A".repeat(64),signedBlob:"ABCD"})).toThrow("SIMULATION_CANNOT_CLAIM_NATIVE_ATTEMPT");
    expect(store.getReturnAttempt(credit.creditId)).toBeNull();
  });
  it("omits NetworkID on Devnet and includes it only for IDs above 1024",async()=>{
    const {credit,store}=await owed(),g=guard(store,credit.creditId),input=signed(store,g);
    for(const networkId of [0,1,2,1024]) {
      expect(store.prepareReturnPayment(g,{sequence:10,lastLedgerSequence:104,feeDrops:"12",networkId})).not.toHaveProperty("NetworkID");
      expect(()=>store.persistReturnAttempt(g,{...input,preparedFields:{...input.preparedFields,NetworkID:networkId}})).toThrow("INVALID_RETURN_PAYMENT");
    }
    expect(store.prepareReturnPayment(g,{sequence:10,lastLedgerSequence:104,feeDrops:"12",networkId:1025}).NetworkID).toBe(1025);
    for(const networkId of [-1,1.5,0x100000000])expect(()=>store.prepareReturnPayment(g,{sequence:10,lastLedgerSequence:104,feeDrops:"12",networkId})).toThrow("INVALID_RETURN_NETWORK");
  });
  it("releases a worker without releasing its unresolved issuer lane and fences a recovered owner",async()=>{
    const {s,credit,store}=await owed(),other=await owed(s,"two"),a=guard(store,credit.creditId);
    const input=signed(store,a);store.persistReturnAttempt(a,input);
    expect(store.claimReturn(other.credit.creditId,"return-worker-B").acquired).toBe(false);
    store.releaseReturnWorker(a);
    expect(store.claimReturn(other.credit.creditId,"return-worker-B")).toMatchObject({acquired:false,activeCreditId:credit.creditId,owner:null});
    const b=guard(store,credit.creditId,"return-worker-B");expect(b.fence).toBe(a.fence+1);
    expect(()=>store.persistReturnAttempt(a,input)).toThrow("STALE_RETURN_GUARD");
    expect(()=>store.releaseReturnWorker(a)).toThrow("STALE_RETURN_GUARD");
    expect(store.persistReturnAttempt(b,input).attemptHash).toBe(input.attemptHash);
  });
  it("recovers the exact saved blob and blocked issuer lane after file reopen",async()=>{
    const folder=mkdtempSync(resolve(tmpdir(),"shellfish-returns-"));folders.push(folder);
    const file=resolve(folder,"return.db"),s=setup(scenario,file),{credit,store}=await owed(s),other=await owed(s,"two");
    const g=guard(store,credit.creditId),saved=store.persistReturnAttempt(g,signed(store,g));
    store.markReturnUncertain(g,saved.attemptHash,"RECONCILING");store.releaseReturnWorker(g);
    s.db.close();connections.pop();const db=new Database(file);connections.push(db);createRegistry(db);
    const recovered=createReturnStore(db);
    expect(recovered.getReturnAttempt(credit.creditId)).toEqual({...saved,state:"RECONCILING"});
    expect(recovered.claimReturn(other.credit.creditId,"return-worker-C").acquired).toBe(false);
    const claim=guard(recovered,credit.creditId,"return-worker-C");
    expect(recovered.persistReturnAttempt(claim,signed(recovered,claim))).toEqual({...saved,state:"RECONCILING"});
  });
  it("atomically pays the credit, finalizes its attempt and frees the issuer exactly once",async()=>{
    const {s,credit,store}=await owed(),other=await owed(s,"two"),g=guard(store,credit.creditId);
    const saved=store.persistReturnAttempt(g,signed(store,g)),event=returned(credit.creditId,credit.amountU,saved.attemptHash);
    const before=s.snapshot();await s.registry.applyEvent(event);const after=s.snapshot();await s.registry.applyEvent(event);
    expect(s.snapshot()).toEqual(after);expect(BigInt(after.reputation.available_u)-BigInt(before.reputation.available_u)).toBe(BigInt(credit.amountU));
    expect(store.getReturnAttempt(credit.creditId)?.state).toBe("VALIDATED");
    expect(()=>store.claimReturn(credit.creditId,"return-worker-B")).toThrow("RETURN_ALREADY_PAID");
    expect(store.releaseReturnWorker(g)).toBe(false);
    const next=guard(store,other.credit.creditId,"return-worker-B");
    expect(store.releaseReturnWorker(g)).toBe(false);
    expect(store.claimReturn(other.credit.creditId,"return-worker-C").acquired).toBe(false);
    expect(()=>store.persistReturnAttempt(next,signed(store,next,"two",10))).toThrow("INVALID_RETURN_SEQUENCE");
    expect(store.persistReturnAttempt(next,signed(store,next,"two",11)).sequence).toBe(11);
  });
  it("rejects mismatched and pre-credit outcomes without finalizing anything",async()=>{
    const {s,credit,store}=await owed(),g=guard(store,credit.creditId),saved=store.persistReturnAttempt(g,signed(store,g));
    const before=s.snapshot(),event=returned(credit.creditId,credit.amountU,saved.attemptHash);
    await expect(s.registry.applyEvent({...event,returned:{...event.returned!,attemptHash:"sim:wrong"}})).rejects.toThrow("RETURN_ATTEMPT_MISMATCH");
    await expect(s.registry.applyEvent({...event,occurredAt:origin-1})).rejects.toThrow("RETURN_PREDATES_CREDIT");
    expect(s.snapshot()).toEqual(before);expect(store.getReturnAttempt(credit.creditId)?.state).toBe("PERSISTED");
  });
  it("restores the fixed 720 REP bond plus 12 appreciation through the saved return",async()=>{
    const a=await active();a.advance(origin+90*day);
    await a.registry.applyEvent(pay(a,"full-pay-return-queue",origin+90*day,"200000"));
    const credit=a.registry.getReturnCredits(a.binding)[0],store=createReturnStore(a.db),g=guard(store,credit.creditId);
    expect(credit).toMatchObject({amountU:"732000000",growthU:"12000000",state:"OWED"});
    const saved=store.persistReturnAttempt(g,signed(store,g,"full-repay"));
    const event=returned(credit.creditId,credit.amountU,saved.attemptHash,"saved-full-repay-return");event.occurredAt=origin+90*day;
    await a.registry.applyEvent(event);
    expect(a.snapshot().reputation).toMatchObject({available_u:"772000000",pending_return_u:"0",bonded_u:"240000000",growth_u:"12000000"});
    expect(a.registry.getRequest(request.request_id).state).toBe("REPAID");
    expect(store.getReturnAttempt(credit.creditId)?.state).toBe("VALIDATED");
  });
  it("keeps append-only attempt history and enforces the replacement bound",async()=>{
    const {s,credit,store}=await owed(),g=guard(store,credit.creditId),before=s.snapshot();
    for(let n=1;n<=3;n++) {
      const saved=store.persistReturnAttempt(g,signed(store,g,`${n}`));
      const failed=await store.resolveNotApplied(g,saved.attemptHash,{kind:"SIMULATED_NOT_APPLIED"});
      expect(await store.resolveNotApplied(g,saved.attemptHash,{kind:"SIMULATED_NOT_APPLIED"})).toEqual(failed);
      await expect(s.registry.applyEvent(returned(credit.creditId,credit.amountU,saved.attemptHash,`late-${n}`))).rejects.toThrow("RETURN_ATTEMPT_MISMATCH");
    }
    expect(()=>store.persistReturnAttempt(g,signed(store,g,"four"))).toThrow("RETURN_ATTEMPT_LIMIT");
    expect(store.getReturnHistory(credit.creditId).map(a=>a.attemptNumber)).toEqual([1,2,3]);expect(s.snapshot()).toEqual(before);
  });
  it("serializes one issuer across REP issuances, with other issuers and networks independent",async()=>{
    const {s,credit,store}=await owed(),g=guard(store,credit.creditId);store.persistReturnAttempt(g,signed(store,g));
    const make=async(n:string,issuer:string,network=scenario.network)=>{
      const seed=structuredClone(scenario);seed.principal_id=`principal-${n}`;seed.network=network;
      seed.facility.facility_id=`facility-${n}`;seed.opening_loans[0].loan_id=`opening-${n}`;
      seed.rep_asset={...seed.rep_asset,issuer,mpt_issuance_id:`sim:rep-${n}`};
      const borrower=`sim:borrower-${n}`;s.registry.seedScenario(seed,borrower);
      const input={...variant(`other-${n}`,"10000"),principal_id:seed.principal_id,facility_id:seed.facility.facility_id,
        network,rep_asset:seed.rep_asset};s.registry.reserveRequest(input);
      const burn=stake(input.request_id);burn.stake={amountU:s.registry.getRequest(input.request_id).originalBondU,
        repAsset:seed.rep_asset,sender:borrower,destination:issuer,requestHash:contentHash(input),partialPayment:false};
      await s.registry.applyEvent(burn);await s.registry.applyEvent({eventId:`failed:${n}`,kind:"FAIL_AFTER_BURN",requestId:input.request_id,occurredAt:origin,conclusive:true});
      return s.registry.getReturnCredits({principalId:seed.principal_id,network,asset:seed.loan_asset})[0];
    };
    const same=await make("same",scenario.rep_asset.issuer),other=await make("issuer","sim:other-issuer"),network=await make("network",scenario.rep_asset.issuer,"other-devnet");
    expect(store.claimReturn(same.creditId,"worker-same").acquired).toBe(false);
    expect(store.claimReturn(other.creditId,"worker-other").acquired).toBe(true);
    expect(store.claimReturn(network.creditId,"worker-network").acquired).toBe(true);
  });
  it("allows only one of two simultaneous SQLite issuer claims",async()=>{
    const folder=mkdtempSync(resolve(tmpdir(),"shellfish-return-race-"));folders.push(folder);
    const file=resolve(folder,"return.db"),s=setup(scenario,file),one=await owed(s),two=await owed(s,"two");s.db.pragma("journal_mode = WAL");
    const barrier=new SharedArrayBuffer(4),control=new Int32Array(barrier);let readyCount=0;
    const results=[one.credit.creditId,two.credit.creditId].map((creditId,i)=>new Promise<boolean>((done,reject)=>{
      const worker=new Worker(`const {workerData,parentPort}=require('node:worker_threads');const {createRequire}=require('node:module');
        const req=createRequire(workerData.packagePath);const Database=req('better-sqlite3');
        (async()=>{const {createRegistry,createReturnStore}=await import(workerData.registryUrl);const db=new Database(workerData.file);createRegistry(db);
        const store=createReturnStore(db);parentPort.postMessage({ready:true});Atomics.wait(new Int32Array(workerData.barrier),0,0);
        const claim=store.claimReturn(workerData.creditId,workerData.owner);parentPort.postMessage({acquired:claim.acquired});db.close();})();`,
        {eval:true,workerData:{packagePath:resolve(root,"services/api/package.json"),registryUrl:new URL("../packages/registry/dist/index.js",import.meta.url).href,file,barrier,creditId,owner:`worker-${i}`}});
      let result:boolean|undefined;worker.on("message",msg=>{if(msg.ready){readyCount++;if(readyCount===2){Atomics.store(control,0,1);Atomics.notify(control,0);}}else result=msg.acquired;});
      worker.on("error",reject);worker.on("exit",code=>{if(code===0&&result!==undefined)done(result);else reject(new Error(`Worker exited ${code}`));});
    }));
    expect((await Promise.all(results)).filter(Boolean)).toHaveLength(1);
  });

  async function nativeOwed(verifyReturnFailure?:NonNullable<Parameters<typeof createReturnStore>[1]>["verifyReturnFailure"]) {
    const db=new Database(":memory:");connections.push(db);
    const registry=createRegistry(db,{now:()=>new Date(origin*1000),verifyNativePortfolio:async()=>{},verifyNativeEvent:async()=>{}});
    const seed=structuredClone(scenario) as Record<string,any>;delete seed.provenance;delete seed.native_signing_permitted;
    seed.mode="LIVE_DEVNET";seed.opening_loans=[];seed.opening.active_principal_minor="0";seed.opening.facility_committed_minor="0";
    seed.opening.reputation.bonded_u="0";seed.opening.reputation.available_u=seed.opening.reputation.seed_u;
    seed.rep_asset={mpt_issuance_id:"A".repeat(48),issuer:"rMockIssuer",asset_scale:6};
    await registry.initializeNativePortfolio(seed,"rMockBorrower",{testOnly:true});
    const input={...variant("native-return","10000"),mode:"LIVE_DEVNET" as const,rep_asset:seed.rep_asset};registry.reserveRequest(input);
    await registry.applyEvent({eventId:"native-stake",kind:"STAKE_VALIDATED",requestId:input.request_id,occurredAt:origin,
      stake:{amountU:registry.getRequest(input.request_id).originalBondU,repAsset:seed.rep_asset,sender:"rMockBorrower",destination:"rMockIssuer",requestHash:contentHash(input),partialPayment:false},
      native:{txHash:"A".repeat(64),ledgerIndex:90,transactionIndex:0,validated:true,result:"tesSUCCESS",transactionType:"Payment"}});
    await registry.applyEvent({eventId:"native-failure",kind:"FAIL_AFTER_BURN",requestId:input.request_id,occurredAt:origin,conclusive:true,
      native:{txHash:"B".repeat(64),ledgerIndex:91,transactionIndex:0,validated:true,result:"CONCLUSIVE_FAILURE",transactionType:"LoanSet"}});
    const binding={principalId:seed.principal_id,network:seed.network,asset:seed.loan_asset},credit=registry.getReturnCredits(binding)[0];
    const store=createReturnStore(db,{verifyReturnFailure}),g=guard(store,credit.creditId);
    const inputReturn={...signed(store,g),attemptHash:"C".repeat(64),signedBlob:"ABCD"};
    return {db,registry,binding,credit,store,g,inputReturn};
  }
  it("requires trusted native failure verification, full history, final ledgers and unchanged sequence",async()=>{
    const a=await nativeOwed(),saved=a.store.persistReturnAttempt(a.g,a.inputReturn),before=a.registry.getPortfolio(a.binding);
    const proof:ReturnFailureEvidence={kind:"EXPIRED_NOT_FOUND",txHash:saved.attemptHash,validatedLedgerIndex:105,historyFromLedger:100,historyToLedger:105,accountSequence:10};
    await expect(a.store.resolveNotApplied(a.g,saved.attemptHash,proof)).rejects.toThrow("RETURN_FAILURE_VERIFIER_REQUIRED");
    for(const change of [{validatedLedgerIndex:104},{historyFromLedger:101},{historyToLedger:104}]) {
      await expect(a.store.resolveNotApplied(a.g,saved.attemptHash,{...proof,...change})).rejects.toThrow("INVALID_RETURN_RECONCILIATION");
    }
    await expect(a.store.resolveNotApplied(a.g,saved.attemptHash,{...proof,accountSequence:11})).rejects.toThrow("ISSUER_SEQUENCE_DIVERGED");
    await expect(a.store.resolveNotApplied(a.g,saved.attemptHash,{kind:"SIMULATED_NOT_APPLIED"})).rejects.toThrow("INVALID_RETURN_RECONCILIATION");
    expect(a.registry.getPortfolio(a.binding)).toEqual(before);expect(a.store.getReturnAttempt(a.credit.creditId)?.state).toBe("PERSISTED");
  });
  it("rejects a native return without a saved attempt",async()=>{
    const a=await nativeOwed(),before=a.registry.getPortfolio(a.binding);
    await expect(a.registry.applyEvent({eventId:"unsaved-native-return",creditId:a.credit.creditId,kind:"RETURN_VALIDATED",occurredAt:origin,
      returned:{amountU:a.credit.amountU,repAsset:a.store.getReturnInstruction(a.credit.creditId).repAsset,sender:"rMockIssuer",destination:"rMockBorrower",partialPayment:false},
      native:{txHash:"D".repeat(64),ledgerIndex:101,transactionIndex:0,validated:true,result:"tesSUCCESS",transactionType:"Payment"}}))
      .rejects.toThrow("NATIVE_RETURN_ATTEMPT_REQUIRED");
    expect(a.registry.getPortfolio(a.binding)).toEqual(before);expect(a.registry.getReturnCredits(a.binding)[0].state).toBe("OWED");
  });
  it("rechecks fencing after an asynchronous native verifier and rejects stale or failed verification",async()=>{
    let finish!:()=>void;const pending=new Promise<void>(done=>{finish=done;});
    const a=await nativeOwed(async()=>pending),saved=a.store.persistReturnAttempt(a.g,a.inputReturn);
    const proof:ReturnFailureEvidence={kind:"VALIDATED_FAILURE",txHash:saved.attemptHash,ledgerIndex:102,transactionIndex:0,result:"tecNO_AUTH"};
    const result=a.store.resolveNotApplied(a.g,saved.attemptHash,proof);
    a.store.releaseReturnWorker(a.g);guard(a.store,a.credit.creditId,"recovery-worker");finish();
    await expect(result).rejects.toThrow("STALE_RETURN_GUARD");expect(a.store.getReturnAttempt(a.credit.creditId)?.state).toBe("PERSISTED");
    const rejecting=createReturnStore(a.db,{verifyReturnFailure:async()=>{throw new Error("UNTRUSTED_LEDGER");}});
    const g=guard(rejecting,a.credit.creditId,"recovery-worker");
    await expect(rejecting.resolveNotApplied(g,saved.attemptHash,proof)).rejects.toThrow("UNTRUSTED_LEDGER");
  });
  it("can retry a failed native credit after another credit consumes an issuer sequence",async()=>{
    const a=await nativeOwed(async()=>{}),first=a.store.persistReturnAttempt(a.g,a.inputReturn);
    await a.store.resolveNotApplied(a.g,first.attemptHash,{kind:"VALIDATED_FAILURE",txHash:first.attemptHash,ledgerIndex:102,transactionIndex:0,result:"tecNO_AUTH"});
    a.store.releaseReturnWorker(a.g);
    const input={...variant("native-second","10000"),mode:"LIVE_DEVNET" as const,rep_asset:a.store.getReturnInstruction(a.credit.creditId).repAsset};
    a.registry.reserveRequest(input);
    await a.registry.applyEvent({eventId:"native-stake-two",kind:"STAKE_VALIDATED",requestId:input.request_id,occurredAt:origin,
      stake:{amountU:a.registry.getRequest(input.request_id).originalBondU,repAsset:input.rep_asset,sender:"rMockBorrower",destination:"rMockIssuer",requestHash:contentHash(input),partialPayment:false},
      native:{txHash:"1".repeat(64),ledgerIndex:103,transactionIndex:0,validated:true,result:"tesSUCCESS",transactionType:"Payment"}});
    await a.registry.applyEvent({eventId:"native-failure-two",kind:"FAIL_AFTER_BURN",requestId:input.request_id,occurredAt:origin,conclusive:true,
      native:{txHash:"2".repeat(64),ledgerIndex:104,transactionIndex:0,validated:true,result:"CONCLUSIVE_FAILURE",transactionType:"LoanSet"}});
    const credit=a.registry.getReturnCredits(a.binding).find(c=>c.requestId===input.request_id)!,g=guard(a.store,credit.creditId,"second-credit-worker");
    const second=a.store.persistReturnAttempt(g,{attemptHash:"E".repeat(64),signedBlob:"EEDD",firstLedgerSequence:104,
      preparedFields:a.store.prepareReturnPayment(g,{sequence:11,lastLedgerSequence:108,feeDrops:"12"})});
    await a.store.resolveNotApplied(g,second.attemptHash,{kind:"VALIDATED_FAILURE",txHash:second.attemptHash,ledgerIndex:106,transactionIndex:0,result:"tecNO_AUTH"});
    a.store.releaseReturnWorker(g);
    const recovery=guard(a.store,a.credit.creditId,"first-credit-recovery");
    const retry=a.store.persistReturnAttempt(recovery,{attemptHash:"F".repeat(64),signedBlob:"FFDD",firstLedgerSequence:108,
      preparedFields:a.store.prepareReturnPayment(recovery,{sequence:12,lastLedgerSequence:112,feeDrops:"12"})});
    expect(retry).toMatchObject({attemptNumber:2,sequence:12});
  });
  for(const kind of ["VALIDATED_FAILURE","EXPIRED_NOT_FOUND"] as const)it(`permits bounded replacement after verified ${kind}`,async()=>{
    let verified=0;const a=await nativeOwed(async()=>{verified++;}),saved=a.store.persistReturnAttempt(a.g,a.inputReturn);
    const proof:ReturnFailureEvidence=kind==="VALIDATED_FAILURE"?
      {kind,txHash:saved.attemptHash,ledgerIndex:102,transactionIndex:0,result:"tecNO_AUTH"}:
      {kind,txHash:saved.attemptHash,validatedLedgerIndex:105,historyFromLedger:100,historyToLedger:105,accountSequence:10};
    await a.store.resolveNotApplied(a.g,saved.attemptHash,proof);expect(verified).toBe(1);
    const sequence=kind==="VALIDATED_FAILURE"?11:10;
    const next={attemptHash:"D".repeat(64),signedBlob:"DCBA",firstLedgerSequence:105,
      preparedFields:a.store.prepareReturnPayment(a.g,{sequence,lastLedgerSequence:109,feeDrops:"15"})};
    expect(a.store.persistReturnAttempt(a.g,next)).toMatchObject({attemptNumber:2,state:"PERSISTED",sequence});
    const nativeReturn:RegistryEvent={eventId:"native-return",creditId:a.credit.creditId,kind:"RETURN_VALIDATED",occurredAt:origin,
      returned:{amountU:a.credit.amountU,repAsset:a.store.getReturnInstruction(a.credit.creditId).repAsset,sender:"rMockIssuer",destination:"rMockBorrower",partialPayment:false},
      native:{txHash:saved.attemptHash,ledgerIndex:106,transactionIndex:0,validated:true,result:"tesSUCCESS",transactionType:"Payment"}};
    await expect(a.registry.applyEvent(nativeReturn)).rejects.toThrow("RETURN_ATTEMPT_MISMATCH");
    nativeReturn.native!.txHash=next.attemptHash;
    await a.registry.applyEvent(nativeReturn);expect(a.store.getReturnAttempt(a.credit.creditId)?.state).toBe("VALIDATED");
    expect(a.registry.getReturnCredits(a.binding)[0].state).toBe("PAID");
  });
});
