/**
 * A marca AwakeFL. O "Awake" é neon e o "FL" é tinta clara: a mesma quebra
 * usada nas telas do participante, para que o logotipo funcione como âncora
 * de cor do sistema inteiro.
 */
export default function Marca({
  subtitulo = false,
  tamanho = "md",
}: {
  subtitulo?: boolean;
  tamanho?: "md" | "lg";
}) {
  return (
    <div>
      <div
        className={`font-bold tracking-tight ${tamanho === "lg" ? "text-2xl" : "text-lg"}`}
      >
        <span style={{ color: "var(--acento-forte)" }}>Awake</span>
        <span style={{ color: "var(--tinta)" }}>FL</span>
      </div>
      {subtitulo && (
        <div
          className="rotulo mt-1"
          style={{ fontSize: 10, color: "var(--tinta-muda)" }}
        >
          Neon Graphite System
        </div>
      )}
    </div>
  );
}
