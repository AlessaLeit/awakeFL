import Link from "next/link";

const REPO = "https://github.com/AlessaLeit/fl-reputation";

export default function Footer() {
  return (
    <footer className="border-t" style={{ borderColor: "var(--borda)" }}>
      <div
        className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-10 text-sm md:flex-row md:items-center md:justify-between"
        style={{ color: "var(--tinta-2)" }}
      >
        <div>
          <div className="font-semibold" style={{ color: "var(--tinta)" }}>
            fl-reputation
          </div>
          <p className="mt-1 max-w-md">
            Camada de reputação on-chain para Federated Learning. Projeto de MVP em
            Anchor/Solana — Devnet.
          </p>
        </div>
        <div className="flex gap-5">
          <a href={REPO} target="_blank" rel="noopener noreferrer" className="hover:underline">
            GitHub
          </a>
          <Link href="/simulacao" className="hover:underline">
            Demo
          </Link>
        </div>
      </div>
      <div
        className="mx-auto max-w-6xl px-5 pb-8 text-xs"
        style={{ color: "var(--tinta-muda)" }}
      >
        Os números exibidos na demo vêm de uma simulação determinística das regras do
        programa, não de dados clínicos ou de produção.
      </div>
    </footer>
  );
}
