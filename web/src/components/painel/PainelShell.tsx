"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import dynamic from "next/dynamic";
import { useAwakeFL } from "@/lib/anchor/estado";
import { encurta, explorerConta } from "@/lib/anchor/program";
import ConexaoWallet from "./ConexaoWallet";
import {
  IconeContribuir,
  IconeExtrato,
  IconeRegras,
  IconeSair,
  IconeValidador,
  IconeVisaoGeral,
} from "./Icones";

const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false, loading: () => <div className="h-[38px] w-[168px]" /> },
);

const FAUCET = "https://faucet.solana.com";

const ITENS = [
  { href: "/painel", rotulo: "Visão Geral", Icone: IconeVisaoGeral },
  {
    href: "/painel/contribuir",
    rotulo: "Nova Contribuição",
    Icone: IconeContribuir,
  },
  { href: "/painel/extrato", rotulo: "Extrato", Icone: IconeExtrato },
  { href: "/painel/regras", rotulo: "Regras", Icone: IconeRegras },
  { href: "/painel/validador", rotulo: "Validador", Icone: IconeValidador },
];

export default function PainelShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { programId, conectado, erro, limparErro, saldoSol, publicKey } =
    useAwakeFL();
  const [menuAberto, setMenuAberto] = useState(false);

  // Sem Program ID não há o que mostrar: toda tela do painel lê contas do
  // programa. É melhor dizer isso uma vez aqui do que cinco vezes vazias.
  if (!programId) return <ProgramaNaoConfigurado />;

  if (!conectado) return <ConexaoWallet />;

  const semSaldo = saldoSol !== null && saldoSol < 0.01;

  return (
    <div className="flex min-h-screen">
      {/* Sidebar — fixa no desktop, gaveta no mobile */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col border-r px-4 py-6 transition-transform md:translate-x-0 ${
          menuAberto ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{
          borderColor: "var(--borda)",
          background: "var(--superficie-baixa)",
        }}
      >
        <Link href="/" className="px-3" onClick={() => setMenuAberto(false)}>
          <div className="text-2xl font-bold tracking-tight">
            <span style={{ color: "var(--acento-forte)" }}>Awake</span>
            <span style={{ color: "var(--tinta)" }}>FL</span>
          </div>
          <div
            className="rotulo mt-1"
            style={{ fontSize: 10, color: "var(--tinta-muda)" }}
          >
            Neon Graphite System
          </div>
        </Link>

        <nav className="mt-8 flex flex-col gap-1">
          {ITENS.map(({ href, rotulo, Icone }) => {
            // "/painel" só casa exato, senão ficaria ativo em todas as filhas.
            const ativo =
              href === "/painel"
                ? pathname === href
                : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setMenuAberto(false)}
                aria-current={ativo ? "page" : undefined}
                className="flex items-center gap-3 rounded px-3 py-2.5 text-sm transition-colors"
                style={{
                  color: ativo ? "var(--acento-forte)" : "var(--tinta-2)",
                  background: ativo ? "var(--acento-lavado)" : "transparent",
                  // A barra à esquerda é o que marca o item ativo nas telas —
                  // a cor sozinha não sobreviveria a um daltonismo verde.
                  boxShadow: ativo
                    ? "inset 3px 0 0 0 var(--acento)"
                    : undefined,
                  fontWeight: ativo ? 600 : 400,
                }}
              >
                <Icone />
                {rotulo}
              </Link>
            );
          })}
        </nav>

        <div
          className="mt-auto border-t pt-4"
          style={{ borderColor: "var(--borda)" }}
        >
          {publicKey && (
            <a
              href={explorerConta(publicKey)}
              target="_blank"
              rel="noopener noreferrer"
              className="mono block px-3 text-xs transition-colors hover:text-[var(--tinta)]"
              style={{ color: "var(--tinta-muda)" }}
            >
              {encurta(publicKey, 6)}
            </a>
          )}
          {saldoSol !== null && (
            <div
              className="mono tabular mt-1.5 px-3 text-xs"
              style={{ color: semSaldo ? "var(--aviso)" : "var(--tinta-muda)" }}
            >
              {saldoSol.toFixed(3)} SOL · devnet
            </div>
          )}
          <Link
            href="/"
            className="mt-3 flex items-center gap-3 rounded px-3 py-2.5 text-sm transition-colors hover:text-[var(--tinta)]"
            style={{ color: "var(--tinta-2)" }}
          >
            <IconeSair />
            Sair do painel
          </Link>
        </div>
      </aside>

      {/* Véu do menu mobile */}
      {menuAberto && (
        <button
          className="fixed inset-0 z-30 md:hidden"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setMenuAberto(false)}
          aria-label="Fechar menu"
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col md:pl-[260px]">
        {/* Barra superior: só o essencial, porque a navegação está na lateral */}
        <header
          className="sticky top-0 z-20 flex items-center gap-3 border-b px-5 py-3"
          style={{
            borderColor: "var(--borda)",
            background: "color-mix(in srgb, var(--plano) 82%, transparent)",
            backdropFilter: "blur(var(--vidro-desfoque))",
            WebkitBackdropFilter: "blur(var(--vidro-desfoque))",
          }}
        >
          <button
            className="btn-fantasma px-3 py-2 text-sm md:hidden"
            onClick={() => setMenuAberto(true)}
            aria-label="Abrir menu"
          >
            ☰
          </button>
          <span className="rotulo hidden md:block">Devnet · Solana</span>
          <div className="ml-auto">
            <WalletMultiButton />
          </div>
        </header>

        <main className="min-w-0 flex-1 px-5 py-8 md:px-8 md:py-10">
          {erro && (
            <div
              className="mb-6 flex items-start gap-3 rounded border p-4 text-sm"
              style={{
                borderColor: "var(--critico)",
                background: "var(--critico-lavado)",
              }}
            >
              <div className="min-w-0">
                <strong style={{ color: "var(--critico)" }}>Falhou:</strong>{" "}
                <span style={{ color: "var(--tinta-2)" }}>{erro}</span>
              </div>
              <button
                onClick={limparErro}
                className="ml-auto shrink-0 text-xs underline"
                style={{ color: "var(--tinta-muda)" }}
              >
                dispensar
              </button>
            </div>
          )}

          {semSaldo && (
            <div
              className="mb-6 rounded border p-4 text-sm"
              style={{
                borderColor: "var(--aviso)",
                background: "var(--superficie)",
              }}
            >
              <span style={{ color: "var(--tinta-2)" }}>
                Sua carteira está sem SOL de Devnet — toda conta criada aqui
                paga aluguel. Peça no{" "}
                <a
                  href={FAUCET}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                  style={{ color: "var(--acento)" }}
                >
                  faucet oficial
                </a>{" "}
                e recarregue.
              </span>
            </div>
          )}

          {children}
        </main>

        <footer
          className="border-t px-5 py-5 md:px-8"
          style={{ borderColor: "var(--borda)" }}
        >
          <div
            className="mono flex flex-wrap items-center justify-between gap-3 text-xs"
            style={{ color: "var(--tinta-muda)" }}
          >
            <span>AwakeFL · Neon Graphite Architecture</span>
            <span>
              Devnet da Solana — o SOL usado aqui não tem valor e as contas são
              públicas.
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}

