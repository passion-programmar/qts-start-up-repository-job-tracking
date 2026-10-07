import type { NextConfig } from 'next';

const apiUrl = process.env.API_URL || 'http://127.0.0.1:1028';

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
      {
        source: '/logo.png',
        destination: `${apiUrl}/logo.png`,
      },
      {
        source: '/account-logo.png',
        destination: `${apiUrl}/account-logo.png`,
      },
    ];
  },
  async redirects() {
    return [
      { source: '/qts-startup-user', destination: '/account', permanent: false },
      { source: '/qts-startup-user/:path*', destination: '/account/:path*', permanent: false },
    ];
  },
};

export default nextConfig;
