import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AdminDashboard from "./AdminDashboard";

export default async function AdminPage() {
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    redirect("/admin/login");
  }

  const claims = await prisma.claim.findMany({
    include: { store: { select: { storeName: true, storeId: true } } },
    orderBy: { createdAt: "desc" },
  });

  const stats = {
    total: claims.length,
    pendiente: claims.filter((c) => c.status === "pendiente").length,
    aprobado: claims.filter((c) => c.status === "aprobado").length,
    rechazado: claims.filter((c) => c.status === "rechazado").length,
  };

  return <AdminDashboard initialClaims={claims} stats={stats} />;
}
