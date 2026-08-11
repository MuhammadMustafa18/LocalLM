import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@excalidraw/excalidraw"],
};

export default config;
