"use client";

import { useSyncExternalStore } from "react";

type Tema = "light" | "dark";

const EVENTO = "fl-tema";

/**
 * O tema vive no DOM (atributo data-theme) e no localStorage — fora do React.
 * useSyncExternalStore é o jeito certo de ler estado externo: nada de
 * setState dentro de efeito, e a hidratação não descasa.
 */
function inscrever(callback: () => void) {
  window.addEventListener(EVENTO, callback);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", callback);
  return () => {
    window.removeEventListener(EVENTO, callback);
    mq.removeEventListener("change", callback);
  };
}

function lerCliente(): Tema {
  const marcado = document.documentElement.getAttribute("data-theme");
  if (marcado === "light" || marcado === "dark") return marcado;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// No servidor não há como saber a preferência: assume claro. Na hidratação o
// React re-renderiza com o valor real do cliente.
const lerServidor = (): Tema => "light";

export default function ThemeToggle() {
  const tema = useSyncExternalStore(inscrever, lerCliente, lerServidor);

  const alternar = () => {
    const proximo: Tema = tema === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", proximo);
    try {
      localStorage.setItem("tema", proximo);
    } catch {
      // modo privado / storage bloqueado: o tema vale só para esta página
    }
    window.dispatchEvent(new Event(EVENTO));
  };

  return (
    <button
      onClick={alternar}
      aria-label={tema === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro"}
      className="flex h-9 w-9 items-center justify-center rounded-lg border transition-colors"
      style={{ borderColor: "var(--borda)", color: "var(--tinta-2)" }}
    >
      <span aria-hidden className="text-base leading-none">
        {tema === "dark" ? "☀" : "☾"}
      </span>
    </button>
  );
}
