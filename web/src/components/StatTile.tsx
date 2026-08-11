export default function StatTile({
  rotulo,
  valor,
  nota,
  tom = "neutro",
}: {
  rotulo: string;
  valor: string | number;
  nota?: string;
  tom?: "neutro" | "critico" | "bom";
}) {
  const corValor =
    tom === "critico"
      ? "var(--critico)"
      : tom === "bom"
        ? "var(--texto-bom)"
        : "var(--tinta)";

  return (
    <div
      className="rounded-xl border p-4"
      style={{ borderColor: "var(--borda)", background: "var(--superficie)" }}
    >
      <div className="text-xs" style={{ color: "var(--tinta-2)" }}>
        {rotulo}
      </div>
      {/* Figuras proporcionais: tabular-nums deixa números grandes frouxos */}
      <div className="mt-1.5 text-3xl font-semibold leading-none" style={{ color: corValor }}>
        {valor}
      </div>
      {nota && (
        <div className="mt-1.5 text-xs" style={{ color: "var(--tinta-muda)" }}>
          {nota}
        </div>
      )}
    </div>
  );
}
