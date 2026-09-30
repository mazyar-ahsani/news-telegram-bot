import http from 'http';
import fs from 'fs';
import path from 'path';
import Parser from 'rss-parser';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const parser = new Parser();
const DB_FILE = path.resolve('db.json');

const FEEDS = [
    { name: 'IGN', url: 'https://feeds.feedburner.com/ign/all' },
    { name: 'GameSpot', url: 'https://www.gamespot.com/feeds/mashup/' },
    { name: 'Deadline', url: 'https://deadline.com/feed/' }
];

function getProcessedGuids() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify([]));
        return [];
    }
    try {
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    } catch {
        return [];
    }
}

function saveGuid(guid) {
    const list = getProcessedGuids();
    list.push(guid);
    if (list.length > 500) list.shift();
    fs.writeFileSync(DB_FILE, JSON.stringify(list, null, 2));
}

async function translateToPersian(text) {
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=fa&dt=t&q=${encodeURIComponent(text)}`;
        const res = await axios.get(url);
        return res.data[0][0][0] || text;
    } catch {
        return text;
    }
}

async function sendToTelegram(message, sourceUrl) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHANNEL_ID;
    if (!token || !chatId) return;

    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    await axios.post(url, {
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
        reply_markup: {
            inline_keyboard: [
                [{ text: '🌐 منبع خبر', url: sourceUrl }]
            ]
        }
    });
}

async function checkNews() {
    const processedGuids = getProcessedGuids();

    for (const feed of FEEDS) {
        try {
            const feedData = await parser.parseURL(feed.url);

            for (const item of feedData.items.slice(0, 5)) {
                const uniqueId = item.guid || item.link;

                if (!uniqueId || processedGuids.includes(uniqueId)) {
                    continue;
                }

                const translatedTitle = await translateToPersian(item.title);
                const channelName = (process.env.TELEGRAM_CHANNEL_ID || '').replace('@', '');

                const post = 
`⚡️ <b>#فوری | ${translatedTitle}</b>

📌 منبع: <i>${feed.name}</i>
🗓 انتشار: ${new Date(item.pubDate || Date.now()).toLocaleTimeString('fa-IR')}

🎮 @${channelName}`;

                await sendToTelegram(post, item.link);
                saveGuid(uniqueId);
                console.log(`[منتشر شد] ${item.title}`);

                await new Promise(r => setTimeout(r, 2000));
            }
        } catch (error) {
            console.error(`خطا در منبع ${feed.name}:`, error.message);
        }
    }
}

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running 24/7');
}).listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

const interval = (process.env.CHECK_INTERVAL_SECONDS || 60) * 1000;
console.log('🤖 ربات خبری شروع به کار کرد...');
checkNews();
setInterval(checkNews, interval);
