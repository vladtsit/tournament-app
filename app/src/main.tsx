import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import { App } from "./App";
import { initI18n } from "./i18n";
import { applyTelegramColorScheme } from "./telegram";

applyTelegramColorScheme();

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");

// Initialise i18n before first paint so the user never sees an English flash.
void initI18n().finally(() => {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
