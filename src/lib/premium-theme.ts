export type PremiumThemeMode = "light" | "dark";

export const PREMIUM_THEME_STORAGE_KEY = "anchr.theme";

export function getInitialPremiumTheme(): PremiumThemeMode {
  return "dark";
}

export function applyPremiumTheme(theme: PremiumThemeMode) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  window.localStorage.setItem(PREMIUM_THEME_STORAGE_KEY, theme);
}
