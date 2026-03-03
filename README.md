# Aurum

App web para seguimiento de patrimonio neto (CLP, USD, EUR) con carga manual y OCR desde screenshots.

## Stack
- React + TypeScript + Vite
- Tailwind CSS (vía CDN en `index.html`)

## Desarrollo local
1. `npm install`
2. `npm run dev`

## Build
- `npm run build`

## Deploy en Vercel
- Framework: `Vite`
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`

## Variables de entorno (Firebase Web App)
Define estas variables en local (`.env`) y en Vercel:
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

Referencia: ver archivo [firebase.env.template](/Users/diegorodriguezpizarro/Documents/New%20project/Aurum/firebase.env.template).

## Infraestructura (owner)
- Firebase/GCP de Aurum están bajo la cuenta: `diegorp.madrid@gmail.com`
- Proyecto Firebase: `Aurum Prod`
- Proyecto GCP (id): `aurum-prod-489114`
- Billing account vinculada: `015D3D-32E945-FFB957`

### Nota operativa
- Mantener este dato actualizado si se cambia de cuenta/proyecto para evitar bloqueos de permisos y facturación.

## Alcance actual
- Módulo `Patrimonio`
- OCR para screenshots (Wise, Global66, SURA, BTG, Dividendo)
- Cierre mensual manual con comparativa cierre vs cierre
