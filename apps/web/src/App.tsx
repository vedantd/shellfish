import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { NetworkBadge } from "./components/NetworkBadge";
import { UiIcon } from "./components/UiIcon";
import { DemoSessionProvider, useDemoSession } from "./state/demoSession";
import { AuthorizationReceiptScreen } from "./screens/AuthorizationReceipt";
import { BorrowerWorkspace } from "./screens/BorrowerWorkspace";
import { CreditLenderDecisions } from "./screens/CreditLenderDecisions";

const steps = [
  { path: "/borrower", title: "Your workspace", detail: "Set your boundaries", icon: "wallet" as const },
  { path: "/credit", title: "Credit & lenders", detail: "Find your fit", icon: "shield" as const },
  { path: "/receipt", title: "Review & borrow", detail: "Every step recorded", icon: "receipt" as const },
];

function ReputationGuide() {
  const session = useDemoSession();
  const quote = session.quote as { bond_u?: string; reason_codes?: string[]; fits_registry_limits?: boolean } | null;
  const amount = quote?.bond_u && /^\d+$/.test(quote.bond_u) ? (Number(quote.bond_u) / 1000000).toLocaleString(undefined, { maximumFractionDigits: 2 }) : null;
  const denied = quote?.fits_registry_limits === false || Boolean(quote?.reason_codes?.length);
  return <aside className="trust-panel">
    <div className="trust-mark"><img src="/brand/cobb-mark.png" alt="" /></div>
    <p className="eyebrow">Reputation with purpose</p>
    <h2>Your credit.<br /> Within your control.</h2>
    <p className="trust-copy">Your agent borrows within the limits you approve. Your reputation puts a boundary on exposure.</p>
    <ol className="trust-steps">
      <li><span>01</span><div><strong>Define the limits</strong><p>You set the amount, rate and term.</p></div></li>
      <li><span>02</span><div><strong>Put reputation behind it</strong><p>More exposure needs a larger REP bond.</p></div></li>
      <li><span>03</span><div><strong>Keep a clear record</strong><p>Follow every validated ledger transaction.</p></div></li>
    </ol>
    {amount ? <div className={`rep-quote ${denied ? "rep-quote-denied" : ""}`}><span>Reputation bond preview</span><strong>{amount} <small>REP</small></strong><p>{denied ? "This request exceeds the available limits." : "Final approval reserves your REP and credit capacity."}</p></div> : <div className="trust-footnote"><UiIcon name="shield" size={18} /><span>Permission first.<br />Execution second.</span></div>}
  </aside>;
}

export function App() {
  const location = useLocation();
  const step = location.pathname.startsWith("/credit") ? 1 : location.pathname.startsWith("/receipt") ? 2 : 0;
  return <DemoSessionProvider><div className="app">
    <header className="header">
      <Link className="brand" to="/borrower" aria-label="Cobb home"><img src="/brand/cobb-wordmark.png" alt="Cobb" /><span className="brand-divider" /><span className="brand-descriptor">Agent credit,<br />on your terms.</span></Link>
      <NetworkBadge />
    </header>
    <div className="workspace-intro"><p className="eyebrow">The Cobb workspace</p><h1>Good credit starts with clear limits.</h1><p>Give your agent room to act, with reputation behind every loan.</p></div>
    <nav className="nav" aria-label="Credit journey">{steps.map((item, index) => <Link key={item.path} to={item.path} className={`${step === index ? "active" : ""} ${step > index ? "complete" : ""}`} aria-current={step === index ? "step" : undefined}><span className="nav-icon"><UiIcon name={step > index ? "check" : item.icon} /></span><span><strong>{item.title}</strong><small>{item.detail}</small></span><span className="nav-number">0{index + 1}</span></Link>)}</nav>
    <div className="workspace-layout"><main className="main"><Routes>
      <Route path="/" element={<Navigate to="/borrower" replace />} />
      <Route path="/borrower" element={<BorrowerWorkspace />} />
      <Route path="/credit" element={<CreditLenderDecisions />} />
      <Route path="/receipt" element={<AuthorizationReceiptScreen />} />
    </Routes></main><ReputationGuide /></div>
    <footer className="app-footer"><span><img src="/brand/cobb-mark.png" alt="" /> Cobb · Agent credit on your terms</span><a href="https://devnet.xrpl.org" target="_blank" rel="noopener noreferrer">XRP Ledger Devnet <UiIcon name="external" size={14} /></a></footer>
  </div></DemoSessionProvider>;
}
