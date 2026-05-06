/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Vercel-friendly defaults. No custom webpack overrides; the app does not
  // require server-side Puppeteer (PDF export uses the browser's print
  // pipeline against a pre-rendered /print HTML route).
};

export default nextConfig;
