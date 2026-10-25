import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { NetworkBadge } from "./components/NetworkBadge";
import { DemoSessionProvider } from "./state/demoSession";
import { AuthorizationReceiptScreen } from "./screens/AuthorizationReceipt";
import { BorrowerWorkspace } from "./screens/BorrowerWorkspace";
import { CreditLenderDecisions } from "./screens/CreditLenderDecisions";

function stepIndex(pathname: string): number {
  if (pathname.startsWith("/credit")) return 1;
  if (pathname.startsWith("/receipt")) return 2;
  return 0;
}

export function App() {
  const location = useLocation();
  const step = stepIndex(location.pathname);

  return (
    <DemoSessionProvider>
      <div className="app">
        <header className="header">
          <div>
            <p className="brand">Shellfish</p>
            <p className="promise">
              Exact approved credit on XRPL — reserved before signing, labeled when
              simulated.
            </p>
          </div>
          <NetworkBadge />
        </header>

        <nav className="nav" aria-label="Demo screens">
          <Link className={step === 0 ? "active" : undefined} to="/borrower">
            A · Borrower
          </Link>
          <Link className={step === 1 ? "active" : undefined} to="/credit">
            B · Credit &amp; lenders
          </Link>
          <Link className={step === 2 ? "active" : undefined} to="/receipt">
            C · Authorization
          </Link>
        </nav>

        <div className="progress" aria-hidden>
          <span className={step >= 0 ? "done" : undefined} />
          <span className={step >= 1 ? "done" : undefined} />
          <span className={step >= 2 ? "done" : undefined} />
        </div>

        <main className="main">
          <Routes>
            <Route path="/" element={<Navigate to="/borrower" replace />} />
            <Route path="/borrower" element={<BorrowerWorkspace />} />
            <Route path="/credit" element={<CreditLenderDecisions />} />
            <Route path="/receipt" element={<AuthorizationReceiptScreen />} />
          </Routes>
        </main>
      </div>
    </DemoSessionProvider>
  );
}
