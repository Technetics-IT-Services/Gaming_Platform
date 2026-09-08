import '@/styles/globals.css';

import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono, Space_Grotesk } from 'next/font/google';

import { RouteBackground } from '@/components/backgrounds/route-background';
import { CinematicIntro } from '@/components/experience/cinematic-intro';
import { OfflineIndicator } from '@/components/monitoring/offline-indicator';
import { PwaRegister } from '@/components/monitoring/pwa-register';
import { WebVitalsReporter } from '@/components/monitoring/web-vitals-reporter';
import { AccessibilityMenu } from '@/components/shared/accessibility-menu';
import { AiAssistant } from '@/components/shared/ai-assistant';
import { SoundControl } from '@/components/shared/sound-control';
import { clientConfig } from '@/lib/config';
import { cn } from '@/lib/utils';
import { AppProviders } from '@/providers';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });
const display = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: `${clientConfig.appName} — Play. Win. Repeat.`,
    template: `%s · ${clientConfig.appName}`,
  },
  description:
    'Play premium casino games, crash, dice, roulette, live sports and tournaments. Big jackpots, instant wins and a world-class gaming experience.',
  applicationName: clientConfig.appName,
  metadataBase: new URL('http://localhost:3000'),
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/icon.svg' }],
  },
  appleWebApp: { capable: true, statusBarStyle: 'default', title: clientConfig.appName },
  openGraph: {
    title: clientConfig.appName,
    description: 'An original gaming universe — casino, crash, dice, roulette, sports and tournaments.',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#f4f6fc',
  width: 'device-width',
  initialScale: 1,
  // Extend under the notch/home-bar so `env(safe-area-inset-*)` (used by the fixed bottom nav and
  // sticky controls) resolves to real insets on mobile instead of 0 (Phase 2C.5 mobile shell).
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(inter.variable, mono.variable, display.variable)}
    >
      <body className="min-h-screen bg-background font-sans antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[300] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:font-semibold focus:text-primary-foreground focus:shadow-glow"
        >
          Skip to content
        </a>
        <AppProviders>
          <RouteBackground />
          {children}
          {/* Floating assistants/controls are desktop+ only — on mobile they
              overlap the bottom navigation and clutter the thumb zone (1.5). */}
          <div className="hidden md:block">
            <SoundControl />
            <AccessibilityMenu />
            <AiAssistant />
          </div>
          <CinematicIntro />
          <OfflineIndicator />
          <WebVitalsReporter />
          <PwaRegister />
        </AppProviders>
      </body>
    </html>
  );
}
