import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";

// Proxy hacia el worker en Railway para probar que loguea OK.
// Admin only.
export async function POST() {
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const workerUrl = process.env.WORKER_URL;
  const workerKey = process.env.WORKER_API_KEY;

  if (!workerUrl || !workerKey) {
    return NextResponse.json(
      { error: "WORKER_URL y WORKER_API_KEY no están configuradas en Vercel" },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(`${workerUrl.replace(/\/$/, "")}/api/test-login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": workerKey,
      },
      // El robot puede tardar 20-30s
      signal: AbortSignal.timeout(60000),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error llamando al worker";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
