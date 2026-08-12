import type { Metadata } from "next";
import SolanaProviders from "@/components/SolanaProviders";
import PainelShell from "@/components/painel/PainelShell";
import { EstadoAwakeFL } from "@/lib/anchor/estado";

export const metadata: Metadata = {
  title: "Área do participante — AwakeFL",
  description:
    "Painel do participante de Federated Learning do AwakeFL: acompanhe sua reputação, submeta contribuições e audite o extrato das suas transações na Devnet da Solana.",
};

export default function PainelLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <SolanaProviders>
      <EstadoAwakeFL>
        <PainelShell>{children}</PainelShell>
      </EstadoAwakeFL>
    </SolanaProviders>
  );
}
