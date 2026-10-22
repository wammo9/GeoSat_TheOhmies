/** Accepts only http(s) links (never javascript: and friends). Returns the cleaned URL or an error message. */
export function parseLink(input: string): { url: string } | { error: string } {
  let v = input.trim();
  if (!v) return { error: 'Paste a link first.' };
  if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = `https://${v}`; // "canva.com/..." -> https://canva.com/...
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'The link must start with https://' };
    if (!u.hostname.includes('.')) return { error: 'That doesn’t look like a web address.' };
    return { url: u.toString() };
  } catch {
    return { error: 'That doesn’t look like a valid link.' };
  }
}

export const hostOf = (url: string) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
};
