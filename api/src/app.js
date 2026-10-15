import express from "express";
import { randomUUID } from "node:crypto";
import { PLANES, buscarPlan } from "./planes.js";
import { validarRegistro, validarTarjeta } from "./validacion.js";

// Tarjetas de prueba (todas pasan Luhn). Cualquier otra tarjeta válida se aprueba.
export const TARJETAS_PRUEBA = {
  "4000000000000002": { http: 402, error: "fondos_insuficientes", mensaje: "Fondos insuficientes. Prueba con otra tarjeta." },
  "4000000000000069": { http: 402, error: "rechazada", mensaje: "El banco rechazó la tarjeta. Comunícate con tu banco o usa otra." },
  "4000000000000119": { http: 504, error: "timeout", mensaje: "El banco no respondió a tiempo. No se realizó ningún cobro.", demora: true }
};

const fallo = (res, http, error, mensaje, campos) =>
  res.status(http).json({ error, mensaje, ...(campos && { campos }) });

const normalizarIp = (ip = "") => ip.replace(/^::ffff:/, "");

export function crearApp({ inventario, timeoutMs = 15000, adminToken = null, corsOrigin = "*", trustProxy = true }) {
  const app = express();
  const clientes = new Map(); // datos mínimos, solo en memoria

  app.set("trust proxy", trustProxy); // HAProxy y nginx añaden X-Forwarded-For
  app.disable("x-powered-by");
  app.use(express.json({ limit: "10kb" }));

  // El portal se sirve desde pfSense (otro origen), por eso se habilita CORS.
  app.use((req, res, next) => {
    res.set("Access-Control-Allow-Origin", corsOrigin);
    res.set("Access-Control-Allow-Headers", "Content-Type, X-Admin-Token");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Cache-Control", "no-store");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  // Health check para HAProxy
  app.get("/api/salud", (req, res) => res.json({ estado: "ok", instancia: process.env.HOSTNAME ?? "local" }));

  app.get("/api/planes", (req, res) => {
    res.json(
      PLANES.map(({ archivoVouchers, ...p }) => ({ ...p, disponibles: inventario.cantidad(p.id) }))
    );
  });

  app.post("/api/registro", (req, res) => {
    const { errores, datos } = validarRegistro(req.body);
    if (Object.keys(errores).length) {
      return fallo(res, 422, "datos_invalidos", "Revisa los campos marcados.", errores);
    }
    const clienteId = randomUUID();
    clientes.set(clienteId, { ...datos, creado: Date.now() });
    res.status(201).json({ clienteId, nombre: datos.nombre });
  });

  app.post("/api/pagos", async (req, res) => {
    const { clienteId, plan: planId, tarjeta } = req.body ?? {};
    const cliente = clientes.get(clienteId);
    if (!cliente) return fallo(res, 401, "sin_registro", "Tu registro expiró. Vuelve a registrarte.");

    const plan = buscarPlan(planId);
    if (!plan) return fallo(res, 400, "plan_invalido", "El plan seleccionado no existe.");

    const { errores, numero } = validarTarjeta(tarjeta);
    if (Object.keys(errores).length) {
      return fallo(res, 422, "tarjeta_invalida", "Revisa los datos de la tarjeta.", errores);
    }

    const prueba = TARJETAS_PRUEBA[numero];
    if (prueba?.demora) await new Promise((r) => setTimeout(r, timeoutMs));
    if (prueba) return fallo(res, prueba.http, prueba.error, prueba.mensaje);

    if (inventario.cantidad(plan.id) === 0) {
      return fallo(res, 503, "plan_agotado", `El plan ${plan.nombre} está agotado. Elige otro plan.`);
    }

    const pagoId = randomUUID();
    const voucher = inventario.entregar(plan.id, {
      pagoId,
      montoQ: plan.precioQ,
      tarjeta: `•••• ${numero.slice(-4)}` // nunca se guarda el número completo
    });

    res.status(201).json({
      pagoId,
      voucher,
      plan: { id: plan.id, nombre: plan.nombre, duracionTexto: plan.duracionTexto },
      montoQ: plan.precioQ
    });
  });

  // Muestra con qué dirección y protocolo llegó el cliente (demo dual stack).
  app.get("/api/diagnostico", (req, res) => {
    const ip = normalizarIp(req.ip);
    res.json({
      ip,
      familia: ip.includes(":") ? "IPv6" : "IPv4",
      atendidoPor: process.env.HOSTNAME ?? "local",
      fecha: new Date().toISOString()
    });
  });

  // Resumen de ventas para la defensa. Deshabilitado si no hay ADMIN_TOKEN.
  app.get("/api/admin/resumen", (req, res) => {
    if (!adminToken || req.get("X-Admin-Token") !== adminToken) {
      return fallo(res, 404, "no_encontrado", "Recurso no encontrado.");
    }
    res.json({
      ...inventario.resumen(),
      disponibles: Object.fromEntries(PLANES.map((p) => [p.id, inventario.cantidad(p.id)])),
      clientesRegistrados: clientes.size
    });
  });

  app.use("/api", (req, res) => fallo(res, 404, "no_encontrado", "Recurso no encontrado."));

  // JSON mal formado u otros errores
  app.use((err, req, res, next) => {
    if (err.type === "entity.parse.failed") return fallo(res, 400, "json_invalido", "La solicitud no es JSON válido.");
    if (err.type === "entity.too.large") return fallo(res, 413, "muy_grande", "La solicitud es demasiado grande.");
    console.error(err);
    fallo(res, 500, "error_interno", "Ocurrió un error inesperado. Intenta de nuevo.");
  });

  return app;
}
