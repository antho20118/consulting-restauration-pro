import { defineConfig, devices } from "@playwright/test";

// Chromium est pré-installé dans cet environnement à un chemin fixe (voir la documentation de
// session) : on le pointe explicitement plutôt que de laisser Playwright tenter de télécharger sa
// propre version, ce qui échouerait sans accès réseau à son CDN de distribution.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:5173",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { executablePath: "/opt/pw-browsers/chromium" },
      },
    },
  ],
});
