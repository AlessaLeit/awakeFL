import type { Metadata } from "next";
import SolanaProviders from "@/components/SolanaProviders";

export const metadata: Metadata = {
  title: "Devnet — fl-reputation",
  description:
    "Console on-chain do fl-reputation na Devnet da Solana: registre um participante, submeta contribuições e valide ou penalize com transações reais.",
};

export default function DevnetLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <SolanaProviders>{children}</SolanaProviders>;
}
