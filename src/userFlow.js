import { replyMenu, parseDecimal } from "./utils.js";
import { registerMovement, listCategories, addCategoryIfMissing } from "./sheets.js";

// Estado en memoria por teléfono
const sessions = new Map(); // phone -> { step, tipo, categoria, monto, detalle }

const reset = (phone) => sessions.delete(phone);

export const startFlow = async (msg, phone) => {
  sessions.set(phone, { step: "tipo" });
  return replyMenu(msg, [
    "¿Qué deseas registrar?",
    "1) Ingreso",
    "2) Gasto"
  ]);
};

export const continueFlow = async (msg, body, phone) => {
  const s = sessions.get(phone);
  if (!s) return startFlow(msg, phone);
  const val = body.trim();

  if (s.step === "tipo") {
    if (val === "1" || val === "2") {
      s.tipo = val === "1" ? "INGRESO" : "GASTO";
      s.step = "categoria";
      const cats = await listCategories(phone, s.tipo);
      return replyMenu(msg, [
        `Selecciona categoría para *${s.tipo}*:`,
        ...cats.map((c, i) => `${i+1}) ${c}`),
        "99) Agregar nueva"
      ]);
    }
    return replyMenu(msg, "Responde 1 (Ingreso) o 2 (Gasto).");
  }

  if (s.step === "categoria") {
    if (val === "99") {
      s.step = "categoria_nueva";
      return replyMenu(msg, "Escribe el nombre de la nueva categoría:");
    }
    const idx = Number(val) - 1;
    const cats = await listCategories(phone, s.tipo);
    if (idx >= 0 && idx < cats.length) {
      s.categoria = cats[idx];
      s.step = "monto";
      return replyMenu(msg, "Ingresa el *monto* (ej: 1234.56):");
    }
    return replyMenu(msg, "Elige una opción válida de la lista.");
  }

  if (s.step === "categoria_nueva") {
    const nombre = body.trim();
    await addCategoryIfMissing(phone, s.tipo, nombre);
    s.categoria = nombre;
    s.step = "monto";
    return replyMenu(msg, "Ingresa el *monto* (ej: 1234.56):");
  }

  if (s.step === "monto") {
    try {
      s.monto = parseDecimal(body);
    } catch {
      return replyMenu(msg, "Monto inválido. Ejemplos válidos: 120, 120.50, 1,200.75");
    }
    s.step = "detalle";
    return replyMenu(msg, "Detalle (opcional). Si no deseas, responde 0.");
  }

  if (s.step === "detalle") {
    s.detalle = body.trim() === "0" ? "" : body.trim();
    // Guardar
    await registerMovement(phone, {
      tipo: s.tipo, categoria: s.categoria, monto: s.monto, detalle: s.detalle
    });
    reset(phone);
    return replyMenu(msg, "✅ Movimiento registrado. ¡Gracias!");
  }
};
