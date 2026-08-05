import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { defineConfig, loadEnv } from "vite";

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };

// CI (release-and-deploy.yml) sets APP_VERSION to the CalVer tag and
// APP_BUILT_AT to the UTC instant of that build. Local/dev keeps a clear
// "-dev" marker so a stamp from `npm run dev` is never confused with a
// deployed release. Exposed as import.meta.env.VITE_* so Vite substitutes
// them in both dev serve and production builds (plain __FOO__ define was
// unreliable under vite serve transforms).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, "");
  const version = env.APP_VERSION || process.env.APP_VERSION || `${pkg.version}-dev`;
  const builtAt = env.APP_BUILT_AT || process.env.APP_BUILT_AT || new Date().toISOString();
  const repoUrl =
    env.APP_REPO_URL || process.env.APP_REPO_URL || "https://github.com/anne-markis/software-factory-the-game";

  return {
    base: "./",
    define: {
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(version),
      "import.meta.env.VITE_APP_BUILT_AT": JSON.stringify(builtAt),
      "import.meta.env.VITE_APP_REPO_URL": JSON.stringify(repoUrl),
    },
  };
});
