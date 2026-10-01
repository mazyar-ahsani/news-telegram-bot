import TelegramBot from 'node-telegram-bot-api';
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
    'https://rss.app/feeds/v1.1/WDگ‌ها، هندل کردن دانلود بافر عکس، تفکیک پیام و سیستم دیتابیس ارتقا دادم تا هر ۸ فید را پردازش کند.

فایل `index.js` را باز کن و کل آن را با کد زیر جایگزین کن:
```javascript
import TelegramBot from 'node-telegram-bot-api';
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
const MAX_POSTS_PER_FEED = 3;
const SEND_DELAY = 2500;

// ==========================================
// HELPquot;');
}

async function downloadImage(imageUrl) {
if (!imageUrl) return null;

try {
const response = await fetch(imageUrl, {
headers: {
'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36',
'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
}
});

if (!response.ok) return null;

const contentType = response.headers.get('content-type') || '';
if (!contentType.startsWith('image/')) return null;

const arrayBuffer = await response.arrayBuffer();
return Buffer.from(arrayBuffer);
} catch {
return null;
}
}

// ==========================================
// SEND POST
// ==========================================

async function sendPost(item, sourceTitle) {
const title = cleanText(item.title || 'بدون عنوان');
const link = item.url || '';
const rawSummary = item.content_text || item.summary || '';
const summary = cleanText(rawSummary.length > 350 ? rawSummary.slice(0, 347) + '...' : rawSummary);
const author = cleanText(item.authors?.[0]?.name || item.author?.name || '');
const imageUrl = item.image || (item.attachments && item.attachments[0]?.url) || null;

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

const imageBuffer = await downloadImage(imageUrl);

if (imageBuffer) {
try {
await bot.sendPhoto(CHANNEL_ID, imageBuffer, {
caption,
parse_mode: 'HTML'
});
console.log(`✓ تصویر و کپشن با موفقیت ارسال شد: ${title}`);
return;
} catch (err) {
console.error(`خطا در ارسال تصویر تلگرام: ${err.message}. ارسال متن ساده...`);
}
}

await bot.sendMessage(CHANNEL_ID, caption, {
parse_mode: 'HTML',
disable_web_page_preview: false
});
console.log(`✓ پیام متنی با موفقیت ارسال شد: ${title}`);
}

// ==========================================
// MAIN
// ==========================================

async function run() {
console.log('\n======================================');
console.log('MULTI-FEED JSON NEWS BOT RUNNING');
console.log('======================================');

const sentItems = loadDatabase();
console.log(`تعداد شناسه‌های ذخیره‌شده در دیتابیس: ${sentItems.length}`);

let newSentCount = 0;

for (const feedUrl of SOURCES) {
console.log(`\nدر حال بررسی منبع: ${feedUrl}`);

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
console.log(`عنوان منبع: ${sourceTitle}`);

// دریافت آیتم‌های جدید و مرتب‌سازی از قدیم به جدید جهت حفظ توالی زمانی
const items = (data.items || []).slice(0, MAX_POSTS_PER_FEED).reverse();

for (const item of items) {
const guid = item.id || item.url;
if (!guid) continue;

if (sentItems.includes(guid)) {
console.log(`قبلاً ارسال شده: ${item.title || guid}`);
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
