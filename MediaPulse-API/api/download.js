const ytdl = require('@distube/ytdl-core');

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    // Handle OPTIONS request
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        const videoId = req.query.v;
        const format = req.query.format || 'mp4';

        if (!videoId) {
            return res.status(400).json({ error: 'Missing video ID parameter v' });
        }

        const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;

        // Fetch video info
        const info = await ytdl.getInfo(ytUrl);

        let downloadUrl = null;

        if (format === 'mp3') {
            // Find the best audio-only format
            const audioFormat = ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' });
            if (audioFormat) {
                downloadUrl = audioFormat.url;
            }
        } else {
            // Find the best video+audio format (usually 720p maximum for combined)
            const videoFormat = ytdl.chooseFormat(info.formats, { quality: 'highest', filter: 'audioandvideo' });
            if (videoFormat) {
                downloadUrl = videoFormat.url;
            } else {
                // Fallback to highest video only (though it won't have sound without merging, Capacitor handles simple mp4)
                const fallback = ytdl.chooseFormat(info.formats, { quality: 'highestvideo' });
                if (fallback) downloadUrl = fallback.url;
            }
        }

        if (downloadUrl) {
            return res.status(200).json({ url: downloadUrl });
        } else {
            return res.status(404).json({ error: 'Could not extract valid format url' });
        }
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: e.message || 'Internal Server Error' });
    }
};
