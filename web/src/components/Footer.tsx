import Link from "next/link";

const REPO = "https://github.com/AlessaLeit/awakeFL";

export default function Footer() {
  return (
    <footer className="border-t" style={{ borderColor: "var(--borda)" }}>
      <div
        className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-10 text-sm md:flex-row md:items-center md:justify-between"
        style={{ color: "var(--tinta-2)" }}
      >
        <div>
          <div className="font-semibold" style={{ color: "var(--tinta)" }}>
            AwakeFL
          </div>
          <p className="mt-1 max-w-md">
            Camada de reputação on-chain para Federated Learning. Projeto de MVP
            em Anchor/Solana — Devnet.
          </p>
        </div>
        <div className="flex gap-5">
          <a
            href={REPO}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-[var(--tinta)]"
          >
            GitHub
          </a>
          <Link
            href="/simulacao"
            className="transition-colors hover:text-[var(--tinta)]"
          >
            Simulação
          </Link>
          <Link
            href="/painel"
            className="transition-colors hover:text-[var(--tinta)]"
          >
            Área do participante
          </Link>
        </div>
      </div>
      <div
        className="mx-auto max-w-6xl px-5 pb-8 text-xs"
        style={{ color: "var(--tinta-muda)" }}
      >
        Os números da simulação vêm de um modelo determinístico das regras do
        programa, não de dados clínicos ou de produção. Os do console de Devnet
        são lidos das contas reais do programa na Solana.
      </div>
    </footer>
  );
}
