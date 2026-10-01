import TelegramBot from 'node-telegram-bot-api';
import * as cheerio from 'cheerio';
import fs from 'fs';

// ==========================================
// CONFIG
// ==========================================

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || process.env.CHANNEL_ID;

if (!BOT_TOKEN) {
    throw new Error('Bot token is missing in environment variables');
}

if (!CHANNEL_ID) {
    throw new Error('Channel ID is missing in environment variables');
}

const bot = new TelegramBot(BOT_TOKEN);

const SOURCES = [
    'https://rss.app/feeds/v1.1/hJq82RDHPbUAgruU.json',
    'https://rss.app/feeds/v1.1/4uDnWEncNDKOOHhm.json',
    'https://rss.app/feeds/v1.1/w0i8qundSwVqzDvf.json',
    'https://rss.app/feeds/v1.1/wFhpf78OfTkIeVyU.json',
    'https://rss.app/feeds/v1.1/sof9nJ6lqw3WQMQ6.json',
    'https://rss.app/feeds/v1.1/WDYZJVQukTWHArwU.json',
    'https://rss.app/feeds/v1.1/AHEgGj1L3ut2KReu.json',
    'https://rss.app/feeds/v1.1/3zEGo7487fY2hbjy.json'
];

const DB_FILE = './db.json';
const MAX_POSTS_PER_FEED = 2; // برای جلوگیری از شلوغی و طولانی شدن اجرای گیت‌هاب
const SEND_DELAY = 2500;

// ==========================================
// HELPERS
// ==========================================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function loadDatabase() {
    if (!fs.existsSync(DB_FILE)) return [];
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

function saveDatabase(items) {
    fs.writeFileSync(DB_FILE, JSON.stringify(items.slice(-500), null, 2), 'utf8');
}

function cleanText(text) {
    return String(text || '')
        .replace(/\u00a0/g, ' ')
        .replace(/\r/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function extractImageUrl(item) {
    if (item.image && typeof item.image === 'string' && item.image.startsWith('http')) {
        return item.image;
    }

    if (Array.isArray(item.attachments) && item.attachments.length > 0) {
        const attach = item.attachments.find(a => a.mime_type?.startsWith('image/') || a.url?.match(/\.(jpg|jpeg|png|webp|gif)/i));
        if (attach?.url) return attach.url;
    }

    if (item.content_html) {
        const match = item.content_html.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i);
        if (match && match[1]) {
            return match[1].replace(/&amp;/g, '&');
        }
    }

    return null;
}

// ==========================================
// SCRAPE FULL ARTICLE TEXT
// ==========================================

async function fetchFullArticleText(url) {
    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        });

        if (!res.ok) return '';

        const html = await res.text();
        const $ = cheerio.load(html);

        // پاکسازی تگ‌های اضافه
        $('script, style, noscript, iframe, svg, nav, aside, footer, form, button, .comments, .related-posts, .share, .advertisement, .ads, .sidebar').remove();

        let container = $('article').first();
        if (!container.length) container = $('main').first();
        if (!container.length) container = $('.post-content, .entry-content, .article-content').first();
        if (!container.length) container = $('body');

        const blocks = [];
        container.find('h2, h3, p, li, blockquote').each((_, el) => {
            const tag = el.tagName.toLowerCase();
            let text = cleanText($(el).text());
            if (!text || text.length < 5) return;

            if (tag === 'li') text = `• ${text}`;
            if (tag === 'blockquote') text = `“${text}”`;

            blocks.push(text);
        });

        return cleanText(blocks.join('\n\n'));
    } catch {
        return '';
    }
}

// تقسیم پیام‌های بزرگ تلگرام (محدودیت ۴۰۹۶ کاراکتر)
function splitMessage(text, maxLength = 3800) {
    const messages = [];
    let remaining = text.trim();

    while (remaining.length > maxLength) {
        let splitAt = remaining.lastIndexOf('\n\n', maxLength);
        if (splitAt < 1000) splitAt = remaining.lastIndexOf('\n', maxLength);
        if (splitAt < 1000) splitAt = remaining.lastIndexOf(' ', maxLength);
        if (splitAt < 1000) splitAt = maxLength;

        messages.push(remaining.slice(0, splitAt).trim());
        remaining = remaining.slice(splitAt).trim();
    }

    if (remaining) messages.push(remaining);
    return messages;
}

