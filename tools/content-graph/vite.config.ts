import { fileURLToPath, URL } from "node:url";
import { defineConfig, searchForWorkspaceRoot } from "vite";

const toolRoot = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
  root: toolRoot,
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    fs: {
      // The tool intentionally reuses the engine loader and bundled content
      // outside its Vite root.
      allow: [searchForWorkspaceRoot(repositoryRoot)],
    },
  },
});
