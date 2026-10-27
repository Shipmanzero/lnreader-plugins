import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { load as loadCheerio } from 'cheerio';
import { defaultCover } from '@libs/defaultCover';

/**
 * 第一版主网移动版 — LNReader source plugin
 * Site: https://m.03banzhu.com
 *
 * Selectors are based on user-provided directory and chapter HTML.
 * Search uses the site's observed POST form fields (objectType=2, wd=keyword).
 */
class DiYiBanZhuPlugin implements Plugin.PluginBase {
  id = 'diyibanzhuMobile';
  name = '第一版主网（移动版）';
  icon = '';
  site = 'https://m.03banzhu.com';
  version = '1.0.0';

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    const url = pageNo > 1 ? `${this.site}/rank.html?page=${pageNo}` : `${this.site}/rank.html`;
    try {
      const html = await fetchApi(url).then(res => res.text());
      const $ = loadCheerio(html);
      const novels: Plugin.NovelItem[] = [];
      const seen = new Set<string>();

      $('a[href*="/list/"]').each((_, element) => {
        const href = $(element).attr('href')?.trim();
        const name = $(element).text().replace(/\s+/g, ' ').trim();
        if (!href || !name || !/^\/list\/\d+\.html(?:[?#].*)?$/.test(href)) return;
        const path = href.replace(/[?#].*$/, '');
        if (seen.has(path) || name.includes('章节目录') || name === '全本') return;
        seen.add(path);
        const image = $(element).find('img').attr('src');
        novels.push({ name, path, cover: image ? this.absoluteUrl(image) : defaultCover });
      });
      return novels;
    } catch {
      return [];
    }
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const url = this.absoluteUrl(novelPath);
    const html = await fetchApi(url).then(res => res.text());
    const $ = loadCheerio(html);
    const title = $('h1').first().text().trim() || $('title').first().text().split('_')[0].trim() || '未知小说';
    const coverSrc = $('.detail img').first().attr('src') || $('img[alt]').first().attr('src');
    const chapters: Plugin.ChapterItem[] = [];
    const seen = new Set<string>();

    // The second chapter-list block is the full directory, in reading order.
    const chapterLinks = $('.chapter-list').last().find('a[href]');
    chapterLinks.each((index, element) => {
      const href = $(element).attr('href')?.trim();
      const chapterName = $(element).text().replace(/\s+/g, ' ').trim();
      if (!href || !chapterName) return;
      if (!/^\/view\/\d+(?:_\d+)?\.html(?:[?#].*)?$/.test(href)) return;
      const path = href.replace(/[?#].*$/, '');
      if (seen.has(path)) return;
      seen.add(path);
      const match = chapterName.match(/(\d+(?:\.\d+)?)/);
      chapters.push({
        name: chapterName,
        path,
        releaseTime: '',
        chapterNumber: match ? Number(match[1]) : index + 1,
      });
    });

    // Fallback for sites/layout variants where the directory selector differs.
    if (chapters.length === 0) {
      $('a[href^="/view/"]').each((index, element) => {
        const href = $(element).attr('href')?.trim();
        const chapterName = $(element).text().replace(/\s+/g, ' ').trim();
        if (!href || !chapterName || !/^\/view\/\d+(?:_\d+)?\.html$/.test(href)) return;
        if (!/第?\s*\d+|[0-9]+/.test(chapterName)) return;
        if (seen.has(href)) return;
        seen.add(href);
        const match = chapterName.match(/(\d+(?:\.\d+)?)/);
        chapters.push({ name: chapterName, path: href, releaseTime: '', chapterNumber: match ? Number(match[1]) : index + 1 });
      });
    }

    return {
      path: novelPath,
      name: title,
      cover: coverSrc ? this.absoluteUrl(coverSrc) : defaultCover,
      author: $('.detail .info').text().match(/作者：\s*([^\n\r]+)/)?.[1]?.trim() || '',
      summary: $('.book-intro .bd').text().trim() || $('meta[name="description"]').attr('content') || '',
      chapters,
    };
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const url = this.absoluteUrl(chapterPath);
    const html = await fetchApi(url).then(res => res.text());
    const $ = loadCheerio(html);
    const title = $('h1.page-title').first().text().trim();
    const content = $('#nr1').first();
    if (!content.length) throw new Error(`未找到正文容器 #nr1：${url}`);

    // Remove ads, controls, scripts, and pagination links, while preserving paragraphs and line breaks.
    content.find('script, style, iframe, .chapterPages, .page, .page-control, .slide-ad, a, img').remove();
    content.find('[style*="display:none"], [style*="display: none"]').remove();
    const body = content.html()?.trim();
    if (!body) throw new Error(`正文为空：${url}`);
    return `${title ? `<h1>${this.escapeHtml(title)}</h1>` : ''}${body}`;
  }

  async searchNovels(searchTerm: string, pageNo: number): Promise<Plugin.NovelItem[]> {
    const keyword = searchTerm.trim();
    if (!keyword || pageNo < 1) return [];

    // The source's HTML form submits POST /wap.php?action=search with objectType=2 and wd=<keyword>.
    const body = `objectType=2&wd=${encodeURIComponent(keyword)}${pageNo > 1 ? `&page=${pageNo}` : ''}`;
    const response = await fetchApi(`${this.site}/wap.php?action=search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Referer': `${this.site}/`,
      },
      body,
    });
    const html = await response.text();
    const $ = loadCheerio(html);
    const novels: Plugin.NovelItem[] = [];
    const seen = new Set<string>();

    // Search-result markup may vary; collect only book detail links, not chapter links/categories.
    $('a[href*="/list/"]').each((_, element) => {
      const href = $(element).attr('href')?.trim();
      const name = $(element).text().replace(/\s+/g, ' ').trim();
      if (!href || !name || !/^\/list\/\d+\.html(?:[?#].*)?$/.test(href)) return;
      const path = href.replace(/[?#].*$/, '');
      if (seen.has(path) || name.includes('章节目录') || name === '全本') return;
      seen.add(path);
      const image = $(element).find('img').attr('src');
      const cover = image ? this.absoluteUrl(image) : defaultCover;
      novels.push({ name, path, cover });
    });

    // Avoid returning a fake success when the server rejected the request or returned a prompt page.
    const pageText = $.text();
    if (pageText.includes('关键字不能小于') || pageText.includes('请输入关键字')) return [];
    return novels;
  }

  resolveUrl = (path: string) => this.absoluteUrl(path);

  private absoluteUrl(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;
    return `${this.site}/${path.replace(/^\/+/, '')}`;
  }

  private escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
}

export default new DiYiBanZhuPlugin();
