import TelegramBot from 'node-telegram-bot-api';
import Parser from 'rss-parser';
import fs from 'fs';

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const DB_FILE = 'db.json';

const parser = new Parser({
    customFields: {
        item: [
            ['media:content', 'media'],
            ['media:thumbnail', 'thumbnail']
        ]
    }
});

const SOURCES = [
    {
        name: 'IGN',
        url: 'https://feeds.feedburner.com/IGNAllArticles'
    },
    {
        name: 'GameSpot',
        url: 'https://www.gamespot.com/feeds/news/'
    },
    {
        name: 'Deadline',
        url: 'https://deadline.com/feed/'
    },
    {
        name: 'PlayStation Blog',
        url: 'https://blog.playstation.com/feed/'
    }
];

function cleanText(text = '') {
    return text
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

function getRssImage(item) {
    // media:content
    if (item.media?.$?.url) {
        return item.media.$.url;
    }

    // media:content ممکن است به شکل‌های مختلف parse شود
    if (typeof item.media === 'string') {
        return item.media;
    }

    // media:thumbnail
    if (item.thumbnail?.$?.url) {
        return item.thumbnail.$.url;
    }

    // enclosure
    if (item.enclosure?.url) {
        return item.enclosure.url;
    }

    // تصویر داخل description/content
    const content = item.content || item.summary || '';

    const imgMatch = content.match(
        /<img[^>]+(?:src|data-src)=["']([^"']+)["']/i
    );

    if (imgMatch?.[1]) {
        return imgMatch[1];
    }

    return '';
}

async function getPlayStationImage(url) {
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36'
            }
        });

        if (!response.ok) {
            console.error(
                `PlayStation page returned ${response.status}: ${url}`
            );
            return '';
        }

        const html = await response.text();

        /*
         * 1. JSON-LD
         */
        const jsonLdMatches = html.match(
            /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
        );

        if (jsonLdMatches) {
            for (const block of jsonLdMatches) {
                try {
                    const jsonText = block
                        .replace(
                            /<script[^>]*type=["']application\/ld\+json["'][^>]*>/i,
                            ''
                        )
                        .replace(/<\/script>$/i, '')
                        .trim();

                    const data = JSON.parse(jsonText);

                    const findImage = (obj) => {
                        if (!obj || typeof obj !== 'object') {
                            return '';
                        }

                        // image: "https://..."
                        if (typeof obj.image === 'string') {
                            return obj.image;
                        }

                        // image: [...]
                        if (
                            Array.isArray(obj.image) &&
                            typeof obj.image[0] === 'string'
                        ) {
                            return obj.image[0];
                        }

                        // image: { url: "..." }
                        if (
                            obj.image &&
                            typeof obj.image === 'object' &&
                            typeof obj.image.url === 'string'
                        ) {
                            return obj.image.url;
                        }

                        return '';
                    };

                    // JSON-LD معمولی
                    let image = findImage(data);

                    if (image) {
                        return image;
                    }

                    // @graph
                    if (Array.isArray(data?.['@graph'])) {
                        for (const item of data['@graph']) {
                            image = findImage(item);

                            if (image) {
                                return image;
                            }
                        }
                    }
                } catch {
                    // JSON-LD نامعتبر بود، ادامه می‌دهیم
                }
            }
        }

        /*
         * 2. Open Graph
         */
        const ogImage = html.match(
            /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
        );

        if (ogImage?.[1]) {
            return ogImage[1];
        }

        /*
         * حالت برعکس attributeها
         */
        const ogImageReverse = html.match(
            /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i
        );

        if (ogImageReverse?.[1]) {
            return ogImageReverse[1];
        }

        /*
         * 3. twitter:image
         */
        const twitterImage = html.match(
            /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i
        );

        if (twitterImage?.[1]) {
            return twitterImage[1];
        }

        return '';
    } catch (error) {
        console.error(
            `خطا در دریافت تصویر PlayStation: ${error.message}`
        );

        return '';
    }
}

async function getSourceData(item, sourceName) {
    let image = getRssImage(item);

    /*
     * فقط برای PlayStation اگر RSS عکس نداشت،
     * صفحه خبر را باز می‌کنیم.
     */
    if (!image && sourceName === 'PlayStation Blog' && item.link) {
        image = await getPlayStationImage(item.link);
    }

    /*
     * توضیحات
     */
    let description = cleanText(
        item.contentSnippet ||
        item.summary ||
        item.content ||
        ''
    );

    /*
     * کوتاه کردن توضیحات
     */
    if (description.length > 300) {
        description = description.substring(0, 300).trim() + '...';
    }

    return {
        image,
        description
    };
}

async function run() {
    let sentItems = [];

    if (fs.existsSync(DB_FILE)) {
        try {
            sentItems = JSON.parse(
                fs.readFileSync(DB_FILE, 'utf8')
            );
        } catch {
            sentItems = [];
        }
    }

    for (const source of SOURCES) {
        try {
            console.log(`در حال بررسی ${source.name}...`);

            const feed = await parser.parseURL(source.url);

            /*
             * فقط ۳ خبر آخر
             */
            for (const item of feed.items.slice(0, 3)) {
                const guid = item.guid || item.id || item.link;

                if (!guid) {
                    continue;
                }

                if (sentItems.includes(guid)) {
                    continue;
                }

                const { image, description } =
                    await getSourceData(item, source.name);

                const title = cleanText(item.title || 'بدون عنوان');

                const caption =
                    `<b>${title}</b>\n\n` +
                    `${description}\n\n` +
                    `🏷 منبع: ${source.name}\n` +
                    `🔗 <a href="${item.link}">مشاهده خبر</a>`;

                try {
                    if (image) {
                        await bot.sendPhoto(
                            CHANNEL_ID,
                            image,
                            {
                                caption,
                                parse_mode: 'HTML'
                            }
                        );
                    } else {
                        await bot.sendMessage(
                            CHANNEL_ID,
                            caption,
                            {
                                parse_mode: 'HTML'
                            }
                        );
                    }

                    sentItems.push(guid);

                    console.log(
                        `ارسال شد: ${source.name} - ${title}`
                    );

                    /*
                     * فاصله بین ارسال‌ها
                     */
                    await new Promise(resolve =>
                        setTimeout(resolve, 2000)
                    );
                } catch (error) {
                    console.error(
                        `خطا در ارسال ${source.name}:`,
                        error.message
                    );
                }
            }
        } catch (error) {
            console.error(
                `خطا در خواندن ${source.name}:`,
                error.message
            );
        }
    }

    /*
     * فقط ۱۰۰ خبر آخر را نگه می‌داریم
     */
    fs.writeFileSync(
        DB_FILE,
        JSON.stringify(
            sentItems.slice(-100),
            null,
            2
        )
    );
}

run();
