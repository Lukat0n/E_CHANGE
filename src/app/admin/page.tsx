"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AdminDashboard from "./AdminDashboard";

interface Claim {
  id: string;
  orderNumber: string;
  type: string;
  description: string | null;
  photoUrl: string | null;
  status: string;
  adminNotes: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  shippingAddress: string | null;
  shippingNumber: string | null;
  shippingFloor: string | null;
  shippingNeighborhood: string | null;
  shippingCity: string | null;
  shippingProvince: string | null;
  shippingZipcode: string | null;
  shippingPhone: string | null;
  shippingRecipientName: string | null;
  shippingRecipientLastName: string | null;
  shippingMode: string | null;
  shippingMethodCode: string | null;
  shippingMethodName: string | null;
  shippingCost: number | null;
  paymentStatus: string | null;
  paymentId: string | null;
  paymentAmount: number | null;
  mpInitPoint: string | null;
  whatsappStatus: string | null;
  whatsappError: string | null;
  whatsappSentAt: string | Date | null;
  shipmentTrackingCode: string | null;
  shipmentTrackingUrl: string | null;
  shipmentRobotUrl: string | null;
  reorderOrderId: number | null;
  reorderOrderNumber: string | null;
  reorderAdminUrl: string | null;
  reorderCreatedAt: string | Date | null;
  createdAt: string | Date;
  store: { storeName: string | null; storeId: string };
}

export default function AdminPage() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/claims")
      .then((res) => {
        if (res.status === 401) {
          router.push("/admin/login");
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data) setClaims(data);
        setLoading(false);
      })
      .catch(() => {
        router.push("/admin/login");
      });
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500 text-lg">Cargando...</div>
      </div>
    );
  }

  const stats = {
    total: claims.length,
    pendiente: claims.filter((c) => c.status === "pendiente").length,
    aprobado: claims.filter((c) => c.status === "aprobado").length,
    rechazado: claims.filter((c) => c.status === "rechazado").length,
  };

  return <AdminDashboard initialClaims={claims} stats={stats} />;
}
