import {
  filterSearchSources,
  mergeBookSourceSearchResults,
} from '../LocalBookSourceService';
import {BookSourceSearchResult, LegadoBookSource} from '../types';

const makeBook = (
  sourceId: string,
  originName: string,
  name: string,
  author: string,
): BookSourceSearchResult => ({
  name,
  author,
  bookUrl: `${sourceId}/book/${name}/${author}`,
  origin: sourceId,
  originName,
  sourceId,
});

const makeSource = (
  bookSourceUrl: string,
  bookSourceName: string,
): LegadoBookSource => ({
  bookSourceUrl,
  bookSourceName,
});

describe('本地书源搜索聚合', () => {
  it('按规范化后的书名和作者严格合并多个书源结果', () => {
    const groups = mergeBookSourceSearchResults([
      makeBook('https://a.example', '源 A', '我的模拟长生路', '愤怒的乌贼'),
      makeBook('https://b.example', '源 B', ' 我的 模拟长生路 ', '愤怒的乌贼'),
      makeBook('https://c.example', '源 C', '我的模拟长生路', '另一个作者'),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].sourceCount).toBe(2);
    expect(groups[0].sourceNames).toEqual(['源 A', '源 B']);
    expect(groups[0].primary.originName).toBe('源 A');
    expect(groups[1].sourceCount).toBe(1);
  });

  it('未知作者不跨源合并，避免同名误合并', () => {
    const groups = mergeBookSourceSearchResults([
      makeBook('https://a.example', '源 A', '同名小说', '未知作者'),
      makeBook('https://b.example', '源 B', '同名小说', '未知作者'),
      makeBook('https://c.example', '源 C', '同名小说', ''),
    ]);

    expect(groups).toHaveLength(3);
    expect(groups.map(item => item.sourceCount)).toEqual([1, 1, 1]);
  });

  it('空选择搜索全部书源，非空选择只搜索指定书源', () => {
    const sources = [
      makeSource('https://a.example', '源 A'),
      makeSource('https://b.example', '源 B'),
      makeSource('https://c.example', '源 C'),
    ];

    expect(
      filterSearchSources(sources).map(item => item.bookSourceName),
    ).toEqual(['源 A', '源 B', '源 C']);
    expect(
      filterSearchSources(sources, ['https://b.example']).map(
        item => item.bookSourceName,
      ),
    ).toEqual(['源 B']);
  });
});
