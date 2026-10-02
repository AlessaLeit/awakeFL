/**
 * A marca AwakeFL: um quadrado 2×2 e o nome em tinta.
 *
 * O lima aparece em UM dos quatro quadrantes, como preenchimento — nunca na
 * palavra. É a mesma regra do sistema inteiro, aplicada no menor elemento
 * possível: o logotipo demonstra a regra em vez de abrir exceção para ela.
 */
export default function Marca({ tamanho = "md" }: { tamanho?: "md" | "lg" }) {
  const grande = tamanho === "lg";

  return (
    <span
      className={`inline-flex items-center font-bold tracking-[-0.03em] ${
        grande ? "gap-3 text-2xl" : "gap-2.5 text-xl"
      }`}
      style={{ color: "var(--tinta)" }}
    >
      <span
        aria-hidden
        className={`grid grid-cols-2 ${grande ? "h-6 w-6 gap-[2.5px]" : "h-5 w-5 gap-[2px]"}`}
      >
        <span style={{ background: "var(--tinta)" }} />
        <span
          style={{
            background: "var(--plano)",
            border: "1px solid var(--acento)",
          }}
        />
        <span style={{ background: "var(--acento)" }} />
        <span style={{ background: "var(--tinta)" }} />
      </span>
      AwakeFL
    </span>
  );
}
