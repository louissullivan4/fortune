/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{tsx,ts}'],
  darkMode: 'media', // overridden by CSS custom properties via prefers-color-scheme
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      page: 'var(--color-bg-page)',
      surface: 'var(--color-bg-surface)',
      raised: 'var(--color-bg-raised)',
      accent: 'var(--color-accent)',
      green: '#16a34a',
      red: '#dc2626',
      yellow: '#ca8a04',
    },
    textColor: {
      primary: 'var(--color-text-primary)',
      secondary: 'var(--color-text-secondary)',
      muted: 'var(--color-text-muted)',
      accent: 'var(--color-accent)',
      green: '#16a34a',
      red: '#dc2626',
      yellow: '#ca8a04',
      inherit: 'inherit',
    },
    borderColor: {
      DEFAULT: 'var(--color-border)',
      hover: 'var(--color-border-hover)',
      accent: 'var(--color-accent)',
      transparent: 'transparent',
    },
    extend: {
      fontFamily: {
        ui: ['system-ui', '-apple-system', 'sans-serif'],
        code: ['"JetBrains Mono"', 'monospace'],
      },
      fontSize: {
        '2xs': '11px',
        xs: '12px',
        sm: '13px',
        base: '14px',
        lg: '16px',
        xl: '20px',
      },
      spacing: {
        1: '4px',
        2: '8px',
        3: '12px',
        4: '16px',
        6: '24px',
        8: '32px',
        12: '48px',
      },
      borderRadius: {
        sm: '4px',
        DEFAULT: '4px',
        md: '6px',
        lg: '8px',
        full: '9999px',
      },
      borderWidth: {
        DEFAULT: '0.5px',
        0: '0',
        1: '1px',
      },
    },
  },
  plugins: [],
}
