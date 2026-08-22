import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

/**
 * The dev/preview server doubles as the app's tiny backend: the browser calls
 * /api/openrouter/* and /api/sarvam/* with no credentials, and the proxy
 * injects the matching key from .env.local (OPENROUTER_API_KEY /
 * SARVAM_API_KEY — deliberately NOT VITE_-prefixed, so they can never leak
 * into the client bundle). Production swaps the keys in the same file or
 * replaces the proxy with a real gateway.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxy = {
    "/api/openrouter": {
      target: "https://openrouter.ai/api/v1",
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/api\/openrouter/, ""),
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY ?? ""}`,
        "X-Title": "VibeStudio"
      }
    },
    "/api/sarvam": {
      target: "https://api.sarvam.ai/v1",
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/api\/sarvam/, ""),
      headers: {
        "api-subscription-key": env.SARVAM_API_KEY ?? ""
      }
    }
  };
  return {
    plugins: [react()],
    server: { proxy },
    preview: { proxy }
  };
});
