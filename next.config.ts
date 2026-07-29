import type { NextConfig } from 'next'

/**
 * Optional packages that `wagmi/connectors` pulls in but never executes here.
 * Duplicated for Turbopack because `webpack()` is ignored under `--turbopack`, and a
 * Turbopack build would fail to resolve them.
 */
const UNREACHABLE = ['@x402/evm', '@x402/core/client', '@x402/svm', '@x402/svm/exact/client']

const nextConfig: NextConfig = {
  // Fail the deploy on type errors rather than shipping them.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // A bridge UI inside someone else's iframe is a phishing primitive: the victim
          // sees a wrapper site while signing our burn intents.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
      {
        // Balances and attestations must never be cached by a CDN or shared proxy.
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }],
      },
    ]
  },

  webpack: (config, { webpack }) => {
    // Optional node-only logging deps that wagmi/viem reference but never need here.
    config.externals.push('pino-pretty', 'lokijs', 'encoding')

    /**
     * lib/wagmi.ts imports `injected` from `wagmi/connectors`, whose barrel drags in
     * baseAccount -> @base-org/account -> @coinbase/cdp-sdk plus @metamask/sdk. Those
     * reference optional packages that are not installed. We never construct a
     * baseAccount connector or run in React Native, so the code is unreachable.
     *
     * Delete this block if `injected()` is ever removed again.
     */
    config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /^@x402\// }))
    config.resolve.alias = {
      ...config.resolve.alias,
      '@react-native-async-storage/async-storage': false,
    }

    return config
  },

  // Mirror of the webpack workaround, for `next build --turbopack`.
  turbopack: {
    resolveAlias: {
      ...Object.fromEntries(UNREACHABLE.map((m) => [m, { browser: './lib/empty.ts' }])),
      '@react-native-async-storage/async-storage': { browser: './lib/empty.ts' },
    },
  },
}

export default nextConfig
