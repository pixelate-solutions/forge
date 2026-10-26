/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@forge/core"],
  serverExternalPackages: [],
  webpack(config) {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"]
    };
    return config;
  }
};

export default nextConfig;
