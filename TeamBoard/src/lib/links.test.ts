import { describe, expect, it } from 'vitest';
import { hostOf, parseLink } from './links';

describe('parseLink', () => {
  it('accepts Canva and other https links', () => {
    expect(parseLink(' https://www.canva.com/design/DAF123/abc/edit ')).toEqual({ url: 'https://www.canva.com/design/DAF123/abc/edit' });
    expect(parseLink('canva.com/design/x/view')).toEqual({ url: 'https://canva.com/design/x/view' });
  });
  it('rejects empty, unsafe and malformed input', () => {
    expect('error' in parseLink('')).toBe(true);
    expect('error' in parseLink('javascript:alert(1)')).toBe(true);
    expect('error' in parseLink('ftp://x.com/file')).toBe(true);
    expect('error' in parseLink('hello')).toBe(true);
  });
  it('shows a tidy host', () => expect(hostOf('https://www.canva.com/design/x')).toBe('canva.com'));
});
