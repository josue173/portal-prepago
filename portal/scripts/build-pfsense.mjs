// Genera los archivos para subir a la zona del portal cautivo de pfSense:
//   dist/pfsense/index.html            -> "Portal page contents"
//   dist/pfsense/captiveportal-app.css -> File Manager (pfSense exige el prefijo captiveportal-)
//   dist/pfsense/captiveportal-app.js  -> File Manager
//
// Uso: node scripts/build-pfsense.mjs [url-base-del-portal]
//      por defecto http://portal.prepago.lan (la VIP de HAProxy, en "Allowed IP addresses").
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const publico = join(raiz, "public");
const salida = join(raiz, "dist", "pfsense");
const base = (process.argv[2] ?? "http://portal.prepago.lan").replace(/\/$/, "");

const config = {
  modo: "pfsense",
  apiBase: `${base}/api`,
  diagnosticoUrl: `${base}/diagnostico.html`
};

// pfSense reemplaza $PORTAL_ACTION$, $PORTAL_REDIRURL$ y $PORTAL_ZONE$ al servir la página.
const formulario = `<form id="pf-login" method="post" action="$PORTAL_ACTION$" hidden>
    <input type="hidden" name="auth_voucher" id="pf-voucher">
    <input type="hidden" name="redirurl" value="$PORTAL_REDIRURL$">
    <input type="hidden" name="zone" value="$PORTAL_ZONE$">
    <input type="hidden" name="accept" value="Continuar">
  </form>`;

let html = readFileSync(join(publico, "index.html"), "utf8");
const reemplazos = [
  ['href="css/app.css"', 'href="captiveportal-app.css"'],
  ['src="js/app.js"', 'src="captiveportal-app.js"'],
  ["<!-- PORTAL_CONFIG -->", `<script>window.PORTAL_CONFIG = ${JSON.stringify(config)};</script>`],
  ["<!-- PFSENSE_FORM -->", formulario]
];
for (const [buscar, poner] of reemplazos) {
  if (!html.includes(buscar)) throw new Error(`No se encontró el marcador: ${buscar}`);
  html = html.replace(buscar, poner);
}

mkdirSync(salida, { recursive: true });
writeFileSync(join(salida, "index.html"), html);
copyFileSync(join(publico, "css", "app.css"), join(salida, "captiveportal-app.css"));
copyFileSync(join(publico, "js", "app.js"), join(salida, "captiveportal-app.js"));
console.log(`Listo: ${salida} (API en ${config.apiBase})`);
