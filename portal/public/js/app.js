/*
 * Portal cautivo prepago: registro -> plan -> pago simulado -> voucher -> liberación en pfSense.
 *
 * Modos (window.PORTAL_CONFIG, opcional):
 *   - "demo":    servido por las réplicas de srv-web; muestra el voucher sin tocar pfSense.
 *   - "pfsense": página subida a la zona del portal cautivo; envía el voucher a $PORTAL_ACTION$.
 *
 * Restricciones del mini navegador de portal cautivo (iOS/Android): no se usa localStorage,
 * ventanas emergentes ni recursos externos.
 */
(function () {
  "use strict";

  var config = Object.assign(
    { modo: "demo", apiBase: "/api", diagnosticoUrl: "diagnostico.html", tiempoEsperaMs: 25000, segundosAutoConexion: 8 },
    window.PORTAL_CONFIG || {}
  );

  var estado = { clienteId: null, nombre: "", planes: [], plan: null, ocupado: false };
  var $ = function (id) { return document.getElementById(id); };

  // ---------- API ----------

  function pedir(ruta, opciones) {
    var control = new AbortController();
    var temporizador = setTimeout(function () { control.abort(); }, config.tiempoEsperaMs);
    var init = Object.assign({ signal: control.signal, headers: { "Content-Type": "application/json" } }, opciones || {});

    return fetch(config.apiBase + ruta, init)
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (datos) {
          return { ok: r.ok, status: r.status, datos: datos };
        });
      })
      .catch(function (e) {
        var error = new Error(e.name === "AbortError" ? "tiempo" : "red");
        throw error;
      })
      .finally(function () { clearTimeout(temporizador); });
  }

  var MENSAJE_RED = "No pudimos comunicarnos con el sistema. Verifica que sigues conectado al Wi-Fi Prepago-UMG e intenta de nuevo.";
  var MENSAJE_TIEMPO = "El sistema tardó demasiado en responder. No se realizó ningún cobro; intenta de nuevo.";
  var mensajeDeFallo = function (e) { return e.message === "tiempo" ? MENSAJE_TIEMPO : MENSAJE_RED; };

  // ---------- Navegación entre pasos ----------

  function irA(n) {
    for (var i = 1; i <= 4; i++) $("paso-" + i).hidden = i !== n;
    var items = $("pasos").children;
    for (var j = 0; j < items.length; j++) {
      items[j].classList.toggle("hecho", j < n - 1);
      if (j === n - 1) items[j].setAttribute("aria-current", "step");
      else items[j].removeAttribute("aria-current");
    }
    window.scrollTo(0, 0);
    var titulo = $("t-paso-" + n);
    titulo.setAttribute("tabindex", "-1");
    titulo.focus({ preventScroll: true });
  }

  function avisar(paso, texto) { $("aviso-" + paso).textContent = texto || ""; }

  // ---------- Errores por campo ----------

  var ID_ERROR = { aceptaTerminos: "e-acepta" };
  var ID_CAMPO = { aceptaTerminos: "acepta" };

  function mostrarErrores(form, campos) {
    var entradas = form.querySelectorAll("input");
    for (var i = 0; i < entradas.length; i++) entradas[i].removeAttribute("aria-invalid");
    form.querySelectorAll(".error-campo").forEach(function (p) { p.textContent = ""; });

    var primero = null;
    Object.keys(campos || {}).forEach(function (campo) {
      var entrada = $(ID_CAMPO[campo] || campo);
      var error = $(ID_ERROR[campo] || "e-" + campo);
      if (entrada) {
        entrada.setAttribute("aria-invalid", "true");
        primero = primero || entrada;
      }
      if (error) error.textContent = campos[campo];
    });
    if (primero) primero.focus();
    return primero === null;
  }

  function ocupar(boton, texto) {
    estado.ocupado = true;
    boton.disabled = true;
    boton.dataset.texto = boton.textContent;
    boton.textContent = texto;
    boton.classList.add("cargando");
  }

  function liberar(boton) {
    estado.ocupado = false;
    boton.disabled = false;
    boton.classList.remove("cargando");
    if (boton.dataset.texto) boton.textContent = boton.dataset.texto;
  }

  // ---------- Validación en el cliente (la API valida lo mismo) ----------

  var digitos = function (s) { return String(s || "").replace(/\D/g, ""); };

  function luhn(numero) {
    var d = digitos(numero);
    if (d.length < 13 || d.length > 19) return false;
    var suma = 0, doble = false;
    for (var i = d.length - 1; i >= 0; i--) {
      var n = Number(d[i]);
      if (doble) { n *= 2; if (n > 9) n -= 9; }
      suma += n;
      doble = !doble;
    }
    return suma % 10 === 0;
  }

  function vencimientoValido(texto) {
    var m = /^(\d{2})\/(\d{2})$/.exec(texto);
    if (!m) return false;
    var mes = Number(m[1]);
    if (mes < 1 || mes > 12) return false;
    return new Date(2000 + Number(m[2]), mes, 1) > new Date();
  }

  function validarRegistro(d) {
    var e = {};
    if (!/^[\p{L} .'-]{3,60}$/u.test(d.nombre)) e.nombre = "Escribe tu nombre (solo letras, 3 a 60 caracteres).";
    if (!/^[2-7]\d{7}$/.test(digitos(d.telefono))) e.telefono = "Escribe un teléfono de Guatemala de 8 dígitos.";
    if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) e.email = "El correo no tiene un formato válido.";
    if (!d.aceptaTerminos) e.aceptaTerminos = "Debes aceptar las condiciones del servicio.";
    return e;
  }

  function validarTarjeta(t) {
    var e = {};
    if (t.titular.trim().length < 3) e.titular = "Escribe el nombre como aparece en la tarjeta.";
    if (!luhn(t.numero)) e.numero = "Revisa el número: no corresponde a una tarjeta válida.";
    if (!vencimientoValido(t.vencimiento)) e.vencimiento = "Usa MM/AA con una fecha vigente.";
    if (!/^\d{3,4}$/.test(t.cvv)) e.cvv = "El CVV tiene 3 o 4 dígitos.";
    return e;
  }

  // ---------- Paso 1: registro ----------

  $("form-registro").addEventListener("submit", function (ev) {
    ev.preventDefault();
    if (estado.ocupado) return;
    avisar(1, "");

    var datos = {
      nombre: $("nombre").value.trim(),
      telefono: $("telefono").value,
      email: $("email").value.trim(),
      aceptaTerminos: $("acepta").checked
    };
    if (!mostrarErrores(this, validarRegistro(datos))) return;

    var boton = this.querySelector("button[type=submit]");
    ocupar(boton, "Guardando");
    pedir("/registro", { method: "POST", body: JSON.stringify(datos) })
      .then(function (r) {
        if (r.status === 201) {
          estado.clienteId = r.datos.clienteId;
          estado.nombre = r.datos.nombre;
          return cargarPlanes().then(function () { irA(2); });
        }
        if (r.datos.campos) mostrarErrores($("form-registro"), r.datos.campos);
        avisar(1, r.datos.mensaje || "No se pudo guardar el registro.");
      })
      .catch(function (e) { avisar(1, mensajeDeFallo(e)); })
      .finally(function () { liberar(boton); });
  });

  // ---------- Paso 2: plan ----------

  function crear(etiqueta, clase, texto) {
    var el = document.createElement(etiqueta);
    if (clase) el.className = clase;
    if (texto !== undefined) el.textContent = texto;
    return el;
  }

  function pintarPlanes() {
    var lista = $("lista-planes");
    lista.querySelectorAll(".ficha").forEach(function (f) { f.remove(); });

    estado.planes.forEach(function (p) {
      var agotado = p.disponibles === 0;
      var ficha = crear("label", "ficha");
      var radio = crear("input");
      radio.type = "radio";
      radio.name = "plan";
      radio.value = p.id;
      radio.disabled = agotado;
      radio.checked = estado.plan && estado.plan.id === p.id && !agotado;

      var cuerpo = crear("span", "ficha__cuerpo");
      var talon = crear("span", "ficha__talon");
      talon.appendChild(crear("span", "ficha__moneda", "Q"));
      talon.appendChild(crear("span", "ficha__precio", String(p.precioQ)));

      var datos = crear("span", "ficha__datos");
      datos.appendChild(crear("span", "ficha__nombre", p.nombre + ": " + p.duracionTexto));
      datos.appendChild(crear("span", "ficha__detalle", "Hasta " + p.bajadaMbps + " Mbps de bajada y " + p.subidaMbps + " de subida"));
      if (agotado) datos.appendChild(crear("span", "ficha__estado", "Agotado por ahora"));

      cuerpo.appendChild(talon);
      cuerpo.appendChild(datos);
      ficha.appendChild(radio);
      ficha.appendChild(cuerpo);
      lista.appendChild(ficha);
    });
    actualizarBotonPlan();
  }

  function actualizarBotonPlan() {
    var elegido = $("form-plan").querySelector("input[name=plan]:checked");
    estado.plan = elegido ? estado.planes.find(function (p) { return p.id === elegido.value; }) : null;
    var boton = $("btn-plan");
    boton.disabled = !estado.plan;
    boton.textContent = estado.plan ? "Continuar con Q" + estado.plan.precioQ : "Elige un plan";
  }

  function cargarPlanes() {
    return pedir("/planes").then(function (r) {
      if (!r.ok || !Array.isArray(r.datos)) throw new Error("red");
      estado.planes = r.datos;
      pintarPlanes();
    }).catch(function (e) {
      avisar(2, mensajeDeFallo(e));
    });
  }

  $("form-plan").addEventListener("change", actualizarBotonPlan);

  $("form-plan").addEventListener("submit", function (ev) {
    ev.preventDefault();
    if (!estado.plan) return;
    avisar(2, "");
    var p = estado.plan;
    var resumen = $("resumen");
    resumen.textContent = "";
    resumen.appendChild(crear("span", null, "Plan " + p.nombre + ", " + p.duracionTexto));
    resumen.appendChild(crear("strong", null, "Q" + p.precioQ));
    $("btn-pagar").textContent = "Pagar Q" + p.precioQ;
    if (!$("titular").value) $("titular").value = estado.nombre;
    irA(3);
  });

  // ---------- Paso 3: pago ----------

  $("numero").addEventListener("input", function () {
    this.value = digitos(this.value).slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 ");
  });

  $("vencimiento").addEventListener("input", function (ev) {
    var d = digitos(this.value).slice(0, 4);
    var borrando = ev.inputType && ev.inputType.indexOf("delete") === 0;
    this.value = d.length > 2 || (d.length === 2 && !borrando) ? d.slice(0, 2) + "/" + d.slice(2) : d;
  });

  $("cvv").addEventListener("input", function () { this.value = digitos(this.value).slice(0, 4); });

  document.querySelectorAll("[data-tarjeta]").forEach(function (b) {
    b.addEventListener("click", function () {
      $("numero").value = b.dataset.tarjeta.replace(/(\d{4})(?=\d)/g, "$1 ");
      $("vencimiento").value = "12/30";
      $("cvv").value = "123";
      if (!$("titular").value) $("titular").value = estado.nombre || "Cliente de prueba";
      mostrarErrores($("form-pago"), {});
      avisar(3, "");
      $("btn-pagar").focus();
    });
  });

  $("form-pago").addEventListener("submit", function (ev) {
    ev.preventDefault();
    if (estado.ocupado) return;
    avisar(3, "");

    var tarjeta = {
      titular: $("titular").value,
      numero: digitos($("numero").value),
      vencimiento: $("vencimiento").value.trim(),
      cvv: $("cvv").value
    };
    if (!mostrarErrores(this, validarTarjeta(tarjeta))) return;

    var boton = $("btn-pagar");
    ocupar(boton, "Procesando pago");
    pedir("/pagos", { method: "POST", body: JSON.stringify({ clienteId: estado.clienteId, plan: estado.plan.id, tarjeta: tarjeta }) })
      .then(function (r) {
        if (r.status === 201) return mostrarVoucher(r.datos);
        var d = r.datos;
        if (d.error === "sin_registro") { avisar(1, d.mensaje); irA(1); return; }
        if (d.error === "plan_agotado") { estado.plan = null; avisar(2, d.mensaje); cargarPlanes(); irA(2); return; }
        if (d.campos) mostrarErrores($("form-pago"), d.campos);
        avisar(3, d.mensaje || "No se pudo completar el pago.");
      })
      .catch(function (e) { avisar(3, mensajeDeFallo(e)); })
      .finally(function () { liberar(boton); });
  });

  // ---------- Paso 4: voucher y liberación ----------

  function mostrarVoucher(pago) {
    $("gracias").textContent = "Gracias, " + estado.nombre.split(" ")[0] + ". Se cobraron Q" + pago.montoQ + " a tu tarjeta.";
    $("v-plan").textContent = "Plan " + pago.plan.nombre;
    $("v-duracion").textContent = pago.plan.duracionTexto;
    $("v-codigo").textContent = pago.voucher;
    var acciones = $("acciones-final");
    acciones.textContent = "";
    irA(4);

    var formulario = $("pf-login");
    if (config.modo === "pfsense" && formulario) {
      $("pf-voucher").value = pago.voucher;
      // Cuenta regresiva: da tiempo de anotar el código antes de que pfSense cambie de página
      var restantes = config.segundosAutoConexion;
      var enviado = false;
      var enviar = function () {
        if (enviado) return;
        enviado = true;
        clearInterval(reloj);
        $("estado-conexion").textContent = "Activando tu conexión…";
        formulario.submit();
      };
      var mostrar = function () {
        $("estado-conexion").textContent = "Anota tu código. Te conectaremos en " + restantes + " s.";
      };
      var reloj = setInterval(function () {
        restantes -= 1;
        if (restantes <= 0) enviar(); else mostrar();
      }, 1000);
      mostrar();
      var boton = crear("button", "boton", "Conectar ahora");
      boton.type = "button";
      boton.addEventListener("click", enviar);
      acciones.appendChild(boton);
      return;
    }

    $("estado-conexion").textContent =
      "Modo demostración: en la red Prepago-UMG, pfSense recibe este código y libera tu conexión automáticamente.";
    var otro = crear("button", "boton", "Comprar otro plan");
    otro.type = "button";
    otro.addEventListener("click", function () {
      $("form-pago").reset();
      estado.plan = null;
      cargarPlanes().then(function () { irA(2); });
    });
    acciones.appendChild(otro);
  }

  // ---------- Inicio ----------

  document.querySelectorAll("[data-volver]").forEach(function (b) {
    b.addEventListener("click", function () { irA(Number(b.dataset.volver)); });
  });

  $("link-diagnostico").href = config.diagnosticoUrl;

  // Reconexión con un voucher ya comprado (solo tiene sentido frente a pfSense)
  if (config.modo === "pfsense" && $("pf-login")) {
    $("ya-tengo").hidden = false;
    $("form-codigo").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var codigo = $("codigo").value.trim();
      if (!/^[A-Za-z0-9]{6,}$/.test(codigo)) {
        mostrarErrores(this, { codigo: "Escribe el código tal como aparece, sin espacios." });
        return;
      }
      $("pf-voucher").value = codigo;
      $("pf-login").submit();
    });
  }
})();
