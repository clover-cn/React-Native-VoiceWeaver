import {
  MAX_ARTICLE_LENGTH,
  normalizeArticleText,
  normalizeArticleUrl,
} from './article';

/** 检查主文档是否已经可读，不等待广告、统计脚本等外围资源全部结束。 */
export function browserReadyScript(id: string): string {
  return `(function(){try {
    if (window.top !== window || !document.body) return;
    var state = document.readyState;
    var text = (document.body.innerText || '').trim();
    var visible = document.body.getBoundingClientRect();
    var image = document.querySelector('img');
    var hasImage = image && image.complete && image.naturalWidth > 0;
    if (visible.width > 0 && visible.height > 0 &&
        ((state === 'interactive' && text.length >= 80) ||
         (state === 'complete' && (text.length > 0 || hasImage)))) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type:'article_page_ready',id:${JSON.stringify(id)},url:location.href
      }));
    }
  } catch(e) {}
  })(); true;`;
}

/** 读取整个已加载页面的可见文字，不按正文得分删掉后续章节。 */
export function browserArticleScript(id: string): string {
  return `(function(){try {
    var text = document.body ? document.body.innerText : '';
    var tooLong = typeof text === 'string' && text.length > ${MAX_ARTICLE_LENGTH};
    window.ReactNativeWebView.postMessage(JSON.stringify({id:${JSON.stringify(
      id,
    )},url:location.href,title:document.title,
      text:tooLong?'':text,error:tooLong?'页面文字超过 20 万字符，请复制正文分篇导入。':''}));
  } catch(e) { window.ReactNativeWebView.postMessage(JSON.stringify({id:${JSON.stringify(
    id,
  )},error:'页面文字提取失败，请复制正文后粘贴。'})); }
  })(); true;`;
}

export function parseBrowserArticle(data: {
  url: unknown;
  title: unknown;
  text: unknown;
}) {
  if (typeof data.url !== 'string' || typeof data.text !== 'string') {
    throw new Error('网页返回的文字无效。');
  }
  const text = normalizeArticleText(data.text);
  if (!text || text.length > MAX_ARTICLE_LENGTH) {
    throw new Error('页面文字为空或超过 20 万字符，请展开全文或分篇粘贴。');
  }
  return {
    url: normalizeArticleUrl(data.url),
    title:
      typeof data.title === 'string' ? data.title.slice(0, 200) : '未命名文章',
    text,
  };
}
