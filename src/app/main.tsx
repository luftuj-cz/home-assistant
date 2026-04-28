import { createRoot } from "react-dom/client";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "../index.css";
import App from "@luftuj/app/App.tsx";
import "../shared/i18n";

createRoot(document.getElementById("root")!).render(<App />);
