// Planes prepago. Cada plan corresponde a un "roll" de vouchers en pfSense
// (Services > Captive Portal > zona > Vouchers) con la misma duración.
// Los precios son de ejemplo para la demostración.
export const PLANES = [
  {
    id: "basico",
    nombre: "Básico",
    duracionMin: 60,
    duracionTexto: "1 hora",
    bajadaMbps: 2,
    subidaMbps: 1,
    precioQ: 5,
    archivoVouchers: "basico.csv"
  },
  {
    id: "diario",
    nombre: "Diario",
    duracionMin: 1440,
    duracionTexto: "24 horas",
    bajadaMbps: 5,
    subidaMbps: 2,
    precioQ: 15,
    archivoVouchers: "diario.csv"
  },
  {
    id: "semanal",
    nombre: "Semanal",
    duracionMin: 10080,
    duracionTexto: "7 días",
    bajadaMbps: 10,
    subidaMbps: 3,
    precioQ: 60,
    archivoVouchers: "semanal.csv"
  }
];

export const buscarPlan = (id) => PLANES.find((p) => p.id === id);
