import TelegramBot from 'node-telegram-bot-api';
import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import fs from 'fs';

// ==========================================
// CONFIG
// ==========================================

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

const RSS_URL = 'https://blog.playstation.com/feed/';

const DB_FILE = './db.json';

const MAX_POSTS = 5;

const SEND_DELAY = 2000;

// ==========================================
// CHECK CONFIG
// ==========================================

if (!process.env.TELEGRAM_BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN is missing');
}

if (!CHANNEL_ID) {
    throw new Error('TELEGRAM_CHANNEL_ID is missing');
}

// ==========================================
// RSS PARSER
// ==========================================

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

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function loadDatabase() {
    if (!fs.existsSync(DB_FILE)) {
        return [];
    }

    try {
        const data = JSON.parse(
            fs.readFileSync(DB_FILE, 'utf8')
        );

        return Array.isArray(data) ? data : [];

    } catch {
        return [];
    }
}

function saveDatabase(items) {
    fs.writeFileSync(
        DB_FILE,
        JSON.stringify(items.slice(-500), null, 2),
        'utf8'
    );
}

function cleanText(text) {
    return String(text || '')
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

function escapeHtml(text) {

    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ==========================================
// IMAGE URL
// ==========================================

function getImageUrl($, articleUrl) {

    // --------------------------------------
    // 1. og:image
    // --------------------------------------

    let image =
        $('meta[property="og:image"]')
            .attr('content');

    if (image) {
        return absoluteUrl(image, articleUrl);
    }

    // --------------------------------------
    // 2. twitter:image
    // --------------------------------------

    image =
        $('meta[name="twitter:image"]')
            .attr('content');

    if (image) {
        return absoluteUrl(image, articleUrl);
    }

    // --------------------------------------
    // 3. JSON-LD
    // --------------------------------------

    let jsonImage = '';

    $('script[type="application/ld+json"]').each(
        (_, element) => {

            if (jsonImage) {
                return;
            }

            try {

                const raw = $(element)
                    .contents()
                    .text();

                const data = JSON.parse(raw);

                const findImage = object => {

                    if (!object) {
                        return '';
                    }

                    if (typeof object === 'string') {
                        return '';
                    }

                    if (Array.isArray(object)) {

                        for (const item of object) {

                            const result =
                                findImage(item);

                            if (result) {
                                return result;
                            }
                        }

                        return '';
                    }

                    if (typeof object === 'object') {

                        if (object.image) {

                            if (
                                typeof object.image ===
                                'string'
                            ) {
                                return object.image;
                            }

                            if (
                                Array.isArray(object.image)
                                &&
                                object.image.length
                            ) {
                                return object.image[0];
                            }

                            if (
                                typeof object.image ===
                                'object'
                            ) {
                                return object.image.url || '';
                            }
                        }

                        for (
                            const value
                            of Object.values(object)
                        ) {

                            const result =
                                findImage(value);

                            if (result) {
                                return result;
                            }
                        }
                    }

                    return '';
                };

                jsonImage = findImage(data);

            } catch {
                // ignore
            }
        }
    );

    if (jsonImage) {
        return absoluteUrl(
            jsonImage,
            articleUrl
        );
    }

    // --------------------------------------
    // 4. اولین عکس مقاله
    // --------------------------------------

    const articleImage =
        $('article img')
            .first()
            .attr('src');

    if (articleImage) {
        return absoluteUrl(
            articleImage,
            articleUrl
        );
    }

    // --------------------------------------
    // 5. عکس‌های main
    // --------------------------------------

    const mainImage =
        $('main img')
            .first()
            .attr('src');

    if (mainImage) {
        return absoluteUrl(
            mainImage,
            articleUrl
        );
    }

    return '';
}

// ==========================================
// DOWNLOAD IMAGE
// ==========================================

async function downloadImage(imageUrl) {

    if (!imageUrl) {
        return null;
    }

    console.log(`در حال دانلود عکس: ${imageUrl}`);

    try {

        const response = await fetch(
            imageUrl,
            {
                headers: {
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36',
                    'Accept':
                        'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                    'Referer':
                        'https://blog.playstation.com/'
                }
            }
        );

        if (!response.ok) {

            console.error(
                `خطای دریافت عکس: HTTP ${response.status}`
            );

            return null;
        }

        const contentType =
            response.headers.get('content-type') || '';

        if (!contentType.startsWith('image/')) {

            console.error(
                `URL عکس، تصویر برنگرداند: ${contentType}`
            );

            return null;
        }

        const arrayBuffer =
            await response.arrayBuffer();

        return Buffer.from(arrayBuffer);

    } catch (error) {

        console.error(
            'خطا در دانلود عکس:',
            error.message
        );

        return null;
    }
}

// ==========================================
// FIND ARTICLE
// ==========================================

function getArticle($) {

    let article =
        $('main article').first();

    if (article.length) {
        return article;
    }

    article =
        $('article').first();

    if (article.length) {
        return article;
    }

    return $('main').first();
}

// ==========================================
// CLEAN ARTICLE
// ==========================================

function cleanArticle($, article) {

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

    article.find('h1').remove();

    article.find('.entry-meta').remove();
    article.find('.post-meta').remove();
    article.find('.article-meta').remove();
    article.find('.author-meta').remove();

    return article;
}

// ==========================================
// ARTICLE TEXT
// ==========================================

function extractArticleText($, article) {

    const blocks = [];

    article
        .find('h2, h3, h4, h5, p, li, blockquote')
        .each((_, element) => {

            const tag =
                element.tagName.toLowerCase();

            let text =
                cleanText($(element).text());

            if (!text) {
                return;
            }

            if (
                tag === 'li'
            ) {
                text = `• ${text}`;
            }

            if (
                tag === 'blockquote'
            ) {
                text = `“${text}”`;
            }

            blocks.push(text);
        });

    return cleanText(
        blocks.join('\n\n')
    );
}

// ==========================================
// FETCH ARTICLE
// ==========================================

async function fetchArticle(url) {

    console.log('');
    console.log(
        `دریافت مقاله: ${url}`
    );

    const response = await fetch(
        url,
        {
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36',
                'Accept':
                    'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language':
                    'en-US,en;q=0.9'
            }
        }
    );

    if (!response.ok) {

        throw new Error(
            `HTTP ${response.status}`
        );
    }

    const html =
        await response.text();

    const $ =
        cheerio.load(html);

    // ======================================
    // TITLE
    // ======================================

    const title =
        cleanText(
            $('h1').first().text()
        ) ||
        cleanText(
            $('meta[property="og:title"]')
                .attr('content')
        ) ||
        'PlayStation News';

    // ======================================
    // DESCRIPTION
    // ======================================

    const description =
        cleanText(
            $('meta[property="og:description"]')
                .attr('content')
        ) ||
        cleanText(
            $('meta[name="description"]')
                .attr('content')
        );

    // ======================================
    // AUTHOR
    // ======================================

    const author =
        cleanText(
            $('meta[name="author"]')
                .attr('content')
        ) ||
        cleanText(
            $('[rel="author"]')
                .first()
                .text()
        );

    // ======================================
    // DATE
    // ======================================

    const publishedAt =
        $('meta[property="article:published_time"]')
            .attr('content') ||
        $('time[datetime]')
            .first()
            .attr('datetime') ||
        '';

    // ======================================
    // IMAGE
    // ======================================

    const image =
        getImageUrl($, url);

    console.log(
        `عکس: ${image || 'پیدا نشد'}`
    );

    // ======================================
    // CONTENT
    // ======================================

    const article =
        getArticle($);

    if (!article.length) {

        throw new Error(
            'Article container not found'
        );
    }

    cleanArticle(
        $,
        article
    );

    const content =
        extractArticleText(
            $,
            article
        );

    if (!content) {

        throw new Error(
            'Article content is empty'
        );
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
// SPLIT TELEGRAM MESSAGE
// ==========================================

function splitMessage(
    text,
    maxLength = 3900
) {

    const messages = [];

    let remaining =
        text.trim();

    while (
        remaining.length > maxLength
    ) {

        let splitAt =
            remaining.lastIndexOf(
                '\n\n',
                maxLength
            );

        if (splitAt < 1000) {

            splitAt =
                remaining.lastIndexOf(
                    '\n',
                    maxLength
                );
        }

        if (splitAt < 1000) {

            splitAt =
                remaining.lastIndexOf(
                    ' ',
                    maxLength
                );
        }

        if (splitAt < 1000) {
            splitAt = maxLength;
        }

        messages.push(
            remaining
                .slice(0, splitAt)
                .trim()
        );

        remaining =
            remaining
                .slice(splitAt)
                .trim();
    }

    if (remaining) {
        messages.push(remaining);
    }

    return messages;
}

// ==========================================
// SEND ARTICLE
// ==========================================

async function sendArticle(article) {

    let caption =
        `<b>${escapeHtml(article.title)}</b>\n\n`;

    if (article.description) {

        caption +=
            `${escapeHtml(article.description)}\n\n`;
    }

    if (article.author) {

        caption +=
            `✍️ ${escapeHtml(article.author)}\n`;
    }

    caption +=
        `\n🔗 <a href="${escapeHtml(article.url)}">منبع: PlayStation Blog</a>`;

    // ======================================
    // DOWNLOAD IMAGE
    // ======================================

    const imageBuffer =
        await downloadImage(
            article.image
        );

    // ======================================
    // SEND IMAGE
    // ======================================

    if (imageBuffer) {

        try {

            await bot.sendPhoto(
                CHANNEL_ID,
                imageBuffer,
                {
                    caption,
                    parse_mode: 'HTML'
                }
            );

            console.log(
                '✓ عکس ارسال شد'
            );

        } catch (error) {

            console.error(
                'خطا در ارسال عکس:',
                error.message
            );

            await bot.sendMessage(
                CHANNEL_ID,
                caption,
                {
                    parse_mode: 'HTML'
                }
            );
        }

    } else {

        await bot.sendMessage(
            CHANNEL_ID,
            caption,
            {
                parse_mode: 'HTML'
            }
        );
    }

    await sleep(
        SEND_DELAY
    );

    // ======================================
    // SEND FULL ARTICLE
    // ======================================

    const messages =
        splitMessage(
            article.content
        );

    console.log(
        `تعداد پیام‌های متن: ${messages.length}`
    );

    for (
        const message
        of messages
    ) {

        await bot.sendMessage(
            CHANNEL_ID,
            message,
            {
                disable_web_page_preview: true
            }
        );

        await sleep(
            SEND_DELAY
        );
    }
}

// ==========================================
// MAIN
// ==========================================

async function run() {

    console.log('');
    console.log(
        '======================================'
    );
    console.log(
        'PLAYSTATION BLOG NEWS BOT'
    );
    console.log(
        '======================================'
    );

    const sentItems =
        loadDatabase();

    console.log(
        `اخبار ثبت شده: ${sentItems.length}`
    );

    // ======================================
    // RSS
    // ======================================

    console.log(
        'دریافت PlayStation Blog RSS...'
    );

    const feed =
        await parser.parseURL(
            RSS_URL
        );

    console.log(
        `اخبار موجود در RSS: ${feed.items.length}`
    );

    // ======================================
    // PROCESS NEWS
    // ======================================

    const posts =
        feed.items.slice(
            0,
            MAX_POSTS
        );

    for (
        const item
        of posts
    ) {

        const guid =
            item.guid ||
            item.id ||
            item.link;

        const articleUrl =
            item.link;

        if (
            !guid ||
            !articleUrl
        ) {
            continue;
        }

        // ==================================
        // DUPLICATE
        // ==================================

        if (
            sentItems.includes(guid)
        ) {

            console.log(
                `قبلاً ارسال شده: ${item.title}`
            );

            continue;
        }

        console.log('');
        console.log(
            '--------------------------------------'
        );

        console.log(
            `خبر جدید: ${item.title}`
        );

        try {

            // دریافت صفحه کامل
            const article =
                await fetchArticle(
                    articleUrl
                );

            console.log(
                `عنوان: ${article.title}`
            );

            console.log(
                `طول متن: ${article.content.length}`
            );

            // ارسال
            await sendArticle(
                article
            );

            // ثبت
            sentItems.push(
                guid
            );

            saveDatabase(
                sentItems
            );

            console.log(
                `✓ خبر ارسال شد: ${article.title}`
            );

            await sleep(
                SEND_DELAY
            );

        } catch (error) {

            console.error(
                `✗ خطا: ${error.message}`
            );
        }
    }

    saveDatabase(
        sentItems
    );

    console.log('');
    console.log(
        '======================================'
    );
    console.log(
        'BOT FINISHED'
    );
    console.log(
        '======================================'
    );
}

// ==========================================
// START
// ==========================================

run().catch(error => {

    console.error(
        'Fatal Error:',
        error
    );

    process.exit(1);
});
