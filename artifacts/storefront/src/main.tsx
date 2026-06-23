import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setBaseUrl } from "@workspace/api-client-react";

// Configure API base URL from environment
const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:5001/api";
setBaseUrl(apiUrl);

createRoot(document.getElementById("root")!).render(<App />);
