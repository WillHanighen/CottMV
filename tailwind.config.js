/**
 * Tailwind CSS Configuration
 * ==========================
 * 
 * This file configures Tailwind CSS for the CottMV project.
 * 
 * Key settings:
 * - content: Where to look for class names to include
 * - theme: Customizations to the default theme
 * - plugins: Additional Tailwind plugins
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  // Files to scan for Tailwind class names
  content: [
    "./src/**/*.{ts,tsx,html}",
    "./public/**/*.html",
  ],
  
  // Enable dark mode via class (add "dark" class to html element)
  darkMode: "class",
  
  theme: {
    extend: {
      // Custom colors for the media vault theme
      colors: {
        // Primary purple accent
        primary: {
          50: "#faf5ff",
          100: "#f3e8ff",
          200: "#e9d5ff",
          300: "#d8b4fe",
          400: "#c084fc",
          500: "#a855f7",
          600: "#9333ea",
          700: "#7c3aed",
          800: "#6b21a8",
          900: "#581c87",
        },
      },
      
      // Custom font family
      fontFamily: {
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      
      // Custom spacing
      spacing: {
        "18": "4.5rem",
        "88": "22rem",
        "128": "32rem",
      },
      
      // Custom border radius
      borderRadius: {
        "4xl": "2rem",
      },
      
      // Custom animations
      animation: {
        "spin-slow": "spin 3s linear infinite",
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
      
      // Custom backdrop blur
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  
  plugins: [
    // Add any Tailwind plugins here
    // For example: require('@tailwindcss/forms'),
  ],
};
