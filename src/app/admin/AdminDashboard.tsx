"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
  createdAt: string | Date;
  store: { storeName: string | null; storeId: string };
}

interface Stats {
  total: number;
  pendiente: number;
  aprobado: number;
  rechazado: number;
}

export default function AdminDashboard({
  initialClaims,
  stats,
}: {
  initialClaims: Claim[];
  stats: Stats;
}) {
  const [claims, setClaims] = useState(initialClaims);
  const [filter, setFilter] = useState("todos");
  const [typeFilter, setTypeFilter] = useState("todos");
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [adminNotes, setAdminNotes] = useState("");
  const [updating, setUpdating] = useState(false);
  const [editingPhone, setEditingPhone] = useState<{ customer: string; shipping: string } | null>(null);
  const [savingPhone, setSavingPhone] = useState(false);
  const [testingRobot, setTestingRobot] = useState(false);
  const [robotResult, setRobotResult] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [robotDebug, setRobotDebug] = useState<any | null>(null);
  const [inspectUrl, setInspectUrl] = useState("https://gelica.mitiendanube.com/admin/apps/envionube/ar#/create-single-shipment");
  const router = useRouter();

  const filteredClaims = claims.filter((c) => {
    if (filter !== "todos" && c.status !== filter) return false;
    if (typeFilter !== "todos" && c.type !== typeFilter) return false;
    return true;
  });

  async function updateClaim(id: string, status: string) {
    setUpdating(true);
    const res = await fetch(`/api/claims/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, adminNotes }),
    });

    if (res.ok) {
      const updated = await res.json();
      setClaims(claims.map((c) => (c.id === id ? { ...c, ...updated } : c)));
      setSelectedClaim(null);
      setAdminNotes("");
      router.refresh();
    }
    setUpdating(false);
  }

  function copyShippingData(claim: Claim) {
    const isPickup = claim.shippingMode === "sucursal";
    const lines = [
      claim.shippingMethodName ? `Método: ${claim.shippingMethodName}` : "",
      claim.shippingCost != null ? `Costo envío: $${claim.shippingCost.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "",
      `Modo: ${isPickup ? "Retiro en sucursal" : "Envío a domicilio"}`,
      `CP: ${claim.shippingZipcode}`,
      `Provincia: ${claim.shippingProvince}`,
      `Ciudad: ${claim.shippingCity}`,
      !isPickup ? `Calle: ${claim.shippingAddress}` : "",
      !isPickup ? `Número: ${claim.shippingNumber}` : "",
      !isPickup && claim.shippingFloor ? `Depto: ${claim.shippingFloor}` : "",
      !isPickup && claim.shippingNeighborhood ? `Barrio: ${claim.shippingNeighborhood}` : "",
      `Nombre: ${claim.shippingRecipientName || ""}${claim.shippingRecipientLastName ? ` ${claim.shippingRecipientLastName}` : ""}`,
      `Email: ${claim.customerEmail || ""}`,
      `Tel: ${claim.shippingPhone || ""}`,
    ].filter(Boolean).join("\n");
    navigator.clipboard.writeText(lines);
    alert("Datos de envío copiados al portapapeles");
  }

  async function testRobotLogin() {
    setTestingRobot(true);
    setRobotResult(null);
    setRobotDebug(null);
    try {
      const res = await fetch("/api/worker/test-login", { method: "POST" });
      const data = await res.json();
      if (data.ok && data.loggedIn) {
        setRobotResult(`✅ Login OK — URL final: ${data.url}`);
      } else {
        setRobotResult(`⚠️ ${data.error || `Login falló (url: ${data.url || "?"})`}`);
        if (data.url || data.visibleInputs || data.screenshot) {
          setRobotDebug(data);
        }
      }
    } catch (err) {
      setRobotResult(`❌ ${err instanceof Error ? err.message : "Error"}`);
    } finally {
      setTestingRobot(false);
    }
  }

  async function testCreateShipment() {
    setTestingRobot(true);
    setRobotResult(null);
    setRobotDebug(null);
    try {
      const res = await fetch("/api/worker/shipment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "domicilio",
          destZip: "1425",
          alto: 10,
          ancho: 15,
          profundidad: 10,
          peso: 500,
          valor: 15000,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        setRobotResult(`❌ ${data.error || `HTTP ${res.status}`}`);
      } else {
        setRobotResult(`🧪 Dry run OK — ${data.url}`);
      }
      setRobotDebug(data);
    } catch (err) {
      setRobotResult(`❌ ${err instanceof Error ? err.message : "Error"}`);
    } finally {
      setTestingRobot(false);
    }
  }

  async function inspectRobotUrl() {
    setTestingRobot(true);
    setRobotResult(null);
    setRobotDebug(null);
    try {
      const res = await fetch("/api/worker/inspect-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: inspectUrl }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        setRobotResult(`❌ ${data.error || `HTTP ${res.status}`}`);
        if (data.url || data.visibleInputs || data.screenshot) {
          setRobotDebug(data);
        }
      } else {
        setRobotResult(`📄 Inspección OK — URL final: ${data.url || inspectUrl}`);
        setRobotDebug(data);
      }
    } catch (err) {
      setRobotResult(`❌ ${err instanceof Error ? err.message : "Error"}`);
    } finally {
      setTestingRobot(false);
    }
  }

  async function savePhone(id: string) {
    if (!editingPhone) return;
    setSavingPhone(true);
    const res = await fetch(`/api/claims/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerPhone: editingPhone.customer,
        shippingPhone: editingPhone.shipping,
      }),
    });
    if (res.ok) {
      const updated = await res.json();
      setClaims(claims.map((c) => (c.id === id ? { ...c, ...updated } : c)));
      if (selectedClaim?.id === id) setSelectedClaim({ ...selectedClaim, ...updated });
      setEditingPhone(null);
    }
    setSavingPhone(false);
  }

  async function deleteClaim(id: string) {
    if (!confirm("¿Estás seguro de eliminar este reclamo?")) return;
    const res = await fetch(`/api/claims/${id}`, { method: "DELETE" });
    if (res.ok) {
      setClaims(claims.filter((c) => c.id !== id));
      setSelectedClaim(null);
      router.refresh();
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/admin/login");
  }

  function typeLabel(type: string) {
    switch (type) {
      case "reclamo": return "Reclamo";
      case "cambio": return "Cambio";
      case "no_recibido": return "No recibido";
      case "reenvio": return "Reenvío";
      default: return type;
    }
  }

  function typeBadgeColor(type: string) {
    switch (type) {
      case "reclamo": return "bg-red-100 text-red-700";
      case "cambio": return "bg-yellow-100 text-yellow-700";
      case "no_recibido": return "bg-purple-100 text-purple-700";
      case "reenvio": return "bg-blue-100 text-blue-700";
      default: return "bg-gray-100 text-gray-700";
    }
  }

  function paymentLabel(status: string | null) {
    switch (status) {
      case "approved": return "Pagado";
      case "pending": case "in_process": return "Pago pendiente";
      case "rejected": return "Pago rechazado";
      case "cancelled": return "Pago cancelado";
      case "refunded": return "Pago reembolsado";
      default: return null;
    }
  }

  function paymentBadgeColor(status: string | null) {
    switch (status) {
      case "approved": return "bg-green-100 text-green-700";
      case "pending": case "in_process": return "bg-orange-100 text-orange-700";
      case "rejected": case "cancelled": return "bg-red-100 text-red-700";
      case "refunded": return "bg-gray-100 text-gray-700";
      default: return "bg-gray-100 text-gray-700";
    }
  }

  function statusBadgeColor(status: string) {
    switch (status) {
      case "pendiente": return "bg-orange-100 text-orange-700";
      case "aprobado": return "bg-green-100 text-green-700";
      case "rechazado": return "bg-red-100 text-red-700";
      default: return "bg-gray-100 text-gray-700";
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">E-Change Admin</h1>
            <p className="text-gray-500 text-sm">Panel de gestión de reclamos</p>
          </div>
          <button
            onClick={handleLogout}
            className="text-gray-500 hover:text-gray-700 text-sm font-medium"
          >
            Cerrar sesión
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl p-4 shadow-sm border">
            <p className="text-sm text-gray-500">Total</p>
            <p className="text-3xl font-bold text-gray-900">{stats.total}</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border">
            <p className="text-sm text-orange-600">Pendientes</p>
            <p className="text-3xl font-bold text-orange-600">{stats.pendiente}</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border">
            <p className="text-sm text-green-600">Aprobados</p>
            <p className="text-3xl font-bold text-green-600">{stats.aprobado}</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border">
            <p className="text-sm text-red-600">Rechazados</p>
            <p className="text-3xl font-bold text-red-600">{stats.rechazado}</p>
          </div>
        </div>

        {/* Robot panel (Fase 1) */}
        <div className="bg-white rounded-xl p-4 shadow-sm border mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900">Robot Envío Nube</p>
              <p className="text-xs text-gray-500">
                Login y navegación al admin de Tiendanube.
                {robotResult && <span className="ml-2 font-medium">{robotResult}</span>}
              </p>
            </div>
            <button
              onClick={testRobotLogin}
              disabled={testingRobot}
              className="bg-gray-900 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-gray-800 transition disabled:opacity-50"
            >
              {testingRobot ? "..." : "Test login"}
            </button>
          </div>

          {/* Inspeccionar URL del admin */}
          <div className="mt-3 flex flex-wrap items-center gap-2 pt-3 border-t border-gray-100">
            <input
              type="text"
              value={inspectUrl}
              onChange={(e) => setInspectUrl(e.target.value)}
              className="flex-1 min-w-[200px] border border-gray-300 rounded px-2 py-1 text-xs text-gray-900 font-mono"
              placeholder="URL del admin para inspeccionar"
            />
            <button
              onClick={inspectRobotUrl}
              disabled={testingRobot || !inspectUrl}
              className="bg-blue-600 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-blue-700 transition disabled:opacity-50"
            >
              {testingRobot ? "..." : "Inspeccionar URL"}
            </button>
            <button
              onClick={testCreateShipment}
              disabled={testingRobot}
              className="bg-green-600 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-green-700 transition disabled:opacity-50"
            >
              {testingRobot ? "..." : "Probar dry run envío"}
            </button>
          </div>

          {robotDebug && (
            <details className="mt-3" open>
              <summary className="text-xs font-medium text-gray-700 cursor-pointer">Ver debug del robot</summary>
              <div className="mt-2 space-y-2 text-xs">
                {robotDebug.url && (
                  <div className="bg-gray-50 rounded p-2 break-all">
                    <span className="font-medium">URL final:</span> {robotDebug.url}
                  </div>
                )}
                {robotDebug.title && (
                  <div className="bg-gray-50 rounded p-2">
                    <span className="font-medium">Título:</span> {robotDebug.title}
                  </div>
                )}
                {robotDebug.visibleInputs && (
                  <div className="bg-gray-50 rounded p-2">
                    <span className="font-medium block mb-1">Inputs en la página ({robotDebug.visibleInputs.length}):</span>
                    <pre className="text-[10px] overflow-x-auto">{JSON.stringify(robotDebug.visibleInputs, null, 2)}</pre>
                  </div>
                )}
                {robotDebug.forms && robotDebug.forms.length > 0 && (
                  <div className="bg-gray-50 rounded p-2">
                    <span className="font-medium block mb-1">Forms en la página ({robotDebug.forms.length}):</span>
                    <pre className="text-[10px] overflow-x-auto">{JSON.stringify(robotDebug.forms, null, 2)}</pre>
                  </div>
                )}
                {robotDebug.bodyHtmlSnippet && (
                  <div className="bg-gray-50 rounded p-2">
                    <span className="font-medium block mb-1">HTML del body (primeros 2000 chars):</span>
                    <pre className="text-[10px] overflow-x-auto whitespace-pre-wrap break-all">{robotDebug.bodyHtmlSnippet}</pre>
                  </div>
                )}
                {robotDebug.screenshot && (
                  <div>
                    <p className="font-medium mb-1">Screenshot:</p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`data:image/jpeg;base64,${robotDebug.screenshot}`}
                      alt="screenshot"
                      className="border rounded max-w-full"
                    />
                  </div>
                )}
              </div>
            </details>
          )}
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl p-4 shadow-sm border mb-6 flex flex-wrap gap-3">
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Estado</label>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
            >
              <option value="todos">Todos</option>
              <option value="pendiente">Pendientes</option>
              <option value="aprobado">Aprobados</option>
              <option value="rechazado">Rechazados</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Tipo</label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
            >
              <option value="todos">Todos</option>
              <option value="reclamo">Reclamo</option>
              <option value="cambio">Cambio</option>
              <option value="no_recibido">No recibido</option>
              <option value="reenvio">Reenvío</option>
            </select>
          </div>
        </div>

        {/* Claims list */}
        <div className="space-y-3">
          {filteredClaims.length === 0 ? (
            <div className="bg-white rounded-xl p-8 text-center text-gray-500 shadow-sm border">
              No hay reclamos {filter !== "todos" ? `con estado "${filter}"` : ""}
            </div>
          ) : (
            filteredClaims.map((claim) => (
              <div
                key={claim.id}
                className="bg-white rounded-xl p-4 shadow-sm border hover:shadow-md transition cursor-pointer"
                onClick={() => {
                  setSelectedClaim(claim);
                  setAdminNotes(claim.adminNotes || "");
                }}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900">
                        Orden #{claim.orderNumber}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeBadgeColor(claim.type)}`}>
                        {typeLabel(claim.type)}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadgeColor(claim.status)}`}>
                        {claim.status.charAt(0).toUpperCase() + claim.status.slice(1)}
                      </span>
                      {paymentLabel(claim.paymentStatus) && (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${paymentBadgeColor(claim.paymentStatus)}`}>
                          {paymentLabel(claim.paymentStatus)}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 mt-1 truncate">
                      {claim.customerName} - {claim.customerEmail}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      {new Date(claim.createdAt).toLocaleDateString("es-AR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  {claim.photoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={claim.photoUrl}
                      alt="Foto"
                      className="w-16 h-16 object-cover rounded-lg"
                    />
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Claim detail modal */}
      {selectedClaim && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-xl font-bold text-gray-900">
                  Orden #{selectedClaim.orderNumber}
                </h2>
                <button
                  onClick={() => setSelectedClaim(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeBadgeColor(selectedClaim.type)}`}>
                    {typeLabel(selectedClaim.type)}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadgeColor(selectedClaim.status)}`}>
                    {selectedClaim.status.charAt(0).toUpperCase() + selectedClaim.status.slice(1)}
                  </span>
                  {paymentLabel(selectedClaim.paymentStatus) && (
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${paymentBadgeColor(selectedClaim.paymentStatus)}`}>
                      {paymentLabel(selectedClaim.paymentStatus)}
                    </span>
                  )}
                </div>

                {selectedClaim.whatsappStatus && (
                  <div className={`rounded-lg p-3 text-sm ${selectedClaim.whatsappStatus === "sent" ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
                    <p className="font-medium text-gray-900">
                      {selectedClaim.whatsappStatus === "sent" ? "WhatsApp enviado" : "WhatsApp falló"}
                    </p>
                    {selectedClaim.whatsappSentAt && selectedClaim.whatsappStatus === "sent" && (
                      <p className="text-xs text-gray-600 mt-0.5">
                        {new Date(selectedClaim.whatsappSentAt).toLocaleString("es-AR")}
                      </p>
                    )}
                    {selectedClaim.whatsappError && (
                      <p className="text-xs text-red-700 mt-0.5">{selectedClaim.whatsappError}</p>
                    )}
                  </div>
                )}

                {(selectedClaim.paymentStatus || selectedClaim.paymentAmount) && (
                  <div className="bg-gray-50 rounded-lg p-3 space-y-1 text-sm">
                    <p className="font-medium text-gray-900">Pago (Mercado Pago)</p>
                    {selectedClaim.paymentAmount != null && (
                      <p><span className="font-medium text-gray-700">Monto:</span> ${selectedClaim.paymentAmount.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    )}
                    {selectedClaim.paymentId && (
                      <p><span className="font-medium text-gray-700">ID:</span> <span className="font-mono text-xs">{selectedClaim.paymentId}</span></p>
                    )}
                    {selectedClaim.paymentStatus === "pending" && selectedClaim.mpInitPoint && (
                      <a href={selectedClaim.mpInitPoint} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline text-sm">
                        Ver link de pago →
                      </a>
                    )}
                  </div>
                )}

                <div className="bg-gray-50 rounded-lg p-3 space-y-2 text-sm">
                  <p><span className="font-medium text-gray-700">Cliente:</span> <span className="text-gray-900">{selectedClaim.customerName}</span></p>
                  <p><span className="font-medium text-gray-700">Email:</span> <span className="text-gray-900">{selectedClaim.customerEmail}</span></p>

                  {/* Teléfonos editables */}
                  {!editingPhone ? (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <p>
                          <span className="font-medium text-gray-700">Teléfono cliente:</span>{" "}
                          <span className="text-gray-900">{selectedClaim.customerPhone || <span className="italic text-gray-400">sin teléfono</span>}</span>
                        </p>
                        <button
                          onClick={() => setEditingPhone({
                            customer: selectedClaim.customerPhone || "",
                            shipping: selectedClaim.shippingPhone || "",
                          })}
                          className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                        >
                          Editar
                        </button>
                      </div>
                      {selectedClaim.shippingPhone && selectedClaim.shippingPhone !== selectedClaim.customerPhone && (
                        <p>
                          <span className="font-medium text-gray-700">Teléfono envío:</span>{" "}
                          <span className="text-gray-900">{selectedClaim.shippingPhone}</span>
                        </p>
                      )}
                      <p className="text-xs text-gray-500">
                        WhatsApp se manda a: <span className="font-mono">{selectedClaim.shippingPhone || selectedClaim.customerPhone || "—"}</span>
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2 bg-white border border-gray-200 rounded p-2">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-0.5">Teléfono cliente</label>
                        <input
                          type="tel"
                          value={editingPhone.customer}
                          onChange={(e) => setEditingPhone({ ...editingPhone, customer: e.target.value })}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-sm text-gray-900"
                          placeholder="Ej: 1155667788"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-0.5">Teléfono envío</label>
                        <input
                          type="tel"
                          value={editingPhone.shipping}
                          onChange={(e) => setEditingPhone({ ...editingPhone, shipping: e.target.value })}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-sm text-gray-900"
                          placeholder="Si es distinto al del cliente"
                        />
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => setEditingPhone(null)}
                          disabled={savingPhone}
                          className="flex-1 border border-gray-300 text-gray-700 py-1 rounded text-xs font-medium hover:bg-gray-50 transition"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={() => savePhone(selectedClaim.id)}
                          disabled={savingPhone}
                          className="flex-1 bg-blue-600 text-white py-1 rounded text-xs font-medium hover:bg-blue-700 transition disabled:opacity-50"
                        >
                          {savingPhone ? "Guardando..." : "Guardar"}
                        </button>
                      </div>
                    </div>
                  )}

                  <p><span className="font-medium text-gray-700">Fecha:</span> <span className="text-gray-900">{new Date(selectedClaim.createdAt).toLocaleDateString("es-AR", {
                    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
                  })}</span></p>
                </div>

                <div>
                  <p className="text-sm font-medium text-gray-700 mb-1">Descripción:</p>
                  <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">
                    {selectedClaim.description || "Sin descripción"}
                  </p>
                </div>

                {(selectedClaim.type === "cambio" || selectedClaim.type === "reenvio") && (selectedClaim.shippingZipcode || selectedClaim.shippingMode) && (
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-1">
                      {selectedClaim.type === "reenvio"
                        ? "Datos del reenvío:"
                        : selectedClaim.shippingMode === "presencial"
                          ? "Retiro presencial en depósito:"
                          : selectedClaim.shippingMode === "sucursal"
                            ? "Retiro en sucursal (cambio):"
                            : "Dirección de envío (cambio):"}
                    </p>
                    <div className={`${selectedClaim.shippingMode === "presencial" ? "bg-green-50 border-green-200" : "bg-blue-50 border-blue-200"} border rounded-lg p-3 space-y-1 text-sm`}>
                      {selectedClaim.shippingMethodName && (
                        <div className="flex justify-between pb-1 mb-1 border-b border-blue-200">
                          <span className="font-medium text-gray-900">{selectedClaim.shippingMethodName}</span>
                          {selectedClaim.shippingCost != null && (
                            <span className="font-semibold text-gray-900">
                              {selectedClaim.shippingCost === 0
                                ? "Gratis"
                                : `$${selectedClaim.shippingCost.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                            </span>
                          )}
                        </div>
                      )}
                      <p className="font-medium text-gray-900">
                        {selectedClaim.shippingRecipientName}{selectedClaim.shippingRecipientLastName ? ` ${selectedClaim.shippingRecipientLastName}` : ""}
                      </p>
                      {selectedClaim.shippingMode === "presencial" ? (
                        <p className="text-gray-700">Coordinar retiro en <strong>La Espuela 2757, Ituzaingó</strong> (día y horario a coordinar).</p>
                      ) : (
                        <>
                          {selectedClaim.shippingMode !== "sucursal" && selectedClaim.shippingAddress && (
                            <p className="text-gray-900">
                              {selectedClaim.shippingAddress} {selectedClaim.shippingNumber}
                              {selectedClaim.shippingFloor ? ` - ${selectedClaim.shippingFloor}` : ""}
                            </p>
                          )}
                          {selectedClaim.shippingMode !== "sucursal" && selectedClaim.shippingNeighborhood && (
                            <p className="text-gray-700">Barrio: {selectedClaim.shippingNeighborhood}</p>
                          )}
                          <p className="text-gray-700">
                            {selectedClaim.shippingCity}, {selectedClaim.shippingProvince} - CP {selectedClaim.shippingZipcode}
                          </p>
                        </>
                      )}
                      {selectedClaim.shippingPhone && (
                        <p className="text-gray-700">Tel: {selectedClaim.shippingPhone}</p>
                      )}
                    </div>
                  </div>
                )}

                {selectedClaim.photoUrl && (
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-1">Foto adjunta:</p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={selectedClaim.photoUrl}
                      alt="Foto del reclamo"
                      className="w-full max-h-64 object-contain rounded-lg bg-gray-100"
                    />
                  </div>
                )}

                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">
                    Notas del admin:
                  </label>
                  <textarea
                    value={adminNotes}
                    onChange={(e) => setAdminNotes(e.target.value)}
                    rows={3}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-gray-900"
                    placeholder="Agregar notas..."
                  />
                </div>

                <div className="flex flex-col gap-2 pt-2">
                  {selectedClaim.type === "cambio" && selectedClaim.shippingZipcode && selectedClaim.shippingMode !== "presencial" && (
                    <button
                      onClick={() => copyShippingData(selectedClaim)}
                      className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 transition flex items-center justify-center gap-2"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                      </svg>
                      Copiar datos para Envío Nube
                    </button>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => updateClaim(selectedClaim.id, "aprobado")}
                      disabled={updating}
                      className="flex-1 bg-green-600 text-white py-2.5 rounded-lg font-medium hover:bg-green-700 transition disabled:opacity-50"
                    >
                      Aprobar
                    </button>
                    <button
                      onClick={() => updateClaim(selectedClaim.id, "rechazado")}
                      disabled={updating}
                      className="flex-1 bg-red-600 text-white py-2.5 rounded-lg font-medium hover:bg-red-700 transition disabled:opacity-50"
                    >
                      Rechazar
                    </button>
                    <button
                      onClick={() => deleteClaim(selectedClaim.id)}
                      className="px-4 py-2.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition"
                      title="Eliminar"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
