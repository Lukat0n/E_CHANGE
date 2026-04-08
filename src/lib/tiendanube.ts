const TIENDANUBE_API = "https://api.tiendanube.com/v1";

export async function getOrderByNumber(
  accessToken: string,
  storeId: string,
  orderNumber: string
) {
  const res = await fetch(
    `${TIENDANUBE_API}/${storeId}/orders?q=${orderNumber}`,
    {
      headers: {
        Authentication: `bearer ${accessToken}`,
        "User-Agent": "E_CHANGE (reclamos@app.com)",
        "Content-Type": "application/json",
      },
    }
  );

  if (!res.ok) return null;
  const orders = await res.json();
  return orders.length > 0 ? orders[0] : null;
}

export async function getStoreInfo(accessToken: string, storeId: string) {
  const res = await fetch(`${TIENDANUBE_API}/${storeId}/store`, {
    headers: {
      Authentication: `bearer ${accessToken}`,
      "User-Agent": "E_CHANGE (reclamos@app.com)",
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) return null;
  return res.json();
}
