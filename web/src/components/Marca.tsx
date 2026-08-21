/**
 * A marca AwakeFL. O "Awake" é neon e o "FL" é tinta clara: a mesma quebra
 * usada nas telas do participante, para que o logotipo funcione como âncora
 * de cor do sistema inteiro.
 */
export default function Marca({ tamanho = "md" }: { tamanho?: "md" | "lg" }) {
  return (
    <div>
      <div
        className={`font-bold tracking-tight ${tamanho === "lg" ? "text-2xl" : "text-lg"}`}
      >
        <span style={{ color: "var(--acento-forte)" }}>Awake</span>
        <span style={{ color: "var(--tinta)" }}>FL</span>
      </div>
    </div>
  );
}
