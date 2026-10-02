/**
 * A moldura do sistema editorial: calhas hachuradas e uma coluna de 1200px
 * com fio vertical nos dois lados.
 *
 * Os fios são o que as cruzes de cada seção ancoram — por isso a coluna
 * precisa envolver nav, conteúdo e rodapé juntos. Se cada bloco tivesse a sua
 * própria coluna, os fios teriam emendas.
 */
export default function Coluna({ children }: { children: React.ReactNode }) {
  return (
    <div className="hachura min-h-screen px-4 sm:px-6">
      <div
        className="mx-auto max-w-[1200px] border-x"
        style={{ borderColor: "var(--borda)", background: "var(--plano)" }}
      >
        {children}
      </div>
    </div>
  );
}
