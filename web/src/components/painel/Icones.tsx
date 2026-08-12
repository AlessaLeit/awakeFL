/**
 * Ícones do painel, em SVG inline.
 *
 * São desenhados na malha de 24 e herdam a cor do texto (`currentColor`), o que
 * permite que o item ativo da sidebar acenda junto com o rótulo. Inline em vez
 * de uma biblioteca de ícones porque são sete glifos: uma dependência inteira
 * para isso pesaria mais do que o arquivo.
 */

type Props = { className?: string };

const base = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function IconeVisaoGeral({ className }: Props) {
  return (
    <svg {...base} className={className}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export function IconeContribuir({ className }: Props) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

export function IconeExtrato({ className }: Props) {
  return (
    <svg {...base} className={className}>
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-3-2-3 2-3-2-3 2V4a1 1 0 0 1 1-1Z" />
      <path d="M9 8h6M9 12h6" />
    </svg>
  );
}

export function IconeRegras({ className }: Props) {
  return (
    <svg {...base} className={className}>
      <path d="m4 20 9-9M8 7l6 6" />
      <path d="m11 4 4 4M14 1l6 6-3 3-6-6z" />
    </svg>
  );
}

export function IconeValidador({ className }: Props) {
  return (
    <svg {...base} className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9h5M7 13h5M15.5 12l1.5 1.5 3-3" />
    </svg>
  );
}

export function IconeCarteira({ className }: Props) {
  return (
    <svg {...base} className={className}>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <circle cx="16.5" cy="14.5" r="1.2" />
    </svg>
  );
}

export function IconeCadeado({ className }: Props) {
  return (
    <svg {...base} className={className}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function IconeSair({ className }: Props) {
  return (
    <svg {...base} className={className}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5M21 12H9" />
    </svg>
  );
}

export function IconeAtualizar({ className }: Props) {
  return (
    <svg {...base} className={className}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}
