import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    qualities: [75, 90],
  },
  ...(process.env.NODE_ENV === 'development' && {
    allowedDevOrigins: [
      '*.e2b.app',
      'localhost',
      '0.0.0.0',
    ],
  }),
};

export default nextConfig;
