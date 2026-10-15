import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crearApp } from "../src/app.js";
import { PLANES } from "../src/planes.js";
import { InventarioVouchers, leerCsvVouchers } from "../src/vouchers.js";
import { luhnValido, vencimientoValido } from "../src/validacion.js";

const TARJETA_OK = { numero: "4111 1111 1111 1111", vencimiento: "12/30", cvv: "123", titular: "Ana López" };
const REGISTRO_OK = { nombre: "Ana López", telefono: "5555-1234", email: "", aceptaTerminos: true };

let dir, servidor, base, archivoEstado;

function crearInventario() {
  return new InventarioVouchers({ planes: PLANES, dirVouchers: dir, archivoEstado });
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "prepago-"));
  archivoEstado = join(dir, "estado.json");
  writeFileSync(join(dir, "basico.csv"), '# roll 1\n"AAA111"\n"AAA222"\n');
  writeFileSync(join(dir, "diario.csv"), '# roll 2\n"BBB111"\n');
  // semanal.csv no existe: el plan debe quedar agotado
  const app = crearApp({ inventario: crearInventario(), timeoutMs: 50, adminToken: "secreto" });
  servidor = app.listen(0);
  await new Promise((r) => servidor.once("listening", r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => {
  servidor.close();
  rmSync(dir, { recursive: true, force: true });
});

const post = (ruta, cuerpo) =>
  fetch(base + ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });

async function registrar() {
  const r = await post("/api/registro", REGISTRO_OK);
  assert.equal(r.status, 201);
  return (await r.json()).clienteId;
}

describe("utilidades", () => {
  test("leerCsvVouchers ignora comentarios, comillas y líneas vacías", () => {
    assert.deepEqual(leerCsvVouchers('# hdr\n"abc"\r\n\n def \n'), ["abc", "def"]);
  });
  test("luhnValido", () => {
    assert.equal(luhnValido("4111111111111111"), true);
    assert.equal(luhnValido("4111111111111112"), false);
    assert.equal(luhnValido("123"), false);
  });
  test("vencimientoValido respeta el fin de mes", () => {
    const ahora = new Date(2026, 9, 15); // 15 oct 2026
    assert.equal(vencimientoValido("10/26", ahora), true);
    assert.equal(vencimientoValido("09/26", ahora), false);
    assert.equal(vencimientoValido("13/30", ahora), false);
    assert.equal(vencimientoValido("1230", ahora), false);
  });
});

describe("API", () => {
  test("salud responde ok para HAProxy", async () => {
    const r = await fetch(base + "/api/salud");
    assert.equal(r.status, 200);
    assert.equal((await r.json()).estado, "ok");
  });

  test("planes muestra disponibilidad y oculta el archivo de vouchers", async () => {
    const planes = await (await fetch(base + "/api/planes")).json();
    const basico = planes.find((p) => p.id === "basico");
    assert.equal(basico.disponibles, 2);
    assert.equal(basico.archivoVouchers, undefined);
    assert.equal(planes.find((p) => p.id === "semanal").disponibles, 0);
  });

  test("CORS: el preflight responde 204 con encabezados", async () => {
    const r = await fetch(base + "/api/pagos", { method: "OPTIONS" });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get("access-control-allow-origin"), "*");
  });

  test("registro rechaza datos inválidos campo por campo", async () => {
    const r = await post("/api/registro", { nombre: "A1", telefono: "123", email: "x@", aceptaTerminos: false });
    assert.equal(r.status, 422);
    const cuerpo = await r.json();
    assert.deepEqual(Object.keys(cuerpo.campos).sort(), ["aceptaTerminos", "email", "nombre", "telefono"]);
  });

  test("pago sin registro devuelve 401", async () => {
    const r = await post("/api/pagos", { clienteId: "nadie", plan: "basico", tarjeta: TARJETA_OK });
    assert.equal(r.status, 401);
  });

  test("pago con plan inexistente devuelve 400", async () => {
    const r = await post("/api/pagos", { clienteId: await registrar(), plan: "oro", tarjeta: TARJETA_OK });
    assert.equal(r.status, 400);
  });

  test("tarjeta con Luhn inválido, vencida y CVV corto devuelve 422 con campos", async () => {
    const r = await post("/api/pagos", {
      clienteId: await registrar(),
      plan: "basico",
      tarjeta: { numero: "4111111111111112", vencimiento: "01/20", cvv: "1", titular: "" }
    });
    assert.equal(r.status, 422);
    assert.deepEqual(Object.keys((await r.json()).campos).sort(), ["cvv", "numero", "titular", "vencimiento"]);
  });

  test("tarjetas de prueba: fondos insuficientes, rechazada y timeout", async () => {
    const clienteId = await registrar();
    const casos = [
      ["4000000000000002", 402, "fondos_insuficientes"],
      ["4000000000000069", 402, "rechazada"],
      ["4000000000000119", 504, "timeout"]
    ];
    for (const [numero, http, error] of casos) {
      const r = await post("/api/pagos", { clienteId, plan: "basico", tarjeta: { ...TARJETA_OK, numero } });
      assert.equal(r.status, http, numero);
      assert.equal((await r.json()).error, error);
    }
    // ninguna de ellas consumió vouchers
    const planes = await (await fetch(base + "/api/planes")).json();
    assert.equal(planes.find((p) => p.id === "basico").disponibles, 2);
  });

  test("pago aprobado entrega vouchers en orden y agota el plan", async () => {
    const clienteId = await registrar();
    const pagar = () => post("/api/pagos", { clienteId, plan: "diario", tarjeta: TARJETA_OK });

    const r1 = await pagar();
    assert.equal(r1.status, 201);
    const pago = await r1.json();
    assert.equal(pago.voucher, "BBB111");
    assert.equal(pago.montoQ, 15);

    const r2 = await pagar();
    assert.equal(r2.status, 503);
    assert.equal((await r2.json()).error, "plan_agotado");
  });

  test("el estado persiste: un reinicio no reentrega vouchers ni guarda la tarjeta completa", () => {
    const estado = JSON.parse(readFileSync(archivoEstado, "utf8"));
    assert.deepEqual(estado.usados.diario, ["BBB111"]);
    assert.equal(estado.ventas[0].tarjeta, "•••• 1111");
    assert.equal(JSON.stringify(estado).includes("4111111111111111"), false);
    assert.equal(crearInventario().cantidad("diario"), 0);
  });

  test("diagnóstico informa la familia de la IP", async () => {
    const d = await (await fetch(base + "/api/diagnostico")).json();
    assert.equal(d.familia, "IPv4");
    assert.equal(d.ip, "127.0.0.1");
  });

  test("admin: 404 sin token, resumen con token", async () => {
    assert.equal((await fetch(base + "/api/admin/resumen")).status, 404);
    const r = await fetch(base + "/api/admin/resumen", { headers: { "X-Admin-Token": "secreto" } });
    assert.equal(r.status, 200);
    const resumen = await r.json();
    assert.equal(resumen.ventasPorPlan.diario, 1);
    assert.equal(resumen.totalQ, 15);
  });

  test("JSON mal formado devuelve 400", async () => {
    const r = await fetch(base + "/api/registro", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error, "json_invalido");
  });
});
