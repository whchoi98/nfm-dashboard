'use client';

import Script from 'next/script';

// Real User Monitoring via aws-rum-pipeline. NEXT_PUBLIC_* values are inlined
// at build time (Docker build args); when unset the provider renders nothing,
// so local dev collects nothing by default.
const RUM_ENDPOINT = process.env.NEXT_PUBLIC_RUM_ENDPOINT;
const RUM_API_KEY = process.env.NEXT_PUBLIC_RUM_API_KEY;

declare global {
  interface Window {
    RumSDK?: {
      init(config: {
        endpoint: string;
        apiKey: string;
        appName: string;
        appVersion: string;
      }): void;
    };
  }
}

export default function RumProvider() {
  if (!RUM_ENDPOINT || !RUM_API_KEY) return null;

  return (
    <Script
      src="/rum-sdk.min.js"
      strategy="afterInteractive"
      // onReady instead of onLoad: onLoad can be missed when the script loads
      // from the preload cache before React attaches the handler. init() is
      // idempotent, so onReady re-fires on remounts are safe.
      onReady={() => {
        window.RumSDK?.init({
          endpoint: RUM_ENDPOINT,
          apiKey: RUM_API_KEY,
          appName: 'nfm-dashboard', // rum-pipeline partition id (^[a-z0-9-]{1,64}$)
          appVersion: '0.10.0',
        });
      }}
    />
  );
}
