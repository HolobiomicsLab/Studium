/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config) {
    // Workspace TypeScript uses Node-compatible .js specifiers. Resolve those
    // to their source files when Next bundles the shared schema on the server.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};
export default nextConfig;
