export const normalizePhone = (raw) => {
  if (!raw) return "";
  // whatsapp-web.js suele entregar "51999999999@c.us"; nos quedamos con la parte numérica
  const base = String(raw).split("@")[0].replace(/\s/g, "");
  // Si ya viene con "+" la dejamos, si no la agregamos
  return base.startsWith("+") ? base : `+${base}`;
};

export const isAdmin = (phone) => {
  const envRaw = process.env.ADMIN_PHONE || "";
  const admin = normalizePhone(envRaw);
  const who = normalizePhone(phone);
  if (!admin || !who) return false;
  return who === admin;
};

export const replyMenu = async (msg, lines) => {
  const text = Array.isArray(lines) ? lines.join("\n") : String(lines);
  return msg.reply(text);
};

export const parseDecimal = (s) => {
  // Acepta "1234", "1,234.56", "1234,56" => 1234.56
  if (typeof s !== "string") s = String(s ?? "");
  const t = s.trim().replace(/\s/g, "");
  const normalized = t.includes(",") && !t.includes(".") ? t.replace(",", ".") : t.replace(/,/g, "");
  const n = Number(normalized);
  if (!Number.isFinite(n)) throw new Error("Monto inválido");
  return Number(n.toFixed(2));
};
