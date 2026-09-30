import TelegramBot from 'node-telegram-bot-api';
import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import fs from 'fs';

// ==========================================
// CONFIG
// ==========================================

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

const DB_FILE = './db.json';

// فقط PlayStation Blog
const RSS_URL = 'https://blog.playstation.com/feed/';

// تعداد خبرهایی که در هر اجرا بررسی می‌شوند
const MAX_POSTS = 5;

// فاصله بین ارسال پیام‌ها
const SEND_DELAY = 2000;

// ==========================================
// CHECK CONFIG
// ==========================================

if (!TELEGRAM_BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN is not set.');
}

if (!CHANNEL_ID) {
    throw new Error('TELEGRAM_CHANNEL_ID is not set.');
}

// ==========================================
// INSTANCES
// ==========================================

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

const parser = new Parser({
    timeout: 30000,
    headers: {
        'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36'
    }
});

// ==========================================
// HELPERS
// ==========================================

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function loadDatabase() {
    if (!fs.existsSync(DB_FILE)) {
        return [];
    }

    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.error('خطا در خواندن db.json:', error.message);
        return [];
    }
}

function saveDatabase(sentItems) {
    fs.writeFileSync(
        DB_FILE,
        JSON.stringify(sentItems.slice(-500), null, 2),
        'utf8'
    );
}

