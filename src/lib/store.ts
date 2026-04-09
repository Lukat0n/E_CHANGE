import { prisma } from "@/lib/prisma";

interface StoreData {
  id: string;
  storeId: string;
  storeName: string | null;
  accessToken: string;
}

// Resolve store from DB or environment variables
export async function findStore(storeId: string): Promise<StoreData | null> {
  // Try DB first
  try {
    let store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) {
      store = await prisma.store.findUnique({ where: { storeId } });
    }
    if (store) return store;
  } catch {
    // DB not available (e.g. Vercel without DB), fall through to env vars
  }

  // Fallback: env vars for single store setup
  const envStoreId = process.env.TIENDANUBE_STORE_ID;
  const envAccessToken = process.env.TIENDANUBE_ACCESS_TOKEN;

  if (envStoreId && envAccessToken && (storeId === envStoreId || storeId === "default")) {
    return {
      id: envStoreId,
      storeId: envStoreId,
      storeName: process.env.TIENDANUBE_STORE_NAME || "Mi Tienda",
      accessToken: envAccessToken,
    };
  }

  return null;
}
