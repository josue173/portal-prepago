import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";

// Lee un CSV exportado desde pfSense (Vouchers > Rolls > exportar).
// pfSense escribe líneas de comentario que empiezan con "#" y un voucher
// por línea, a veces entre comillas.
export function leerCsvVouchers(texto) {
  return texto
    .split(/\r?\n/)
    .map((l) => l.trim().replaceAll('"', ""))
    .filter((l) => l && !l.startsWith("#"));
}

// Inventario de vouchers con persistencia mínima en JSON, para que un
// reinicio del contenedor no vuelva a vender vouchers ya entregados.
export class InventarioVouchers {
  constructor({ planes, dirVouchers, archivoEstado }) {
    this.archivoEstado = archivoEstado;
    this.estado = this.#cargarEstado();
    this.disponibles = new Map();

    for (const plan of planes) {
      const ruta = join(dirVouchers, plan.archivoVouchers);
      const todos = existsSync(ruta) ? leerCsvVouchers(readFileSync(ruta, "utf8")) : [];
      const usados = new Set(this.estado.usados[plan.id] ?? []);
      this.disponibles.set(plan.id, todos.filter((v) => !usados.has(v)));
    }
  }

  #cargarEstado() {
    if (this.archivoEstado && existsSync(this.archivoEstado)) {
      return JSON.parse(readFileSync(this.archivoEstado, "utf8"));
    }
    return { usados: {}, ventas: [] };
  }

  #guardar() {
    if (!this.archivoEstado) return;
    mkdirSync(dirname(this.archivoEstado), { recursive: true });
    const temporal = `${this.archivoEstado}.tmp`;
    writeFileSync(temporal, JSON.stringify(this.estado, null, 2));
    renameSync(temporal, this.archivoEstado); // escritura atómica
  }

  cantidad(planId) {
    return this.disponibles.get(planId)?.length ?? 0;
  }

  // Entrega el siguiente voucher del plan y registra la venta.
  entregar(planId, venta) {
    const lista = this.disponibles.get(planId);
    if (!lista || lista.length === 0) return null;
    const voucher = lista.shift();
    (this.estado.usados[planId] ??= []).push(voucher);
    this.estado.ventas.push({ ...venta, plan: planId, fecha: new Date().toISOString() });
    this.#guardar();
    return voucher;
  }

  resumen() {
    const ventasPorPlan = {};
    let totalQ = 0;
    for (const v of this.estado.ventas) {
      ventasPorPlan[v.plan] = (ventasPorPlan[v.plan] ?? 0) + 1;
      totalQ += v.montoQ ?? 0;
    }
    return { ventasPorPlan, totalQ, ventas: this.estado.ventas.length };
  }
}