// ==========================================
// SEND POST
// ==========================================

async function sendPost(item, sourceTitle) {
    const title = cleanText(item.title || 'بدون عنوان');
    const link = item.url || '';
    const author = cleanText(item.authors?.[0]?.name || item.author?.name || '');
    const imageUrl = extractImageUrl(item);

    // ۱. دریافت متن کامل خبر
    console.log(`در حال دریافت متن کامل مقاله از: ${link}`);
    let fullText = await fetchFullArticleText(link);

    // اگر متن کامل پیدا نشد، از خلاصه فید استفاده کن
    if (!fullText) {
        fullText = cleanText(item.content_text || item.summary || '');
    }

    let caption = `📢 <b>${escapeHtml(title)}</b>\n\n`;
    if (author) {
        caption += `✍️ نویسنده: ${escapeHtml(author)}\n`;
    }
    caption += `🌐 منبع: <b>${escapeHtml(sourceTitle)}</b>\n`;
    if (link) {
        caption += `🔗 <a href="${escapeHtml(link)}">مشاهده لینک منبع</a>`;
    }

    // ارسال کاور خبر (تصویر یا پیام متنی تیتر)
    if (imageUrl) {
        try {
            await bot.sendPhoto(CHANNEL_ID, imageUrl, {
                caption,
                parse_mode: 'HTML'
            });
            console.log(`✓ تصویر و تیتر ارسال شد: ${title}`);
        } catch (err) {
            console.error(`خطا در ارسال عکس: ${err.message}. ارسال متنی...`);
            await bot.sendMessage(CHANNEL_ID, caption, { parse_mode: 'HTML' });
        }
    } else {
        await bot.sendMessage(CHANNEL_ID, caption, { parse_mode: 'HTML' });
    }

    await sleep(SEND_DELAY);

    // ارسال متن کامل مقاله به صورت پیام‌های تفکیک‌شده
    if (fullText) {
        const textParts = splitMessage(fullText);
        console.log(`تعداد پیام‌های متن خبر: ${textParts.length}`);

        for (const part of textParts) {
            try {
                await bot.sendMessage(CHANNEL_ID, part, {
                    disable_web_page_preview: true
                });
                await sleep(1500);
            } catch (err) {
                console.error(`خطا در ارسال بخشی از متن: ${err.message}`);
            }
        }
    }
}

// ==========================================
// MAIN
// ==========================================

async function run() {
    console.log('\n======================================');
    console.log('FULL ARTICLE MULTI-FEED BOT RUNNING');
    console.log('======================================');

    const sentItems = loadDatabase();
    console.log(`تعداد شناسه‌های ذخیره‌شده: ${sentItems.length}`);

    let newSentCount = 0;

    for (const feedUrl of SOURCES) {
        console.log(`\nدر حال دریافت منبع: ${feedUrl}`);

        try {
            const res = await fetch(feedUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36'
                }
            });

            if (!res.ok) {
                console.error(`خطا در دریافت فید: HTTP ${res.status}`);
                continue;
            }

            const data = await res.json();
            const sourceTitle = data.title || 'News Feed';

            const items = (data.items || []).slice(0, MAX_POSTS_PER_FEED).reverse();

            for (const item of items) {
                const guid = item.id || item.url;
                if (!guid || sentItems.includes(guid)) continue;

                console.log(`\nخبر جدید: ${item.title}`);
                await sendPost(item, sourceTitle);

                sentItems.push(guid);
                newSentCount++;

                await sleep(SEND_DELAY);
            }
        } catch (error) {
            console.error(`خطای پردازش فید: ${error.message}`);
        }
    }

    saveDatabase(sentItems);

    console.log('\n======================================');
    console.log(`BOT FINISHED | کل پست‌های جدید ارسال‌شده: ${newSentCount}`);
    console.log('======================================\n');
}

// ==========================================
// START
// ==========================================

run().catch(error => {
    console.error('Fatal Error:', error);
    process.exit(1);
});
