# Offline native configuration preflight

This working tool reads Shellfish's actual schema sources and the accepted pending fixture. It checks a separate native-selection draft against source documents. It writes no repository file, loads no keys, accesses no network and submits no transaction. It uses Node 24 and the repository's existing Zod installation. No extra package is needed.

Implemented against repository `3c5f9bc7fdda9954603f69acfc429d98eb09e5a8`, including PR 5's public runtime contract. The current network/signing fixture remains unchanged. Its null native fields and `native_ready:false` still parse under the accepted C0 schema.

PR 6 at `8b6b544` changes coordination documents only. AUTH-DEVNET-001 approves Vedant's bounded smoke execution. That approval is separate from technical readiness and is not a successful run. The source checks against `3c5f9bc` still apply. This tool performs no smoke execution.

Run these commands from this folder with Node 24 on PATH:

```sh
SOURCE_REPO=/absolute/path/to/shellfish node --test native-preflight.test.mjs
node native-preflight.mjs --repo /absolute/path/to/shellfish --output current-preflight-report.json
```

The second command exits **2** for the current incomplete native selection. It still writes a valid report. Exit **0** means the selected known configuration matches the supplied documents. It never means native execution is ready.

Inside an ancestor Shellfish checkout, the tool discovers the repository from its current directory or installed script location. Outside a checkout, pass `--repo` or set `SHELLFISH_REPO`. No personal repository path is hard-coded. Tests accept `SOURCE_REPO` explicitly.

To check a separate proposed native selection:

```sh
node native-preflight.mjs --repo /absolute/path/to/shellfish --selection native-selection.json --sources native-source-documents.json --runtime public-network-snapshot.json --output result.json
```

`native-selection.template.json` lists all draft fields. Null values are deliberate missing inputs. Do not put keys, seed phrases, signed transaction bytes or endpoint credentials in either input.

The source-document JSON contains:

```text
portfolio: NativePortfolioSeed
mandate: BorrowingMandate
offer: LenderFacilityOffer
request: AtomicReservationRequest
evidence: EvidencePassport
native_asset_metadata: {
  mode: "LIVE_DEVNET",
  network: "devnet",
  loan_asset: AssetRef,
  loan_asset_scale: integer,
  rep_asset: RepAssetRef
}
```

The first five entries use existing source schemas. The native portfolio shape matches the current `ScenarioFixture.omit({provenance:true,native_signing_permitted:true})` used by registry types. `native_asset_metadata` is this tool's draft declaration wrapper. It binds the selected scale to the supplied metadata declaration. This tool does not authenticate that declaration against a ledger.

The selection and source records must agree on mode, network, principal, borrower, loan asset, REP issuance, facility, offer, monetary scale, principal, nominal annual rate, term and fees. The tool recomputes actual approved canonical commitments. It rejects expired source records, unrecorded opening debt and inconsistent principal/fee precision. It never rounds debt downward. REP has six decimal places. Current money strings use cents and require `money_scale:"100"`.

`--runtime` accepts a saved public `GET /v1/network` JSON response. It never calls the endpoint itself and never reads an environment file. The current response shape is `{mode,live_ready,public_signing,explorer_base}`. `public_signing` uses the actual `publicLiveSigningFields` keys: `endpoint`, `native_loan_asset`, `borrower_account`, `broker_account`, `broker_id`, `native_rep_asset`, string `required_signer_route`, `native_schedule:{payment_total,payment_interval_sec,grace_period_sec}` and `sdk_pin`. The tool binds these to the selected values, the generated `devnet:` principal/facility mappings and the offer lender. It catches a public 30-day schedule paired with a 90-day offer.

The public response's `live_ready:true` means the application's handles exist. It is not native evidence. The preflight never promotes that Boolean. Origination/service fees are absent from `public_signing`. The report states `fee_coverage:"NOT_EXPOSED_BY_PUBLIC_SIGNING"`. Source offer fees are checked, but actual native fee configuration remains unverified. The preflight does not read `SHELLFISH_BORROWER_SEED`, `SHELLFISH_BROKER_SEED` or any local `.env` file. The public `.env.live.example` is documentation only.

`loan_asset_scale` is a declared arithmetic input, bounded to 0 through 18 in this draft tool. That bound is a tool limit, not an assertion about XRPL asset protocol limits. The native adapter must verify supported precision from actual asset metadata. XRP declarations require scale six. MPT issuance syntax uses the approved 48-hex asset shape. Address checksum, endpoint identity, actual broker/asset existence and signatures remain unverified.

The old simulated source documents are loaded by default. A native selection paired with them fails mode/identity checks. Produce a coherent native example and reissue its bound commitments through the agreed producer path. Do not relabel the old synthetic example.

The report separates three facts:

- `CONFIGURATION_INCOMPLETE`: missing fields, unavailable approved schemas, invalid source records or a detected mismatch.
- `CONFIGURATION_CONSISTENT_BUT_UNVERIFIED`: selected known values and supplied source documents agree. A supplied public runtime snapshot maps the current route/schedule shape, but owner acceptance and native verification remain pending.
- `NATIVE_EVIDENCE_NOT_AVAILABLE`: this tool performs no ledger authentication, signing, submission or lifecycle proof. This status is present in every report.

Every report returns `native_ready:false`, `can_sign:false` and `can_submit:false`. Reports contain allowlisted finding codes and static field paths. They exclude raw input values, addresses, endpoints, signatures and signed blobs. Known secret-bearing keys cause a closed failure. Input-read errors are redacted.

The current pending schema cannot accept filled native values. Keep it intact. Gita owns any later additive successor schema and fixture proposal. Vedant supplies the selected identifiers, signer-route contract and exact native schedule, then accepts that successor. This preflight is a standalone draft tool. Its format and output do not change C0 or grant a signing route.

Integration point: run it before initializing the native backend. Treat exit 0 as a configuration consistency prerequisite only. The application must still run trusted portfolio, event and failure verifiers, enforce the controlled signer and obtain the agreed native proofs. A future integration diff needs owner review. The tool does not claim repayment, native default or the migrated issuer-return queue passed.

The tests use explicitly unverified draft records and an `example.invalid` endpoint. They test consistency and closed failures. They do not authenticate native identities.

The binding repair now rejects conflicting native defaults before authorization. Its source-bound test checks that rejection, then checks canonical commitments from a coherent 90-day, zero-fee input. This does not select those values for a live run or grant native readiness.
