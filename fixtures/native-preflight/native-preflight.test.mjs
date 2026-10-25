import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {pathToFileURL} from 'node:url';
import {FORMAT,discoverRepository,loadApprovedSchemas,loadRepositoryInputs,preflight as runPreflight} from './native-preflight.mjs';

const SOURCE_REPO=process.env.SOURCE_REPO||discoverRepository();
if(!SOURCE_REPO)throw new Error('Set SOURCE_REPO to a Shellfish checkout for source-bound tests');
const preflight=options=>runPreflight({repo:SOURCE_REPO,...options});
const now=new Date('2026-10-25T12:00:00Z');
const S=await loadApprovedSchemas(SOURCE_REPO);
const hash=value=>'sha256:'+createHash('sha256').update(S.canonicalJson(value)).digest('hex');
const omit=(v,keys)=>Object.fromEntries(Object.entries(v).filter(([key])=>!keys.includes(key)));
const termsKeys=['lender_id','borrower_id','facility_id','offer_id','asset','principal','apr_bps','rate_kind','term_days','fees','purpose','expires_at','schedule','network'];
function coherentDraft() {
  const original=loadRepositoryInputs(SOURCE_REPO),documents=structuredClone(original.documents);
  const asset={mpt_issuance_id:'A'.repeat(48)},rep={mpt_issuance_id:'B'.repeat(48),issuer:'rDraftIssuer',asset_scale:6};
  const portfolio=documents.portfolio;
  delete portfolio.provenance;delete portfolio.native_signing_permitted;
  for(const record of Object.values(documents)){record.mode='LIVE_DEVNET';record.network='devnet';}
  portfolio.loan_asset=asset;portfolio.rep_asset=rep;portfolio.facility.asset=asset;portfolio.opening_loans=[];
  Object.assign(portfolio.opening,{active_principal_minor:'0',reserved_principal_minor:'0',defaulted_principal_minor:'0',facility_committed_minor:'0',facility_reserved_minor:'0'});
  Object.assign(portfolio.opening.reputation,{available_u:'1000000000',reserved_u:'0',bonded_u:'0',pending_return_u:'0',growth_u:'0',forfeited_u:'0'});
  documents.mandate.xrpl_borrower='rDraftBorrower';documents.mandate.asset=asset;documents.mandate.rep_consent.rep_asset=rep;
  documents.mandate.principal_signature='unverified-draft-signature';
  documents.offer.asset=asset;documents.offer.lender_signature='unverified-draft-signature';
  documents.request.asset=asset;documents.request.rep_asset=rep;
  documents.evidence.known_exposure.asset=asset;documents.evidence.known_exposure.amount='0.00';documents.evidence.signature='unverified-draft-signature';
  for(const record of [documents.mandate,documents.offer,documents.request,documents.evidence])record.expires_at='2026-10-26T12:00:00Z';
  documents.native_asset_metadata={mode:'LIVE_DEVNET',network:'devnet',loan_asset:asset,loan_asset_scale:0,rep_asset:rep};
  const selection={format:FORMAT,mode:'LIVE_DEVNET',network:'devnet',network_id:2,endpoint:'wss://example.invalid',
    principal_id:portfolio.principal_id,borrower_account:'rDraftBorrower',broker_id:'C'.repeat(64),loan_asset:asset,loan_asset_scale:0,money_scale:'100',rep_asset:rep,sdk_pin:'5.3.0',offer_id:documents.offer.offer_id,facility_id:documents.offer.facility_id,
    terms:{principal_minor:'200000',fees_minor:'0',apr_bps:550,term_days:90,payment_total:1,payment_interval_seconds:7776000,grace_seconds:0},
    required_signer_route:{status:'PENDING_VEDANT'},native_schedule:{status:'PENDING_VEDANT'}};
  refresh(documents);return {selection,documents,contract:original.contract,now};
}
function refresh(d) {
  d.evidence.evidence_hash=hash(omit(d.evidence,['signature','evidence_hash']));
  d.mandate.mandate_hash=hash(omit(d.mandate,['principal_signature','mandate_hash']));
  d.offer.commercial_terms_hash=hash(Object.fromEntries(Object.entries(d.offer).filter(([key])=>termsKeys.includes(key))));
  d.offer.offer_hash=hash(omit(d.offer,['lender_signature','offer_hash']));
  Object.assign(d.request,{mandate_hash:d.mandate.mandate_hash,evidence_hash:d.evidence.evidence_hash,commercial_terms_hash:d.offer.commercial_terms_hash});
}
const codes=r=>r.configuration.findings.map(f=>f.code);
function noPermission(r){assert.equal(r.native_ready,false);assert.equal(r.can_sign,false);assert.equal(r.can_submit,false);assert.equal(r.native_evidence.status,'NATIVE_EVIDENCE_NOT_AVAILABLE');}

