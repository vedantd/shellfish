import { Link, Navigate, Route, Routes } from "react-router-dom";
import { NetworkBadge } from "./components/NetworkBadge";
import { AuthorizationReceiptScreen } from "./screens/AuthorizationReceipt";
import { BorrowerWorkspace } from "./screens/BorrowerWorkspace";
import { CreditLenderDecisions } from "./screens/CreditLenderDecisions";

export function App() {
  return (
    <div className="app">
      <header className="header">
        <div>
          <p className="eyebrow">Shellfish</p>
          <h1>Agentic Credit Gateway</h1>
        </div>
        <NetworkBadge />
      </header>

      <nav className="nav">
        <Link to="/borrower">A · Borrower</Link>
        <Link to="/credit">B · Credit &amp; lenders</Link>
        <Link to="/receipt">C · Authorization &amp; XRPL</Link>
      </nav>

      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/borrower" replace />} />
          <Route path="/borrower" element={<BorrowerWorkspace />} />
          <Route path="/credit" element={<CreditLenderDecisions />} />
          <Route path="/receipt" element={<AuthorizationReceiptScreen />} />
        </Routes>
      </main>
    </div>
  );
}