function ProgramaNaoConfigurado() {
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-5 py-16">
      <div className="text-2xl font-bold tracking-tight">
        <span style={{ color: "var(--acento-forte)" }}>Awake</span>
        <span style={{ color: "var(--tinta)" }}>FL</span>
      </div>
      <div
        className="mt-6 rounded border p-6"
        style={{ borderColor: "var(--aviso)", background: "var(--superficie)" }}
      >
        <h1 className="text-lg font-semibold">
          Programa ainda não configurado
        </h1>
        <p
          className="mt-2 text-sm leading-relaxed"
          style={{ color: "var(--tinta-2)" }}
        >
          A área do participante fala com um programa Anchor publicado na
          Devnet, e nenhum Program ID foi informado. Depois do deploy, defina a
          variável de ambiente{" "}
          <code className="mono">NEXT_PUBLIC_PROGRAM_ID</code> com o endereço do
          programa e publique de novo.
        </p>
        <p className="mt-4 text-sm" style={{ color: "var(--tinta-2)" }}>
          Enquanto isso, a{" "}
          <Link
            href="/simulacao"
            className="underline"
            style={{ color: "var(--acento)" }}
          >
            simulação do ciclo
          </Link>{" "}
          mostra as mesmas regras sem precisar de carteira.
        </p>
      </div>
    </div>
  );
}
