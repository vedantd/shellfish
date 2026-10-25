# Shellfish native E2E test report

A fresh native Devnet run passed on 25 October 2026. The standalone fixture created
four test accounts, its own loan asset, nontransferable REP, vault and broker.
The Devnet faucet supplied test XRP. No existing wallet or Vedant key was used.

The clean run began at 04:52:39 New York time. LoanSet validated at 04:55:50.
LoanPay validated at 04:56:01. Every core transaction returned validated `tesSUCCESS`.

| Native step | Explorer transaction | Ledger |
| --- | --- | ---: |
| Issue 1,000 REP | [AF3E57FB...BE69127D](https://devnet.xrpl.org/transactions/AF3E57FBEF12B8BEE432A20F903069F6F2050829A16F050549646958BE69127D) | 6,401,320 |
| Redeem 240 REP | [61E3ED04...6937D98C](https://devnet.xrpl.org/transactions/61E3ED040E470F7B50C1A41FE463397A2FC1E2C8BFD905AC15936C146937D98C) | 6,401,349 |
| Originate loan | [2846EC91...71A9DCC9](https://devnet.xrpl.org/transactions/2846EC91AA071877923B29178CA1F020C3D73403130785AAB854B1B771A9DCC9) | 6,401,351 |
| Repay loan | [C23DA798...8F7F53ED](https://devnet.xrpl.org/transactions/C23DA7980AEAFD52E77567EED0203140CD853CD6CFDDC3CC5172C83C8F7F53ED) | 6,401,355 |
| Return 240.000008 REP | [362D204C...70A14A9A](https://devnet.xrpl.org/transactions/362D204C63433DC4D35390A4B11BEA8CC21F7096379D82BB077CFF6F70A14A9A) | 6,401,357 |

The gross principal was 1,000 test USD units. The borrower received 900 after the
100-unit origination fee. LoanPay submitted a 2,000-unit maximum. The actual debit
was 1,015, and principal fell by 1,000. The service fee was 10.

The approved curve required 240 REP at zero opening exposure. Reservation held the
principal and REP together. The borrower redeemed the REP to its issuer before the
fixture signer authorized LoanSet. An altered 2,000-unit request failed before signing.

The history check covered all five validated ledgers from 6,401,351 through 6,401,355.
It found origination and repayment with no intervening loan servicing. The 11-second
ledger-close interval earned 8 micro-REP under the approved rule. Full repayment created
an unavailable return credit. The separate issuer Payment returned 240.000008 REP.

The final native wallet balance and registry balance both held 1,000.000008 REP.
Active principal, reserved principal and pending REP return credit all ended at zero.
Duplicate delivery changed each accounting outcome once.

| Verification | Observed result |
| --- | --- |
| Native run after preserved-state recovery | PASS, 19-second interval, 14 micro-REP growth |
| Fresh native run with no resume | PASS, 11-second interval, 8 micro-REP growth |
| Separate read-only public-ledger recheck | PASS, no keys loaded and no transactions submitted |
| New fixture tests | 37 PASS, no skips or TODOs |
| Existing repository tests | 96 PASS, six existing TODOs |
| Workspace TypeScript build | PASS |
| Whitespace and public secret scan | PASS |

The first run exposed two harness parsing issues. Recovery records preserve both
failures. Resume reused validated setup transactions and the retained stake reservation.
It did not issue another seed or redeem another bond. The corrected harness then passed
from fresh accounts without resume.

All source additions live under `fixtures/xrpl-poc-replay/`. This chat changed no existing
source file. Other parallel checkout edits remain preserved. The fixture imports the
installed XRPL SDK directly and leaves Vedant's adapter, routes, UI and tests to him.

This result verifies native REP operations, native lending, a fixture signing gate and
Gita's registry accounting. Production mandate verification, lender underwriting,
Vedant adapter integration, UI behavior and native default testing remain separate work.
The existing synthetic tests cover partial repayment and default accounting.

REP burns during the pre-loan payment to its issuer. Confirmed default forfeits the
restoration right and suspends borrowing. It requires no second burn. The synthetic
default case leaves 760 REP available and records the original 240 REP as forfeited.
No native LoanManage default was executed in these successful-repayment runs.

Private test keys and signed attempts remain in ignored run folders with restricted
permissions. Public reports contain no wallet secrets. The work is local and uncommitted.
No push, deployment or message to Vedant was made.

The next integration step is Vedant's review of the public event records and registry
interface. His adapter can then consume that interface within his own source paths.
