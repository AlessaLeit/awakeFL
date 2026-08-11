import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Demo — fl-reputation",
  description:
    "Simulação interativa do ciclo de reputação: registrar, contribuir, validar e penalizar um sleepy adversary.",
};

export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
