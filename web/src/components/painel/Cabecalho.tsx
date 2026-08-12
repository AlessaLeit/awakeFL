/**
 * Cabeçalho de tela do painel: título grande, subtítulo e uma ação à direita.
 * Repetido nas cinco telas, então vale um componente — é o que garante que o
 * ritmo vertical não derive de uma tela para a outra.
 */
export default function Cabecalho({
  titulo,
  subtitulo,
  acao,
}: {
  titulo: string;
  subtitulo?: string;
  acao?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
          {titulo}
        </h1>
        {subtitulo && (
          <p
            className="mt-2 max-w-2xl text-sm"
            style={{ color: "var(--tinta-2)" }}
          >
            {subtitulo}
          </p>
        )}
      </div>
      {acao}
    </div>
  );
}
