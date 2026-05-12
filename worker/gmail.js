import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

/**
 * Conecta a Gmail por IMAP, busca el último email de Tiendanube de los últimos
 * 5 minutos, y devuelve el código de 6 dígitos. Si no hay nada, retorna null.
 */
export async function getLatestTiendanubeOtp() {
  const user = process.env.GMAIL_USER;
  const pass = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, ""); // App passwords vienen con espacios
  if (!user || !pass) {
    throw new Error("Faltan env vars GMAIL_USER y/o GMAIL_APP_PASSWORD");
  }

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const since = new Date(Date.now() - 5 * 60 * 1000); // últimos 5 min
      const uids = await client.search({ from: "tiendanube", since });

      if (!uids || uids.length === 0) return null;

      // El más reciente (mayor UID)
      const latestUid = uids.sort((a, b) => b - a)[0];
      const msg = await client.fetchOne(latestUid, { source: true });
      const parsed = await simpleParser(msg.source);

      const haystack = `${parsed.subject || ""}\n${parsed.text || ""}\n${(parsed.html || "").toString()}`;
      const match = haystack.match(/\b(\d{6})\b/);
      if (!match) return null;

      // Marcamos como leído para no procesarlo de nuevo
      await client.messageFlagsAdd(latestUid, ["\\Seen"], { uid: true }).catch(() => {});

      return match[1];
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}
