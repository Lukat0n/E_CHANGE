interface StoreData {
  id: string;
  storeId: string;
  storeName: string | null;
  accessToken: string;
}

// Resolve store from env vars first (fast), then DB
export async function findStore(storeId: string): Promise<StoreData | null> {
  // Check env vars first (works on Vercel without DB)
  const envStoreId = process.env.TIENDANUBE_STORE_ID;
  const envAccessToken = process.env.TIENDANUBE_ACCESS_TOKEN;

  if (envStoreId && envAccessToken) {
    if (storeId === envStoreId || storeId === "default" || !storeId) {
      const data: StoreData = {
        id: envStoreId,
        storeId: envStoreId,
        storeName: process.env.TIENDANUBE_STORE_NAME || "Mi Tienda",
        accessToken: envAccessToken,
      };

      // Ensure the Store record exists in DB (needed for FK on claims)
      try {
        const { prisma } = await import("@/lib/prisma");
        await prisma.store.upsert({
          where: { storeId: envStoreId },
          create: {
            id: envStoreId,
            storeId: envStoreId,
            storeName: data.storeName,
            accessToken: envAccessToken,
          },
          update: {},
        });
      } catch {
        // DB not available, continue without
      }

      return data;
    }
  }

  // Try DB as fallback (for multi-store setups)
  try {
    const { prisma } = await import("@/lib/prisma");
    let store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) {
      store = await prisma.store.findUnique({ where: { storeId } });
    }
    if (store) return store;
  } catch {
    // DB not available
  }

  return null;
}
