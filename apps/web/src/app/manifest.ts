import type { MetadataRoute } from "next";

/** Makes Applyance installable: its own icon on the desktop and home screen, opening in its own window. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Applyance",
    short_name: "Applyance",
    description: "Job application automation with a human in the loop.",
    start_url: "/dashboard?source=app",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#fcfcfc",
    theme_color: "#4f46e5",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Needs Attention", url: "/needs-attention", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Flightpath", url: "/flightpath", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Jobs", url: "/jobs", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
