import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';

// ==========================================
// CONFIG
// ==========================================

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || process.env.CHANNEL_ID;

if (!BOT_TOKEN) {
    throw new Error('Bot token is GAPGPTMASKTOKEN5dae9p68s6vX0X in environment variables');
}

if (!CHANNEL_ID) {
    throw new Error('Channel ID is GAPGPTMASKTOKEN5dae9p68s6vX1X in environment variables');
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
const MAX_POSTS_PER_FEED = 3;
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
        .replace(/<[^>]*>/g, '') // حذف تگ‌های HTML باقی‌مانده
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
    // 1. بررسی فیلد مستقیم image
    if (item.image && typeof item.image === 'string' && item.image.startsWith('http')) {
        return item.image;
    }

    // 2. بررسی attachments
    if (Array.isArray(item.attachments) && item.attachments.length > 0) {
        const attach = item.attachments.find(a => a.mime_type?.startsWith('image/') || a.url?.match(/\.(jpg|jpeg|png|webp|gif)/i));
        if (attach?.url) return attach.url;
    }

    // 3. استخراج از تگ img داخل content_html (فرمت رایج rss.app)
    if (item.content_html) {
        const match = item.content_html.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i);
        if (match && match[1]) {
            return match[1].replace(/&amp;/g, '&');
        }
    }

    return null;
}

// ==========================================
// SEND POST
// ==========================================

async function sendPost(item, sourceTitle) {
    const title = cleanText(item.title || 'بدون عنوان');
    const link = item.url || '';
    const rawSummary = item.content_text || item.summary || '';
    const summary = cleanText(rawSummary.length > 300 ? rawSummary.slice(0, 297) + '...' : rawSummary);
    const author = cleanText(item.authors?.[0]?.name || item.author?.name || '');
    const imageUrl = extractImageUrl(item);

    let caption = `📢 <b>${escapeHtml(title)}</b>\n\n`;

    if (summary) {
        caption += `${escapeHtml(summary)}\n\n`;
    }

    if (author) {
        caption += `✍️ نویسنده: ${escapeHtml(author)}\n`;
    }

    caption += `🌐 منبع: <b>${escapeHtml(sourceTitle)}</b>\n`;
    if (link) {
        caption += `🔗 <a href="${escapeHtml(link)}">مشاهده کامل خبر</a>`;
    }

    if (imageUrl) {
        console.log(`در حال ارسال تصویر: ${imageUrl}`);
        try {
            await bot.sendPhoto(CHANNEL_ID, imageUrl, {
                caption,
                parse_mode: 'HTML'
            });
            console.log(`✓ تصویر و کپشن ارسال شد: ${title}`);
            return;
        } catch (err) {
            console.error(`خطا در ارسال مستقیم تصویر: ${err.message}. تلاش برای ارسال پیام متنی...`);
        }
    } else {
        console.log('عکسی برای این خبر یافت نشد.');
    }

    await bot.sendMessage(CHANNEL_ID, caption, {
        parse_mode: 'HTML',
        disable_web_page_preview: false
    });
    console.log(`✓ پیام متنی ارسال شد: ${title}`);
}

// ==========================================
// MAIN
// ==========================================

async function run() {
    console.log('\n======================================');
    console.log('MULTI-FEED JSON NEWS BOT RUNNING');
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
                if (!guid) continue;

                if (sentItems.includes(guid)) {
                    continue;
                }

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
