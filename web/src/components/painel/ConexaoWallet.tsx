"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { IconeCadeado, IconeCarteira } from "./Icones";

// O botão da carteira lê `window` na primeira renderização; renderizá-lo no
// servidor produz um mismatch de hidratação a cada carregamento.
const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false, loading: () => <div className="h-[38px] w-full" /> },
);

/**
 * Portão de entrada da área do participante. Não é uma rota: é o que o painel
 * mostra no lugar do conteúdo enquanto não há carteira conectada. Como rota
 * separada, o usuário conseguiria abrir /painel/extrato direto e cair numa
 * tela vazia sem explicação.
 */
export default function ConexaoWallet() {
  return (
    <div
      className="relative flex min-h-screen flex-col items-center justify-center px-5 py-16"
      style={{
        // Malha técnica de fundo — o "canvas de void" do design system, com o
        // acento aparecendo apenas como um brilho difuso atrás do cartão.
        backgroundImage: `
          radial-gradient(circle at 50% 45%, var(--acento-lavado), transparent 55%),
          linear-gradient(var(--grade) 1px, transparent 1px),
          linear-gradient(90deg, var(--grade) 1px, transparent 1px)
        `,
        backgroundSize: "100% 100%, 64px 64px, 64px 64px",
      }}
    >
      <div className="vidro w-full max-w-md p-8 text-center md:p-10">
        <div className="flex justify-center">
          <div className="text-center">
            <div className="text-3xl font-bold tracking-tight">
              <span style={{ color: "var(--acento-forte)" }}>Awake</span>
              <span style={{ color: "var(--tinta)" }}>FL</span>
            </div>
            <div className="rotulo mt-2" style={{ fontSize: 10 }}>
              Neon Graphite Architecture
            </div>
          </div>
        </div>

        <div
          className="mx-auto mt-8 flex h-20 w-20 items-center justify-center rounded-lg border"
          style={{
            borderColor: "var(--borda)",
            background: "var(--superficie-2)",
          }}
        >
          <div
            className="flex h-12 w-12 items-center justify-center rounded"
            style={{
              background: "var(--superficie-3)",
              color: "var(--tinta-2)",
            }}
          >
            <IconeCarteira />
          </div>
        </div>

        <h1 className="mt-8 text-2xl font-semibold tracking-tight">
          Autenticação de rede
        </h1>
        <p
          className="mx-auto mt-3 max-w-sm text-sm leading-relaxed"
          style={{ color: "var(--tinta-2)" }}
        >
          Conecte sua carteira para entrar como participante do protocolo
          AwakeFL. A carteira é a sua identidade on-chain — não há login nem
          senha.
        </p>

        {/* O WalletMultiButton traz o próprio markup; `carteira-bloco` o
            estica para a largura do cartão, como no desenho. */}
        <div className="carteira-bloco mt-8">
          <WalletMultiButton>Conectar wallet</WalletMultiButton>
        </div>

        <p
          className="mono mt-5 flex items-center justify-center gap-2 text-xs"
          style={{ color: "var(--tinta-muda)" }}
        >
          <IconeCadeado className="h-3.5 w-3.5" />A chave privada nunca sai da
          carteira
        </p>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs">
        <Link
          href="/"
          className="transition-colors hover:text-[var(--tinta)]"
          style={{ color: "var(--tinta-muda)" }}
        >
          ← Voltar ao site
        </Link>
        <Link
          href="/simulacao"
          className="transition-colors hover:text-[var(--tinta)]"
          style={{ color: "var(--tinta-muda)" }}
        >
          Ver a simulação sem carteira
        </Link>
      </div>
    </div>
  );
}
