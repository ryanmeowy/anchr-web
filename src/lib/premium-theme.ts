export type PremiumThemeMode = "light" | "dark";

export const PREMIUM_THEME_STORAGE_KEY = "anchr.theme";

export function getInitialPremiumTheme(): PremiumThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }

  const storedTheme = window.localStorage.getItem(PREMIUM_THEME_STORAGE_KEY);
  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyPremiumTheme(theme: PremiumThemeMode) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  window.localStorage.setItem(PREMIUM_THEME_STORAGE_KEY, theme);
}
