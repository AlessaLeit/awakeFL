"use client";

import { useMemo } from "react";
import { Buffer } from "buffer";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { RPC_URL } from "@/lib/anchor/program";

import "@solana/wallet-adapter-react-ui/styles.css";
import "./wallet-adapter-tema.css";

// O Anchor e o borsh assumem `Buffer` global. O Next não injeta polyfill de
// Node no browser, então sem esta linha a primeira serialização quebra com
// "Buffer is not defined" — e só em produção, porque em dev alguma extensão
// costuma tê-lo definido.
if (typeof globalThis !== "undefined" && !globalThis.Buffer) {
  globalThis.Buffer = Buffer;
}

export default function SolanaProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  // Phantom e Solflare são registrados explicitamente; carteiras compatíveis com
  // o Wallet Standard aparecem sozinhas, sem precisar de adapter.
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );

  return (
    <ConnectionProvider endpoint={RPC_URL} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
