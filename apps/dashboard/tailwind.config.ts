import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        muted: "hsl(var(--muted))",
        panel: "hsl(var(--panel))",
        accent: "hsl(var(--accent))",
        danger: "hsl(var(--danger))",
        success: "hsl(var(--success))"
      }
    }
  },
  plugins: []
};

export default config;
