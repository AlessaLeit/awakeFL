import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // A demo simulada morava em /dashboard antes do dApp real existir.
      // O link já circulou, então a rota antiga continua valendo.
      { source: "/dashboard", destination: "/simulacao", permanent: false },
    ];
  },
};

export default nextConfig;
