import {
  buildListenProjectName,
  createTextHash,
  sanitizeListenProjectPart,
} from '../listenBook';

describe('listenBook utils', () => {
  it('creates sha256 hash compatible with backend', () => {
    expect(createTextHash('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('builds reader project name with sanitized book and author', () => {
    expect(
      buildListenProjectName({
        name: '我的:小说',
        author: '作者/名字',
        bookUrl: 'https://example.com/book',
      }),
    ).toBe('reader_我的小说__作者名字');
  });

  it('normalizes invalid project path characters', () => {
    expect(sanitizeListenProjectPart(' a\\b/c:*?"<>|  ')).toBe('abc');
  });
});
