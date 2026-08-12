import type { Metadata } from "next";
import SolanaProviders from "@/components/SolanaProviders";

export const metadata: Metadata = {
  title: "Devnet — AwakeFL",
  description:
    "Console on-chain do AwakeFL na Devnet da Solana: registre um participante, submeta contribuições e valide ou penalize com transações reais.",
};

export default function DevnetLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <SolanaProviders>{children}</SolanaProviders>;
}
