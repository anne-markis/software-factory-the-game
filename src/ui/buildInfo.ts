// Build identity for the in-game stamp (issue #45). Values come from
// import.meta.env.VITE_* (see vite.config.ts): CI sets APP_VERSION /
// APP_BUILT_AT to the CalVer release tag and UTC build instant; local/dev
// falls back to package.json + "-dev" and "now". Repo URL is a constant so
// the stamp always links to source. No DOM here -- render.ts turns this into
// markup.

export interface BuildInfo {
  version: string;
  builtAt: string;
  repoUrl: string;
}

export function getBuildInfo(): BuildInfo {
  return {
    version: import.meta.env.VITE_APP_VERSION,
    builtAt: import.meta.env.VITE_APP_BUILT_AT,
    repoUrl: import.meta.env.VITE_APP_REPO_URL,
  };
}

/** Stable UTC display for the stamp; falls back to the raw string if unparseable. */
export function formatBuiltAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}
