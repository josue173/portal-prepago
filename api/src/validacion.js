// Validaciones de entrada. Devuelven un objeto { campo: mensaje } vacío si todo está bien.

export const soloDigitos = (s) => String(s ?? "").replace(/\D/g, "");

// Algoritmo de Luhn: detecta errores de digitación en números de tarjeta.
export function luhnValido(numero) {
  const d = soloDigitos(numero);
  if (d.length < 13 || d.length > 19) return false;
  let suma = 0;
  let doble = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = Number(d[i]);
    if (doble) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    suma += n;
    doble = !doble;
  }
  return suma % 10 === 0;
}

// "MM/AA" vigente hasta el último día del mes indicado.
export function vencimientoValido(texto, ahora = new Date()) {
  const m = /^(\d{2})\s*\/\s*(\d{2})$/.exec(String(texto ?? "").trim());
  if (!m) return false;
  const mes = Number(m[1]);
  const anio = 2000 + Number(m[2]);
  if (mes < 1 || mes > 12) return false;
  const finDeMes = new Date(anio, mes, 1); // primer día del mes siguiente
  return finDeMes > ahora;
}

export function validarRegistro(body) {
  const errores = {};
  const nombre = String(body?.nombre ?? "").trim();
  const telefono = soloDigitos(body?.telefono);
  const email = String(body?.email ?? "").trim();

  if (nombre.length < 3 || nombre.length > 60 || !/^[\p{L} .'-]+$/u.test(nombre)) {
    errores.nombre = "Escribe tu nombre (solo letras, 3 a 60 caracteres).";
  }
  if (!/^[2-7]\d{7}$/.test(telefono)) {
    errores.telefono = "Escribe un teléfono de Guatemala de 8 dígitos.";
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    errores.email = "El correo no tiene un formato válido.";
  }
  if (body?.aceptaTerminos !== true) {
    errores.aceptaTerminos = "Debes aceptar las condiciones del servicio.";
  }
  return { errores, datos: { nombre, telefono, email: email || null } };
}

export function validarTarjeta(tarjeta, ahora = new Date()) {
  const errores = {};
  const numero = soloDigitos(tarjeta?.numero);
  const titular = String(tarjeta?.titular ?? "").trim();

  if (!luhnValido(numero)) errores.numero = "El número de tarjeta no es válido.";
  if (!vencimientoValido(tarjeta?.vencimiento, ahora)) {
    errores.vencimiento = "Fecha inválida o tarjeta vencida (usa MM/AA).";
  }
  if (!/^\d{3,4}$/.test(String(tarjeta?.cvv ?? ""))) errores.cvv = "El CVV tiene 3 o 4 dígitos.";
  if (titular.length < 3) errores.titular = "Escribe el nombre como aparece en la tarjeta.";
  return { errores, numero };
}
