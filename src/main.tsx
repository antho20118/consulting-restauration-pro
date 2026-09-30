import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "@mui/material/styles";
import "./index.css";
import App from "./App";
import theme from "./theme";
import { enregistrerPwa } from "./offline/enregistrerPwa";
import { demarrerSynchronisationAutomatique } from "./offline/synchronisation";

enregistrerPwa();
// Indépendant du service worker (PWA) : la file d'attente d'écritures hors ligne repose sur
// IndexedDB + l'événement "online", jamais sur l'installation d'un service worker.
demarrerSynchronisationAutomatique();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>
);
