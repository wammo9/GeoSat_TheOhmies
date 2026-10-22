export const DECK_BUCKET = 'slide-decks';
export const MAX_DECK_BYTES = 50 * 1024 * 1024; // matches the bucket limit

const TYPES: Record<string, string> = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  pdf: 'application/pdf',
};

export const extOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');
export const contentTypeFor = (name: string) => TYPES[extOf(name)] ?? 'application/octet-stream';

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Returns a message when the file can't be used as a submitted deck, otherwise null. */
export function validateDeckFile(file: { name: string; size: number }): string | null {
  if (!TYPES[extOf(file.name)]) return 'Choose a PowerPoint (.pptx or .ppt) or PDF file.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_DECK_BYTES) return `That file is ${formatBytes(file.size)}; the limit is ${formatBytes(MAX_DECK_BYTES)}.`;
  return null;
}

/** "PowerPoint" or "PDF", for button labels. */
export const deckKind = (name: string | null | undefined) => (extOf(name ?? '') === 'pdf' ? 'PDF' : 'PowerPoint');

/** Storage-safe file name: no folders, odd characters or huge lengths, extension kept. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'deck';
  const ext = extOf(base);
  const stem = (ext ? base.slice(0, -(ext.length + 1)) : base).replace(/[^A-Za-z0-9._ -]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'deck';
  return ext ? `${stem}.${ext}` : stem;
}

export const storagePath = (workspaceId: string, name: string, id: string) => `${workspaceId}/${id}-${safeFileName(name)}`;
