import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";
import { getToken } from "@/lib/auth";

// Configure API base URL from environment
const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:5001/api";
setBaseUrl(apiUrl);

// Wire the JWT from localStorage into every generated API call
setAuthTokenGetter(() => getToken());

createRoot(document.getElementById("root")!).render(<App />);
