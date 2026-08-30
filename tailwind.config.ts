import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: "#080808",
          secondary: "#0D0D0D",
        },
        surface: {
          DEFAULT: "#121212",
          elevated: "#181818",
        },
        border: {
          DEFAULT: "#252525",
          strong: "#333333",
        },
        text: {
          primary: "#F5F5F5",
          secondary: "#A1A1A1",
          muted: "#666666",
        },
        accent: {
          DEFAULT: "#C8FF3D",
          hover: "#D5FF70",
          dark: "#9CCF20",
        },
      },
      fontFamily: {
        tight: ["'Inter Tight'", "sans-serif"],
        sans: ["'Inter'", "sans-serif"],
      },
      fontSize: {
        display: ["72px", { lineHeight: "0.97", letterSpacing: "-0.055em", fontWeight: "700" }],
        "display-md": ["56px", { lineHeight: "0.97", letterSpacing: "-0.055em", fontWeight: "700" }],
        "display-sm": ["42px", { lineHeight: "0.97", letterSpacing: "-0.055em", fontWeight: "700" }],
      },
      borderRadius: {
        DEFAULT: "10px",
        card: "16px",
        video: "16px",
        xl: "20px",
      },
      animation: {
        "pulse-dot": "pulse-dot 1.5s ease-in-out infinite",
        "slide-up": "slide-up 0.35s cubic-bezier(0.22, 1, 0.36, 1) forwards",
        "scale-in": "scale-in 0.3s cubic-bezier(0.22, 1, 0.36, 1) forwards",
        "fade-in": "fade-in 0.35s ease-out forwards",
        grain: "grain 6s steps(1) infinite",
        shimmer: "shimmer 1.5s infinite",
      },
      keyframes: {
        "pulse-dot": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.5", transform: "scale(0.8)" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.8)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        grain: {
          "0%, 100%": { transform: "translate(0, 0)" },
          "10%": { transform: "translate(-1%, -2%)" },
          "20%": { transform: "translate(1%, 1%)" },
          "30%": { transform: "translate(-2%, 2%)" },
          "40%": { transform: "translate(2%, -1%)" },
          "50%": { transform: "translate(-1%, 3%)" },
          "60%": { transform: "translate(3%, -2%)" },
          "70%": { transform: "translate(-2%, 1%)" },
          "80%": { transform: "translate(1%, -3%)" },
          "90%": { transform: "translate(-1%, 2%)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      transitionTimingFunction: {
        premium: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      boxShadow: {
        accent: "0 0 20px rgba(200, 255, 61, 0.15), 0 0 40px rgba(200, 255, 61, 0.05)",
        "accent-sm": "0 0 10px rgba(200, 255, 61, 0.2)",
        card: "0 4px 24px rgba(0, 0, 0, 0.4)",
        video: "0 8px 48px rgba(0, 0, 0, 0.6)",
      },
    },
  },
  plugins: [],
};

export default config;
