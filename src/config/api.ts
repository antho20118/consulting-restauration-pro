// Préfixé par /api pour ne jamais entrer en collision avec les routes du frontend
// (ex. /recettes est à la fois une page React et, sans préfixe, une route API).
export const API_URL = `${import.meta.env.VITE_API_URL ?? "http://localhost:3000"}/api`;
