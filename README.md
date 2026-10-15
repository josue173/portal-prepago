# Portal cautivo prepago

Portal cautivo y API mock de pagos del proyecto **Ecosistema Empresarial de Internet Prepago con Portal Cautivo y pfSense** (Telecomunicaciones, UMG). El flujo completo es registro → plan → pago simulado → voucher → liberación en pfSense.

```
portal-prepago/
├── api/                       API mock (Node.js + Express)
│   ├── src/                   app.js (rutas), planes.js, validacion.js, vouchers.js, server.js
│   ├── test/api.test.js       16 pruebas automatizadas
│   └── vouchers/*.csv         CSV de vouchers exportados de pfSense (los incluidos son de ejemplo)
├── portal/
│   ├── public/                Portal: index.html, diagnostico.html, ipv6.html, css/, js/
│   ├── nginx/                 Plantilla de las réplicas (sirven el portal y redirigen /api)
│   └── scripts/build-pfsense.mjs   Genera la página que se sube a pfSense
├── docker-compose.yml         Desarrollo: API + 2 réplicas (8081, 8082)
└── docker-compose.srv-web.yml Ajustes para la VM srv-web (red host, IPv6)
```

## Probarlo en tu laptop

**Sin Docker** (Node 20 o superior):

```bash
cd api
npm install
npm test        # 16 pruebas
npm run dev     # API + portal en http://localhost:5000
```

**Con Docker**, igual que en `srv-web`:

```bash
cp .env.example .env
docker compose up --build
# Réplica A: http://localhost:8081   Réplica B: http://localhost:8082
```

### Tarjetas de prueba

El portal las muestra en pantalla; tocarlas llena el formulario.

| Número | Resultado |
| --- | --- |
| 4111 1111 1111 1111 | Aprobada (cualquier otra tarjeta válida también) |
| 4000 0000 0000 0002 | Fondos insuficientes (402) |
| 4000 0000 0000 0069 | Rechazada por el banco (402) |
| 4000 0000 0000 0119 | Banco sin respuesta: espera `TIMEOUT_MS` y devuelve 504 |

Ninguna tarjeta rechazada consume vouchers. El número completo nunca se guarda: solo los últimos 4 dígitos.

## API

| Método y ruta | Uso |
| --- | --- |
| `GET /api/salud` | Health check para HAProxy |
| `GET /api/planes` | Planes con precio, velocidad y vouchers disponibles |
| `POST /api/registro` | `{ nombre, telefono, email?, aceptaTerminos }` → `{ clienteId }` |
| `POST /api/pagos` | `{ clienteId, plan, tarjeta: { titular, numero, vencimiento, cvv } }` → `{ voucher, ... }` |
| `GET /api/diagnostico` | IP y familia (IPv4/IPv6) con que llegó el cliente, y qué réplica lo atendió |
| `GET /api/admin/resumen` | Ventas y stock por plan; requiere el encabezado `X-Admin-Token` |

Los errores siempre responden `{ error, mensaje, campos? }`; `campos` trae un mensaje por cada campo inválido.

Variables de entorno: `PORT` (5000), `HOST` (`::`), `TIMEOUT_MS` (15000), `ADMIN_TOKEN` (vacío = admin deshabilitado), `CORS_ORIGIN` (`*`), `VOUCHERS_DIR`, `ESTADO_FILE`.

## Despliegue en srv-web

1. En pfSense, crea un roll de vouchers por plan con la misma duración que en `api/src/planes.js` (60, 1440 y 10080 minutos) y exporta cada roll a CSV.
2. Reemplaza `api/vouchers/basico.csv`, `diario.csv` y `semanal.csv` con esos archivos.
3. En la VM:

   ```bash
   cp .env.example .env    # define ADMIN_TOKEN
   docker compose -f docker-compose.yml -f docker-compose.srv-web.yml up -d --build
   ```

   Con red `host`, las réplicas escuchan en 8081 y 8082 por IPv4 e IPv6 y ven la IP real del cliente. La API solo escucha en `127.0.0.1:5000`.

Los vouchers vendidos se guardan en el volumen `api-data`; reiniciar no vuelve a venderlos. Para empezar de cero (otro roll), borra el volumen: `docker volume rm portal-prepago_api-data`.

## Integración con pfSense

### Página del portal

```bash
cd portal
node scripts/build-pfsense.mjs http://portal.prepago.lan
```

Sube los archivos generados en `portal/dist/pfsense/` a la zona del portal cautivo:

| Archivo | Dónde en pfSense |
| --- | --- |
| `index.html` | Services › Captive Portal › zona › *Portal page contents* |
| `captiveportal-app.css` | Misma zona › File Manager |
| `captiveportal-app.js` | Misma zona › File Manager |

En modo pfSense, el portal envía el voucher a `$PORTAL_ACTION$` tras una cuenta regresiva de 8 s (para que el visitante anote su código) o al tocar "Conectar ahora". También muestra "Ya tengo un código" para reconectarse con un voucher vigente.

**HTTP o HTTPS:** si la zona sirve el portal por HTTPS, la API también debe ir por HTTPS con un certificado que el teléfono acepte; si no, el navegador bloquea las llamadas (contenido mixto). Para la Feria es más simple servir la zona y `portal.prepago.lan` por HTTP.

### Zona del portal cautivo

- Interfaz: VLAN 20 (USUARIOS). Autenticación: vouchers.
- *Allowed IP addresses*: la VIP de HAProxy (10.10.30.10). Sin esto, el cliente sin autenticar no alcanza la API.

### DNS Resolver (host overrides)

| Nombre | Registro | Apunta a | Para qué |
| --- | --- | --- | --- |
| `portal.prepago.lan` | A | 10.10.30.10 (VIP HAProxy) | Portal y API |
| `v4.prepago.lan` | A (solo) | 10.10.30.10 | Diagnóstico: prueba la pila IPv4 |
| `v6.prepago.lan` | AAAA (solo) | 2001:db8:acad:30::11 | Diagnóstico: prueba la pila IPv6 (puerto 8081) |
| `login.prepago.lan` | A (solo) | 192.0.2.1 | Enlace de la página de aviso IPv6; pfSense intercepta y muestra el portal |

### HAProxy (paquete de pfSense)

- Frontend en 10.10.30.10:80.
- Backend con dos servidores: `10.10.30.11:8081` y `10.10.30.11:8082`.
- Health check HTTP: `GET /api/salud`.
- Activar `option forwardfor` para que la API vea la IP del cliente.

### Firewall

Además de las reglas del documento de arquitectura, USUARIOS debe poder llegar a `2001:db8:acad:30::11` en el puerto **8081** (página de aviso IPv6 y diagnóstico IPv6).

El *port forward* IPv6 de clientes no autenticados envía su TCP/80 a `[2001:db8:acad:30::11]:8081`. Un *port forward* no cambia la ruta ni el `Host`, así que nginx responde según el `Host`: si es ajeno (por ejemplo, la sonda `connectivitycheck.gstatic.com/generate_204` de Android o `captive.apple.com` de iOS), redirige con un `Location` relativo a `/ipv6.html`. Así la redirección vuelve a entrar por el puerto 80 y no expone el 8081.

## Para la demo

- Para mostrar el balanceo, detén una réplica (`docker stop portal-prepago-portal-a-1`): HAProxy la marca caída y la otra sigue atendiendo. El encabezado `X-Replica` y la página de diagnóstico muestran qué réplica respondió.
- Para el resumen de ventas: `curl -H "X-Admin-Token: $ADMIN_TOKEN" http://portal.prepago.lan/api/admin/resumen`.
