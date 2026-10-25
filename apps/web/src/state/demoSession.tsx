import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  AuthReceipt,
  EvidencePassport,
  LenderEvaluateResult,
  LenderOffer,
  Mandate,
  OriginateResult,
} from "../lib/api";

export type DemoSession = {
  mandate: Mandate | null;
  evidence: EvidencePassport | null;
  lenderA: LenderEvaluateResult | null;
  lenderB: LenderEvaluateResult | null;
  matchedOffer: LenderOffer | null;
  matchEnvelope: unknown | null;
  creditStatus: unknown | null;
  quote: unknown | null;
  receipt: AuthReceipt | null;
  originate: OriginateResult | null;
  joinedRequest: unknown | null;
  setMandate: (m: Mandate | null) => void;
  setEvidence: (e: EvidencePassport | null) => void;
  setLenderA: (r: LenderEvaluateResult | null) => void;
  setLenderB: (r: LenderEvaluateResult | null) => void;
  setMatch: (offer: LenderOffer | null, envelope: unknown | null) => void;
  setCreditStatus: (v: unknown | null) => void;
  setQuote: (v: unknown | null) => void;
  setReceipt: (r: AuthReceipt | null) => void;
  setOriginate: (o: OriginateResult | null) => void;
  setJoinedRequest: (v: unknown | null) => void;
  clearExecution: () => void;
  resetDemo: () => void;
};

const Ctx = createContext<DemoSession | null>(null);

export function DemoSessionProvider({ children }: { children: ReactNode }) {
  const [mandate, setMandate] = useState<Mandate | null>(null);
  const [evidence, setEvidence] = useState<EvidencePassport | null>(null);
  const [lenderA, setLenderA] = useState<LenderEvaluateResult | null>(null);
  const [lenderB, setLenderB] = useState<LenderEvaluateResult | null>(null);
  const [matchedOffer, setMatchedOffer] = useState<LenderOffer | null>(null);
  const [matchEnvelope, setMatchEnvelope] = useState<unknown | null>(null);
  const [creditStatus, setCreditStatus] = useState<unknown | null>(null);
  const [quote, setQuote] = useState<unknown | null>(null);
  const [receipt, setReceipt] = useState<AuthReceipt | null>(null);
  const [originate, setOriginate] = useState<OriginateResult | null>(null);
  const [joinedRequest, setJoinedRequest] = useState<unknown | null>(null);

  const setMatch = useCallback((offer: LenderOffer | null, envelope: unknown | null) => {
    setMatchedOffer(offer);
    setMatchEnvelope(envelope);
  }, []);

  const clearExecution = useCallback(() => {
    setReceipt(null);
    setOriginate(null);
    setJoinedRequest(null);
  }, []);

  const resetDemo = useCallback(() => {
    setMandate(null);
    setEvidence(null);
    setLenderA(null);
    setLenderB(null);
    setMatchedOffer(null);
    setMatchEnvelope(null);
    setCreditStatus(null);
    setQuote(null);
    setReceipt(null);
    setOriginate(null);
    setJoinedRequest(null);
  }, []);

  const value = useMemo(
    () => ({
      mandate, evidence, lenderA, lenderB, matchedOffer, matchEnvelope,
      creditStatus, quote, receipt, originate, joinedRequest,
      setMandate, setEvidence, setLenderA, setLenderB, setMatch,
      setCreditStatus, setQuote, setReceipt, setOriginate, setJoinedRequest,
      clearExecution, resetDemo,
    }),
    [
      mandate, evidence, lenderA, lenderB, matchedOffer, matchEnvelope,
      creditStatus, quote, receipt, originate, joinedRequest, setMatch, clearExecution, resetDemo,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDemoSession(): DemoSession {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDemoSession requires DemoSessionProvider");
  return ctx;
}
