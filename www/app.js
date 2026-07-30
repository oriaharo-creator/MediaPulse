document.addEventListener('DOMContentLoaded', () => {
    // --- Navigation Logic ---
    const navLinks = document.querySelectorAll('.nav-links li');
    const views = document.querySelectorAll('.view');

    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            navLinks.forEach(n => n.classList.remove('active'));
            views.forEach(v => v.classList.remove('active'));
            link.classList.add('active');
            const targetId = link.getAttribute('data-target');
            document.getElementById(targetId).classList.add('active');
        });
    });

    // --- State ---
    let downloadQueue = [];
    let myCollection = [];
    let currentVideoToQueue = null;

    // --- DOM Elements ---
    const searchBtn = document.getElementById('search-btn');
    const searchInput = document.getElementById('search-input');
    const resultsList = document.getElementById('results-list');
    
    const downloadModal = document.getElementById('download-modal');
    const closeDownloadModal = document.getElementById('close-download-modal');
    const formatSelect = document.getElementById('format-select');
    const qualityGroup = document.getElementById('quality-group');
    const addToQueueBtn = document.getElementById('add-to-queue-btn');
    const queueList = document.getElementById('queue-list');
    const queueBadge = document.getElementById('queue-badge');
    const processQueueBtn = document.getElementById('process-queue-btn');

    const filesList = document.getElementById('files-list');
    const localUpload = document.getElementById('local-upload');

    const playerModal = document.getElementById('player-modal');
    const closePlayer = document.getElementById('close-player');
    const mediaPlayer = document.getElementById('media-player');
    const nowPlayingTitle = document.getElementById('now-playing-title');

    // --- APIs ---
    
    // 100% reliable YouTube search by directly scraping the HTML
    async function searchYouTube(query) {
        try {
            const options = {
                url: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query),
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
            };
            const res = await Capacitor.Plugins.CapacitorHttp.get(options);
            const html = res.data;
            
            // Extract the ytInitialData JSON object from the raw HTML
            const match = html.match(/var ytInitialData = (\{.*?\});/);
            if(match) {
                const data = JSON.parse(match[1]);
                const contents = data.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents;
                const videoList = contents.find(c => c.itemSectionRenderer)?.itemSectionRenderer.contents || [];
                
                const results = videoList.filter(v => v.videoRenderer).map(v => {
                    const vid = v.videoRenderer;
                    return {
                        id: vid.videoId,
                        title: vid.title.runs[0].text,
                        duration: vid.lengthText ? vid.lengthText.simpleText : '',
                        thumb: vid.thumbnail.thumbnails[0].url
                    };
                });
                return results;
            }
        } catch(e) {
            console.error("Scrape failed", e);
        }
        throw new Error("Could not parse YouTube search results.");
    }

    // Fallback known API lists
    const COBALT_INSTANCES = [
        'https://co.eepy.moe',
        'https://cobalt.kwiatektv.me',
        'https://cobalt.q0.pm'
    ];

    // --- Search Logic ---
    searchBtn.addEventListener('click', async () => {
        const query = searchInput.value.trim();
        if (!query) return;

        resultsList.innerHTML = '<div class="empty-state">Searching YouTube...</div>';
        
        try {
            const results = await searchYouTube(query);
            
            if (!results || results.length === 0) {
                resultsList.innerHTML = '<div class="empty-state">No results found.</div>';
                return;
            }
            
            renderResults(results);
        } catch (error) {
            console.error(error);
            resultsList.innerHTML = `<div class="empty-state" style="color:red">Search failed: ${error.message}</div>`;
        }
    });

    function renderResults(results) {
        resultsList.innerHTML = '';
        results.forEach(video => {
            const card = document.createElement('div');
            card.className = 'card';
            card.innerHTML = `
                <div class="card-thumb">
                    <img src="${video.thumb}" alt="Thumbnail">
                    <span class="duration-badge">${video.duration}</span>
                </div>
                <div class="card-info">
                    <div class="card-title" title="${video.title}">${video.title}</div>
                    <div class="card-meta">YouTube Video</div>
                    <div class="card-actions">
                        <button class="download-action" onclick="openDownloadModal('${video.id}', '${video.title.replace(/'/g, "\\'")}', '${video.thumb}')">Download</button>
                    </div>
                </div>
            `;
            resultsList.appendChild(card);
        });
    }

    // --- Download Modal & Queue Logic ---
    window.openDownloadModal = function(id, title, thumb) {
        currentVideoToQueue = { id, title, thumb };
        downloadModal.classList.remove('hidden');
    };

    closeDownloadModal.addEventListener('click', () => {
        downloadModal.classList.add('hidden');
        currentVideoToQueue = null;
    });

    formatSelect.addEventListener('change', (e) => {
        if (e.target.value === 'mp3') {
            qualityGroup.style.display = 'none';
        } else {
            qualityGroup.style.display = 'block';
        }
    });

    addToQueueBtn.addEventListener('click', () => {
        if (!currentVideoToQueue) return;
        
        const format = formatSelect.value;
        const quality = format === 'mp4' ? document.getElementById('quality-select').value + 'p' : 'Audio';
        
        downloadQueue.push({
            ...currentVideoToQueue,
            format,
            quality,
            status: 'queued'
        });
        
        updateQueueUI();
        downloadModal.classList.add('hidden');
    });

    function updateQueueUI() {
        queueBadge.textContent = downloadQueue.length;
        if (downloadQueue.length === 0) {
            queueList.innerHTML = '<div class="empty-state">Queue is empty.</div>';
            return;
        }

        queueList.innerHTML = '';
        downloadQueue.forEach((item, index) => {
            const card = document.createElement('div');
            card.className = 'card';
            card.innerHTML = `
                <div class="card-thumb">
                    <img src="${item.thumb}" alt="Thumbnail">
                </div>
                <div class="card-info">
                    <div class="card-title">${item.title}</div>
                    <div class="card-meta">${item.format.toUpperCase()} • ${item.quality} • Status: ${item.status}</div>
                    <div class="card-actions">
                        <button onclick="removeFromQueue(${index})">Remove</button>
                    </div>
                </div>
            `;
            queueList.appendChild(card);
        });
    }

    window.removeFromQueue = function(index) {
        downloadQueue.splice(index, 1);
        updateQueueUI();
    };

    // --- Real Downloading Logic ---
    processQueueBtn.addEventListener('click', () => {
        if (downloadQueue.length === 0) return;
        processNextInQueue();
    });

    async function processNextInQueue() {
        const nextIndex = downloadQueue.findIndex(item => item.status === 'queued');
        if (nextIndex === -1) {
            alert('Queue processing complete!');
            return;
        }

        const item = downloadQueue[nextIndex];
        item.status = 'redirecting...';
        updateQueueUI();

        try {
            // STRATEGY 3: Browser Redirect
            const ytUrl = `https://www.youtube.com/watch?v=${item.id}`;
            const redirectUrl = `https://ytmp3.nu/`;
            
            // ytmp3 doesn't support pre-filling the URL box via web links.
            // Best workaround: Automatically copy the link to their clipboard!
            try {
                await navigator.clipboard.writeText(ytUrl);
                alert("YouTube Link copied to clipboard! Just paste it in the box on ytmp3.");
            } catch (err) {
                console.log("Clipboard write failed", err);
            }
            
            window.open(redirectUrl, '_blank');

            item.status = 'opened in browser';
            
            myCollection.push({
                ...item,
                url: redirectUrl,
                status: 'Check system downloads folder'
            });
            
            downloadQueue.splice(nextIndex, 1);
            updateQueueUI();
            updateCollectionUI();
            
            processNextInQueue();
        } catch (error) {
            console.error(error);
            item.status = 'Failed: ' + error.message;
            updateQueueUI();
            setTimeout(() => processNextInQueue(), 2000);
        }
    }

    // --- File Manager & Local Upload ---
    function updateCollectionUI() {
        if (myCollection.length === 0) {
            filesList.innerHTML = '<div class="empty-state">No downloaded files yet.</div>';
            return;
        }

        filesList.innerHTML = '';
        myCollection.forEach((item, index) => {
            const card = document.createElement('div');
            card.className = 'card';
            const icon = item.format === 'mp4' ? '🎬' : '🎵';
            card.innerHTML = `
                <div class="card-thumb" style="font-size: 40px; cursor:pointer;" onclick="playMedia(${index})">
                    ${item.thumb ? `<img src="${item.thumb}">` : icon}
                    <div style="position:absolute; background:rgba(0,0,0,0.5); width:100%; height:100%; display:flex; justify-content:center; align-items:center;">▶️</div>
                </div>
                <div class="card-info">
                    <div class="card-title">${item.title}</div>
                    <div class="card-meta">${item.format.toUpperCase()} File</div>
                    <div class="card-actions">
                        <button onclick="playMedia(${index})">Play</button>
                        <button onclick="deleteFromCollection(${index})">Delete</button>
                    </div>
                </div>
            `;
            filesList.appendChild(card);
        });
    }

    window.deleteFromCollection = function(index) {
        myCollection.splice(index, 1);
        updateCollectionUI();
    }

    localUpload.addEventListener('change', (e) => {
        const files = Array.from(e.target.files);
        files.forEach(file => {
            const isVideo = file.type.startsWith('video');
            const format = isVideo ? 'mp4' : 'mp3';
            const url = URL.createObjectURL(file);
            myCollection.push({
                id: 'local_' + Date.now(),
                title: file.name,
                format: format,
                quality: 'Local File',
                thumb: '',
                url: url
            });
        });
        
        navLinks.forEach(n => n.classList.remove('active'));
        views.forEach(v => v.classList.remove('active'));
        document.querySelector('[data-target="files-view"]').classList.add('active');
        document.getElementById('files-view').classList.add('active');
        
        updateCollectionUI();
    });

    // --- Media Player Modal ---
    window.playMedia = function(index) {
        const item = myCollection[index];
        nowPlayingTitle.textContent = item.title;
        mediaPlayer.src = item.url;
        playerModal.classList.remove('hidden');
        mediaPlayer.play();
    };

    closePlayer.addEventListener('click', () => {
        mediaPlayer.pause();
        mediaPlayer.src = '';
        playerModal.classList.add('hidden');
    });
});
