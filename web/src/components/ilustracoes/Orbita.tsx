/**
 * Os blocos em órbita, para o painel escuro.
 *
 * Os três estados do ciclo estão desenhados, e a legenda ao lado os nomeia:
 * bloco cheio = contribuição validada, contorno = aguardando validação,
 * vermelho cortado = participante banido. O corte no bloco vermelho é o que
 * diz "não tem volta" — o programa não expõe instrução que reverta banimento.
 */
export default function Orbita() {
  const blocoGrande = {
    esq: "M-46 -16 L0 7 L0 45 L-46 22 Z",
    dir: "M46 -16 L0 7 L0 45 L46 22 Z",
    topo: "M0 -39 L46 -16 L0 7 L-46 -16 Z",
  };
  const blocoMedio = {
    esq: "M-38 -13 L0 6 L0 38 L-38 19 Z",
    dir: "M38 -13 L0 6 L0 38 L38 19 Z",
    topo: "M0 -32 L38 -13 L0 6 L-38 -13 Z",
  };

  return (
    <svg
      width="100%"
      viewBox="0 0 580 520"
      aria-hidden
      className="block h-auto"
      style={{ aspectRatio: "580 / 520" }}
    >
      <defs>
        <linearGradient id="orb-topo" x1=".2" y1="0" x2=".8" y2="1">
          <stop offset="0%" stopColor="#d9ffc4" />
          <stop offset="100%" stopColor="#7cf044" />
        </linearGradient>
        <linearGradient id="orb-esq" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#43c41c" />
          <stop offset="100%" stopColor="#1e7a10" />
        </linearGradient>
        <linearGradient id="orb-dir" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2a9414" />
          <stop offset="100%" stopColor="#10520b" />
        </linearGradient>
      </defs>

      {/* Fios que descem até os blocos */}
      <g stroke="#9fe870" strokeWidth="1.5" opacity=".3">
        <path d="M150 0 L150 196" />
        <path d="M300 0 L300 120" />
        <path d="M452 0 L452 164" />
      </g>

      {/* Anéis de órbita */}
      <ellipse
        cx="290"
        cy="330"
        rx="236"
        ry="92"
        fill="none"
        stroke="#9fe870"
        strokeWidth="2"
        strokeDasharray="2 11"
        opacity=".5"
      />
      <ellipse
        cx="290"
        cy="330"
        rx="150"
        ry="58"
        fill="none"
        stroke="#4af403"
        strokeWidth="1.5"
        strokeDasharray="2 9"
        opacity=".45"
      />

      {/* A coluna central: a cadeia já selada */}
      <g>
        <ellipse cx="290" cy="356" rx="30" ry="15" fill="#2a9414" />
        <rect x="260" y="276" width="60" height="80" fill="#2a9414" />
        <ellipse cx="290" cy="276" rx="30" ry="15" fill="url(#orb-topo)" />
        <ellipse
          cx="290"
          cy="300"
          rx="30"
          ry="15"
          fill="none"
          stroke="#13300a"
          strokeWidth="1.5"
          opacity=".35"
        />
        <ellipse
          cx="290"
          cy="328"
          rx="30"
          ry="15"
          fill="none"
          stroke="#13300a"
          strokeWidth="1.5"
          opacity=".35"
        />
      </g>

      {/* Blocos cheios: já validados */}
      {[
        { x: 150, y: 196, atraso: "0s", f: blocoGrande },
        { x: 452, y: 164, atraso: "-2.4s", f: blocoGrande },
        { x: 300, y: 120, atraso: "-4.8s", f: blocoMedio },
        { x: 96, y: 388, atraso: "-1.3s", f: blocoMedio },
      ].map((b) => (
        <g key={`${b.x}-${b.y}`} transform={`translate(${b.x} ${b.y})`}>
          <g className="flutua" style={{ animationDelay: b.atraso }}>
            <g strokeLinejoin="round" strokeWidth="12">
              <path d={b.f.esq} fill="url(#orb-esq)" stroke="#2a9414" />
              <path d={b.f.dir} fill="url(#orb-dir)" stroke="#166610" />
              <path d={b.f.topo} fill="url(#orb-topo)" stroke="#9cf86e" />
            </g>
          </g>
        </g>
      ))}

      {/* Só contorno: aguardando validação */}
      <g transform="translate(500 330)">
        <g className="flutua" style={{ animationDelay: "-3.6s" }}>
          <g
            fill="none"
            stroke="#9fe870"
            strokeWidth="2.5"
            strokeLinejoin="round"
            opacity=".55"
          >
            <path d={blocoMedio.esq} />
            <path d={blocoMedio.dir} />
            <path d={blocoMedio.topo} />
          </g>
        </g>
      </g>
      <g transform="translate(166 286)">
        <g className="flutua" style={{ animationDelay: "-5.5s" }}>
          <g
            fill="none"
            stroke="#9fe870"
            strokeWidth="2.5"
            strokeLinejoin="round"
            opacity=".45"
          >
            <path d="M-30 -10 L0 5 L0 30 L-30 15 Z" />
            <path d="M30 -10 L0 5 L0 30 L30 15 Z" />
            <path d="M0 -25 L30 -10 L0 5 L-30 -10 Z" />
          </g>
        </g>
      </g>

      {/* Cortado: o banido */}
      <g transform="translate(392 430)">
        <g className="flutua" style={{ animationDelay: "-6.2s" }}>
          <g strokeLinejoin="round" strokeWidth="12">
            <path d={blocoMedio.esq} fill="#cb272f" stroke="#cb272f" />
            <path d={blocoMedio.dir} fill="#9e1d24" stroke="#9e1d24" />
            <path d={blocoMedio.topo} fill="#d93b42" stroke="#ff8a80" />
          </g>
          <path
            d="M-32 -6 L34 -22"
            stroke="#ffd9d6"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </g>
      </g>

      {/* Reflexos no piso */}
      <g opacity=".13">
        <g transform="translate(150 486) scale(1 -.5)">
          <path d={blocoGrande.esq} fill="#7cf044" />
          <path d={blocoGrande.dir} fill="#43c41c" />
        </g>
        <g transform="translate(452 466) scale(1 -.5)">
          <path d={blocoGrande.esq} fill="#7cf044" />
          <path d={blocoGrande.dir} fill="#43c41c" />
        </g>
      </g>

      <g fill="#9fe870" opacity=".8">
        <circle cx="42" cy="150" r="5" />
        <circle cx="540" cy="90" r="5" />
        <circle cx="252" cy="486" r="5" />
      </g>
    </svg>
  );
}
