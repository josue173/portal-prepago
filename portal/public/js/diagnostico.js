(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };

  function consultar(url) {
    var control = new AbortController();
    var t = setTimeout(function () { control.abort(); }, 5000);
    return fetch(url, { signal: control.signal, cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("http"); return r.json(); })
      .finally(function () { clearTimeout(t); });
  }

  // Un mensaje explicativo no es una dirección: se muestra con el estilo de texto normal
  function explicar(id, texto) {
    var el = $(id);
    el.className = "familia__meta";
    el.textContent = texto;
  }

  function marcar(id, ok, texto) {
    var el = $(id);
    el.textContent = texto;
    el.className = "etiqueta " + (ok ? "etiqueta--si" : "etiqueta--no");
  }

  consultar("api/diagnostico")
    .then(function (d) {
      marcar("actual-familia", true, d.familia);
      $("actual-ip").textContent = d.ip;
      $("actual-meta").textContent = "Atendido por la réplica " + d.atendidoPor;
    })
    .catch(function () {
      marcar("actual-familia", false, "sin respuesta");
      explicar("actual-ip", "No se pudo consultar el servidor.");
    });

  [["v4", document.body.dataset.v4], ["v6", document.body.dataset.v6]].forEach(function (par) {
    var pila = par[0];
    consultar(par[1])
      .then(function (d) {
        marcar(pila + "-estado", true, "Activo");
        $(pila + "-ip").textContent = d.ip;
      })
      .catch(function () {
        marcar(pila + "-estado", false, "No disponible");
        explicar(pila + "-ip", pila === "v6"
          ? "Tu dispositivo no tiene IPv6 en esta red, o tu conexión aún no está activa."
          : "No se pudo llegar por IPv4.");
      });
  });
})();
