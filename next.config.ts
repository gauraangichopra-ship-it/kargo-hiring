import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // CV parsers load workers / native helpers at runtime; keep them out of the bundle.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "mammoth"],
};

export default nextConfig;
