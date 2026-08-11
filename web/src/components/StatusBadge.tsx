import type { StatusContribuicao } from "@/lib/simulation";

/**
 * Cor de status NUNCA carrega significado sozinha: cada badge traz
 * ícone + rótulo, porque na superfície clara o amarelo e o laranja
 * ficam abaixo de 3:1 de contraste.
 */
const MAPA: Record<StatusContribuicao, { icone: string; cor: string }> = {
  Aprovado: { icone: "✓", cor: "var(--bom)" },
  Rejeitado: { icone: "✕", cor: "var(--critico)" },
  Pendente: { icone: "•", cor: "var(--aviso)" },
  Banido: { icone: "⊘", cor: "var(--critico)" },
  Ausente: { icone: "–", cor: "var(--tinta-muda)" },
};

export default function StatusBadge({ status }: { status: StatusContribuicao }) {
  const { icone, cor } = MAPA[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium"
      style={{ borderColor: "var(--borda)", color: "var(--tinta-2)" }}
    >
      <span aria-hidden style={{ color: cor }}>
        {icone}
      </span>
      {status}
    </span>
  );
}
