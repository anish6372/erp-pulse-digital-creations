// The ERP backend (Express + SQLite) is unchanged; Next proxies API, uploads and the
// socket.io endpoint to it so the browser still talks to a single origin.
const BACKEND = process.env.BACKEND_URL || 'http://localhost:4000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false, // hide the floating Next.js badge in dev
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${BACKEND}/api/:path*` },
      { source: '/uploads/:path*', destination: `${BACKEND}/uploads/:path*` },
      { source: '/socket.io/:path*', destination: `${BACKEND}/socket.io/:path*` },
    ];
  },
};
export default nextConfig;
