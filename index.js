const TelegramBot = require('node-telegram-bot-api');
const Parser = require('rss-parser');
const fs = require('fs');

// تنظیمات اولیه
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const DB_FILE = 'db.json';

const parser = new Parser({
    customFields: { item: [['media:content', 'media']] }
});

// لیست منابع با نام اختصاصی
const SOURCES = [
    { name: 'IGN', url: 'https://feeds.feedburner.com/IGNAllArticles' },
    { name: 'GameSpot', url: 'https://www.gamespot.com/feeds/news/' },
    { name: 'Deadline', url: 'https://deadline.com/feed/' }
];

// منطق اختصاصی برای هر منبع
function getSourceData(item, sourceName) {
    let image = '';
    let description = (item.contentSnippet || item.summary || '').replace(/<[^>]*>?/gm, '').substring(0, 200) + '...';

    switch (sourceName) {
        case 'IGN':
            // IGN معمولاً از enclosure یا media:content استفاده می‌کند
            image = item.enclosure?.url || (item.media && item.media.$?.url) || '';
            break;
        case 'GameSpot':
            // GameSpot معمولاً عکس بزرگ را در media:content دارد
            image = (item.media && item.media.$?.url) || item.enclosure?.url || '';
            break;
        case 'Deadline':
            // Deadline معمولاً ساختار پیچیده‌تری دارد
            image = item.enclosure?.url || '';
            break;
    }
    
    return { image, description };
}

async function run() {
    let sentItems = [];
    if (fs.existsSync(DB_FILE)) sentItems = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

    for (const source of SOURCES) {
        try {
            const feed = await parser.parseURL(source.url);
            console.log(`Checking ${source.name}...`);

            for (const item of feed.items.slice(0, 3)) { // فقط ۳ خبر جدید
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
                    await new Promise(r => setTimeout(r, 2000));
                } catch (err) { console.error(`Error sending ${source.name}:`, err.message); }
            }
        } catch (err) { console.error(`Error fetching ${source.name}:`, err.message); }
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(sentItems.slice(-100), null, 2));
}

run();
