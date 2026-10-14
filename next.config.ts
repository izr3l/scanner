import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'export', trailingSlash: true, poweredByHeader: false,
  images: { unoptimized: true },
  reactStrictMode: true,
  webpack(config) {
    config.module.rules.push({ test: /[\\/]node_modules[\\/](vaul|sonner)[\\/]dist[\\/]index\.(mjs|js)$/, use: [{ loader: require.resolve('./scripts/external-css-loader.cjs') }] });
    config.module.rules.push({ test: /[\\/]node_modules[\\/]react-remove-scroll-bar[\\/]dist[\\/]es(5|2015)[\\/]component\.js$/, use: [{ loader: require.resolve('./scripts/scrollbar-css-loader.cjs') }] });
    return config;
  },
};
export default config;
