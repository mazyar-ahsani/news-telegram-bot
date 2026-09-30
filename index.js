const TelegramBot = require('node-telegram-bot-api');
const Parser = require('rss-parser');
const axios = require('axios');
const fs = require('fs');

// تنظیمات اولیه
const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHANNEL_ID;
const bot = new TelegramBot(token, { polling: false });
const parser = new Parser();

const DB_FILE = 'db.json';
const FEEDS = [
    { name: 'IGN', url: 'https://feeds.feedburner.com/ign/all' },
    { name: 'GameSpot', url: 'https://www.gamespot.com/feeds/mashup/' },
    { name: 'Deadline', url: 'https://deadline.com/feed/' }
];

// لود دیتابیس
let db = [];
if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

// تابع ترجمه
async function translateText(text) {
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=fa&dt=t&q=${encodeURIComponent(text)}`;
        const res = await axios.get(url);
        return res.data[0].map(x => x[0]).join('');
    } catch {
        return text;
    }
}

// استخراج تصویر هوشمند
function getImageUrl(item) {
    if (item.enclosure && item.enclosure.url) return item.enclosure.url;
    if (item['media:content'] && item['media:content'].$.url) return item['media:content'].$.url;
    if (item.image && item.image.url) return item.image.url;
    
    // جستجو در متن HTML
    if (item.content) {
        const match = item.content.match(/<img[^>]+src="([^">]+)"/);
        if (match && match[1]) return match[1];
    }
    return null;
}

// تمیزکاری متن
function cleanText(text) {
    if (!text) return "";
    return text.replace(/<[^>]*>?/gm, '').trim();
}

async function start() {
    for (const feedConfig of FEEDS) {
        try {
            const feed = await parser.parseURL(feedConfig.url);
            
            for (const item of feed.items) {
                const guid = item.guid || item.id || item.link;
                if (db.includes(guid)) continue;

                // پردازش محتوا
                const title = await translateText(item.title);
                const rawDesc = cleanText(item.contentSnippet || item.summary || "");
                const desc = rawDesc.length > 20 ? await translateText(rawDesc.substring(0, 150)) + "..." : "";
                const imageUrl = getImageUrl(item);
                
                // ساخت کپشن (فرمت Markdown)
                const caption = `⚡️ *${title.replace(/[*_`]/g, '')}*\n\n${desc}\n\n🔗 [مشاهده منبع](${item.link})`;

                try {
                    if (imageUrl) {
                        await bot.sendPhoto(chatId, imageUrl, { caption: caption, parse_mode: 'Markdown' });
                    } else {
                        await bot.sendMessage(chatId, caption, { parse_mode: 'Markdown' });
                    }
                    
                    db.push(guid);
                    // تاخیر کوتاه برای جلوگیری از فلود تلگرام
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } catch (e) {
                    console.error(`خطا در ارسال پست از ${feedConfig.name}:`, e.message);
                }
            }
        } catch (e) {
            console.error(`خطا در خواندن فید ${feedConfig.name}:`, e.message);
        }
    }
    
    // ذخیره دیتابیس
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

start();
