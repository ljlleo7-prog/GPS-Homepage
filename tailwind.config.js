/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        background: "#1a1a1a", // Deep charcoal
        surface: "#2d2d2d", // Dark gray
        primary: "#00d4ff", // Electric blue
        secondary: "#39ff14", // Neon green
        text: {
          primary: "#ffffff",
          secondary: "#b3b3b3",
        },
        'f1-red': '#FF1801',
      },
      fontFamily: {
        mono: ["Fira Code", "JetBrains Mono", "monospace"],
        sans: ["Inter", "sans-serif"],
      },
      boxShadow: {
        'neon-blue': '0 0 10px #00d4ff, 0 0 20px #00d4ff',
        'neon-green': '0 0 10px #39ff14, 0 0 20px #39ff14',
      },
    },
  },
  plugins: [],
};
