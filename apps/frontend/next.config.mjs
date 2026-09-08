import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Build the workspace UI package from source.
  transpilePackages: ['@gaming-platform/ui'],
  // Produces a minimal standalone server bundle for Docker. Enabled only when
  // BUILD_STANDALONE=true (set by the Dockerfile) so local Windows builds —
  // where standalone tracing needs symlink privileges — are unaffected.
  output: process.env.BUILD_STANDALONE === 'true' ? 'standalone' : undefined,
  // Trace files from the monorepo root so workspace deps are bundled.
  outputFileTracingRoot: join(__dirname, '../../'),
  experimental: {
    optimizePackageImports: ['lucide-react', '@gaming-platform/ui'],
  },
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
  // Optional same-origin API proxy (opt-in via BACKEND_ORIGIN). Mirrors the production
  // reverse-proxy (nginx) so the browser talks to a single origin and the auth refresh
  // cookie flows natively. No effect when BACKEND_ORIGIN is unset (default behaviour).
  async rewrites() {
    const backend = process.env.BACKEND_ORIGIN;
    return backend ? [{ source: '/api/:path*', destination: `${backend}/api/:path*` }] : [];
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
