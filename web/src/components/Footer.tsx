import Link from "next/link";

const REPO = "https://github.com/AlessaLeit/awakeFL";

/**
 * Rodapé editorial: três colunas e a marca em escala de prancha.
 *
 * O "AwakeFL" gigante é tipografia, não imagem — fica em tom de papel
 * (--superficie-3) para ler como marca d'água e não competir com os links.
 * É aria-hidden porque o nome já está dito acima.
 */
export default function Footer() {
  return (
    <footer className="secao px-5 pb-10 pt-14 sm:px-8">
      <span className="cruz cruz-e" aria-hidden />
      <span className="cruz cruz-d" aria-hidden />

      <div className="flex flex-wrap gap-x-16 gap-y-10">
        <div className="w-[280px]">
          <div
            className="text-xl font-bold tracking-[-0.03em]"
            style={{ color: "var(--tinta)" }}
          >
            AwakeFL
          </div>
          <p
            className="mt-3 text-sm leading-relaxed"
            style={{ color: "var(--tinta-muda)" }}
          >
            Camada de reputação on-chain para Federated Learning. Projeto de
            Iniciação Científica.
          </p>
        </div>

        <div>
          <div className="rotulo">Produto</div>
          <div
            className="mt-4 flex flex-col gap-2.5 text-[15px]"
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
              href="/painel"
              className="transition-colors hover:text-[var(--tinta)]"
            >
              Área do participante
            </Link>
          </div>
        </div>

        <div>
          <div className="rotulo">Código</div>
          <div
            className="mt-4 flex flex-col gap-2.5 text-[15px]"
            style={{ color: "var(--tinta-2)" }}
          >
            <a
              href={REPO}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-[var(--tinta)]"
            >
              GitHub
            </a>
            <a
              href={`${REPO}/tree/main/programs/awakefl`}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-[var(--tinta)]"
            >
              Programa Anchor
            </a>
            <Link
              href="/devnet"
              className="transition-colors hover:text-[var(--tinta)]"
            >
              Estado da Devnet
            </Link>
          </div>
        </div>
      </div>

      <p
        className="mt-14 max-w-3xl text-xs leading-relaxed"
        style={{ color: "var(--tinta-muda)" }}
      >
        Os números da simulação vêm de um modelo determinístico das regras do
        programa, não de dados clínicos ou de produção. Os do console de Devnet
        são lidos das contas reais do programa na Solana.
      </p>

      <div
        aria-hidden
        className="titulo mt-10 select-none text-[14vw] leading-[0.8] tracking-[-0.06em] sm:text-[168px]"
        style={{ color: "var(--superficie-3)" }}
      >
        AwakeFL
      </div>
    </footer>
  );
}
