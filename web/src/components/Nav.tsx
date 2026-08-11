import Link from "next/link";
import ThemeToggle from "./ThemeToggle";

const REPO = "https://github.com/AlessaLeit/fl-reputation";

export default function Nav() {
  return (
    <header
      className="sticky top-0 z-50 border-b backdrop-blur"
      style={{
        borderColor: "var(--borda)",
        background: "color-mix(in srgb, var(--plano) 88%, transparent)",
      }}
    >
      <nav className="mx-auto flex max-w-6xl items-center gap-6 px-5 py-3.5">
        <Link href="/" className="flex items-center gap-2.5 font-semibold">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-md text-[13px] font-bold text-white"
            style={{ background: "var(--acento)" }}
            aria-hidden
          >
            fl
          </span>
          <span className="tracking-tight">fl-reputation</span>
        </Link>

        <div
          className="ml-auto hidden items-center gap-6 text-sm md:flex"
          style={{ color: "var(--tinta-2)" }}
        >
          <Link href="/#problema" className="hover:underline">
            O problema
          </Link>
          <Link href="/#funcionamento" className="hover:underline">
            Como funciona
          </Link>
          <Link href="/devnet" className="hover:underline">
            Devnet
          </Link>
          <a href={REPO} target="_blank" rel="noopener noreferrer" className="hover:underline">
            GitHub
          </a>
        </div>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <ThemeToggle />
          <Link
            href="/simulacao"
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            style={{ background: "var(--acento)" }}
          >
            Ver demo
          </Link>
        </div>
      </nav>
    </header>
  );
}
