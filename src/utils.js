export const normalizePhone = (raw) => {
  if (!raw) return "";
  // whatsapp-web.js suele entregar "1234567890@c.us"
  const base = raw.split("@")[0];
  return base.startsWith("+") ? base : `+${base}`;
};

export const isAdmin = (phone) => {
  const admin = process.env.ADMIN_PHONE?.replace(/\s/g, "");

  return admin && phone.replace(/\s/g, "") === admin;
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
