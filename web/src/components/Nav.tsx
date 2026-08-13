import Link from "next/link";
import Marca from "./Marca";

const REPO = "https://github.com/AlessaLeit/awakeFL";

export default function Nav() {
  return (
    <header
      className="sticky top-0 z-50 border-b"
      style={{
        borderColor: "var(--borda)",
        background: "color-mix(in srgb, var(--plano) 82%, transparent)",
        backdropFilter: "blur(var(--vidro-desfoque))",
        WebkitBackdropFilter: "blur(var(--vidro-desfoque))",
      }}
    >
      <nav className="mx-auto flex max-w-6xl items-center gap-6 px-5 py-3.5">
        <Link href="/">
          <Marca />
        </Link>

        <div
          className="ml-auto hidden items-center gap-6 text-sm md:flex"
          style={{ color: "var(--tinta-2)" }}
        >
          <Link
            href="/#problema"
            className="transition-colors hover:text-[var(--tinta)]"
          >
            O problema
          </Link>
          <Link
            href="/#funcionamento"
            className="transition-colors hover:text-[var(--tinta)]"
          >
            Como funciona
          </Link>
          <Link
            href="/simulacao"
            className="transition-colors hover:text-[var(--tinta)]"
          >
            Simulação
          </Link>
          <a
            href={REPO}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-[var(--tinta)]"
          >
            GitHub
          </a>
        </div>

        <div className="ml-auto flex items-center gap-2.5 md:ml-0">
          <Link href="/painel" className="btn-neon px-4 py-2 text-sm">
            Área do participante
          </Link>
        </div>
      </nav>
    </header>
  );
}
