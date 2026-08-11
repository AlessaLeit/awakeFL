import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "fl-reputation — Reputação on-chain para Federated Learning",
  description:
    "Camada de reputação descentralizada na Solana que registra cada contribuição de treinamento de forma imutável, mede confiança continuamente e bane participantes que envenenam o modelo.",
  openGraph: {
    title: "fl-reputation — Reputação on-chain para Federated Learning",
    description:
      "Prove quem envenenou o modelo. Reputação imutável, auditável e sem autoridade central.",
    type: "website",
  },
};

/**
 * Aplica o tema antes da primeira pintura. Sem isto, quem escolheu o tema
 * escuro vê um flash branco a cada navegação.
 */
const scriptTema = `
(function () {
  try {
    var t = localStorage.getItem("tema");
    if (t === "dark" || t === "light") {
      document.documentElement.setAttribute("data-theme", t);
    }
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: scriptTema }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
