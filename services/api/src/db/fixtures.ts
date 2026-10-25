import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createEvidenceService, type EvidenceService } from "@shellfish/evidence";
import { createCompatibilityService, type CompatibilityService } from "@shellfish/compatibility";
import { contentHash, type CreditRegistry } from "@shellfish/registry";
import { BorrowingMandate, EvidencePassport, LenderFacilityOffer, ScenarioFixture } from "@shellfish/schemas";
import { openCreditRegistry } from "./registry.js";

export interface FixtureCreditServices {
  evidence: EvidenceService;
  credit: CompatibilityService;
  registry?: CreditRegistry;
}
function fixtureInputs() {
  const folder=resolve(dirname(fileURLToPath(import.meta.url)),"../../../../fixtures");
  const load=(name:string):unknown=>JSON.parse(readFileSync(resolve(folder,name),"utf8"));
  return {scenario:ScenarioFixture.parse(load("scenario.json")),passport:EvidencePassport.parse(load("evidence-passport.json")),
    offer:LenderFacilityOffer.parse(load("offer-lender-a.json")),mandate:BorrowingMandate.parse(load("mandate.json"))};
}
export function createFixtureCreditServices(registry?:CreditRegistry):FixtureCreditServices {
  const {scenario,passport,offer}=fixtureInputs(),now=()=>new Date(scenario.clock);
  if(scenario.mode!=="SIMULATED_LOAN"||passport.mode!=="SIMULATED_LOAN"||offer.mode!=="SIMULATED_LOAN")throw new Error("Fixture sources must stay simulated");
  return {evidence:createEvidenceService({passports:[passport],hash:contentHash,now}),
    credit:createCompatibilityService({approvedOffers:[{offer,evidenceHash:passport.evidence_hash,evidenceVersion:passport.evidence_version}],hash:contentHash,now}),
    ...(registry?{registry}:{})};
}
/** Explicit simulation bootstrap for Vedant's entrypoint. Importing this module writes nothing. */
export function openFixtureCreditBackend(path:string):{
  services:FixtureCreditServices;db:ReturnType<typeof openCreditRegistry>["db"];signerLanes:ReturnType<typeof openCreditRegistry>["signerLanes"];registry:CreditRegistry;execution:ReturnType<typeof openCreditRegistry>["execution"];returns:ReturnType<typeof openCreditRegistry>["returns"];uiState:ReturnType<typeof openCreditRegistry>["uiState"];requestViews:ReturnType<typeof openCreditRegistry>["requestViews"];transaction:<T>(work:()=>T)=>T;close:()=>void;
} {
  const {scenario,mandate}=fixtureInputs();
  if(scenario.mode!=="SIMULATED_LOAN")throw new Error("Synthetic bootstrap cannot initialize native accounts");
  const backend=openCreditRegistry(path,{now:()=>new Date(scenario.clock),uiMode:"SIMULATED_LOAN",uiNetwork:scenario.network});
  try {
    backend.registry.seedScenario(scenario,mandate.xrpl_borrower);
    return {db:backend.db,signerLanes:backend.signerLanes,services:createFixtureCreditServices(backend.registry),registry:backend.registry,execution:backend.execution,returns:backend.returns,uiState:backend.uiState,requestViews:backend.requestViews,transaction:<T>(work:()=>T):T=>backend.db.transaction(work).immediate(),close:backend.close};
  } catch(error){backend.close();throw error;}
}
