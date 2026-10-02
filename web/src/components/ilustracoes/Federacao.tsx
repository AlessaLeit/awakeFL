/**
 * A federação: quatro instituições mandando a atualização de pesos para o
 * agregador no centro, com os pacotes correndo pelos fios.
 *
 * O nó de baixo à direita tem a base VERMELHA. Não é enfeite: é o participante
 * que vai envenenar, e ele está desenhado antes de o texto falar dele.
 *
 * Os ids de gradiente levam prefixo `fed-` porque a página mostra duas
 * ilustrações, e id de SVG é global no documento.
 */
export default function Federacao() {
  return (
    <svg
      width="100%"
      viewBox="0 0 860 600"
      aria-hidden
      className="block h-auto"
      style={{ aspectRatio: "860 / 600" }}
    >
      <defs>
        <linearGradient id="fed-topo" x1="0" y1="0" x2=".7" y2="1">
          <stop offset="0%" stopColor="#b6ff93" />
          <stop offset="100%" stopColor="#5fe426" />
        </linearGradient>
        <linearGradient id="fed-esq" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2f9e1a" />
          <stop offset="100%" stopColor="#176c10" />
        </linearGradient>
        <linearGradient id="fed-dir" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1d7a13" />
          <stop offset="100%" stopColor="#0c4409" />
        </linearGradient>
        <linearGradient id="fed-base" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4af403" />
          <stop offset="100%" stopColor="#2faa02" />
        </linearGradient>
        <linearGradient id="fed-disco-topo" x1=".2" y1="0" x2=".8" y2="1">
          <stop offset="0%" stopColor="#eaffdf" />
          <stop offset="100%" stopColor="#9cf86e" />
        </linearGradient>
        <linearGradient id="fed-disco-lado" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6ee63a" />
          <stop offset="100%" stopColor="#2e9c14" />
        </linearGradient>
        <radialGradient id="fed-aura">
          <stop offset="0%" stopColor="#4af403" stopOpacity=".2" />
          <stop offset="100%" stopColor="#4af403" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse cx="430" cy="320" rx="300" ry="230" fill="url(#fed-aura)" />

      {/* Os fios: em fundo de papel, fio claro não existe — eles são tinta
          apagada, e os pacotes correm escuros por cima. */}
      <g
        stroke="#13300a"
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
        opacity=".16"
      >
        <path d="M430 300 L186 176" />
        <path d="M430 300 L674 176" />
        <path d="M430 300 L186 424" />
        <path d="M430 300 L674 424" />
      </g>
      <g
        stroke="#13300a"
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
        opacity=".75"
      >
        <path className="corre" d="M186 176 L430 300" />
        <path
          className="corre"
          d="M674 176 L430 300"
          style={{ animationDelay: "-.9s" }}
        />
        <path
          className="corre"
          d="M186 424 L430 300"
          style={{ animationDelay: "-1.7s" }}
        />
        <path
          className="corre"
          d="M674 424 L430 300"
          style={{ animationDelay: "-2.5s" }}
        />
      </g>

      {/* Instituições honestas */}
      {[
        { x: 150, y: 150, atraso: "0s" },
        { x: 674, y: 150, atraso: "-2.2s" },
        { x: 150, y: 424, atraso: "-1.1s" },
      ].map((no) => (
        <g key={`${no.x}-${no.y}`} transform={`translate(${no.x} ${no.y})`}>
          <g className="flutua" style={{ animationDelay: no.atraso }}>
            <g strokeLinejoin="round" strokeWidth="10">
              <path
                d="M0 22 L64 54 L0 86 L-64 54 Z"
                fill="url(#fed-base)"
                stroke="#4af403"
              />
              <path
                d="M-64 54 L0 86 L0 98 L-64 66 Z"
                fill="#2faa02"
                stroke="#2faa02"
              />
              <path
                d="M64 54 L0 86 L0 98 L64 66 Z"
                fill="#228202"
                stroke="#228202"
              />
              <path
                d="M-54 -19 L0 8 L0 52 L-54 25 Z"
                fill="url(#fed-esq)"
                stroke="#2a8f18"
              />
              <path
                d="M54 -19 L0 8 L0 52 L54 25 Z"
                fill="url(#fed-dir)"
                stroke="#166610"
              />
              <path
                d="M0 -46 L54 -19 L0 8 L-54 -19 Z"
                fill="url(#fed-topo)"
                stroke="#7aec45"
              />
            </g>
            <g fill="#13300a" opacity=".5">
              <circle cx="-38" cy="14" r="4" />
              <circle cx="-26" cy="20" r="4" />
            </g>
            <rect
              x="-48"
              y="30"
              width="30"
              height="7"
              rx="3.5"
              fill="#dffcc9"
              opacity=".8"
            />
          </g>
        </g>
      ))}

      {/* O agregador: o modelo global, em três discos */}
      <g transform="translate(430 300)">
        <g className="flutua" style={{ animationDelay: "-3.5s" }}>
          <ellipse cx="0" cy="88" rx="92" ry="46" fill="#13300a" opacity=".1" />
          {[50, 0, -50].map((topo) => (
            <g key={topo}>
              <ellipse
                cx="0"
                cy={topo + 26}
                rx="86"
                ry="43"
                fill="url(#fed-disco-lado)"
              />
              <rect
                x="-86"
                y={topo}
                width="172"
                height="26"
                fill="url(#fed-disco-lado)"
              />
              <ellipse
                cx="0"
                cy={topo}
                rx="86"
                ry="43"
                fill="url(#fed-disco-topo)"
              />
            </g>
          ))}
          <g fill="#13300a" opacity=".85">
            <circle cx="-62" cy="18" r="5" />
            <circle cx="-28" cy="34" r="5" />
            <circle cx="14" cy="36" r="5" />
            <circle cx="52" cy="24" r="5" />
            <circle cx="-62" cy="-32" r="5" />
            <circle cx="-20" cy="-16" r="5" />
            <circle cx="26" cy="-16" r="5" />
            <circle cx="62" cy="-30" r="5" />
          </g>
        </g>
      </g>

      {/* O nó que vai mentir: base vermelha, topo ainda verde */}
      <g transform="translate(674 424)">
        <g className="flutua" style={{ animationDelay: "-4.4s" }}>
          <g strokeLinejoin="round" strokeWidth="10">
            <path
              d="M0 22 L64 54 L0 86 L-64 54 Z"
              fill="#d93b42"
              stroke="#d93b42"
            />
            <path
              d="M-64 54 L0 86 L0 98 L-64 66 Z"
              fill="#cb272f"
              stroke="#cb272f"
            />
            <path
              d="M64 54 L0 86 L0 98 L64 66 Z"
              fill="#9e1d24"
              stroke="#9e1d24"
            />
            <path
              d="M-54 -19 L0 8 L0 52 L-54 25 Z"
              fill="#2a8f18"
              stroke="#2a8f18"
            />
            <path
              d="M54 -19 L0 8 L0 52 L54 25 Z"
              fill="#166610"
              stroke="#166610"
            />
            <path
              d="M0 -46 L54 -19 L0 8 L-54 -19 Z"
              fill="url(#fed-topo)"
              stroke="#7aec45"
            />
          </g>
          <g fill="#13300a" opacity=".5">
            <circle cx="-38" cy="14" r="4" />
            <circle cx="-26" cy="20" r="4" />
          </g>
          <rect
            x="-48"
            y="30"
            width="30"
            height="7"
            rx="3.5"
            fill="#ffd9d6"
            opacity=".9"
          />
        </g>
      </g>

      {/* Marcas soltas da prancha */}
      <g fill="#13300a" opacity=".3">
        <rect x="76" y="292" width="26" height="7" rx="3.5" />
        <rect x="85.5" y="282.5" width="7" height="26" rx="3.5" />
        <rect x="760" y="310" width="24" height="6.5" rx="3.25" />
        <rect x="768.75" y="301.25" width="6.5" height="24" rx="3.25" />
        <circle cx="430" cy="548" r="7" />
        <circle cx="112" cy="64" r="6" />
        <circle cx="790" cy="470" r="6" />
        <circle cx="430" cy="40" r="5" />
      </g>
    </svg>
  );
}
