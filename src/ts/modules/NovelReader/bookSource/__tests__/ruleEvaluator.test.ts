import {BUILTIN_BOOK_SOURCES} from '../builtinBookSources';
import {
  createRuleContext,
  evaluateList,
  evaluateString,
  normalizeContentText,
} from '../ruleEvaluator';
import {
  applyRegexTail,
  isSameContentPageGroup,
  resolveUrl,
  splitParagraphs,
  splitRegexTail,
  stripUrlHash,
} from '../ruleUtils';

const source = BUILTIN_BOOK_SOURCES[0];

describe('本地书源规则解析', () => {
  it('解析速读谷搜索列表字段', () => {
    const html = `
      <div class="item">
        <a href="167/"></a>
        <div class="itemtxt">
          <h3><a href="167/">我有一枚命运魔骰</a></h3>
          <p><span></span><span>玄幻小说</span></p>
          <p><a>作者：水煮仙人球</a></p>
        </div>
      </div>
    `;
    const context = createRuleContext(html, source.bookSourceUrl);
    const list = evaluateList(source.ruleSearch?.bookList, context);

    expect(list).toHaveLength(1);
    expect(
      evaluateString(
        source.ruleSearch?.name,
        createRuleContext(html, source.bookSourceUrl, list[0]),
      ),
    ).toBe('我有一枚命运魔骰');
    expect(
      evaluateString(
        source.ruleSearch?.author,
        createRuleContext(html, source.bookSourceUrl, list[0]),
      ),
    ).toBe('水煮仙人球');
    expect(
      evaluateString(
        source.ruleSearch?.bookUrl,
        createRuleContext(html, source.bookSourceUrl, list[0]),
        true,
      ),
    ).toBe('https://www.sudugu.org/167/');
  });

  it('相对 URL 兜底解析时不会拼到 query 后面', () => {
    expect(
      resolveUrl('167/', 'https://www.sudugu.org/i/sor.aspx?key=我的'),
    ).toBe('https://www.sudugu.org/i/167/');
    expect(
      resolveUrl('/167/', 'https://www.sudugu.org/i/sor.aspx?key=我的'),
    ).toBe('https://www.sudugu.org/167/');
  });

  it('详情页目录锚点按书源根地址补全，发请求前移除 hash', () => {
    const html = `
      <div class="item">
        <h1><a href="167/#dir">我的模拟长生路</a></h1>
      </div>
    `;
    const tocUrl = evaluateString(
      source.ruleBookInfo?.tocUrl,
      createRuleContext(html, source.bookSourceUrl),
      true,
    );

    expect(tocUrl).toBe('https://www.sudugu.org/167/#dir');
    expect(stripUrlHash(tocUrl)).toBe('https://www.sudugu.org/167/');
  });

  it('章节链接不会重复拼接书籍数字目录', () => {
    expect(resolveUrl('167/16656.html', 'https://www.sudugu.org/167/')).toBe(
      'https://www.sudugu.org/167/16656.html',
    );
    expect(resolveUrl('16656.html', 'https://www.sudugu.org/167/')).toBe(
      'https://www.sudugu.org/167/16656.html',
    );
  });

  it('正文下一页链接首段等于当前书籍目录时按站点根路径补全', () => {
    expect(
      resolveUrl('167/16656-2.html', 'https://www.sudugu.org/167/16656.html'),
    ).toBe('https://www.sudugu.org/167/16656-2.html');
    expect(
      resolveUrl(
        '167/16656.html/167/16656-2.html',
        'https://www.sudugu.org/167/16656.html',
      ),
    ).toBe('https://www.sudugu.org/167/16656-2.html');
  });

  it('正文分页只跟随同一章节，不跨到下一章', () => {
    expect(
      isSameContentPageGroup(
        'https://www.sudugu.org/5693/3315359.html',
        'https://www.sudugu.org/5693/3315359-2.html',
      ),
    ).toBe(true);
    expect(
      isSameContentPageGroup(
        'https://www.sudugu.org/5693/3315359.html',
        'https://www.sudugu.org/5693/3315360.html',
      ),
    ).toBe(false);
  });

  it('解析速读谷目录章节', () => {
    const html = `
      <div id="list">
        <ul>
          <li><a href="/chapter/1.html">第一章 起点</a></li>
          <li><a href="/chapter/2.html">第二章 变化</a></li>
        </ul>
      </div>
      <div id="pages"><a class="gr" href="/book/1/2.html">下一页</a></div>
    `;
    const context = createRuleContext(html, source.bookSourceUrl);
    const list = evaluateList(source.ruleToc?.chapterList, context);

    expect(list).toHaveLength(2);
    expect(
      evaluateString(
        source.ruleToc?.chapterName,
        createRuleContext(html, source.bookSourceUrl, list[0]),
      ),
    ).toBe('第一章 起点');
    expect(evaluateString(source.ruleToc?.nextTocUrl, context, true)).toBe(
      'https://www.sudugu.org/book/1/2.html',
    );
  });

  it('清洗正文 HTML 与 replaceRegex', () => {
    const html = `
      <div class="con">
        <p>首页速读谷菜单</p>
        <p>第一段内容。</p>
        <p>第二段内容。</p>
      </div>
    `;
    const context = createRuleContext(html, source.bookSourceUrl);
    const content = evaluateString(source.ruleContent?.content, context);
    const {regex, replacement} = splitRegexTail(
      source.ruleContent?.replaceRegex || '',
    );
    const text = normalizeContentText(
      applyRegexTail(content, regex, replacement),
    );

    expect(splitParagraphs(text)).toEqual(['第一段内容。', '第二段内容。']);
  });
});
