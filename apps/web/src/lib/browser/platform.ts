// Apple keyboards name shortcuts with Command and Option, and Command+H hides
// the browser, so some shortcuts differ there.
export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/.test(navigator.platform);
}
