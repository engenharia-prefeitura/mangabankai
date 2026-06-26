const CDN_MAP = {
  "$TEMP": "https://temp.compsci88.com",
  "$HOT": "https://scans-hot.planeptune.us",
  "$LST": "https://scans.lastation.us",
  "$LOW": "https://official.lowee.us",
  "$MFK": "https://images.mangafreak.me"
};

function resolveCdnUrl(url) {
  for (const [ph, domain] of Object.entries(CDN_MAP)) {
    if (url.startsWith(ph)) {
      return url.replace(ph, domain);
    }
  }
  return url;
}
