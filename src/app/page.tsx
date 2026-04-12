"use client";

import { useState, useEffect, FormEvent } from "react";

type ClaimType = "reclamo" | "cambio" | "no_recibido";

interface OrderInfo {
  number: string | number;
  status: string;
  paymentStatus: string;
  createdAt: string;
  shippingStatus: string;
  shippingCarrier: string | null;
  shippingOption: string | null;
  shippingTracking: string | null;
  shippingTrackingUrl: string | null;
  trackingPageUrl: string | null;
  maxDeliveryDate: string | null;
  shippingAddress: {
    address: string;
    city: string;
    province: string;
    zipcode: string;
  } | null;
  customer: {
    name: string;
    email: string;
    phone: string;
  } | null;
  products: Array<{
    name: string;
    quantity: number;
    price: string;
    sku: string;
    variantId: number | null;
    productId: number | null;
  }>;
  storeUrl: string | null;
}

interface ShippingOption {
  code: string;
  name: string;
  price: number;
  type: "delivery" | "pickup";
  branches?: string[];
}

const CAMBIO_PRECIO = 9968;

function shippingStatusLabel(status: string) {
  const map: Record<string, string> = {
    unpacked: "Sin empacar",
    fulfilled: "Enviado",
    shipped: "En camino",
    delivered: "Entregado",
    unshipped: "No enviado",
  };
  return map[status] || status;
}

function shippingStatusColor(status: string) {
  switch (status) {
    case "delivered": return "bg-green-100 text-green-700";
    case "shipped":
    case "fulfilled": return "bg-blue-100 text-blue-700";
    case "unshipped":
    case "unpacked": return "bg-orange-100 text-orange-700";
    default: return "bg-gray-100 text-gray-700";
  }
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
  });
}

function isDeliveryExpired(maxDeliveryDate: string | null): boolean {
  if (!maxDeliveryDate) return true; // If no date, allow
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const max = new Date(maxDeliveryDate);
  max.setHours(0, 0, 0, 0);
  return now > max;
}

