import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync,writeFileSync} from 'node:fs';
import {createRequire,registerHooks} from 'node:module';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const args=process.argv.slice(2),option=(flag,fallback)=>args.includes(flag)?args[args.indexOf(flag)+1]:fallback;
const here=dirname(fileURLToPath(import.meta.url));
const repo=resolve(option('--repo',process.env.SOURCE_REPO??process.cwd()));
const repositorySpec=resolve(repo,'services/api/src/openapi.json');
const file=resolve(option('--spec',existsSync(repositorySpec)?repositorySpec:resolve(here,'services/api/src/openapi.json')));
const spec=JSON.parse(readFileSync(file,'utf8'));
const pending=args.includes('--allow-pending-routes');
const results=[];
function check(name,fn){fn();results.push({name,result:'PASS'});}
const methods=['get','post','put','patch','delete','head','options'];
const operations=Object.entries(spec.paths).flatMap(([path,item])=>Object.entries(item).filter(([method])=>methods.includes(method)).map(([method,value])=>({path,method,value})));
check('OpenAPI 3.1 document has unique operation IDs and path parameter definitions',()=>{
  assert.equal(spec.openapi,'3.1.0');assert.equal(spec.jsonSchemaDialect,'https://json-schema.org/draft/2020-12/schema');
  assert.equal(new Set(operations.map(o=>o.value.operationId)).size,operations.length);
  for(const o of operations){assert.ok(o.value.responses?.['200']);const names=[...o.path.matchAll(/\{([^}]+)\}/g)].map(m=>m[1]);for(const name of names)assert.ok(o.value.parameters?.some(p=>p.in==='path'&&p.name===name&&p.required===true),o.path+' parameter '+name);}
});
check('Every local schema reference resolves',()=>{
  function visit(value){if(!value||typeof value!=='object')return;if(value.$ref){assert.ok(value.$ref.startsWith('#/'));let node=spec;for(const segment of value.$ref.slice(2).split('/'))node=node?.[segment.replace(/~1/g,'/').replace(/~0/g,'~')];assert.ok(node,'Missing '+value.$ref);}for(const nested of Object.values(value))visit(nested);}
  visit(spec);
});
check('Source schema hashes match all four current shared model files',()=>{
  const files=['index.ts','c0.ts','credit.ts','commitments.ts'].map(name=>'packages/schemas/src/'+name);
  assert.deepEqual(Object.keys(spec['x-source-schema-hashes']).sort(),[...files].sort());
  for(const path of files)assert.equal(spec['x-source-schema-hashes'][path],createHash('sha256').update(readFileSync(resolve(repo,path))).digest('hex'),path+' changed. Refresh OpenAPI schema contract and metadata.');
});
const actual=new Set();
for(const filename of ['services/api/src/index.ts',...readdirSync(resolve(repo,'services/api/src/routes')).filter(f=>f.endsWith('.ts')).map(f=>'services/api/src/routes/'+f)]){
  const text=readFileSync(resolve(repo,filename),'utf8');
  for(const m of text.matchAll(/app\.(get|post|put|patch|delete|head|options)\s*(?:<[\s\S]*?>)?\s*\(\s*["']([^"']+)["']/g))actual.add(m[1].toUpperCase()+' '+m[2].replace(/:([A-Za-z_][A-Za-z0-9_]*)/g,'{$1}'));
}
const documented=new Set(operations.map(o=>o.method.toUpperCase()+' '+o.path));
check('All registered application routes are documented',()=>{for(const route of actual)assert.ok(documented.has(route),'Undocumented route '+route);});
const expectedPending=['GET /openapi.json','GET /v1/requests/{id}'];
check('All documented routes exist or are explicitly pending parent integration',()=>{for(const route of documented)assert.ok(actual.has(route)||(pending&&expectedPending.includes(route)),'Not registered '+route);});

const pnpm=resolve(repo,'node_modules/.pnpm');
const ajvDir=readdirSync(pnpm).find(name=>/^ajv@8\./.test(name));
const formatsDir=readdirSync(pnpm).find(name=>name.startsWith('ajv-formats@'));
if(!ajvDir||!formatsDir)throw new Error('Use the existing locked AJV and ajv-formats dependencies. No automatic installation.');
const require=createRequire(pathToFileURL(resolve(repo,'package.json')));
const Ajv=require(resolve(pnpm,ajvDir,'node_modules/ajv/dist/2020.js')).default;
const addFormats=require(resolve(pnpm,formatsDir,'node_modules/ajv-formats')).default;
const ajv=new Ajv({strict:false,allErrors:true});addFormats(ajv);
const schemaRoot={$id:'urn:shellfish:openapi',components:spec.components};ajv.addSchema(schemaRoot);
const validators=new Map(Object.keys(spec.components.schemas).map(name=>[name,ajv.compile({$ref:'urn:shellfish:openapi#/components/schemas/'+name})]));
check('All 2020-12 component schemas compile with installed AJV',()=>{assert.equal(validators.size,Object.keys(spec.components.schemas).length);});
check('Every component example passes its documented JSON Schema',()=>{
  for(const [name,schema]of Object.entries(spec.components.schemas))for(const example of schema.examples??[]){const valid=validators.get(name)(example);assert.ok(valid,name+': '+ajv.errorsText(validators.get(name).errors));}
});
check('Every request and response example passes its operation schema',()=>{
  for(const o of operations)for(const context of [o.value.requestBody,...Object.values(o.value.responses)])for(const value of Object.values(context?.content??{})){
    if(!value.examples)continue;const validate=ajv.compile({components:spec.components,...value.schema});
    for(const [name,example]of Object.entries(value.examples))assert.ok(validate(example.value),o.value.operationId+'/'+name+': '+ajv.errorsText(validate.errors));
  }
});
const root=pathToFileURL(resolve(repo,'packages/schemas/src')+'/').href;
const hook=registerHooks({resolve(specifier,context,nextResolve){if(context.parentURL?.startsWith(root)&&specifier.startsWith('./')&&specifier.endsWith('.js')){const url=new URL(specifier.slice(0,-3)+'.ts',context.parentURL);if(existsSync(fileURLToPath(url)))return nextResolve(url.href,context);}return nextResolve(specifier,context);}});
const S=await import(new URL('index.ts',root).href);hook.deregister();
check('Documented model fields and required sets match current Zod source shapes',()=>{
  for(const name of ['ReputationState','CreditSnapshot','PaymentSchedule','RepSpendConsent','BorrowingMandate','EvidencePassport','LenderFacilityOffer','AuthorizationReceipt','CreditStatus','CreditQuoteRequest','CreditQuote','OfferMatchResult']){
    let schema=S[name];while(schema._def.typeName==='ZodEffects')schema=schema._def.schema;
    const shape=schema._def.shape(),documented=spec.components.schemas[name];
    assert.deepEqual(Object.keys(documented.properties).sort(),Object.keys(shape).sort(),name+' properties drift');
    const required=Object.entries(shape).filter(([,value])=>value._def.typeName!=='ZodOptional').map(([key])=>key).sort();
    assert.deepEqual([...documented.required].sort(),required,name+' required fields drift');
  }
  assert.deepEqual(spec.components.schemas.DenialCode.enum,S.DenialCode.options);
});
check('Examples agree with actual current Zod model outputs',()=>{for(const name of ['BorrowingMandate','EvidencePassport','LenderFacilityOffer','AuthorizationReceipt','OfferMatchResult'])for(const example of spec.components.schemas[name].examples??[])S[name].parse(example);S.ReservationFixture.shape.request.parse(spec.components.schemas.ReservationRequest.examples[0]);});
check('Asset and simulation schemas reject misleading payloads',()=>{
  assert.equal(validators.get('AssetRef')({currency:'XRP',issuer:'wrong'}),false);
  assert.equal(validators.get('AssetRef')({currency:'USD'}),false);
  assert.equal(validators.get('AssetRef')({mpt_issuance_id:'wrong'}),false);
  assert.equal(validators.get('AssetRef')({currency:'USD',issuer:'sim:issuer'}),true);
  const receipt=structuredClone(spec.components.schemas.AuthorizationReceipt.examples[0]);receipt.tx_hash='A'.repeat(64);assert.equal(validators.get('AuthorizationReceipt')(receipt),false);
  assert.equal(validators.get('CreditQuoteRequest')({principal_minor:'0'}),false);
});
check('Request view describes exact source projection fields',()=>{
  const props=spec.components.schemas.RequestView.properties;
  for(const key of ['request_id','reservation_id','mode','network','request_state','loan_id','receipt','approved_offer','lender_decision','credit_status','loan','transactions','attempts'])assert.ok(props[key]);
  assert.ok(spec.components.schemas.TransactionReference.properties.explorer);
  assert.equal(spec.components.schemas.TransactionReference.properties.ledger_requeried.const,false);
  assert.equal(spec.components.schemas.AttemptSummary.properties.recorded_validated.const,false);
  assert.ok(!JSON.stringify(spec.components.schemas.RequestView).includes('signed_blob'));
});
const report={result:'PASS',operations:operations.length,schemas:validators.size,checks:results,route_inventory:[...actual].sort(),pending_parent_integration:[...documented].filter(route=>!actual.has(route)),scope:'Schema, examples and source route inventory only. No HTTP or native ledger acceptance is claimed.'};
const reportFile=resolve(option('--output',resolve(here,'contract-check-results.json')));writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
