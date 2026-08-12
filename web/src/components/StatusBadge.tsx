import type { StatusContribuicao } from "@/lib/simulation";

/**
 * Cor de status NUNCA carrega significado sozinha: cada badge traz
 * ícone + rótulo. No grafite, o amarelo e o laranja ficam abaixo de 3:1
 * de contraste, então a forma precisa distinguir tanto quanto a cor.
 */
const MAPA: Record<StatusContribuicao, { icone: string; cor: string }> = {
  Aprovado: { icone: "✓", cor: "var(--bom)" },
  Rejeitado: { icone: "✕", cor: "var(--critico)" },
  Pendente: { icone: "•", cor: "var(--aviso)" },
  Banido: { icone: "⊘", cor: "var(--critico)" },
  Ausente: { icone: "–", cor: "var(--tinta-muda)" },
};

export default function StatusBadge({
  status,
}: {
  status: StatusContribuicao;
}) {
  const { icone, cor } = MAPA[status];
  return (
    <span
      className="chip"
      style={{
        borderColor: `color-mix(in srgb, ${cor} 40%, transparent)`,
        background: `color-mix(in srgb, ${cor} 8%, transparent)`,
      }}
    >
      <span aria-hidden style={{ color: cor }}>
        {icone}
      </span>
      {status}
    </span>
  );
}
