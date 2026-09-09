#!/usr/bin/env node
import { chromium } from 'playwright-core';

const url = process.argv[2];
if (!url) {
  console.error('Usage: extract_wechat_article.mjs <url>');
  process.exit(1);
}

const executablePath = process.env.WECHAT_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const pageExtractor = () => {
  const q = s => document.querySelector(s);
  const text = s => q(s)?.textContent?.trim() || '';
  const html = q('#js_content')?.innerHTML || '';
  return {
    url: location.href,
    title: text('#activity-name') || text('#js_name') || document.title,
    account: text('#js_name'),
    author: text('#js_author_name') || text('#js_author'),
    publish_time: text('#publish_time'),
    description: document.querySelector('meta[name="description"]')?.content || '',
    cover: document.querySelector('meta[property="og:image"]')?.content || '',
    html
  };
};

const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: ['--disable-blink-features=AutomationControlled']
});

try {
  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 2000 },
    locale: 'zh-CN'
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(4000);
  // trigger lazy images
  await page.evaluate(async () => {
    for (let i = 0; i < 10; i++) {
      window.scrollBy(0, window.innerHeight);
      await new Promise(r => setTimeout(r, 300));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1000);

  const data = await page.evaluate(pageExtractor);
  if (!data.html || !data.html.trim()) {
    throw new Error('Failed to extract #js_content from rendered page');
  }
  process.stdout.write(JSON.stringify(data, null, 2));
} finally {
  await browser.close();
}