export default function HomePage() {
  const [step, setStep] = useState(1);
  const [storeId, setStoreId] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [orderInfo, setOrderInfo] = useState<OrderInfo | null>(null);
  const [verified, setVerified] = useState(false);
  const [claimType, setClaimType] = useState<ClaimType>("reclamo");
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  // Shipping address for cambio
  const [shipZipcode, setShipZipcode] = useState("");
  const [shipProvince, setShipProvince] = useState("");
  const [shipCity, setShipCity] = useState("");
  const [shipAddress, setShipAddress] = useState(""); // calle
  const [shipNumber, setShipNumber] = useState("");
  const [shipFloor, setShipFloor] = useState("");
  const [shipNeighborhood, setShipNeighborhood] = useState("");
  const [shipRecipientName, setShipRecipientName] = useState("");
  const [shipRecipientLastName, setShipRecipientLastName] = useState("");
  const [shipPhone, setShipPhone] = useState("");
  // Shipping method selection
  const [deliveryMode, setDeliveryMode] = useState<"domicilio" | "sucursal">("domicilio");
  const [domicilioOptions, setDomicilioOptions] = useState<ShippingOption[]>([]);
  const [sucursalOptions, setSucursalOptions] = useState<ShippingOption[]>([]);
  const [selectedShippingCode, setSelectedShippingCode] = useState("");
  const [calculatingShipping, setCalculatingShipping] = useState(false);
  const [shippingError, setShippingError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const s = params.get("store");
    if (s) setStoreId(s);
  }, []);

  async function verifyOrder() {
    if (!orderNumber.trim() || !customerEmail.trim()) return;
    setVerifying(true);
    setError("");
    setOrderInfo(null);
    setVerified(false);

    try {
      const res = await fetch("/api/orders/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: storeId || "default",
          orderNumber: orderNumber.trim(),
          customerEmail: customerEmail.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo verificar la orden");

      setOrderInfo(data.order);
      setVerified(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error verificando orden");
    } finally {
      setVerifying(false);
    }
  }

  async function calculateShipping(zip: string) {
    if (!zip || zip.length < 4 || !orderInfo) return;
    const variantId = orderInfo.products.find((p) => p.variantId)?.variantId;
    if (!variantId) {
      setShippingError("No pudimos identificar el producto para calcular el envío");
      return;
    }
    setCalculatingShipping(true);
    setShippingError("");
    setDomicilioOptions([]);
    setSucursalOptions([]);
    setSelectedShippingCode("");
    try {
      const res = await fetch("/api/shipping/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: storeId || "default",
          zipcode: zip,
          variantId,
          quantity: orderInfo.products.find((p) => p.variantId)?.quantity || 1,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo calcular el envío");
      setDomicilioOptions(data.domicilio || []);
      setSucursalOptions(data.sucursal || []);
      // Auto-select cheapest option of current mode
      const initial = deliveryMode === "domicilio" ? data.domicilio : data.sucursal;
      if (initial && initial.length > 0) {
        const cheapest = [...initial].sort((a: ShippingOption, b: ShippingOption) => a.price - b.price)[0];
        setSelectedShippingCode(cheapest.code);
      }
    } catch (err) {
      setShippingError(err instanceof Error ? err.message : "Error calculando el envío");
    } finally {
      setCalculatingShipping(false);
    }
  }

  // When switching delivery mode, auto-select cheapest option of that group
  useEffect(() => {
    const list = deliveryMode === "domicilio" ? domicilioOptions : sucursalOptions;
    if (list.length > 0) {
      const currentIsInList = list.some((o) => o.code === selectedShippingCode);
      if (!currentIsInList) {
        const cheapest = [...list].sort((a, b) => a.price - b.price)[0];
        setSelectedShippingCode(cheapest.code);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveryMode, domicilioOptions, sucursalOptions]);

  const selectedShipping: ShippingOption | undefined = [...domicilioOptions, ...sucursalOptions].find(
    (o) => o.code === selectedShippingCode
  );

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setPhoto(file);
      const reader = new FileReader();
      reader.onloadend = () => setPhotoPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      let photoUrl = "";

      if (photo) {
        const formData = new FormData();
        formData.append("file", photo);
        const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
        if (!uploadRes.ok) {
          const data = await uploadRes.json();
          throw new Error(data.error || "Error subiendo la foto");
        }
        const uploadData = await uploadRes.json();
        photoUrl = uploadData.url;
      }

      const claimRes = await fetch("/api/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: storeId || "default",
          orderNumber,
          type: claimType,
          description,
          photoUrl,
          customerName: orderInfo?.customer?.name || "",
          customerEmail: orderInfo?.customer?.email || customerEmail,
          customerPhone: orderInfo?.customer?.phone || "",
          ...(claimType === "cambio" && {
            shippingZipcode: shipZipcode,
            shippingProvince: shipProvince,
            shippingCity: shipCity,
            // For pickup (sucursal) these can be blank
            shippingAddress: deliveryMode === "domicilio" ? shipAddress : "",
            shippingNumber: deliveryMode === "domicilio" ? shipNumber : "",
            shippingFloor: deliveryMode === "domicilio" ? shipFloor : "",
            shippingNeighborhood: deliveryMode === "domicilio" ? shipNeighborhood : "",
            shippingRecipientName: shipRecipientName,
            shippingRecipientLastName: shipRecipientLastName,
            shippingPhone: shipPhone,
            // Shipping method
            shippingMode: deliveryMode,
            shippingMethodCode: selectedShipping?.code || "",
            shippingMethodName: selectedShipping?.name || "",
            shippingCost: selectedShipping?.price ?? null,
          }),
        }),
      });

      if (!claimRes.ok) {
        const data = await claimRes.json();
        throw new Error(data.error || "Error enviando el reclamo");
      }

      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setLoading(false);
    }
  }

  // Determine what to show based on claim type
  const deliveryExpired = orderInfo ? isDeliveryExpired(orderInfo.maxDeliveryDate) : false;
  const noRecibidoBlocked = claimType === "no_recibido" && !deliveryExpired;

  if (success) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            {claimType === "cambio" ? "Solicitud de cambio enviada" : "Reclamo enviado"}
          </h2>
          <p className="text-gray-600 mb-6">
            Tu solicitud fue registrada exitosamente. Te contactaremos pronto.
          </p>
          <button
            onClick={() => {
              setSuccess(false);
              setStep(1);
              setOrderNumber("");
              setCustomerEmail("");
              setOrderInfo(null);
              setVerified(false);
              setDescription("");
              setClaimType("reclamo");
              setPhoto(null);
              setPhotoPreview(null);
              setShipZipcode("");
              setShipProvince("");
              setShipCity("");
              setShipAddress("");
              setShipNumber("");
              setShipFloor("");
              setShipNeighborhood("");
              setShipRecipientName("");
              setShipRecipientLastName("");
              setShipPhone("");
              setDeliveryMode("domicilio");
              setDomicilioOptions([]);
              setSucursalOptions([]);
              setSelectedShippingCode("");
              setShippingError("");
            }}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition"
          >
            Volver al inicio
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-gray-900">E-Change</h1>
          <p className="text-gray-500 text-sm">Gestión de reclamos y cambios</p>
        </div>
      </header>

      {/* Progress bar */}
      <div className="max-w-3xl mx-auto w-full px-4 pt-6">
        <div className="flex items-center gap-2 mb-6">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex-1">
              <div className={`h-2 rounded-full transition-colors ${s <= step ? "bg-blue-600" : "bg-gray-200"}`} />
              <p className={`text-xs mt-1 ${s <= step ? "text-blue-600 font-medium" : "text-gray-400"}`}>
                {s === 1 ? "Verificar" : s === 2 ? "Tipo" : claimType === "cambio" ? "Dirección" : "Foto"}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="max-w-3xl mx-auto w-full px-4 pb-8 flex-1">
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-lg p-6 md:p-8">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
              {error}
            </div>
          )}

          {/* Step 1: Order + email verification */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Verificá tu compra</h2>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Número de orden *</label>
                <input
                  type="text"
                  required
                  value={orderNumber}
                  onChange={(e) => { setOrderNumber(e.target.value); setOrderInfo(null); setVerified(false); setError(""); }}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-gray-900"
                  placeholder="Ej: 12345"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email del comprador *</label>
                <input
                  type="email"
                  required
                  value={customerEmail}
                  onChange={(e) => { setCustomerEmail(e.target.value); setVerified(false); setError(""); }}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-gray-900"
                  placeholder="El email que usaste en la compra"
                />
              </div>

              {!verified && (
                <button
                  type="button"
                  onClick={verifyOrder}
                  disabled={verifying || !orderNumber.trim() || !customerEmail.trim()}
                  className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {verifying ? "Verificando..." : "Verificar orden"}
                </button>
              )}

              {verified && orderInfo && (
                <>
                  <div className="border border-green-200 bg-green-50 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="font-semibold text-green-800">Orden #{String(orderInfo.number)} verificada</span>
                    </div>

                    <div className="bg-white rounded-lg p-3 space-y-2">
                      <p className="font-medium text-gray-900 text-sm">Estado del envío</p>
                      <div className="flex flex-wrap gap-2">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${shippingStatusColor(orderInfo.shippingStatus)}`}>
                          {shippingStatusLabel(orderInfo.shippingStatus)}
                        </span>
                        {orderInfo.shippingCarrier && (
                          <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                            {orderInfo.shippingCarrier}
                          </span>
                        )}
                      </div>
                      {orderInfo.maxDeliveryDate && (
                        <p className="text-sm text-gray-600">
                          <span className="font-medium">Entrega estimada hasta:</span>{" "}
                          {formatDate(orderInfo.maxDeliveryDate)}
                        </p>
                      )}
                      {orderInfo.shippingTracking && (
                        <p className="text-sm text-gray-600">
                          <span className="font-medium">Tracking:</span>{" "}
                          {orderInfo.shippingTrackingUrl ? (
                            <a href={orderInfo.shippingTrackingUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
                              {orderInfo.shippingTracking}
                            </a>
                          ) : orderInfo.shippingTracking}
                        </p>
                      )}
                      {orderInfo.shippingAddress && (
                        <p className="text-sm text-gray-500">
                          {orderInfo.shippingAddress.address}, {orderInfo.shippingAddress.city}, {orderInfo.shippingAddress.province}
                        </p>
                      )}
                    </div>

                    {orderInfo.products.length > 0 && (
                      <div className="bg-white rounded-lg p-3 space-y-2">
                        <p className="font-medium text-gray-900 text-sm">Productos</p>
                        {orderInfo.products.map((p, i) => (
                          <div key={i} className="flex justify-between text-sm">
                            <span className="text-gray-700">{p.quantity}x {p.name}</span>
                            <span className="text-gray-500">${p.price}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition"
                  >
                    Continuar
                  </button>
                </>
              )}
            </div>
          )}

          {/* Step 2: Claim type */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">¿Qué necesitás?</h2>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {([
                  { value: "reclamo" as const, label: "Reclamo", desc: "Producto con problema", icon: "!" },
                  { value: "cambio" as const, label: "Cambio", desc: "Quiero cambiar producto", icon: "↔" },
                  { value: "no_recibido" as const, label: "No recibido", desc: "No me llegó el pedido", icon: "?" },
                ]).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setClaimType(opt.value)}
                    className={`p-4 rounded-xl border-2 text-left transition ${
                      claimType === opt.value
                        ? "border-blue-600 bg-blue-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <span className="text-2xl">{opt.icon}</span>
                    <p className="font-medium text-gray-900 mt-1">{opt.label}</p>
                    <p className="text-xs text-gray-500">{opt.desc}</p>
                  </button>
                ))}
              </div>

              {/* No recibido blocked message */}
              {noRecibidoBlocked && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 space-y-2">
                  <div className="flex items-start gap-2">
                    <svg className="w-5 h-5 text-yellow-600 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    <div>
                      <p className="font-medium text-yellow-800">
                        Tu pedido todavía está dentro del plazo de entrega
                      </p>
                      <p className="text-sm text-yellow-700 mt-1">
                        La fecha límite de entrega es el <strong>{orderInfo?.maxDeliveryDate ? formatDate(orderInfo.maxDeliveryDate) : "-"}</strong>.
                        Podés hacer este reclamo a partir del día siguiente si no recibiste tu pedido.
                      </p>
                    </div>
                  </div>
                  {orderInfo?.trackingPageUrl && (
                    <a
                      href={orderInfo.trackingPageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-800 mt-1"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      Ver seguimiento de mi pedido
                    </a>
                  )}
                </div>
              )}

              {/* Description for reclamo and no_recibido */}
              {(claimType === "reclamo" || (claimType === "no_recibido" && deliveryExpired)) && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Descripción *</label>
                  <textarea
                    required
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none text-gray-900"
                    placeholder={claimType === "no_recibido" ? "Contanos los detalles..." : "Contanos qué pasó con tu pedido..."}
                  />
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 transition"
                >
                  Atrás
                </button>
                {claimType === "cambio" ? (
                  <button
                    type="button"
                    onClick={() => setStep(3)}
                    className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition"
                  >
                    Ver precio del cambio
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => { if (description && !noRecibidoBlocked) setStep(3); }}
                    disabled={noRecibidoBlocked || !description}
                    className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Continuar
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Step 3: Photo (reclamo/no_recibido) OR Payment (cambio) */}
          {step === 3 && claimType !== "cambio" && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Foto del producto</h2>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Adjuntá una foto (opcional pero recomendado)
                </label>
                <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-blue-400 transition cursor-pointer">
                  <input type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" id="photo-input" />
                  <label htmlFor="photo-input" className="cursor-pointer">
                    {photoPreview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photoPreview} alt="Preview" className="max-h-48 mx-auto rounded-lg" />
                    ) : (
                      <div>
                        <svg className="w-12 h-12 text-gray-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <p className="text-gray-500">Tocá para subir una imagen</p>
                        <p className="text-xs text-gray-400 mt-1">JPG, PNG, WEBP - Máx 5MB</p>
                      </div>
                    )}
                  </label>
                </div>
              </div>

              <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                <h3 className="font-medium text-gray-900">Resumen</h3>
                <div className="text-sm text-gray-600 space-y-1">
                  <p><span className="font-medium">Orden:</span> #{orderNumber}</p>
                  <p><span className="font-medium">Nombre:</span> {orderInfo?.customer?.name || "-"}</p>
                  <p><span className="font-medium">Tipo:</span> {claimType === "reclamo" ? "Reclamo" : "No recibido"}</p>
                </div>
              </div>

              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(2)} className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 transition">
                  Atrás
                </button>
                <button type="submit" disabled={loading} className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed">
                  {loading ? "Enviando..." : "Enviar reclamo"}
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Cambio - CP → Shipping method → Address/Recipient → Submit */}
          {step === 3 && claimType === "cambio" && (
            <div className="space-y-5">
              <h2 className="text-xl font-semibold text-gray-900">Cambio de producto</h2>

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
                <div className="flex justify-between text-sm text-gray-700">
                  <span>Costo del cambio:</span>
                  <span className="font-semibold">${CAMBIO_PRECIO.toLocaleString("es-AR")}</span>
                </div>
                {selectedShipping && (
                  <div className="flex justify-between text-sm text-gray-700">
                    <span>Envío ({selectedShipping.name}):</span>
                    <span className="font-semibold">${selectedShipping.price.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                )}
                <div className="border-t border-blue-200 pt-2 flex justify-between">
                  <span className="font-semibold text-gray-900">Total</span>
                  <span className="text-2xl font-bold text-gray-900">
                    ${(CAMBIO_PRECIO + (selectedShipping?.price || 0)).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              {/* Código postal + opciones de envío */}
              <div className="space-y-3 border border-gray-200 rounded-xl p-4">
                <h3 className="font-semibold text-gray-900">¿A dónde lo enviamos?</h3>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    value={shipZipcode}
                    onChange={(e) => { setShipZipcode(e.target.value); setDomicilioOptions([]); setSucursalOptions([]); setSelectedShippingCode(""); }}
                    className="flex-1 border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-gray-900"
                    placeholder="Código postal"
                  />
                  <button
                    type="button"
                    onClick={() => calculateShipping(shipZipcode)}
                    disabled={calculatingShipping || !shipZipcode}
                    className="bg-blue-600 text-white px-5 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {calculatingShipping ? "Calculando..." : "Calcular envío"}
                  </button>
                </div>
                {shippingError && (
                  <p className="text-sm text-red-600">{shippingError}</p>
                )}

                {(domicilioOptions.length > 0 || sucursalOptions.length > 0) && (
                  <div className="space-y-3 pt-2">
                    {/* Mode toggle */}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setDeliveryMode("domicilio")}
                        disabled={domicilioOptions.length === 0}
                        className={`py-2.5 rounded-lg border-2 text-sm font-medium transition ${
                          deliveryMode === "domicilio"
                            ? "border-blue-600 bg-blue-50 text-blue-700"
                            : "border-gray-200 text-gray-600 hover:border-gray-300"
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        Envío a domicilio
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeliveryMode("sucursal")}
                        disabled={sucursalOptions.length === 0}
                        className={`py-2.5 rounded-lg border-2 text-sm font-medium transition ${
                          deliveryMode === "sucursal"
                            ? "border-blue-600 bg-blue-50 text-blue-700"
                            : "border-gray-200 text-gray-600 hover:border-gray-300"
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        Retirar en sucursal
                      </button>
                    </div>

                    {/* Options list for selected mode */}
                    <div className="space-y-2">
                      {(deliveryMode === "domicilio" ? domicilioOptions : sucursalOptions).map((opt) => (
                        <label
                          key={opt.code}
                          className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition ${
                            selectedShippingCode === opt.code
                              ? "border-blue-600 bg-blue-50"
                              : "border-gray-200 hover:border-gray-300"
                          }`}
                        >
                          <input
                            type="radio"
                            name="shipping-option"
                            value={opt.code}
                            checked={selectedShippingCode === opt.code}
                            onChange={() => setSelectedShippingCode(opt.code)}
                            className="mt-1"
                          />
                          <div className="flex-1">
                            <div className="flex justify-between gap-2">
                              <span className="text-sm font-medium text-gray-900">{opt.name}</span>
                              <span className="text-sm font-semibold text-gray-900 whitespace-nowrap">
                                ${opt.price.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            </div>
                            {opt.branches && opt.branches.length > 0 && (
                              <details className="mt-1.5">
                                <summary className="text-xs text-blue-600 cursor-pointer">Ver sucursales ({opt.branches.length})</summary>
                                <ul className="text-xs text-gray-600 mt-1 space-y-0.5 pl-2">
                                  {opt.branches.slice(0, 10).map((b, i) => (
                                    <li key={i} className="capitalize">• {b}</li>
                                  ))}
                                </ul>
                              </details>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Province + city (always shown once options loaded) */}
              {selectedShipping && (
                <div className="space-y-3 border border-gray-200 rounded-xl p-4">
                  <h3 className="font-semibold text-gray-900">
                    {deliveryMode === "domicilio" ? "Dirección de entrega" : "Localidad de la sucursal"}
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Provincia *</label>
                      <select
                        required
                        value={shipProvince}
                        onChange={(e) => setShipProvince(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-gray-900 bg-white"
                      >
                        <option value="">Seleccioná una provincia</option>
                        {[
                          "Buenos Aires", "Ciudad Autónoma de Buenos Aires", "Catamarca", "Chaco",
                          "Chubut", "Córdoba", "Corrientes", "Entre Ríos", "Formosa", "Jujuy",
                          "La Pampa", "La Rioja", "Mendoza", "Misiones", "Neuquén", "Río Negro",
                          "Salta", "San Juan", "San Luis", "Santa Cruz", "Santa Fe",
                          "Santiago del Estero", "Tierra del Fuego", "Tucumán",
                        ].map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Ciudad *</label>
                      <input
                        type="text"
                        required
                        value={shipCity}
                        onChange={(e) => setShipCity(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-gray-900"
                        placeholder="Ciudad"
                      />
                    </div>
                  </div>

                  {/* Address only for domicilio */}
                  {deliveryMode === "domicilio" && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Calle *</label>
                        <input
                          type="text"
                          required
                          value={shipAddress}
                          onChange={(e) => setShipAddress(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-gray-900"
                          placeholder="Ingresá la calle"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Número *</label>
                          <input
                            type="text"
                            required
                            value={shipNumber}
                            onChange={(e) => setShipNumber(e.target.value)}
                            className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-gray-900"
                            placeholder="Número"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Departamento <span className="text-gray-400">(opcional)</span></label>
                          <input
                            type="text"
                            value={shipFloor}
                            onChange={(e) => setShipFloor(e.target.value)}
                            className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-gray-900"
                            placeholder="Piso / Depto"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Barrio</label>
                        <input
                          type="text"
                          value={shipNeighborhood}
                          onChange={(e) => setShipNeighborhood(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-gray-900"
                          placeholder="Barrio"
                        />
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Datos del destinatario */}
              {selectedShipping && (
                <div className="space-y-3 border border-gray-200 rounded-xl p-4">
                  <h3 className="font-semibold text-gray-900">Datos del destinatario</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Nombre *</label>
                      <input
                        type="text"
                        required
                        value={shipRecipientName}
                        onChange={(e) => setShipRecipientName(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-gray-900"
                        placeholder="Nombre"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Apellido <span className="text-gray-400">(opcional)</span></label>
                      <input
                        type="text"
                        value={shipRecipientLastName}
                        onChange={(e) => setShipRecipientLastName(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-gray-900"
                        placeholder="Apellido"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Email <span className="text-gray-400">(opcional)</span></label>
                      <input
                        type="email"
                        value={customerEmail}
                        disabled
                        className="w-full border border-gray-200 rounded-lg px-4 py-2.5 bg-gray-50 text-gray-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Teléfono *</label>
                      <input
                        type="tel"
                        required
                        value={shipPhone}
                        onChange={(e) => setShipPhone(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-gray-900"
                        placeholder="Ej: 1155667788"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(2)} className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 transition">
                  Atrás
                </button>
                <button
                  type="submit"
                  disabled={
                    loading ||
                    !selectedShipping ||
                    !shipZipcode ||
                    !shipProvince ||
                    !shipCity ||
                    (deliveryMode === "domicilio" && (!shipAddress || !shipNumber)) ||
                    !shipRecipientName ||
                    !shipPhone
                  }
                  className="flex-1 bg-green-600 text-white py-3 rounded-lg font-medium hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading ? "Enviando..." : "Solicitar cambio"}
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
