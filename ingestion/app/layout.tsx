import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Cambodia food-price data pipeline',
  description:
    'Publication-updated ingestion of WFP Cambodia market monitoring reports into a reviewed food-price dataset.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
