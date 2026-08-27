import type { NextConfig } from 'next'

const config: NextConfig = {
  // pdfjs-dist ships a Node build that must stay external: bundling it breaks its
  // dynamic font/worker requires inside a serverless function.
  serverExternalPackages: ['pdfjs-dist'],
}

export default config
