# Mi Contabilidad

App de contabilidad (plan de cuentas, partida doble, libro mayor, balance
de comprobación, estados financieros y facturación) lista para desplegar.

## Probarla en tu computador

```bash
npm install
npm run dev
```

Abre la dirección que muestre la terminal (normalmente `http://localhost:5173`).

## Publicarla en internet (gratis, sin servidor propio)

**Opción más simple — Vercel:**

1. Crea una cuenta gratis en https://vercel.com
2. Sube esta carpeta a un repositorio de GitHub (o usa `vercel` CLI: `npm i -g vercel && vercel`)
3. En Vercel, "Add New Project" → selecciona el repositorio → Deploy.
   Vercel detecta Vite automáticamente, no necesitas configurar nada.
4. En unos segundos tendrás una URL pública (ej. `mi-contabilidad.vercel.app`).
   Puedes conectarle tu propio dominio desde el panel de Vercel (Settings → Domains).

**Alternativa — Netlify:** mismo proceso, o simplemente:
```bash
npm run build
```
y arrastra la carpeta `dist/` a https://app.netlify.com/drop

## Muy importante: sobre el guardado de datos

Esta versión guarda los datos con `localStorage`, es decir: **solo en el
navegador donde la uses**. Si borras datos del navegador, o entras desde
otro computador o celular, no vas a ver la misma información.

Eso está bien para probarla o para uso personal en un solo equipo. Si vas a
usarla en tu negocio de verdad (varios usuarios, varios dispositivos, o
simplemente no quieres arriesgarte a perder la información contable), el
siguiente paso natural es reemplazar `src/lib/storagePolyfill.js` por una
base de datos real. Dos caminos típicos y gratuitos para empezar:

- **Supabase** (https://supabase.com) — base de datos Postgres gratis,
  fácil de conectar desde React.
- **Firebase** (https://firebase.google.com) — Firestore, también con capa
  gratuita generosa.

Si en algún momento quieres que te ayude a hacer ese cambio (conectar una
base de datos real, agregar usuarios con login, etc.), puedes volver a
pedírmelo y lo hacemos juntos.

## Estructura del proyecto

```
src/
  App.jsx                 → toda la lógica y UI de la app
  lib/storagePolyfill.js  → guarda/lee datos (hoy: localStorage)
  main.jsx                → punto de entrada de React
index.html
package.json
```
