import TelegramBot from 'node-telegram-bot-api';
import Parser from 'rss-parser';
import fs from 'fs';

// تنظیمات ربات
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const DB_FILE = 'db.json';

const parser = new Parser({
    customFields: { item: [['media:content', 'media']] }
});

const SOURCES = [
    { name: 'IGN', url: 'https://feeds.feedburner.com/IGNAllArticles' },
    { name: 'GameSpot', url: 'https://www.gamespot.com/feeds/news/' },
    { name: 'Deadline', url: 'https://deadline.com/feed/' }
];

function getSourceData(item, sourceName) {
    let image = '';
    
    // ۱. استخراج عکس با اولویت‌بندی (بسیار قوی‌تر)
    // اول: media:content (استاندارد رسانه‌ای)
    // دوم: enclosure (استاندارد RSS)
    // سوم: search in content (اگر در تگ media نبود، در محتوا دنبال تگ <img> می‌گردد)
    
    const mediaUrl = item.media?.$.url || item.enclosure?.url;
    
    if (mediaUrl) {
        image = mediaUrl;
    } else if (item.content || item.summary) {
        const content = item.content || item.summary;
        const imgMatch = content.match(/<img[^>]+src="([^">]+)"/);
        if (imgMatch && imgMatch[1]) {
            image = imgMatch[1];
        }
    }

    // پاکسازی توضیحات
    let description = (item.contentSnippet || item.summary || '').replace(/<[^>]*>?/gm, '').substring(0, 200) + '...';
    
    return { image, description };
}

async function run() {
    let sentItems = [];
    if (fs.existsSync(DB_FILE)) {
        sentItems = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }

    for (const source of SOURCES) {
        try {
            const feed = await parser.parseURL(source.url);
            
            // پردازش ۳ خبر آخر هر منبع
            for (const item of feed.items.slice(0, 3)) {
                const guid = item.guid || item.link;
                if (sentItems.includes(guid)) continue;

                const { image, description } = getSourceData(item, source.name);
                const caption = `<b>${item.title}</b>\n\n${description}\n\n🏷 منبع: ${source.name}\n🔗 <a href="${item.link}">مشاهده خبر</a>`;

                try {
                    if (image) {
                        await bot.sendPhoto(CHANNEL_ID, image, { caption, parse_mode: 'HTML' });
                    } else {
                        await bot.sendMessage(CHANNEL_ID, caption, { parse_mode: 'HTML' });
                    }
                    sentItems.push(guid);
                    // تأخیر ۲ ثانیه‌ای برای جلوگیری از بن شدن توسط تلگرام
                    await new Promise(r => setTimeout(r, 2000));
                } catch (err) { console.error(`خطا در ارسال ${source.name}:`, err.message); }
            }
        } catch (err) { console.error(`خطا در خواندن ${source.name}:`, err.message); }
    }
    
    fs.writeFileSync(DB_FILE, JSON.stringify(sentItems.slice(-100), null, 2));
}

run();
