import {createHash} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const FORMAT = 'SHELLFISH_NATIVE_SELECTION_DRAFT_V1';
const REQUIRED = ['format','mode','network','network_id','endpoint','principal_id','borrower_account','broker_id','loan_asset','loan_asset_scale','money_scale','rep_asset','sdk_pin','offer_id','facility_id','terms'];
const SECRET_KEYS = /(?:seed|privatekey|secretkey|apikey|mnemonic|password|authorization|signedblob|txblob)$|^(?:secret|wallet)$/i;
const TERMS_KEYS = ['lender_id','borrower_id','facility_id','offer_id','asset','principal','apr_bps','rate_kind','term_days','fees','purpose','expires_at','schedule','network'];
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const uint = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value);
const positive = value => uint(value) && BigInt(value) > 0n;
const same = (a,b) => JSON.stringify(sort(a)) === JSON.stringify(sort(b));
function sort(v) {return Array.isArray(v) ? v.map(sort) : isObject(v) ? Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,sort(x)])) : v;}
function containsSecretKey(v) {return isObject(v) ? Object.entries(v).some(([k,x])=>SECRET_KEYS.test(k.replace(/[^a-z0-9]/gi,''))||containsSecretKey(x)) : Array.isArray(v)&&v.some(containsSecretKey);}
function synthetic(v) {return typeof v === 'string' && /^(sim:|sig-(demo|simulated)|SYNTHETIC$)/i.test(v);}
function money(v) {if(typeof v !== 'string'||!/^(0|[1-9][0-9]*)\.[0-9]{2}$/.test(v)) return null; return BigInt(v.replace('.',''));}
function without(v,keys) {return Object.fromEntries(Object.entries(v).filter(([k])=>!keys.includes(k)));}
function sha256(v) {return createHash('sha256').update(v).digest('hex');}

/** Find an ancestor checkout, or accept an explicit --repo / SHELLFISH_REPO path. */
export function discoverRepository(explicit, {start=process.cwd(),env=process.env}={}) {
  if(typeof explicit==='string'&&explicit.trim())return resolve(explicit);
  if(typeof env.SHELLFISH_REPO==='string'&&env.SHELLFISH_REPO.trim())return resolve(env.SHELLFISH_REPO);
  for(const initial of [start,dirname(fileURLToPath(import.meta.url))]) {
    let current=resolve(initial);
    for(;;) {
      if(existsSync(resolve(current,'packages/schemas/src/c0.ts'))&&existsSync(resolve(current,'fixtures/network-signing-contract.json')))return current;
      const parent=dirname(current);if(parent===current)break;current=parent;
    }
  }
  return null;
}

/** Load the actual schema sources without installing a compiler or writing builds. */
export async function loadApprovedSchemas(repo) {
  const root = pathToFileURL(resolve(repo,'packages/schemas/src')+'/').href;
  const hook = registerHooks({resolve(specifier,context,nextResolve) {
    if(context.parentURL?.startsWith(root)&&specifier.startsWith('./')&&specifier.endsWith('.js')) {
      const source = new URL(specifier.slice(0,-3)+'.ts',context.parentURL);
      if(source.href.startsWith(root)&&existsSync(fileURLToPath(source))) return nextResolve(source.href,context);
    }
    return nextResolve(specifier,context);
  }});
  try {return await import(new URL('index.ts',root).href);} finally {hook.deregister();}
}

export function loadRepositoryInputs(repo) {
  const json = name => JSON.parse(readFileSync(resolve(repo,'fixtures',name),'utf8'));
  return {contract:json('network-signing-contract.json'),documents:{portfolio:json('scenario.json'),mandate:json('mandate.json'),offer:json('offer-lender-a.json'),request:json('reservation.json').request,evidence:json('evidence-passport.json')}};
}

