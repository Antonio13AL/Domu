# Domu — Frontend (React)

Aplicación SPA de la plataforma de gestión de comunidades **Domu**.

## Stack

| Área          | Tecnología                                             |
| :------------ | :----------------------------------------------------- |
| UI            | React 19 (componentes funcionales y hooks)             |
| Lenguaje      | JavaScript ES6+ (`.js` / `.jsx`, sin TypeScript)       |
| Enrutado      | React Router                                           |
| Estado global | Zustand                                                |
| HTTP          | `fetch` mediante el cliente de `src/api/`              |
| Estilos       | CSS tradicional (`index.css`, `App.css`) + CSS Modules |
| Build         | Vite                                                   |
| Tests         | Vitest + Testing Library + Playwright                  |

## Requisitos

- Node.js 20 o superior y npm.

## Puesta en marcha

```bash
cp .env.example .env   # ajusta VITE_API_BASE_URL si hace falta
npm install
npm run dev
```

El servidor de desarrollo queda en `http://localhost:5173` y proxea `/api`
hacia la API de Express (ver `vite.config.js`).

## Scripts

| Comando                 | Descripción                               |
| :---------------------- | :---------------------------------------- |
| `npm run dev`           | Servidor de desarrollo con HMR            |
| `npm run build`         | Build de producción en `dist/`            |
| `npm run preview`       | Vista previa del build                    |
| `npm run lint`          | Análisis estático con ESLint              |
| `npm test`              | Tests unitarios y de componentes (Vitest) |
| `npm run test:coverage` | Tests con informe de cobertura            |
| `npm run test:e2e`      | Tests end-to-end (Playwright)             |

## Variables de entorno

Ver `.env.example`. Toda variable prefijada con `VITE_` es **pública**:
se incrusta en el bundle. No se deben colocar secretos.

## Documentación

- Reglas del proyecto: `../.opencode/rules/frontend-rules.md`
- Sistema de diseño: `../.opencode/rules/DESIGN.md`
- Roadmap: `../.opencode/roadmap/frontend-roadmap.md`