test('unchanged accepted fixture parses but cannot claim native readiness',async()=>{
  const before=readFileSync(SOURCE_REPO+'/fixtures/network-signing-contract.json');
  const r=await preflight({now});assert.equal(r.accepted_fixture.status,'PASS');assert.equal(r.accepted_fixture.mode,'SIMULATED_LOAN');assert.equal(r.configuration.status,'CONFIGURATION_INCOMPLETE');noPermission(r);
  assert.deepEqual(readFileSync(SOURCE_REPO+'/fixtures/network-signing-contract.json'),before);
});
test('coherent draft is configuration-consistent but every permission stays false',async()=>{
  const r=await preflight(coherentDraft());assert.deepEqual(r.configuration.findings,[]);assert.equal(r.configuration.status,'CONFIGURATION_CONSISTENT_BUT_UNVERIFIED');assert.equal(r.contract_acceptance.required_signer_route,'PENDING_VEDANT');noPermission(r);
});
test('missing broker prevents a consistent report',async()=>{const x=coherentDraft();delete x.selection.broker_id;const r=await preflight(x);assert.ok(codes(r).includes('MISSING_SELECTION'));assert.equal(r.configuration.status,'CONFIGURATION_INCOMPLETE');});
test('old simulation fixture relabeled as selection is denied',async()=>{const x=coherentDraft();x.selection=x.contract;const r=await preflight(x);assert.ok(codes(r).includes('NATIVE_MODE_REQUIRED'));assert.ok(codes(r).includes('DRAFT_FORMAT_MISMATCH'));noPermission(r);});
test('source simulation labels cannot be promoted through selected strings',async()=>{const x=coherentDraft();x.documents=loadRepositoryInputs(SOURCE_REPO).documents;const r=await preflight(x);assert.ok(codes(r).includes('SOURCE_MODE_MISMATCH'));assert.equal(r.configuration.status,'CONFIGURATION_INCOMPLETE');});
test('synthetic issuer is rejected even with matching source values',async()=>{const x=coherentDraft();x.selection.rep_asset.issuer='sim:issuer';const r=await preflight(x);assert.ok(codes(r).includes('SYNTHETIC_ASSET_IN_NATIVE_SELECTION'));noPermission(r);});
test('REP precision and source loan scale mismatches fail',async()=>{
  for(const mutate of [x=>{x.selection.rep_asset={...x.selection.rep_asset,asset_scale:9};},x=>{x.selection.loan_asset_scale=2;}]){const x=coherentDraft();mutate(x);const r=await preflight(x);assert.ok(codes(r).some(c=>['INVALID_REP_ASSET_OR_SCALE','SOURCE_LOAN_SCALE_MISMATCH'].includes(c)));assert.equal(r.configuration.status,'CONFIGURATION_INCOMPLETE');}
});
test('unrepresentable native principal never rounds down',async()=>{const x=coherentDraft();x.selection.terms.principal_minor='200001';const r=await preflight(x);assert.ok(codes(r).includes('NATIVE_PRECISION_MISMATCH'));noPermission(r);});
test('borrower, principal and asset identities bind to sources',async()=>{
  for(const mutate of [x=>{x.selection.borrower_account='rOtherBorrower';},x=>{x.selection.principal_id='business:other';},x=>{x.selection.loan_asset={mpt_issuance_id:'D'.repeat(48)};}]){const x=coherentDraft();mutate(x);const r=await preflight(x);assert.ok(codes(r).some(c=>['SOURCE_IDENTITY_OR_SCALE_MISMATCH','SOURCE_ASSET_MISMATCH'].includes(c)));assert.equal(r.configuration.status,'CONFIGURATION_INCOMPLETE');}
});
test('rate, fee and schedule mismatches bind to offer and mandate',async()=>{
  for(const mutate of [x=>{x.selection.terms.apr_bps=900;},x=>{x.selection.terms.fees_minor='3100';},x=>{x.selection.terms.payment_interval_seconds=1;}]){const x=coherentDraft();mutate(x);const r=await preflight(x);assert.ok(codes(r).includes('SOURCE_TERMS_MISMATCH'));assert.equal(r.configuration.status,'CONFIGURATION_INCOMPLETE');}
});
test('native source mutations need coherent commitments',async()=>{const x=coherentDraft();x.documents.offer.principal='1999.00';const r=await preflight(x);assert.ok(codes(r).includes('SOURCE_COMMITMENT_MISMATCH'));});
test('source documents must not be expired and opening native debt cannot disappear',async()=>{
  const x=coherentDraft();x.documents.offer.expires_at='2026-10-24T00:00:00Z';x.documents.portfolio.opening.active_principal_minor='100';const r=await preflight(x);assert.ok(codes(r).includes('SOURCE_EXPIRED_OR_INVALID'));assert.ok(codes(r).includes('NATIVE_OPENING_HISTORY_REQUIRED'));
});
test('arbitrary signer shape and claimed readiness fail closed',async()=>{const x=coherentDraft();x.selection.required_signer_route={status:'VERIFIED',route:'anything'};x.selection.native_ready=true;const r=await preflight(x);assert.ok(codes(r).includes('UNACCEPTED_CONTRACT_SHAPE'));assert.ok(codes(r).includes('UNVERIFIED_NATIVE_PERMISSION_CLAIM'));noPermission(r);});
function withPublicRuntime() {
  const x=coherentDraft(),s=x.selection,d=x.documents;
  s.principal_id='devnet:'+s.borrower_account;s.facility_id='devnet:'+s.broker_id;
  d.portfolio.principal_id=s.principal_id;d.portfolio.facility.facility_id=s.facility_id;
  d.mandate.principal_id=s.principal_id;d.mandate.allowed_lenders=['rDraftBroker'];
  d.offer.borrower_id=s.principal_id;d.offer.facility_id=s.facility_id;d.offer.lender_id='rDraftBroker';
  d.request.principal_id=s.principal_id;d.request.facility_id=s.facility_id;d.evidence.subject_id=s.principal_id;
  refresh(d);
  x.runtime={mode:'LIVE_DEVNET',live_ready:true,public_signing:{endpoint:s.endpoint,native_loan_asset:s.loan_asset,borrower_account:s.borrower_account,broker_account:'rDraftBroker',broker_id:s.broker_id,native_rep_asset:s.rep_asset,required_signer_route:'shellfish.authorizeExactAction→stake→dualSignLoanSet',native_schedule:{payment_total:1,payment_interval_sec:7776000,grace_period_sec:0},sdk_pin:'5.3.0'},explorer_base:'https://devnet.xrpl.org/transactions/'};
  return x;
}
test('actual GET network public shape maps without accepting live_ready as proof',async()=>{const r=await preflight(withPublicRuntime());assert.deepEqual(r.configuration.findings,[]);assert.equal(r.configuration.status,'CONFIGURATION_CONSISTENT_BUT_UNVERIFIED');assert.equal(r.public_runtime.status,'CHECKED_UNVERIFIED');assert.equal(r.public_runtime.fee_coverage,'NOT_EXPOSED_BY_PUBLIC_SIGNING');noPermission(r);});
test('runtime public schedule catches 30-day selection against 90-day source offer',async()=>{const x=withPublicRuntime();x.runtime.public_signing.native_schedule.payment_interval_sec=2592000;const r=await preflight(x);assert.ok(codes(r).includes('PUBLIC_RUNTIME_SCHEDULE_MISMATCH'));noPermission(r);});
test('runtime borrower, broker and asset values must bind to selection and sources',async()=>{const x=withPublicRuntime();x.runtime.public_signing.borrower_account='rOtherBorrower';x.runtime.public_signing.broker_account='rOtherBroker';x.runtime.public_signing.native_loan_asset={mpt_issuance_id:'E'.repeat(48)};const r=await preflight(x);assert.ok(codes(r).includes('PUBLIC_RUNTIME_SELECTION_MISMATCH'));assert.ok(codes(r).includes('PUBLIC_RUNTIME_PRINCIPAL_MAPPING_MISMATCH'));assert.ok(codes(r).includes('PUBLIC_RUNTIME_LENDER_MAPPING_MISMATCH'));});
test('actual material builder rejects conflicting defaults and emits canonical coherent commitments offline',async()=>{
  const {buildLiveAuthMaterials}=await import(pathToFileURL(SOURCE_REPO+'/services/api/src/live-materials.ts').href);
  const x=withPublicRuntime(),p=x.runtime.public_signing;
  const config={borrowerAddress:p.borrower_account,brokerAddress:p.broker_account,principalId:x.selection.principal_id,facilityId:x.selection.facility_id,principalMinor:'200000',maxStakeU:'760000000',loanBrokerId:p.broker_id,loanMptIssuanceId:p.native_loan_asset.mpt_issuance_id,repIssuanceId:p.native_rep_asset.mpt_issuance_id,repIssuerAddress:p.native_rep_asset.issuer,wsUrl:p.endpoint};
  // The builder uses public fields only. No seed, key, client or env is supplied.
  assert.throws(()=>buildLiveAuthMaterials(config,now),/LIVE_CONFIG_TERMS_MISMATCH/);
  const material=buildLiveAuthMaterials({...config,paymentIntervalSec:7776000,paymentTotal:1,loanOriginationFee:'0',loanServiceFee:'0'},now);
  assert.equal(material.mandate.mandate_hash,hash(omit(material.mandate,['principal_signature','mandate_hash'])));
  assert.equal(material.offer.offer_hash,hash(omit(material.offer,['lender_signature','offer_hash'])));
  assert.equal(material.offer.commercial_terms_hash,hash(Object.fromEntries(Object.entries(material.offer).filter(([key])=>termsKeys.includes(key)))));
  assert.equal(material.offer.term_days*86400,material.offer.schedule.payment_interval_seconds);
});
test('secret keys and raw input values never appear in reports',async()=>{
  const marker='TOP_SECRET_DO_NOT_PRINT_924';const x=coherentDraft();x.selection.private_key=marker;let r=await preflight(x);assert.ok(codes(r).includes('SECRET_INPUT_REJECTED'));assert.ok(!JSON.stringify(r).includes(marker));
  delete x.selection.private_key;x.selection.endpoint=`wss://user:${marker}@example.invalid`;x.selection.borrower_account=marker;r=await preflight(x);assert.ok(codes(r).includes('INVALID_OR_CREDENTIALLED_ENDPOINT'));assert.ok(!JSON.stringify(r).includes(marker));
});
test('prefixed and camelCase seed keys in unknown runtime env objects are rejected without leakage',async()=>{
  for(const key of ['borrowerSeed','brokerSeed','SHELLFISH_BORROWER_SEED','SHELLFISH_BROKER_SEED','privateKey','tx_blob']) {
    const marker='PRIVATE_TEST_VALUE_'+key,x=withPublicRuntime();x.runtime.extra={env:{[key]:marker}};
    const r=await preflight(x);assert.ok(codes(r).includes('SECRET_INPUT_REJECTED'));
    assert.ok(!JSON.stringify(r).includes(marker));assert.ok(!JSON.stringify(r).includes(key));noPermission(r);
  }
});
test('repository discovery uses explicit, env and ancestor paths without a personal default',()=>{
  assert.equal(discoverRepository(SOURCE_REPO),SOURCE_REPO);
  assert.equal(discoverRepository(undefined,{start:SOURCE_REPO+'/fixtures',env:{}}),SOURCE_REPO);
  assert.equal(discoverRepository(undefined,{start:'/',env:{SHELLFISH_REPO:SOURCE_REPO}}),SOURCE_REPO);
  assert.ok(!readFileSync(fileURLToPath(new URL('./native-preflight.mjs',import.meta.url)),'utf8').includes('/Users/'));
});
test('missing actual schemas and invalid clocks do not yield permission',async()=>{
  let r=await preflight({repo:'/nonexistent-shellfish-path',now});assert.ok(codes(r).includes('APPROVED_SCHEMA_NOT_AVAILABLE'));noPermission(r);
  r=await preflight({now:'invalid-clock'});assert.ok(codes(r).includes('INVALID_CHECK_CLOCK'));noPermission(r);
});
test('CLI gives redacted JSON and exit2 for incomplete input or bad arguments',()=>{
  const file=fileURLToPath(new URL('./native-preflight.mjs',import.meta.url));
  const normal=spawnSync(process.execPath,[file,'--repo',SOURCE_REPO],{encoding:'utf8'});assert.equal(normal.status,2);assert.equal(JSON.parse(normal.stdout).configuration.status,'CONFIGURATION_INCOMPLETE');
  const marker='TOP_SECRET_ARGUMENT_924',bad=spawnSync(process.execPath,[file,'--unknown',marker],{encoding:'utf8'});assert.equal(bad.status,2);assert.ok(!bad.stdout.includes(marker));assert.ok(!bad.stderr.includes(marker));JSON.parse(bad.stdout);
});
