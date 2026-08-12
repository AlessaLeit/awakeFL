export default function StatTile({
  rotulo,
  valor,
  nota,
  tom = "neutro",
  icone,
}: {
  rotulo: string;
  valor: string | number;
  nota?: string;
  tom?: "neutro" | "critico" | "bom" | "neon";
  /** Glifo curto à direita do rótulo, como nos painéis das telas do participante. */
  icone?: string;
}) {
  const corValor =
    tom === "critico"
      ? "var(--critico)"
      : tom === "bom"
        ? "var(--texto-bom)"
        : tom === "neon"
          ? "var(--acento)"
          : "var(--tinta)";

  return (
    <div className="vidro p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="rotulo">{rotulo}</div>
        {icone && (
          <span
            aria-hidden
            className="text-sm"
            style={{ color: "var(--acento)" }}
          >
            {icone}
          </span>
        )}
      </div>
      {/* Figuras proporcionais: tabular-nums deixa números grandes frouxos */}
      <div
        className={`mt-2 text-3xl font-semibold leading-none ${tom === "neon" ? "neon" : ""}`}
        style={tom === "neon" ? undefined : { color: corValor }}
      >
        {valor}
      </div>
      {nota && (
        <div className="mt-2 text-xs" style={{ color: "var(--tinta-muda)" }}>
          {nota}
        </div>
      )}
    </div>
  );
}
