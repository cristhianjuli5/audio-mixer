/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        'cyber': ['Orbitron', 'sans-serif'],
        'mono-retro': ['"Share Tech Mono"', 'monospace'],
      },
      colors: {
        'neon-magenta': '#ff2d7b',
        'neon-cyan': '#00f0ff',
        'neon-yellow': '#f7ff00',
        'cyber-dark': '#0a0a12',
        'cyber-panel': 'rgba(15, 15, 25, 0.8)',
      },
      animation: {
        'glitch': 'glitch 0.2s infinite',
        'pulse-neon': 'pulse-neon 2s infinite',
        'scanline': 'scanline 10s linear infinite',
        'flicker': 'flicker 0.15s infinite',
      },
      keyframes: {
        glitch: {
          '0%, 100%': { transform: 'translate(0)' },
          '33%': { transform: 'translate(-2px, 1px)' },
          '66%': { transform: 'translate(2px, -1px)' },
        },
        'pulse-neon': {
          '0%, 100%': { boxShadow: '0 0 10px #00f0ff, 0 0 20px #00f0ff' },
          '50%': { boxShadow: '0 0 20px #00f0ff, 0 0 40px #00f0ff' },
        },
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
        flicker: {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.8 },
        }
      }
    },
  },
  plugins: [],
}