import { describe, expect, it } from 'vitest';
import { contentTypeFor, deckKind, formatBytes, safeFileName, storagePath, validateDeckFile } from './files';

describe('deck files', () => {
  it('accepts PowerPoint and PDF files within the size limit', () => {
    expect(validateDeckFile({ name: 'Week 4 Customer Slides.pptx', size: 5_000_000 })).toBeNull();
    expect(validateDeckFile({ name: 'old.PPT', size: 1000 })).toBeNull();
    expect(validateDeckFile({ name: 'slides.pdf', size: 1000 })).toBeNull();
  });
  it('rejects other types, empty files and oversized files with a clear message', () => {
    expect(validateDeckFile({ name: 'notes.docx', size: 1000 })).toMatch(/PowerPoint/);
    expect(validateDeckFile({ name: 'virus.exe', size: 1000 })).toBeTruthy();
    expect(validateDeckFile({ name: 'noext', size: 1000 })).toBeTruthy();
    expect(validateDeckFile({ name: 'a.pptx', size: 0 })).toMatch(/empty/);
    expect(validateDeckFile({ name: 'a.pptx', size: 60 * 1024 * 1024 })).toMatch(/limit is 50\.0 MB/);
  });
  it('sets the right content type even when the browser leaves it blank', () => {
    expect(contentTypeFor('x.pptx')).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation');
    expect(contentTypeFor('x.PDF')).toBe('application/pdf');
  });
  it('builds safe storage paths inside the workspace folder', () => {
    expect(safeFileName('../../etc/passwd.pptx')).toBe('passwd.pptx');
    expect(safeFileName('Week 4: "Final" slides?.pptx')).toBe('Week 4_ _Final_ slides_.pptx');
    expect(storagePath('ws-1', 'My Deck.pptx', 'abc')).toBe('ws-1/abc-My Deck.pptx');
    expect(storagePath('ws-1', '.pptx', 'abc').startsWith('ws-1/abc-')).toBe(true);
  });
  it('labels and sizes', () => {
    expect(deckKind('a.pdf')).toBe('PDF');
    expect(deckKind('a.pptx')).toBe('PowerPoint');
    expect(formatBytes(4_400_000)).toBe('4.2 MB');
    expect(formatBytes(20_000)).toBe('20 KB');
  });
});
