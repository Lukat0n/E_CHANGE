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
  }>;
}

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

export default function HomePage() {
  const [step, setStep] = useState(1);
  const [storeId, setStoreId] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [orderInfo, setOrderInfo] = useState<OrderInfo | null>(null);
  const [claimType, setClaimType] = useState<ClaimType>("reclamo");
  const [description, setDescription] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const s = params.get("store");
    if (s) setStoreId(s);
  }, []);

  async function verifyOrder() {
    if (!orderNumber.trim()) return;
    setVerifying(true);
    setError("");
    setOrderInfo(null);

    try {
      const res = await fetch("/api/orders/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, orderNumber: orderNumber.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "No se pudo verificar la orden");
      }

      const data = await res.json();
      setOrderInfo(data.order);

      // Auto-fill customer data from order
      if (data.order.customer) {
        if (data.order.customer.name && !customerName) {
          setCustomerName(data.order.customer.name);
        }
        if (data.order.customer.email && !customerEmail) {
          setCustomerEmail(data.order.customer.email);
        }
        if (data.order.customer.phone && !customerPhone) {
          setCustomerPhone(data.order.customer.phone);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error verificando orden");
    } finally {
      setVerifying(false);
    }
  }

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
        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

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
          storeId,
          orderNumber,
          type: claimType,
          description,
          photoUrl,
          customerName,
          customerEmail,
          customerPhone,
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

  if (success) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Reclamo enviado</h2>
          <p className="text-gray-600 mb-6">
            Tu solicitud fue registrada exitosamente. Te contactaremos pronto para resolverlo.
          </p>
          <button
            onClick={() => {
              setSuccess(false);
              setStep(1);
              setOrderNumber("");
              setOrderInfo(null);
              setDescription("");
              setCustomerName("");
              setCustomerEmail("");
              setCustomerPhone("");
              setPhoto(null);
              setPhotoPreview(null);
            }}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition"
          >
            Enviar otro reclamo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
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
              <div
                className={`h-2 rounded-full transition-colors ${
                  s <= step ? "bg-blue-600" : "bg-gray-200"
                }`}
              />
              <p className={`text-xs mt-1 ${s <= step ? "text-blue-600 font-medium" : "text-gray-400"}`}>
                {s === 1 ? "Orden" : s === 2 ? "Detalle" : "Foto"}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Form */}
      <div className="max-w-3xl mx-auto w-full px-4 pb-8 flex-1">
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-lg p-6 md:p-8">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
              {error}
            </div>
          )}

          {/* Step 1: Order verification */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Verificar tu orden</h2>

              {/* Order number input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Número de orden / compra *
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    value={orderNumber}
                    onChange={(e) => {
                      setOrderNumber(e.target.value);
                      setOrderInfo(null);
                      setError("");
                    }}
                    className="flex-1 border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-gray-900"
                    placeholder="Ej: 12345"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        verifyOrder();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={verifyOrder}
                    disabled={verifying || !orderNumber.trim()}
                    className="bg-blue-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    {verifying ? "Buscando..." : "Verificar"}
                  </button>
                </div>
              </div>

              {/* Order info card */}
              {orderInfo && (
                <div className="border border-green-200 bg-green-50 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="font-semibold text-green-800">Orden #{String(orderInfo.number)} encontrada</span>
                  </div>

                  {/* Shipping info */}
                  <div className="bg-white rounded-lg p-3 space-y-2">
                    <p className="font-medium text-gray-900 text-sm">Envío</p>
                    <div className="flex flex-wrap gap-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${shippingStatusColor(orderInfo.shippingStatus)}`}>
                        {shippingStatusLabel(orderInfo.shippingStatus)}
                      </span>
                      {orderInfo.shippingCarrier && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                          {orderInfo.shippingCarrier}
                        </span>
                      )}
                    </div>
                    {orderInfo.shippingTracking && (
                      <p className="text-sm text-gray-600">
                        <span className="font-medium">Tracking:</span>{" "}
                        {orderInfo.shippingTrackingUrl ? (
                          <a
                            href={orderInfo.shippingTrackingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 underline"
                          >
                            {orderInfo.shippingTracking}
                          </a>
                        ) : (
                          orderInfo.shippingTracking
                        )}
                      </p>
                    )}
                    {orderInfo.shippingAddress && (
                      <p className="text-sm text-gray-500">
                        {orderInfo.shippingAddress.address}, {orderInfo.shippingAddress.city},{" "}
                        {orderInfo.shippingAddress.province} ({orderInfo.shippingAddress.zipcode})
                      </p>
                    )}
                  </div>

                  {/* Products */}
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

                  {/* Auto-filled customer data */}
                  {orderInfo.customer && (
                    <div className="bg-white rounded-lg p-3 space-y-1">
                      <p className="font-medium text-gray-900 text-sm">Cliente</p>
                      <p className="text-sm text-gray-600">{orderInfo.customer.name}</p>
                      <p className="text-sm text-gray-600">{orderInfo.customer.email}</p>
                      {orderInfo.customer.phone && (
                        <p className="text-sm text-gray-600">{orderInfo.customer.phone}</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Customer data (editable, shown after order verified or if no store connection) */}
              {(orderInfo || !storeId) && (
                <div className="space-y-3 pt-2">
                  <p className="text-sm font-medium text-gray-700">
                    {orderInfo ? "Confirmar tus datos:" : "Tus datos:"}
                  </p>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Nombre completo *
                    </label>
                    <input
                      type="text"
                      required
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-gray-900"
                      placeholder="Juan Pérez"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Email *
                    </label>
                    <input
                      type="email"
                      required
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-gray-900"
                      placeholder="juan@email.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Teléfono (opcional)
                    </label>
                    <input
                      type="tel"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-gray-900"
                      placeholder="+54 11 1234-5678"
                    />
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  if (customerName && customerEmail && orderNumber && (orderInfo || !storeId)) {
                    setStep(2);
                  } else if (!orderInfo && storeId) {
                    setError("Primero verificá tu número de orden");
                  }
                }}
                disabled={!orderNumber || (!orderInfo && !!storeId)}
                className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continuar
              </button>
            </div>
          )}

          {/* Step 2: Claim details */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Detalle del reclamo</h2>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Tipo de solicitud *
                </label>
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
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Descripción *
                </label>
                <textarea
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none text-gray-900"
                  placeholder="Contanos qué pasó con tu pedido..."
                />
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 transition"
                >
                  Atrás
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (description) setStep(3);
                  }}
                  className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition"
                >
                  Continuar
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Photo + Submit */}
          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Foto del producto</h2>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Adjuntá una foto (opcional pero recomendado)
                </label>
                <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-blue-400 transition cursor-pointer">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoChange}
                    className="hidden"
                    id="photo-input"
                  />
                  <label htmlFor="photo-input" className="cursor-pointer">
                    {photoPreview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={photoPreview}
                        alt="Preview"
                        className="max-h-48 mx-auto rounded-lg"
                      />
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

              {/* Summary */}
              <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                <h3 className="font-medium text-gray-900">Resumen</h3>
                <div className="text-sm text-gray-600 space-y-1">
                  <p><span className="font-medium">Orden:</span> #{orderNumber}</p>
                  <p><span className="font-medium">Tipo:</span> {claimType === "reclamo" ? "Reclamo" : claimType === "cambio" ? "Cambio" : "No recibido"}</p>
                  <p><span className="font-medium">Nombre:</span> {customerName}</p>
                  <p><span className="font-medium">Email:</span> {customerEmail}</p>
                  {orderInfo?.shippingCarrier && (
                    <p><span className="font-medium">Envío:</span> {orderInfo.shippingCarrier} - {shippingStatusLabel(orderInfo.shippingStatus)}</p>
                  )}
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 transition"
                >
                  Atrás
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? "Enviando..." : "Enviar reclamo"}
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
