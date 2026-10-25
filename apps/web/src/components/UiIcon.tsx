export function UiIcon({ name, size = 20 }: { name: "wallet" | "shield" | "receipt" | "arrow" | "check" | "external"; size?: number }) {
  const paths = {
    wallet: <><path d="M20 8H5a2 2 0 0 1 0-4h13v4M5 8H3v12h17V8" /><path d="M20 12h-5v4h5" /></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" /><path d="m8 12 3 3 5-6" /></>,
    receipt: <><path d="M5 3h14v18l-3-2-4 2-4-2-3 2z" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
    arrow: <><path d="M4 12h16m-6-6 6 6-6 6" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
    external: <><path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
