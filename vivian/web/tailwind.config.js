export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
    },
    borderRadius: {
      none: '0',
      sm: '2px',
      DEFAULT: '4px',
    },
    boxShadow: {
      none: 'none',
    },
    fontFamily: {
      sans: ['Noto Sans', 'sans-serif'],
      mono: ['JetBrains Mono', 'monospace'],
    },
    fontSize: {
      xs: ['11px', { lineHeight: '16px' }],
      sm: ['12px', { lineHeight: '18px' }],
      base: ['13px', { lineHeight: '20px' }],
      md: ['14px', { lineHeight: '22px' }],
      lg: ['16px', { lineHeight: '24px' }],
      xl: ['20px', { lineHeight: '28px' }],
      '2xl': ['24px', { lineHeight: '32px' }],
    },
    spacing: {
      px: '1px',
      0: '0',
      1: '4px',
      2: '8px',
      3: '12px',
      4: '16px',
      5: '20px',
      6: '24px',
      8: '32px',
      10: '40px',
      12: '48px',
    },
    extend: {},
  },
  plugins: [],
}
