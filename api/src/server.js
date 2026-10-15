import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import { dirname, join } from "node:path";
import { crearApp } from "./app.js";
import { PLANES } from "./planes.js";
import { InventarioVouchers } from "./vouchers.js";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = process.env;

const inventario = new InventarioVouchers({
  planes: PLANES,
  dirVouchers: env.VOUCHERS_DIR ?? join(raiz, "vouchers"),
  archivoEstado: env.ESTADO_FILE ?? join(raiz, "data", "estado.json")
});

const app = crearApp({
  inventario,
  timeoutMs: Number(env.TIMEOUT_MS ?? 15000),
  adminToken: env.ADMIN_TOKEN || null,
  corsOrigin: env.CORS_ORIGIN ?? "*"
});

// En desarrollo (sin Docker) la API también sirve el portal: `npm run dev` y abrir http://localhost:5000
const dirPortal = env.STATIC_DIR ?? join(raiz, "..", "portal", "public");
if (env.NODE_ENV !== "production" && existsSync(dirPortal)) {
  app.use(express.static(dirPortal));
  console.log(`Sirviendo el portal desde ${dirPortal}`);
}

const puerto = Number(env.PORT ?? 5000);
const host = env.HOST ?? "::"; // "::" escucha en IPv6 e IPv4
app.listen(puerto, host, () => {
  const stock = PLANES.map((p) => `${p.id}=${inventario.cantidad(p.id)}`).join(", ");
  console.log(`API prepago en [${host}]:${puerto} · vouchers disponibles: ${stock}`);
});
