/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        background: '#F2F7F5',
        foreground: '#162420',
        card: '#ffffff',
        primary: {
          DEFAULT: '#0D9488',
          foreground: '#ffffff',
        },
        secondary: {
          DEFAULT: '#E6F2F0',
          foreground: '#0D9488',
        },
        muted: {
          DEFAULT: '#E8EDEB',
          foreground: '#6B827C',
        },
        accent: {
          DEFAULT: '#CCEDE9',
          foreground: '#0D7A6F',
        },
        destructive: '#DC2626',
        border: 'rgba(13, 148, 136, 0.12)',
        safe: '#16a34a',
        modify: '#d97706',
        avoid: '#dc2626',
      },
      borderRadius: {
        lg: '1rem',
        xl: '1.25rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono: ['"DM Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
}
