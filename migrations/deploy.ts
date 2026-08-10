// Executado por `anchor migrate` apos o deploy.
// No MVP nao fazemos nada aqui: o `initialize` e chamado pelos testes
// ou manualmente, para deixar o ciclo da demo explicito.
const anchor = require("@coral-xyz/anchor");

module.exports = async function (provider) {
  anchor.setProvider(provider);
};
