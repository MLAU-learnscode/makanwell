/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Traffic-light ratings (see workplan colour decisions)
        safe: '#16a34a', // green  — universal safe signal
        modify: '#d97706', // amber — caution, not danger
        avoid: '#dc2626', // red    — clear danger
        // Brand
        primary: '#0d9488', // teal — health + hawker
      },
      backgroundColor: {
        canvas: '#f9fafb', // near-white clinical background
      },
    },
  },
  plugins: [],
}
