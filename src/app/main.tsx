import { createRoot } from "react-dom/client";
import "../globals.css";
import App from "@luftuj/app/App.tsx";
import "../shared/i18n";

createRoot(document.getElementById("root")!).render(<App />);
