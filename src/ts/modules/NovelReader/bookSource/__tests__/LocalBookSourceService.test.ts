import {
  LocalBookSourceService,
  filterSearchSources,
  mergeBookSourceSearchResults,
} from '../LocalBookSourceService';
import {BookSourceSearchResult, LegadoBookSource} from '../types';
import {
  __resetUserBookSourceStorageForTests,
  buildExportBookSourceJson,
  importUserBookSourcesFromJson,
  parseBookSourceJson,
  saveUserBookSourceRecords,
} from '../userBookSourceStorage';

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
  beforeEach(async () => {
    __resetUserBookSourceStorageForTests();
    await saveUserBookSourceRecords([]);
  });

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

  it('导入书源 JSON 时支持数组、跳过无效项，并用后出现的同 URL 书源覆盖', () => {
    const result = parseBookSourceJson(
      JSON.stringify([
        makeSource('https://a.example', '源 A'),
        {bookSourceName: '', bookSourceUrl: 'https://invalid.example'},
        makeSource('https://a.example', '源 A 更新'),
        makeSource('https://b.example', '源 B'),
      ]),
    );

    expect(result.sources).toHaveLength(2);
    expect(result.sources[0].bookSourceName).toBe('源 A 更新');
    expect(result.invalidCount).toBe(1);
    expect(result.duplicateCount).toBe(1);
  });

  it('用户导入书源会持久化并参与有效书源列表', async () => {
    const result = await importUserBookSourcesFromJson(
      JSON.stringify(makeSource('https://user.example', '用户源')),
    );

    expect(result.importedCount).toBe(1);
    expect(result.updatedCount).toBe(0);

    const sources = await LocalBookSourceService.getSources();
    expect(
      sources.some(source => source.bookSourceUrl === 'https://user.example'),
    ).toBe(true);
  });

  it('导出书源 JSON 不包含导入记录元信息', () => {
    const source = makeSource('https://export.example', '导出源');
    const exported = JSON.parse(buildExportBookSourceJson(source));

    expect(exported.bookSourceName).toBe('导出源');
    expect(exported.importedAt).toBeUndefined();
  });
});
