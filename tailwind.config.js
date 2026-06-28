/** @type {import('tailwindcss').Config} */
export default {
  // We pivot via [data-theme] on <html>. `dark` / `light` classes still ride along for safety.
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter Variable', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'SF Pro Text', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      letterSpacing: {
        tightish: '-0.011em',
        tighter:  '-0.02em',
      },
      fontSize: {
        display: ['28px',  { lineHeight: '1.15', letterSpacing: '-0.02em',  fontWeight: '600' }],
        page:    ['20px',  { lineHeight: '1.25', letterSpacing: '-0.015em', fontWeight: '600' }],
        section: ['15px',  { lineHeight: '1.35', letterSpacing: '-0.005em', fontWeight: '600' }],
        cardt:   ['13px',  { lineHeight: '1.35', fontWeight: '600' }],
        body:    ['13.5px',{ lineHeight: '1.5' }],
        meta:    ['12px',  { lineHeight: '1.4' }],
        label:   ['11px',  { lineHeight: '1.2',  letterSpacing: '0.02em', fontWeight: '500' }],
      },
      colors: {
        // All theme-aware tokens resolve at runtime through CSS variables.
        // Define values in src/index.css under [data-theme="dark"] / [data-theme="light"].
        canvas:   'rgb(var(--bg-canvas-rgb) / <alpha-value>)',
        surface:  'rgb(var(--bg-surface-rgb) / <alpha-value>)',
        elevated: 'rgb(var(--bg-elevated-rgb) / <alpha-value>)',
        raised:   'rgb(var(--bg-raised-rgb) / <alpha-value>)',
        s1:       'rgb(var(--surface-1-rgb) / <alpha-value>)',
        s2:       'rgb(var(--surface-2-rgb) / <alpha-value>)',
        s3:       'rgb(var(--surface-3-rgb) / <alpha-value>)',
        line: {
          soft:    'var(--line-soft)',
          DEFAULT: 'var(--line)',
          strong:  'var(--line-strong)',
        },
        ink: {
          DEFAULT: 'rgb(var(--ink-rgb) / <alpha-value>)',
          dim:     'rgb(var(--ink-dim-rgb) / <alpha-value>)',
          muted:   'rgb(var(--ink-muted-rgb) / <alpha-value>)',
          faint:   'rgb(var(--ink-faint-rgb) / <alpha-value>)',
        },
        // Accent — theme-dependent. Dark = Mystify purple. Light = teal.
        accent: {
          50:  'rgb(var(--accent-50-rgb)  / <alpha-value>)',
          100: 'rgb(var(--accent-100-rgb) / <alpha-value>)',
          400: 'rgb(var(--accent-400-rgb) / <alpha-value>)',
          500: 'rgb(var(--accent-500-rgb) / <alpha-value>)',
          600: 'rgb(var(--accent-600-rgb) / <alpha-value>)',
          700: 'rgb(var(--accent-700-rgb) / <alpha-value>)',
          DEFAULT: 'rgb(var(--accent-500-rgb) / <alpha-value>)',
        },
        // Semantic — same across themes (status meaning shouldn't flip).
        ok:    '#10B981',
        warn:  '#F59E0B',
        err:   '#EF4444',
        info:  '#3B82F6',
        // Avatar palette (deterministic by hash) — unchanged
        av: {
          emerald: '#A7F3D0',
          violet:  '#C4B5FD',
          amber:   '#FCD34D',
          rose:    '#FECDD3',
          sky:     '#BAE6FD',
          peach:   '#FED7AA',
          mint:    '#BBF7D0',
          slate:   '#CBD5E1',
        },
      },
      borderRadius: {
        sm:    '6px',
        md:    '8px',
        lg:    '10px',
        xl:    '12px',
        '2xl': '16px',
        '3xl': '20px',
      },
      boxShadow: {
        e1: '0 0 0 1px var(--shadow-ring), 0 1px 2px var(--shadow-2)',
        e2: '0 0 0 1px var(--shadow-ring), 0 4px 12px var(--shadow-3)',
        e3: '0 0 0 1px var(--shadow-ring), 0 12px 32px var(--shadow-4)',
        ring: '0 0 0 2px rgb(var(--accent-500-rgb) / 0.4)',
      },
      transitionTimingFunction: {
        sleek: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        snap:  'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      transitionDuration: {
        150: '150ms',
        200: '200ms',
        250: '250ms',
      },
      keyframes: {
        fadeIn:  { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        scaleIn: { '0%': { opacity: '0', transform: 'scale(0.98) translateY(2px)' }, '100%': { opacity: '1', transform: 'scale(1) translateY(0)' } },
        slideUp: { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
      },
      animation: {
        'fade-in':  'fadeIn  150ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
        'scale-in': 'scaleIn 180ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'slide-up': 'slideUp 220ms cubic-bezier(0.16, 1, 0.3, 1) both',
      },
    },
  },
  plugins: [],
};
