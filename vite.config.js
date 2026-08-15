import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon-192.png", "icons/icon-512.png"],
      manifest: {
        name: "Al Sugri Ops",
        short_name: "Al Sugri",
        description: "Production, inventory, sales and reconciliation for beverage factories",
        theme_color: "#0B1E2C",
        background_color: "#0B1E2C",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest}"]
      }
    })
  ],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001"
    }
  },
  preview: {
    host: true,
    port: 4173
  }
});