/** Read-only consistency checks. The result never grants native execution. */
export async function preflight({repo, selection=null, documents=null, contract=null, runtime=null, now=new Date()}={}) {
  const findings = [];
  const add = (code,field,severity='ERROR') => findings.push({code,field,severity});
  const validClock=Number.isFinite(new Date(now).getTime());
  const report = {
    report_format:'SHELLFISH_NATIVE_PREFLIGHT_V1', checked_at:validClock?new Date(now).toISOString():null,
    approved_schema:{status:'NOT_AVAILABLE',source:'packages/schemas/src/index.ts',source_sha256:null,source_files:[]},
    accepted_fixture:{status:'NOT_AVAILABLE',mode:null},
    public_runtime:{status:'NOT_AVAILABLE',input_shape:'GET /v1/network',declared_live_ready_is_proof:false,fee_coverage:'NOT_EXPOSED_BY_PUBLIC_SIGNING'},
    configuration:{status:'CONFIGURATION_INCOMPLETE',known_selection_consistent:false,findings},
    contract_acceptance:{native_successor:'PENDING_VEDANT_ACK',required_signer_route:'PENDING_VEDANT',native_schedule:'PENDING_VEDANT'},
    native_evidence:{status:'NATIVE_EVIDENCE_NOT_AVAILABLE',checks_run:[]},
    native_ready:false,can_sign:false,can_submit:false,
    scope:'OFFLINE_CONFIGURATION_ONLY',
  };
  if(!validClock){add('INVALID_CHECK_CLOCK','checked_at');return report;}
  // Never serialize raw inputs, schema error messages, endpoint URLs or credentials.
  if(containsSecretKey(selection)||containsSecretKey(documents)||containsSecretKey(contract)||containsSecretKey(runtime)) {
    add('SECRET_INPUT_REJECTED','input');return report;
  }
  repo=discoverRepository(repo);
  if(!repo){add('REPOSITORY_NOT_SELECTED','repo');return report;}
  let S;
  try {
    S=await loadApprovedSchemas(repo);report.approved_schema.status='AVAILABLE';
    report.approved_schema.source_files=['index.ts','c0.ts','credit.ts','commitments.ts'].map(name=>({path:'packages/schemas/src/'+name,sha256:sha256(readFileSync(resolve(repo,'packages/schemas/src',name)))}));
    report.approved_schema.source_sha256=report.approved_schema.source_files[0].sha256;
  } catch {add('APPROVED_SCHEMA_NOT_AVAILABLE','approved_schema');}
  try {
    const defaults=loadRepositoryInputs(repo);contract??=defaults.contract;documents??=defaults.documents;
  } catch {if(!contract||!documents)add('SOURCE_DOCUMENTS_NOT_AVAILABLE','sources');}
  if(containsSecretKey(documents)||containsSecretKey(contract)) {add('SECRET_INPUT_REJECTED','sources');return report;}
  if(S&&contract) {
    const checked=S.NetworkSigningContractFixture.safeParse(contract);
    report.accepted_fixture.status=checked.success?'PASS':'FAIL';
    report.accepted_fixture.mode=checked.success?checked.data.mode:null;
    report.accepted_fixture.native_fields_missing=['endpoint','native_loan_asset','borrower_account','broker_id','native_rep_asset','required_signer_route','native_schedule'].filter(field=>contract[field]===null||contract[field]===undefined);
    if(!checked.success)add('ACCEPTED_PENDING_FIXTURE_SCHEMA_MISMATCH','accepted_fixture');
  }
  if(!isObject(selection)) {for(const field of REQUIRED)add('MISSING_SELECTION',`selection.${field}`);return report;}
  for(const field of REQUIRED)if(selection[field]===undefined||selection[field]===null||selection[field]==='')add('MISSING_SELECTION',`selection.${field}`);
  if(selection.format!==FORMAT)add('DRAFT_FORMAT_MISMATCH','selection.format');
  if(selection.mode!=='LIVE_DEVNET')add('NATIVE_MODE_REQUIRED','selection.mode');
  if(selection.native_ready===true||selection.can_sign===true||selection.can_submit===true)add('UNVERIFIED_NATIVE_PERMISSION_CLAIM','selection');
  if(selection.network!=='devnet')add('DEVNET_SELECTION_REQUIRED','selection.network');
  if(selection.network_id!==2)add('DECLARED_NETWORK_ID_MISMATCH','selection.network_id');
  if(selection.sdk_pin!==contract?.sdk_pin)add('SDK_PIN_MISMATCH','selection.sdk_pin');
  try {const endpoint=new URL(selection.endpoint);if(!['wss:','https:'].includes(endpoint.protocol)||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw Error();}catch{add('INVALID_OR_CREDENTIALLED_ENDPOINT','selection.endpoint');}
  for(const field of ['principal_id','borrower_account','broker_id','offer_id','facility_id']) {
    if(typeof selection[field]!=='string'||!selection[field])add('INVALID_IDENTITY_SELECTION',`selection.${field}`);
    else if(synthetic(selection[field]))add('SYNTHETIC_IDENTITY_IN_NATIVE_SELECTION',`selection.${field}`);
  }
  if(typeof selection.broker_id==='string'&&!/^[A-Fa-f0-9]{64}$/.test(selection.broker_id))add('INVALID_BROKER_ID','selection.broker_id');
  if(S&&!S.AssetRef.safeParse(selection.loan_asset).success)add('INVALID_LOAN_ASSET','selection.loan_asset');
  if(S&&!S.RepAssetRef.safeParse(selection.rep_asset).success)add('INVALID_REP_ASSET_OR_SCALE','selection.rep_asset');
  if(typeof selection.rep_asset?.mpt_issuance_id!=='string'||!/^[A-Fa-f0-9]{48}$/.test(selection.rep_asset.mpt_issuance_id))add('INVALID_NATIVE_REP_ISSUANCE_ID','selection.rep_asset.mpt_issuance_id');
  for(const [field,asset] of [['loan_asset',selection.loan_asset],['rep_asset',selection.rep_asset]]) {
    if(isObject(asset)&&Object.values(asset).some(synthetic))add('SYNTHETIC_ASSET_IN_NATIVE_SELECTION',`selection.${field}`);
  }
  if(!Number.isSafeInteger(selection.loan_asset_scale)||selection.loan_asset_scale<0||selection.loan_asset_scale>18)add('INVALID_DECLARED_LOAN_SCALE','selection.loan_asset_scale');
  if(!positive(selection.money_scale)||!/^10*$/.test(selection.money_scale))add('INVALID_MONEY_SCALE','selection.money_scale');
  if(selection.loan_asset?.currency==='XRP'&&selection.loan_asset_scale!==6)add('XRP_SCALE_MISMATCH','selection.loan_asset_scale');
  for(const field of ['required_signer_route','native_schedule']) {
    if(selection[field]!==undefined&&(!isObject(selection[field])||selection[field].status!=='PENDING_VEDANT'||Object.keys(selection[field]).some(k=>k!=='status')))add('UNACCEPTED_CONTRACT_SHAPE',`selection.${field}`);
  }
  if(runtime!==null) {
    const pub=runtime?.public_signing;
    report.public_runtime.status='CHECKED_UNVERIFIED';
    if(!isObject(runtime)||runtime.mode!=='LIVE_DEVNET'||!isObject(pub))add('PUBLIC_RUNTIME_NOT_NATIVE_CONFIGURED','public_runtime');
    else {
      const mappings=[['endpoint','endpoint'],['loan_asset','native_loan_asset'],['borrower_account','borrower_account'],['broker_id','broker_id'],['rep_asset','native_rep_asset'],['sdk_pin','sdk_pin']];
      for(const [selected,publicKey]of mappings)if(!same(selection[selected],pub[publicKey]))add('PUBLIC_RUNTIME_SELECTION_MISMATCH','public_runtime.public_signing.'+publicKey);
      if(selection.principal_id!==`devnet:${pub.borrower_account}`)add('PUBLIC_RUNTIME_PRINCIPAL_MAPPING_MISMATCH','selection.principal_id');
      if(selection.facility_id!==`devnet:${pub.broker_id}`)add('PUBLIC_RUNTIME_FACILITY_MAPPING_MISMATCH','selection.facility_id');
      if(typeof pub.broker_account!=='string'||!pub.broker_account||synthetic(pub.broker_account))add('INVALID_PUBLIC_BROKER_ACCOUNT','public_runtime.public_signing.broker_account');
      if(pub.required_signer_route!=='shellfish.authorizeExactAction→stake→dualSignLoanSet')add('UNRECOGNIZED_RUNTIME_SIGNER_ROUTE','public_runtime.public_signing.required_signer_route');
      if(!isObject(pub.native_schedule))add('MISSING_PUBLIC_NATIVE_SCHEDULE','public_runtime.public_signing.native_schedule');
      else for(const [selected,publicKey]of [['payment_total','payment_total'],['payment_interval_seconds','payment_interval_sec'],['grace_seconds','grace_period_sec']])if(!same(selection.terms?.[selected],pub.native_schedule[publicKey]))add('PUBLIC_RUNTIME_SCHEDULE_MISMATCH','public_runtime.public_signing.native_schedule.'+publicKey);
      report.contract_acceptance.required_signer_route='RUNTIME_SHAPE_KNOWN_OWNER_ACK_PENDING';
      report.contract_acceptance.native_schedule='RUNTIME_SHAPE_KNOWN_OWNER_ACK_PENDING';
    }
  }
  const t=selection.terms;
  if(!isObject(t))add('MISSING_NATIVE_TERMS','selection.terms');
  else {
    for(const field of ['principal_minor','fees_minor'])if(!uint(t[field])||(field==='principal_minor'&&!positive(t[field])))add('INVALID_ATOMIC_TERMS',`selection.terms.${field}`);
    for(const field of ['apr_bps','term_days','payment_total','payment_interval_seconds','grace_seconds'])if(!Number.isSafeInteger(t[field])||t[field]<0||(['term_days','payment_total','payment_interval_seconds'].includes(field)&&t[field]===0))add('INVALID_INTEGER_TERMS',`selection.terms.${field}`);
    if(t.payment_total!==1)add('UNSUPPORTED_PAYMENT_COUNT','selection.terms.payment_total');
    if(Number.isSafeInteger(t.term_days)&&Number.isSafeInteger(t.payment_interval_seconds)&&Number.isSafeInteger(t.payment_total)&&BigInt(t.term_days)*86400n!==BigInt(t.payment_interval_seconds)*BigInt(t.payment_total))add('SCHEDULE_TERM_MISMATCH','selection.terms');
    if(positive(selection.money_scale)&&Number.isSafeInteger(selection.loan_asset_scale)&&selection.loan_asset_scale>=0&&selection.loan_asset_scale<=18) {
      const scale=10n**BigInt(selection.loan_asset_scale),moneyScale=BigInt(selection.money_scale);
      for(const field of ['principal_minor','fees_minor'])if(uint(t[field])&&BigInt(t[field])*scale%moneyScale!==0n)add('NATIVE_PRECISION_MISMATCH',`selection.terms.${field}`);
    }
  }
  const d=documents;
  if(!isObject(d)){add('SOURCE_DOCUMENTS_NOT_AVAILABLE','sources');return report;}
  if(isObject(runtime?.public_signing)&&d.offer?.lender_id!==runtime.public_signing.broker_account)add('PUBLIC_RUNTIME_LENDER_MAPPING_MISMATCH','sources.offer.lender_id');
  const schemas=S?{portfolio:S.ScenarioFixture.omit({provenance:true,native_signing_permitted:true}),mandate:S.BorrowingMandate,offer:S.LenderFacilityOffer,request:S.ReservationFixture.shape.request,evidence:S.EvidencePassport}:{};
  for(const key of ['portfolio','mandate','offer','request','evidence']) {
    if(!isObject(d[key])) {add('MISSING_SOURCE_DOCUMENT',`sources.${key}`);continue;}
    if(schemas[key]&&!schemas[key].safeParse(d[key]).success)add('SOURCE_SCHEMA_MISMATCH',`sources.${key}`);
    if(d[key].mode!=='LIVE_DEVNET')add('SOURCE_MODE_MISMATCH',`sources.${key}.mode`);
    if(d[key].network!==selection.network)add('SOURCE_NETWORK_MISMATCH',`sources.${key}.network`);
  }
  const checks=[
    ['principal_id',d.portfolio?.principal_id],['principal_id',d.mandate?.principal_id],['principal_id',d.offer?.borrower_id],['principal_id',d.request?.principal_id],['principal_id',d.evidence?.subject_id],
    ['borrower_account',d.mandate?.xrpl_borrower],['offer_id',d.offer?.offer_id],['offer_id',d.request?.offer_id],['facility_id',d.offer?.facility_id],['facility_id',d.request?.facility_id],['facility_id',d.portfolio?.facility?.facility_id],
    ['loan_asset',d.portfolio?.loan_asset],['loan_asset',d.portfolio?.facility?.asset],['loan_asset',d.mandate?.asset],['loan_asset',d.offer?.asset],['loan_asset',d.request?.asset],['loan_asset',d.evidence?.known_exposure?.asset],
    ['rep_asset',d.portfolio?.rep_asset],['rep_asset',d.mandate?.rep_consent?.rep_asset],['rep_asset',d.request?.rep_asset],['money_scale',d.portfolio?.money_scale?.toString()],
  ];
  for(const [field,value]of checks)if(!same(selection[field],value))add(field.includes('asset')?'SOURCE_ASSET_MISMATCH':'SOURCE_IDENTITY_OR_SCALE_MISMATCH',`selection.${field}`);
  if(d.portfolio?.rep_scale!==1000000)add('SOURCE_REP_SCALE_MISMATCH','sources.portfolio.rep_scale');
  if(!isObject(d.native_asset_metadata))add('NATIVE_LOAN_SCALE_SOURCE_MISSING','sources.native_asset_metadata');
  else {
    if(d.native_asset_metadata.mode!=='LIVE_DEVNET'||d.native_asset_metadata.network!==selection.network)add('SOURCE_MODE_OR_NETWORK_MISMATCH','sources.native_asset_metadata');
    if(!same(d.native_asset_metadata.loan_asset,selection.loan_asset)||!same(d.native_asset_metadata.rep_asset,selection.rep_asset))add('SOURCE_ASSET_MISMATCH','sources.native_asset_metadata');
    if(d.native_asset_metadata.loan_asset_scale!==selection.loan_asset_scale)add('SOURCE_LOAN_SCALE_MISMATCH','selection.loan_asset_scale');
  }
  if(d.portfolio?.opening_loans?.length||d.portfolio?.opening?.active_principal_minor!=='0'||d.portfolio?.opening?.reputation?.bonded_u!=='0')add('NATIVE_OPENING_HISTORY_REQUIRED','sources.portfolio.opening');
  if(isObject(t)) {
    const compareTerms=[['principal_minor',d.request?.principal_minor],['principal_minor',money(d.offer?.principal)?.toString()],['fees_minor',money(d.offer?.fees)?.toString()],['apr_bps',d.offer?.apr_bps],['term_days',d.offer?.term_days],['payment_total',d.offer?.schedule?.payment_total],['payment_interval_seconds',d.offer?.schedule?.payment_interval_seconds]];
    for(const [field,value]of compareTerms)if(!same(t[field],value))add('SOURCE_TERMS_MISMATCH',`selection.terms.${field}`);
    if(positive(selection.money_scale)&&BigInt(selection.money_scale)!==100n)add('SOURCE_MONEY_FORMAT_UNSUPPORTED','selection.money_scale');
    if(uint(t.principal_minor)&&money(d.mandate?.max_principal)!==null&&BigInt(t.principal_minor)>money(d.mandate.max_principal))add('MANDATE_AMOUNT_CAP_MISMATCH','selection.terms.principal_minor');
    if(Number.isSafeInteger(t.apr_bps)&&Number.isSafeInteger(d.mandate?.max_apr_bps)&&t.apr_bps>d.mandate.max_apr_bps)add('MANDATE_RATE_CAP_MISMATCH','selection.terms.apr_bps');
    if(Number.isSafeInteger(t.term_days)&&Number.isSafeInteger(d.mandate?.max_term_days)&&t.term_days>d.mandate.max_term_days)add('MANDATE_TERM_CAP_MISMATCH','selection.terms.term_days');
    if(uint(t.fees_minor)&&money(d.mandate?.max_total_fees)!==null&&BigInt(t.fees_minor)>money(d.mandate.max_total_fees))add('MANDATE_FEE_CAP_MISMATCH','selection.terms.fees_minor');
  }
  if(d.mandate?.rep_consent?.authorized!==true)add('REP_CONSENT_REQUIRED','sources.mandate.rep_consent');
  const millis=new Date(now).getTime();
  for(const key of ['mandate','offer','request','evidence']) {
    const expiry=Date.parse(d[key]?.expires_at);
    if(!Number.isFinite(expiry)||expiry<=millis)add('SOURCE_EXPIRED_OR_INVALID','sources.'+key+'.expires_at');
  }
  if(S) {
    const hash=v=>'sha256:'+sha256(S.canonicalJson(v));
    try {
      if(hash(without(d.mandate,['principal_signature','mandate_hash']))!==d.mandate.mandate_hash)add('SOURCE_COMMITMENT_MISMATCH','sources.mandate.mandate_hash');
      if(hash(without(d.offer,['lender_signature','offer_hash']))!==d.offer.offer_hash)add('SOURCE_COMMITMENT_MISMATCH','sources.offer.offer_hash');
      if(hash(Object.fromEntries(Object.entries(d.offer).filter(([key])=>TERMS_KEYS.includes(key))))!==d.offer.commercial_terms_hash)add('SOURCE_COMMITMENT_MISMATCH','sources.offer.commercial_terms_hash');
      if(hash(without(d.evidence,['signature','evidence_hash']))!==d.evidence.evidence_hash)add('SOURCE_COMMITMENT_MISMATCH','sources.evidence.evidence_hash');
      for(const [field,a,b]of [['mandate_hash',d.request.mandate_hash,d.mandate.mandate_hash],['commercial_terms_hash',d.request.commercial_terms_hash,d.offer.commercial_terms_hash],['evidence_hash',d.request.evidence_hash,d.evidence.evidence_hash],['policy_hash',d.request.policy_hash,d.portfolio.policy_hash],['policy_hash',d.request.policy_hash,d.mandate.rep_consent.policy_hash]])if(a!==b)add('SOURCE_BOUND_COMMITMENT_MISMATCH',`sources.request.${field}`);
    } catch {add('SOURCE_COMMITMENT_NOT_CHECKABLE','sources');}
  }
  const seen=new Set();report.configuration.findings=findings.filter(f=>{const key=JSON.stringify(f);if(seen.has(key))return false;seen.add(key);return true;});
  if(report.approved_schema.status==='AVAILABLE'&&report.accepted_fixture.status==='PASS'&&!report.configuration.findings.some(f=>f.severity==='ERROR')) {
    report.configuration.status='CONFIGURATION_CONSISTENT_BUT_UNVERIFIED';report.configuration.known_selection_consistent=true;
  }
  return report;
}

function failure(code) {return {report_format:'SHELLFISH_NATIVE_PREFLIGHT_V1',configuration:{status:'CONFIGURATION_INCOMPLETE',findings:[{code,field:'cli',severity:'ERROR'}]},native_evidence:{status:'NATIVE_EVIDENCE_NOT_AVAILABLE'},native_ready:false,can_sign:false,can_submit:false};}
export async function cli(args=process.argv.slice(2)) {
  try {
    const opts={};
    for(let i=0;i<args.length;i+=2) {if(!['--repo','--selection','--sources','--runtime','--output'].includes(args[i])||!args[i+1]||opts[args[i]])throw Error();opts[args[i]]=args[i+1];}
    const json=path=>JSON.parse(readFileSync(path,'utf8'));
    const result=await preflight({repo:opts['--repo'],selection:opts['--selection']?json(opts['--selection']):null,documents:opts['--sources']?json(opts['--sources']):null,runtime:opts['--runtime']?json(opts['--runtime']):null});
    const output=JSON.stringify(result,null,2)+'\n';if(opts['--output'])writeFileSync(opts['--output'],output,{mode:0o600});process.stdout.write(output);
    return result.configuration.status==='CONFIGURATION_CONSISTENT_BUT_UNVERIFIED'?0:2;
  } catch {process.stdout.write(JSON.stringify(failure('INPUT_OR_ARGUMENT_READ_FAILED'),null,2)+'\n');return 2;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await cli();
