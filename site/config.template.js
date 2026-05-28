// Dibuat saat build Netlify -> menjadi site/config.js
// Jangan hardcode URL/API key di app.js
window.__CONFIG__ = {
  GAS_API_URL: "__GAS_API_URL__",
  API_KEY: "__API_KEY__"
};
