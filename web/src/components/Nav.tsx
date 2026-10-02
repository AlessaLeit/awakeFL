import Link from "next/link";
import Marca from "./Marca";

const REPO = "https://github.com/AlessaLeit/awakeFL";

/**
 * Faixa de aviso + navegação.
 *
 * A faixa de tinta no topo não é decorativa: ela é o único lugar da página que
 * declara, antes de qualquer promessa, que o ciclo roda assinado por carteira
 * na Devnet. Por isso ela leva ao "Como funciona", onde isso está detalhado.
 *
 * A navegação fica no fluxo, não fixa. É a decisão do design: numa página que
 * é uma prancha contínua, uma barra flutuante cortaria os fios verticais da
 * coluna no meio da rolagem.
 */
export default function Nav() {
  return (
    <header>
      <Link
        href="/como-funciona"
        className="mono flex min-h-10 flex-wrap items-center justify-center gap-3 px-4 py-2 text-center text-[12.5px] uppercase tracking-[0.06em]"
        style={{ background: "var(--tinta)", color: "#e8ece2" }}
      >
        <span
          className="inline-flex items-center gap-2 rounded px-2 py-0.5 font-semibold"
          style={{ background: "var(--acento)", color: "var(--sobre-acento)" }}
        >
          Devnet
        </span>
        Ciclo completo — registrar, contribuir, validar, penalizar — assinado
        por carteira
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M5 12h14" />
          <path d="m13 6 6 6-6 6" />
        </svg>
      </Link>

      <nav
        className="flex min-h-[72px] flex-wrap items-center gap-x-9 gap-y-3 border-b px-5 py-3 sm:px-8"
        style={{ borderColor: "var(--borda)" }}
      >
        <Link href="/">
          <Marca />
        </Link>

        <div
          className="flex flex-wrap items-center gap-x-7 gap-y-2 text-[15px]"
          style={{ color: "var(--tinta-2)" }}
        >
          <Link
            href="/como-funciona"
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
          <Link
            href="/devnet"
            className="transition-colors hover:text-[var(--tinta)]"
          >
            Estado da Devnet
          </Link>
        </div>

        <div className="ml-auto flex items-center gap-2.5">
          <a
            href={REPO}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-fio h-10 px-3.5 text-[15px]"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
              <path d="M9 18c-4.51 2-5-2-7-2" />
            </svg>
            GitHub
          </a>
          <Link href="/painel" className="btn-tinta h-10 px-4 text-[15px]">
            Área do participante
          </Link>
        </div>
      </nav>
    </header>
  );
}
