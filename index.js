import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';

// ==========================================
// CONFIG
// ==========================================

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || process.env.CHANNEL_ID;

if (!BOT_TOKEN) throw new Error('Bot token is GAPGPTMASKTOKEN2x6xslz4m9nX0X in environment variables');
if (!CHANNEL_ID) throw new Error('Channel ID is GAPGPTMASKTOKEN2x6xslz4m9nX1X in environment variables');

const bot = new TelegramBot(BOT_TOKEN);

const SOURCES = [
    'https://rss.app/feeds/v1.1/6Hir3ou4lxVVU5sp.json'
];

const DB_FILE = './db.json';
const MAX_POSTS_PER_FEED = 5;
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
// SEND POST (PHOTO ONLY)
// ==========================================

async function sendPost(item) {
    const imageUrl = extractImageUrl(item);

    if (!imageUrl) {
        console.log(`تصویری برای خبر یافت نشد، رد شد: ${item.title || 'بدون عنوان'}`);
        return false;
    }

    try {
        console.log(`در حال ارسال تصویر: ${imageUrl}`);
        await bot.sendPhoto(CHANNEL_ID, imageUrl);
        console.log(`✓ تصویر ارسال شد: ${item.title || ''}`);
        return true;
    } catch (err) {
        console.error(`خطا در ارسال تصویر: ${err.message}`);
        return false;
    }
}

// ==========================================
// MAIN
// ==========================================

async function run() {
    console.log('\n======================================');
    console.log('NEWS BOT RUNNING (PHOTO ONLY MODE)');
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
            const items = (data.items || []).slice(0, MAX_POSTS_PER_FEED).reverse();

            for (const item of items) {
                const guid = item.id || item.url;
                if (!guid || sentItems.includes(guid)) continue;

                console.log(`\nبررسی خبر: ${item.title}`);
                const sent = await sendPost(item);

                sentItems.push(guid);
                if (sent) newSentCount++;

                await sleep(SEND_DELAY);
            }
        } catch (error) {
            console.error(`خطای پردازش فید: ${error.message}`);
        }
    }

    saveDatabase(sentItems);

    console.log('\n======================================');
    console.log(`BOT FINISHED | تصاویر جدید ارسال‌شده: ${newSentCount}`);
    console.log('======================================\n');
}

// ==========================================
// START
// ==========================================

run().catch(error => {
    console.error('Fatal Error:', error);
    process.exit(1);
});
