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
import {resolveRequest} from '../requestClient';

const source = {
  bookSourceUrl: 'https://www.sudugu.org/',
  ruleSearch: {
    bookList: '.item',
    name: '.itemtxt h3 a@text',
    author: '.itemtxt p a@text##^作者：##',
    bookUrl: 'a@href',
  },
  ruleBookInfo: {
    tocUrl: 'h1 a@href',
  },
  ruleToc: {
    chapterList: '#list ul li',
    chapterName: 'a@text',
    chapterUrl: 'a@href',
    nextTocUrl: '#pages a.gr@href',
  },
  ruleContent: {
    content: '.con@html',
    replaceRegex: 'all##首页速读谷菜单##',
  },
};

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
    expect(
      resolveUrl(
        '/api/chapter?id=5569&chapterid=1',
        'https://apibi.cc/api/booklist?id=5569',
      ),
    ).toBe('https://apibi.cc/api/chapter?id=5569&chapterid=1');
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

  it('解析 JSON API 搜索项里的单花括号 JSONPath 占位', () => {
    const item = {
      id: '5569',
      title: '在你心尖上起舞',
      author: '白芷陈流',
      intro: '简介：傍晚，舞蹈室里。',
    };
    const raw = JSON.stringify({data: [item]});
    const context = createRuleContext(
      raw,
      'https://apibi.cc/api/search?q=我的',
    );
    const list = evaluateList('$.data[*]', context);
    const itemContext = createRuleContext(raw, 'https://apibi.cc', list[0]);

    expect(list).toHaveLength(1);
    expect(evaluateString('$.title', itemContext)).toBe('在你心尖上起舞');
    expect(evaluateString('$.intro##^简介：##', itemContext)).toBe(
      '傍晚，舞蹈室里。',
    );
    expect(evaluateString('/api/book?id={$.id}', itemContext, true)).toBe(
      'https://apibi.cc/api/book?id=5569',
    );
  });

  it('支持 JSON API 书源的脚本变量与章节序号', () => {
    const vars: Record<string, unknown> = {};
    const bookContext = createRuleContext(
      JSON.stringify({id: '5569', dirid: '7788'}),
      'https://apibi.cc/api/book?id=5569',
      undefined,
      vars,
    );
    const tocUrl = evaluateString(
      "$.dirid@js:java.put('bqglDirId',String(result));result='/api/booklist?id='+result",
      bookContext,
      true,
    );
    const chapterContext = createRuleContext(
      JSON.stringify({list: ['第一章 起点']}),
      'https://apibi.cc/api/booklist?id=7788',
      '第一章 起点',
      {...vars, chapter: {index: 0}},
    );

    expect(tocUrl).toBe('https://apibi.cc/api/booklist?id=7788');
    expect(
      evaluateString('<js>result=String(result)</js>', chapterContext),
    ).toBe('第一章 起点');
    expect(
      evaluateString(
        "<js>result='/api/chapter?id='+java.get('bqglDirId')+'&chapterid='+(Number(chapter.index)+1)</js>",
        chapterContext,
        true,
      ),
    ).toBe('https://apibi.cc/api/chapter?id=7788&chapterid=1');
  });

  it('支持目录列表规则用 @js 返回章节对象数组', () => {
    const context = createRuleContext(
      '<div id="content">正文</div>',
      'https://book.qingse.site/article/14420',
    );
    const list = evaluateList(
      '@js:\n[{"title":"全一章", "href":baseUrl}]',
      context,
    );
    const itemContext = createRuleContext(
      context.raw,
      context.baseUrl,
      list[0],
    );

    expect(list).toHaveLength(1);
    expect(evaluateString('title', itemContext)).toBe('全一章');
    expect(evaluateString('href', itemContext, true)).toBe(
      'https://book.qingse.site/article/14420',
    );
  });

  it('支持目录列表规则用 @js 返回 JSON 字符串数组', () => {
    const context = createRuleContext('', 'https://example.com/book/1');
    const list = evaluateList(
      '@js:result=JSON.stringify([{title:"第一章",href:"/chapter/1.html"}])',
      context,
    );
    const itemContext = createRuleContext('', context.baseUrl, list[0]);

    expect(list).toHaveLength(1);
    expect(evaluateString('title', itemContext)).toBe('第一章');
    expect(evaluateString('href', itemContext, true)).toBe(
      'https://example.com/chapter/1.html',
    );
  });

  it('支持 legado Default 规则链、索引和反序列表', () => {
    const html = `
      <section>
        <div class="tags"><span>作者：</span><a class="tag">张三</a></div>
        <ul><li>第一章</li><li>第二章</li><li>第三章</li></ul>
      </section>
    `;
    const context = createRuleContext(html, 'https://example.com');

    expect(evaluateString('.tags@text.作者@a@.tag@text', context)).toBe('张三');
    expect(evaluateString('tag.li.1@text', context)).toBe('第二章');
    expect(
      evaluateList('-tag.li', context).map(item =>
        evaluateString(
          'text',
          createRuleContext(html, 'https://example.com', item),
        ),
      ),
    ).toEqual(['第三章', '第二章', '第一章']);
  });

  it('支持组合规则 &&、||、%%', () => {
    const html = `
      <div><h2>备用标题</h2><p class="a">A1</p><p class="b">B1</p><p class="a">A2</p><p class="b">B2</p></div>
    `;
    const context = createRuleContext(html, 'https://example.com');

    expect(evaluateString('h1@text||h2@text', context)).toBe('备用标题');
    expect(evaluateString('.a@text&&.b@text', context)).toBe(
      ['A1', 'A2', 'B1', 'B2'].join('\n'),
    );
    expect(
      evaluateList('.a%%.b', context).map(item =>
        evaluateString(
          'text',
          createRuleContext(html, 'https://example.com', item),
        ),
      ),
    ).toEqual(['A1', 'B1', 'A2', 'B2']);
  });

  it('支持 jsoup CSS :eq(n) 与任意属性提取', () => {
    const html = `
      <div>
        <article class="item fiction">双 class 项</article>
        <p><a data-id="a">第一</a></p>
        <p><a data-id="b">第二</a></p>
        <p><a data-id="c">第三</a></p>
      </div>
    `;
    const context = createRuleContext(html, 'https://example.com');

    expect(evaluateList('.item.fiction', context)).toHaveLength(1);
    expect(evaluateString('@css:p:eq(2)>a@text', context)).toBe('第三');
    expect(evaluateString('@css:p:eq(1)>a@data-id', context)).toBe('b');
  });

  it('支持 XPath 列表节点上下文里的文本和属性', () => {
    const html = `
      <div id="sitebox">
        <dl><dt><a href="/book/1">书一</a></dt><dd><span>作者一</span></dd></dl>
        <dl><dt><a href="/book/2">书二</a></dt><dd><span>作者二</span></dd></dl>
      </div>
    `;
    const context = createRuleContext(html, 'https://example.com');
    const list = evaluateList('//*[@id="sitebox"]/dl', context);

    expect(list).toHaveLength(2);
    expect(
      evaluateString(
        '//dt/a/text()',
        createRuleContext(html, 'https://example.com', list[1]),
      ),
    ).toBe('书二');
    expect(
      evaluateString(
        '//dt/a/@href',
        createRuleContext(html, 'https://example.com', list[1]),
        true,
      ),
    ).toBe('https://example.com/book/2');
  });

  it('支持递归 JSONPath 和章节列表中的 $.items.[*] 写法', () => {
    const raw = JSON.stringify({
      result: {books: [{title: '甲'}, {title: '乙'}]},
      chapterInfo: {chapters: [{title: '第一章'}]},
    });
    const context = createRuleContext(raw, 'https://api.example.com/search');

    expect(evaluateList('$..books[*]', context)).toHaveLength(2);
    expect(
      evaluateString(
        '$.title',
        createRuleContext(
          raw,
          context.baseUrl,
          evaluateList('$..books[*]', context)[1],
        ),
      ),
    ).toBe('乙');
    expect(evaluateList('$.chapterInfo.chapters.[*]', context)).toHaveLength(1);
  });

  it('支持正则捕获组拼接 URL 请求选项', () => {
    const raw = '<a href="/chapter/1.html">第一章</a>';
    const context = createRuleContext(raw, 'https://example.com/book/');
    const item = evaluateList(':href="([^"]+)">([^<]*)', context)[0];

    expect(
      evaluateString(
        '$1,{"webView":true}',
        createRuleContext(raw, 'https://example.com/book/', item),
        true,
      ),
    ).toBe('https://example.com/chapter/1.html,{"webView":true}');
  });

  it('支持非 JS 规则里的 @put 与 @get', () => {
    const vars: Record<string, unknown> = {};
    const html = '<div bid-data="7788"></div>';
    const context = createRuleContext(
      html,
      'https://example.com',
      undefined,
      vars,
    );

    expect(
      evaluateString('@put:{bid:"//*[@bid-data]/@bid-data"}', context),
    ).toBe('');
    expect(evaluateString('@get:bid', context)).toBe('7788');
  });

  it('解析搜索 URL 的 POST、charset、headers 配置', () => {
    const request = resolveRequest(
      {
        bookSourceName: '测试源',
        bookSourceUrl: 'https://example.com',
        header: '{"Referer":"{{baseUrl}}"}',
      },
      '/search,{"charset":"gbk","method":"POST","body":"page={{page}}&key={{key}}","headers":{"X-Test":"1"}}',
      {key: '凡人', page: 2},
    );

    expect(request.url).toBe('https://example.com/search');
    expect(request.method).toBe('POST');
    expect(request.charset).toBe('gbk');
    expect(request.body).toBe('page=2&key=凡人');
    expect(request.headers.Referer).toBe('https://example.com');
    expect(request.headers['X-Test']).toBe('1');
  });

  it('请求 URL 中的中文关键词会在最终请求前编码', () => {
    const request = resolveRequest(
      {
        bookSourceName: '小说网',
        bookSourceUrl: 'https://crxs.me',
      },
      'https://crxs.me/fictions/keyword-{{key}}/sort-read/{{page}}.html',
      {key: '我的', page: 1},
    );

    expect(request.url).toBe(
      'https://crxs.me/fictions/keyword-%E6%88%91%E7%9A%84/sort-read/1.html',
    );
  });

  it('支持搜索 URL 中的可选模板片段', () => {
    const request = resolveRequest(
      {
        bookSourceName: '测试源',
        bookSourceUrl: 'https://example.com',
      },
      '/rank/<,{{page}}>.html',
      {page: 3},
    );

    expect(request.url).toBe('https://example.com/rank/,3.html');
  });
});
