import { ArcBackdrop } from '@/components/ArcBackdrop'
import { config } from '@/lib/wagmi'
import type { Metadata } from 'next'
import { DM_Sans, Space_Grotesk, Space_Mono } from 'next/font/google'
import { headers } from 'next/headers'
import { cookieToInitialState } from 'wagmi'
import './globals.css'
import { Providers } from './providers'

// arc.io's actual stack. next/font self-hosts these at build time, so there is no
// runtime request to Google and no layout shift.
const dm = DM_Sans({ subsets: ['latin'], variable: '--font-dm', display: 'swap' })
const grotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-grotesk',
  display: 'swap',
})
const spaceMono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-space-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Arc Bridge — Base → Arc USDC',
  description: 'Bridge USDC from Base to Arc mainnet through Circle Gateway.',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Keeps the connected account from flickering on first paint.
  const initialState = cookieToInitialState(config, (await headers()).get('cookie'))

  return (
    <html lang="en" className={`${dm.variable} ${grotesk.variable} ${spaceMono.variable}`}>
      <body>
        <ArcBackdrop />
        <Providers initialState={initialState}>{children}</Providers>
      </body>
    </html>
  )
}
