import type { Config } from 'tailwindcss';

/**
 * Shared Tailwind preset. Both the UI package and the Next.js app extend this
 * so design tokens stay consistent. Colors map to the CSS variables declared
 * in `src/styles/globals.css`.
 *
 * The palette is a premium, casino/esports-inspired dark theme: electric blue,
 * neon cyan, royal purple and violet, with gold / emerald / pink accents and
 * layered glows. Token *names* are kept stable so existing markup never breaks;
 * everything here is additive.
 */
const preset: Omit<Config, 'content'> = {
  darkMode: ['class'],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: {
        '2xl': '1440px',
      },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // --- Premium gaming accent ramp (additive) --------------------------
        neon: {
          DEFAULT: 'hsl(var(--neon))',
          foreground: 'hsl(var(--neon-foreground))',
        },
        violet: {
          DEFAULT: 'hsl(var(--violet))',
        },
        gold: {
          DEFAULT: 'hsl(var(--gold))',
          foreground: 'hsl(var(--gold-foreground))',
        },
        emerald: {
          DEFAULT: 'hsl(var(--emerald))',
        },
        pink: {
          DEFAULT: 'hsl(var(--pink))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        '2xl': 'calc(var(--radius) + 6px)',
        '3xl': 'calc(var(--radius) + 14px)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      backgroundImage: {
        'gradient-brand': 'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--neon)) 100%)',
        'gradient-royal':
          'linear-gradient(135deg, hsl(var(--violet)) 0%, hsl(var(--primary)) 50%, hsl(var(--pink)) 100%)',
        'gradient-gold': 'linear-gradient(135deg, hsl(var(--gold)) 0%, hsl(28 95% 34%) 100%)',
        'gradient-emerald': 'linear-gradient(135deg, hsl(var(--emerald)) 0%, hsl(var(--neon)) 100%)',
        'gradient-sheen':
          'linear-gradient(110deg, transparent 25%, hsl(0 0% 100% / 0.14) 50%, transparent 75%)',
      },
      boxShadow: {
        'glow-sm': '0 6px 18px -6px hsl(var(--primary) / 0.4)',
        glow: '0 10px 28px -8px hsl(var(--primary) / 0.5), 0 0 0 1px hsl(var(--primary) / 0.06)',
        'glow-neon': '0 10px 28px -8px hsl(var(--neon) / 0.5), 0 0 0 1px hsl(var(--neon) / 0.08)',
        'glow-gold': '0 10px 28px -8px hsl(var(--gold) / 0.5), 0 0 0 1px hsl(var(--gold) / 0.1)',
        'glow-pink': '0 10px 28px -8px hsl(var(--pink) / 0.5)',
        'glow-emerald': '0 10px 28px -8px hsl(var(--emerald) / 0.5)',
        'inner-glow': 'inset 0 1px 0 0 hsl(0 0% 100% / 0.6)',
        soft: '0 10px 30px -14px hsl(230 50% 40% / 0.25)',
        elevated: '0 26px 60px -22px hsl(230 50% 40% / 0.32)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(14px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'float-slow': {
          '0%, 100%': { transform: 'translateY(0) translateX(0)' },
          '50%': { transform: 'translateY(-22px) translateX(12px)' },
        },
        'glow-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
        'gradient-shift': {
          '0%, 100%': { 'background-position': '0% 50%' },
          '50%': { 'background-position': '100% 50%' },
        },
        shine: {
          '0%': { transform: 'translateX(-120%)' },
          '60%, 100%': { transform: 'translateX(120%)' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '70%, 100%': { transform: 'scale(1.7)', opacity: '0' },
        },
        marquee: {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-50%)' },
        },
        'spin-slow': {
          to: { transform: 'rotate(360deg)' },
        },
        'count-up': {
          from: { opacity: '0', transform: 'translateY(0.4em)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'dropdown-in': {
          from: { opacity: '0', transform: 'translateY(-4px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-in': 'fade-in 0.3s ease-out',
        'dropdown-in': 'dropdown-in 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-up': 'fade-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) both',
        shimmer: 'shimmer 1.5s infinite',
        float: 'float 6s ease-in-out infinite',
        'float-slow': 'float-slow 14s ease-in-out infinite',
        'glow-pulse': 'glow-pulse 2.4s ease-in-out infinite',
        'gradient-shift': 'gradient-shift 6s ease infinite',
        shine: 'shine 2.6s ease-in-out infinite',
        'pulse-ring': 'pulse-ring 2s cubic-bezier(0.3, 0, 0.4, 1) infinite',
        marquee: 'marquee 38s linear infinite',
        'spin-slow': 'spin-slow 14s linear infinite',
      },
    },
  },
  plugins: [],
};

export default preset;
