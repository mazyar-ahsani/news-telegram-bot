const TelegramBot = require('node-telegram-bot-api');
const Parser = require('rss-parser');
const fs = require('fs');

const parser = new Parser();
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const DB_FILE = 'db.json';

// لیست منابع خبری شما
const FEEDS = [
    'https://feeds.feedburner.com/IGNAllArticles',
    'https://www.gamespot.com/feeds/news/',
    'https://deadline.com/feed/'
];

async function run() {
    let sentItems = [];
    try {
        if (fs.existsSync(DB_FILE)) {
            sentItems = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        }
    } catch (e) { console.error("Error reading db:", e); }

    for (const feedUrl of FEEDS) {
        try {
            const feed = await parser.parseURL(feedUrl);
            
            for (const item of feed.items) {
                const guid = item.guid || item.link;

                // بررسی تکراری نبودن خبر
                if (sentItems.includes(guid)) continue;

                // استخراج عکس
                const image = item.enclosure?.url || 
                              item['media:content']?.$.url || 
                              item.image?.url || '';

                // تمیزسازی متن (حذف HTML)
                const description = (item.contentSnippet || item.summary || '').replace(/<[^>]*>?/gm, '').substring(0, 200) + '...';

                const caption = `<b>${item.title}</b>\n\n${description}\n\n🔗 <a href="${item.link}">مشاهده خبر</a>`;

                try {
                    if (image) {
                        await bot.sendPhoto(CHANNEL_ID, image, { caption, parse_mode: 'HTML' });
                    } else {
                        await bot.sendMessage(CHANNEL_ID, caption, { parse_mode: 'HTML' });
                    }
                    console.log(`Sent: ${item.title}`);
                    sentItems.push(guid);
                } catch (err) {
                    console.error(`Failed to send: ${item.title}`, err);
                }
                
                // جلوگیری از اسپم (کمی تأخیر بین ارسال)
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        } catch (err) { console.error(`Error parsing feed ${feedUrl}:`, err); }
    }

    // ذخیره دیتابیس جدید
    fs.writeFileSync(DB_FILE, JSON.stringify(sentItems, null, 2));
}

run();
