/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      boxShadow: {
        forge: '0 28px 60px rgba(28, 22, 16, 0.28)',
      },
      colors: {
        bronze: {
          50: '#fdf8f1',
          100: '#f4e6d2',
          200: '#e6c49f',
          300: '#d49f63',
          400: '#bd7a35',
          500: '#9f5e1f',
          600: '#844716',
          700: '#673511',
          800: '#47240d',
          900: '#2d1708',
        },
        slateforge: {
          950: '#17120e',
        },
      },
      fontFamily: {
        display: ['"Segoe UI Variable Display"', '"Trebuchet MS"', 'sans-serif'],
        body: ['"Segoe UI Variable Text"', '"Bahnschrift"', 'sans-serif'],
        mono: ['"Cascadia Code"', '"Consolas"', 'monospace'],
      },
    },
  },
  plugins: [],
}
