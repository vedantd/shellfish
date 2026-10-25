import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useDemoSession } from "../state/demoSession";

type ResetResult = {
  ok: boolean;
  mode?: string;
  borrower_account?: string | null;
  took_ms?: number;
  code?: string;
  message?: string;
};

type Props = {
  onResetComplete?: () => void;
};

export function DemoResetButton({ onResetComplete }: Props) {
  const session = useDemoSession();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resetDemo() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<ResetResult>("/v1/demo/reset", { method: "POST" });
      if (!result.ok) {
        setError(result.message ?? result.code ?? "Reset failed");
        return;
      }
      session.resetDemo();
      onResetComplete?.();
      navigate("/borrower", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as ResetResult | undefined;
        setError(
          body?.code === "DEMO_RESET_DISABLED"
            ? "Reset disabled — set SHELLFISH_DEMO_RESET=1 on the API"
            : body?.message ?? err.message,
        );
      } else {
        setError(err instanceof Error ? err.message : "Reset failed");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="demo-reset">
      <button
        type="button"
        className="demo-reset-button"
        disabled={busy}
        onClick={() => void resetDemo()}
        title="Wipe local demo state and prepare a clean borrower for the next judge run"
      >
        {busy ? "Preparing clean demo…" : "Reset demo"}
      </button>
      {error ? (
        <p className="demo-reset-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
