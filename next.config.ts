import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // CV parsers load workers / native helpers at runtime; keep them out of the bundle.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "mammoth", "@napi-rs/canvas"],
  // @napi-rs/canvas picks its native binary (e.g. canvas-linux-x64-gnu on Vercel)
  // with a dynamic require that file tracing can't see, so ship it explicitly.
  outputFileTracingIncludes: {
    "/api/process": ["./node_modules/@napi-rs/canvas*/**/*", "./node_modules/pdfjs-dist/legacy/build/**/*"],
  },
};

export default nextConfig;