function cleanText(text) {
    return text
        .replace(/\u00a0/g, ' ')
        .replace(/\r/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function absoluteUrl(url, baseUrl) {
    if (!url) {
        return '';
    }

    try {
        return new URL(url, baseUrl).href;
    } catch {
        return '';
    }
}

// ==========================================
// GET FEATURED IMAGE
// ==========================================

function getFeaturedImage($, articleUrl) {
    // 1. Open Graph
    const ogImage = $('meta[property="og:image"]').attr('content');

    if (ogImage) {
        return absoluteUrl(ogImage, articleUrl);
    }

    // 2. Twitter image
    const twitterImage = $('meta[name="twitter:image"]').attr('content');

    if (twitterImage) {
        return absoluteUrl(twitterImage, articleUrl);
    }

    // 3. JSON-LD
    let jsonLdImage = '';

    $('script[type="application/ld+json"]').each((_, element) => {
        if (jsonLdImage) {
            return;
        }

        try {
            const raw = $(element).contents().text();
            const data = JSON.parse(raw);

            const findImage = obj => {
                if (!obj) {
                    return '';
                }

                if (typeof obj === 'string') {
                    return '';
                }

                if (Array.isArray(obj)) {
                    for (const item of obj) {
                        const result = findImage(item);

                        if (result) {
                            return result;
                        }
                    }
                }

                if (typeof obj === 'object') {
                    if (obj.image) {
                        if (typeof obj.image === 'string') {
                            return obj.image;
                        }

                        if (Array.isArray(obj.image) && obj.image.length) {
                            return obj.image[0];
                        }

                        if (typeof obj.image === 'object') {
                            return obj.image.url || '';
                        }
                    }

                    for (const value of Object.values(obj)) {
                        const result = findImage(value);

                        if (result) {
                            return result;
                        }
                    }
                }

                return '';
            };

            jsonLdImage = findImage(data);
        } catch {
            // JSON-LD ممکن است قابل parse نباشد
        }
    });

    if (jsonLdImage) {
        return absoluteUrl(jsonLdImage, articleUrl);
    }

    // 4. اولین عکس مناسب داخل مقاله
    const firstImage = $('article img').first().attr('src');

    if (firstImage) {
        return absoluteUrl(firstImage, articleUrl);
    }

    return '';
}

// ==========================================
// GET ARTICLE ROOT
// ==========================================

function getArticleRoot($) {
    // اول article اصلی
    let article = $('main article').first();

    if (article.length) {
        return article;
    }

    article = $('article').first();

    if (article.length) {
        return article;
    }

    // fallback
    return $('main').first();
}

// ==========================================
// REMOVE UNWANTED CONTENT
// ==========================================

function cleanArticleDom($, article) {
    article.find(`
        script,
        style,
        noscript,
        iframe,
        svg,
        nav,
        aside,
        footer,
        form,
        button,
        .comments,
        .comment,
        .comments-area,
        .comment-list,
        .related-posts,
        .related-content,
        .share,
        .sharing,
        .social-share,
        .social,
        .newsletter,
        .advertisement,
        .advert,
        .ads,
        .sidebar
    `).remove();

    // عنوان اصلی را حذف می‌کنیم
    article.find('h1').remove();

    // اطلاعات اضافی مربوط به مقاله
    article.find('.entry-meta').remove();
    article.find('.post-meta').remove();
    article.find('.article-meta').remove();
    article.find('.author-meta').remove();

    // بخش‌های انتهایی سایت
    article.find('a[href*="/category/"]').remove();

    // لینک‌های خالی
    article.find('a').each((_, element) => {
        const text = cleanText($(element).text());

        if (!text) {
            $(element).remove();
        }
    });

    return article;
}

// ==========================================
// EXTRACT ARTICLE TEXT
// ==========================================

function extractArticleText($, article) {
    const blocks = [];

    article
        .find('h2, h3, h4, h5, p, li, blockquote')
        .each((_, element) => {

            const tag = element.tagName.toLowerCase();

            let text = cleanText($(element).text());

            if (!text) {
                return;
            }

            // حذف متن‌های خیلی کوتاه و غیرمقاله‌ای
            if (
                text.length < 2 &&
                !['h2', 'h3', 'h4', 'h5'].includes(tag)
            ) {
                return;
            }

            if (tag.startsWith('h')) {
                text = `\n${text}\n`;
            }

            if (tag === 'li') {
                text = `• ${text}`;
            }

            if (tag === 'blockquote') {
                text = `“${text}”`;
            }

            blocks.push(text);
        });

    return cleanText(blocks.join('\n\n'));
}

// ==========================================
// EXTRACT ARTICLE DATA
// ==========================================

async function fetchArticle(url) {
    console.log(`در حال دریافت مقاله: ${url}`);

    const response = await fetch(url, {
        headers: {
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36',
            'Accept':
                'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9'
        }
    });

    if (!response.ok) {
        throw new Error(
            `HTTP ${response.status} while fetching article`
        );
    }

    const html = await response.text();

    const $ = cheerio.load(html);

    // ======================================
    // TITLE
    // ======================================

    const title =
        cleanText($('h1').first().text()) ||
        cleanText($('meta[property="og:title"]').attr('content')) ||
        'Untitled';

    // ======================================
    // DESCRIPTION
    // ======================================

    const description =
        cleanText(
            $('meta[property="og:description"]').attr('content')
        ) ||
        cleanText(
            $('meta[name="description"]').attr('content')
        ) ||
        cleanText($('article p').first().text());

    // ======================================
    // AUTHOR
    // ======================================

    let author =
        cleanText(
            $('meta[name="author"]').attr('content')
        );

    if (!author) {
        author = cleanText(
            $('[rel="author"]').first().text()
        );
    }

    if (!author) {
        author = cleanText(
            $('.author').first().text()
        );
    }

    // ======================================
    // DATE
    // ======================================

    let publishedAt =
        $('meta[property="article:published_time"]').attr('content');

    if (!publishedAt) {
        publishedAt =
            $('time[datetime]').first().attr('datetime');
    }

    if (!publishedAt) {
        publishedAt =
            $('time').first().text();
    }

    // ======================================
    // FEATURED IMAGE
    // ======================================

    const image = getFeaturedImage($, url);

    // ======================================
    // ARTICLE BODY
    // ======================================

    const article = getArticleRoot($);

    if (!article || !article.length) {
        throw new Error('Article container not found.');
    }

    cleanArticleDom($, article);

    const content = extractArticleText($, article);

    if (!content) {
        throw new Error('Article content is empty.');
    }

    return {
        title,
        description,
        author,
        publishedAt,
        image,
        content,
        url
    };
}

// ==========================================
// TELEGRAM MESSAGE SPLITTER
// ==========================================

function splitMessage(text, maxLength = 3900) {
    const messages = [];

    let remaining = text.trim();

    while (remaining.length > maxLength) {
        let splitAt = remaining.lastIndexOf('\n\n', maxLength);

        if (splitAt < 1000) {
            splitAt = remaining.lastIndexOf('\n', maxLength);
        }

        if (splitAt < 1000) {
            splitAt = remaining.lastIndexOf(' ', maxLength);
        }

        if (splitAt < 1000) {
            splitAt = maxLength;
        }

        messages.push(
            remaining.slice(0, splitAt).trim()
        );

        remaining = remaining.slice(splitAt).trim();
    }

    if (remaining) {
        messages.push(remaining);
    }

    return messages;
}

// ==========================================
// TELEGRAM HEADER
// ==========================================

function createHeader(article) {
    let header = `<b>${escapeHtml(article.title)}</b>\n\n`;

    if (article.description) {
        header += `${escapeHtml(article.description)}\n\n`;
    }

    if (article.author) {
        header += `✍️ ${escapeHtml(article.author)}\n`;
    }

    if (article.publishedAt) {
        header += `📅 ${escapeHtml(String(article.publishedAt))}\n`;
    }

    header += `\n🔗 <a href="${escapeHtml(article.url)}">مشاهده خبر در PlayStation Blog</a>`;

    return header;
}

// ==========================================
// HTML ESCAPE
// ==========================================

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ==========================================
// SEND ARTICLE
// ==========================================

async function sendArticle(article) {

    const header = createHeader(article);

    // --------------------------------------
    // 1. عکس + عنوان
    // --------------------------------------

    if (article.image) {
        try {
            await bot.sendPhoto(
                CHANNEL_ID,
                article.image,
                {
                    caption: header,
                    parse_mode: 'HTML'
                }
            );
        } catch (error) {
            console.error(
                'ارسال عکس ناموفق بود:',
                error.message
            );

            // اگر عکس مشکل داشت، حداقل header ارسال شود
            await bot.sendMessage(
                CHANNEL_ID,
                header,
                {
                    parse_mode: 'HTML',
                    disable_web_page_preview: false
                }
            );
        }
    } else {
        await bot.sendMessage(
            CHANNEL_ID,
            header,
            {
                parse_mode: 'HTML',
                disable_web_page_preview: false
            }
        );
    }

    await delay(SEND_DELAY);

    // --------------------------------------
    // 2. متن کامل مقاله
    // --------------------------------------

    const messages = splitMessage(article.content);

    console.log(
        `تعداد بخش‌های مقاله: ${messages.length}`
    );

    for (const message of messages) {
        await bot.sendMessage(
            CHANNEL_ID,
            message,
            {
                disable_web_page_preview: true
            }
        );

        await delay(SEND_DELAY);
    }
}

// ==========================================
// MAIN
// ==========================================

async function run() {

    console.log('======================================');
    console.log('PlayStation Blog News Bot');
    console.log('======================================');

    const sentItems = loadDatabase();

    console.log(
        `تعداد اخبار ثبت شده: ${sentItems.length}`
    );

    try {

        // ----------------------------------
        // دریافت RSS
        // ----------------------------------

        console.log('در حال دریافت RSS...');

        const feed = await parser.parseURL(RSS_URL);

        console.log(
            `تعداد اخبار RSS: ${feed.items.length}`
        );

        // ----------------------------------
        // آخرین اخبار
        // ----------------------------------

        const posts = feed.items.slice(0, MAX_POSTS);

        for (const item of posts) {

            const guid =
                item.guid ||
                item.id ||
                item.link;

            const articleUrl = item.link;

            if (!guid || !articleUrl) {
                continue;
            }

            // قبلاً ارسال شده
            if (sentItems.includes(guid)) {
                console.log(
                    `قبلاً ارسال شده: ${item.title}`
                );

                continue;
            }

            console.log('');
            console.log('--------------------------------------');
            console.log(`خبر جدید: ${item.title}`);
            console.log(`URL: ${articleUrl}`);
            console.log('--------------------------------------');

            try {

                // دریافت صفحه کامل خبر
                const article =
                    await fetchArticle(articleUrl);

                console.log(
                    `عنوان: ${article.title}`
                );

                console.log(
                    `حجم متن: ${article.content.length} کاراکتر`
                );

                // ارسال کامل به تلگرام
                await sendArticle(article);

                // ثبت در دیتابیس
                sentItems.push(guid);

                saveDatabase(sentItems);

                console.log(
                    `✓ ارسال شد: ${article.title}`
                );

                await delay(SEND_DELAY);

            } catch (error) {

                console.error(
                    `✗ خطا در پردازش خبر "${item.title}":`,
                    error.message
                );
            }
        }

    } catch (error) {

        console.error(
            'خطا در دریافت PlayStation Blog RSS:',
            error.message
        );
    }

    saveDatabase(sentItems);

    console.log('');
    console.log('======================================');
    console.log('پایان اجرای ربات');
    console.log('======================================');
}

// ==========================================
// RUN
// ==========================================

run().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
