import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';

// ==========================================
// CONFIG
// ==========================================

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || process.env.CHANNEL_ID;
const CHANNEL_USERNAME = '@maz_game_channel';

if (!BOT_TOKEN) throw new Error('Bot token is GAPGPTMASKTOKENq3xxvtngg8dX0X in environment variables');
if (!CHANNEL_ID) throw new Error('Channel ID is GAPGPTMASKTOKENq3xxvtngg8dX1X in environment variables');

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

function cleanText(text) {
    return String(text || '')
        .replace(/\u00a0/g, ' ')
        .replace(/\r/g, '')
        .replace(/[ \t]+/g, ' ')
        .trim();
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatPublishTime(dateString) {
    if (!dateString) return '';
    try {
        const date = new Date(dateString);
        return date.toLocaleTimeString('fa-IR', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZone: 'Asia/Tehran'
        });
    } catch {
        return '';
    }
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
// SEND POST (PHOTO + FORMATTED CAPTION)
// ==========================================

async function sendPost(item) {
    const title = cleanText(item.title || 'بدون عنوان');
    const imageUrl = extractImageUrl(item);
    const timeStr = formatPublishTime(item.date_published);

    let caption = `⚡️ <b>#فوری | ${escapeHtml(title)}</b>\n\n`;
    caption += `📌 منبع: <b>IGN</b>\n`;
    if (timeStr) {
        caption += `🗓 انتشار: ${escapeHtml(timeStr)}\n`;
    }
    caption += `\n🎮 ${CHANNEL_USERNAME}`;

    try {
        if (imageUrl) {
            console.log(`در حال ارسال تصویر: ${imageUrl}`);
            await bot.sendPhoto(CHANNEL_ID, imageUrl, {
                caption: caption,
                parse_mode: 'HTML'
            });
            console.log(`✓ تصویر با کپشن ارسال شد: ${title}`);
        } else {
            await bot.sendMessage(CHANNEL_ID, caption, {
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });
            console.log(`✓ پیام متنی ارسال شد: ${title}`);
        }
        return true;
    } catch (err) {
        console.error(`خطا در ارسال: ${err.message}`);
        return false;
    }
}

// ==========================================
// MAIN
// ==========================================

async function run() {
    console.log('\n======================================');
    console.log('NEWS BOT RUNNING (PHOTO + FORMATTED CAPTION)');
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

                console.log(`\nخبر جدید: ${item.title}`);
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
    console.log(`BOT FINISHED | پست‌های جدید ارسال‌شده: ${newSentCount}`);
    console.log('======================================\n');
}

// ==========================================
// START
// ==========================================

run().catch(error => {
    console.error('Fatal Error:', error);
    process.exit(1);
});
