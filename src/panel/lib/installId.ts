// A stable per-installation identifier for this browser/profile. The extension
// has no per-machine identity of its own, so we mint a UUID on first run and
// keep it in chrome.storage.local — this is the "computer seat" key registered
// under accounts/{email}/computers/{installId}. Mirrors the phone app's
// deviceId concept. Note: it identifies a Chrome profile/install, not physical
// hardware — clearing storage or reinstalling mints a new one.

export function getOrCreateInstallId(): Promise<string> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['installId'], (r) => {
      const existing = r.installId as string | undefined;
      if (existing) return resolve(existing);
      const id = crypto.randomUUID();
      chrome.storage.local.set({ installId: id }, () => resolve(id));
    });
  });
}

// Human-friendly default name derived from the user agent (e.g. "Chrome on
// Windows"). Users can rename their devices later in "My Devices".
export function defaultComputerName(): string {
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Macintosh|Mac OS/.test(ua)
      ? 'macOS'
      : /CrOS/.test(ua)
        ? 'ChromeOS'
        : /Linux/.test(ua)
          ? 'Linux'
          : 'Unknown OS';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : 'Browser';
  return `${browser} on ${os}`;
}
