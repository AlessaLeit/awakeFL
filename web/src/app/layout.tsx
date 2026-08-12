import type { Metadata } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/* Geist na interface, JetBrains Mono em rótulos, hashes e métricas — a dupla
   definida pelo design system. As variáveis são consumidas em globals.css. */
const geist = Geist({
  subsets: ["latin"],
  variable: "--fonte-geist",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--fonte-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AwakeFL — Reputação on-chain para Federated Learning",
  description:
    "Camada de reputação descentralizada na Solana que registra cada contribuição de treinamento de forma imutável, mede confiança continuamente e bane participantes que envenenam o modelo.",
  openGraph: {
    title: "AwakeFL — Reputação on-chain para Federated Learning",
    description:
      "Prove quem envenenou o modelo. Reputação imutável, auditável e sem autoridade central.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // Extensões de browser costumam injetar atributos no <body> antes do React
    // carregar (cz-shortcut-listen, grammarly, etc.), o que dispara um aviso de
    // hidratação que não é um defeito do site.
    <html lang="pt-BR" className={`${geist.variable} ${mono.variable}`}>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
