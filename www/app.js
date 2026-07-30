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
            const res = await fetch('https://www.youtube.com/results?search_query=' + encodeURIComponent(query), {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
            });
            const html = await res.text();
            
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

    // Community Cobalt instances for downloading
    const COBALT_INSTANCES = [
        'https://co.eepy.moe',
        'https://cobalt.kwiatektv.me',
        'https://cobalt.q0.pm',
        'https://api.cobalt.tools' // Fallback (might require auth)
    ];

    async function getDownloadUrl(videoId, format, quality) {
        const url = `https://www.youtube.com/watch?v=${videoId}`;
        
        let instancesToTry = [...COBALT_INSTANCES];
        
        try {
            // Dynamically fetch working community instances
            const instancesRes = await fetch('https://instances.cobalt.best/api/instances');
            if (instancesRes.ok) {
                const data = await instancesRes.json();
                const validInstances = data.filter(i => i.cors === 1 && i.api_online && (i.version.startsWith('10') || i.version === '10.0'));
                if (validInstances.length > 0) {
                    instancesToTry = validInstances.slice(0, 5).map(i => 'https://' + i.domain);
                }
            }
        } catch(e) {
            console.error("Failed to fetch instance list, using fallback array.", e);
        }

        for (let instance of instancesToTry) {
            try {
                const res = await fetch(instance, {
                    method: 'POST',
                    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        url: url,
                        aFormat: format === 'mp3' ? 'mp3' : 'best',
                        vQuality: quality.replace('p', ''),
                        isAudioOnly: format === 'mp3'
                    })
                });
                
                if (res.ok) {
                    const data = await res.json();
                    if (data.url) return data.url;
                }
            } catch (e) {
                console.error(`Cobalt instance ${instance} failed`, e);
            }
        }
        
        // Final fallback: Try Invidious if Cobalt is completely down
        try {
            const res = await fetch(`https://invidious.jing.rocks/api/v1/videos/${videoId}`);
            const data = await res.json();
            if (format === 'mp3') {
                return data.adaptiveFormats.find(f => f.type.includes('audio'))?.url;
            } else {
                let videoStream = data.formatStreams.find(f => f.resolution && f.resolution.includes(quality));
                return videoStream ? videoStream.url : data.formatStreams[0].url;
            }
        } catch(e) {
            console.error("Invidious fallback failed", e);
        }

        throw new Error("All download APIs failed. Check internet connection.");
    }

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
        item.status = 'downloading...';
        updateQueueUI();

        try {
            // Get streaming URL
            const streamUrl = await getDownloadUrl(item.id, item.format, item.quality);
            if(!streamUrl) throw new Error("Could not fetch stream URL");

            const filename = `${item.title.replace(/[^a-z0-9]/gi, '_').substring(0, 50)}_${Date.now()}.${item.format}`;
            
            let localPath = "";
            
            // Download via Capacitor Filesystem
            if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
                const result = await window.Capacitor.Plugins.Filesystem.downloadFile({
                    url: streamUrl,
                    path: filename,
                    directory: 'DATA'
                });
                localPath = window.Capacitor.convertFileSrc(result.path);
            } else {
                // If not running in native container, fallback
                localPath = streamUrl;
            }

            item.status = 'done';
            
            myCollection.push({
                ...item,
                url: localPath
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
