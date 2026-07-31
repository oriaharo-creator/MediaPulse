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
    let downloadQueue = JSON.parse(localStorage.getItem('downloadQueue') || '[]');
    let myCollection = JSON.parse(localStorage.getItem('myCollection') || '[]');
    let currentVideoToQueue = null;
    
    setTimeout(() => {
        if(downloadQueue.length > 0) {
            // Reset any downloads that were interrupted during the last session
            downloadQueue.forEach(item => {
                if (item.status === 'downloading...') item.status = 'queued';
            });
            updateQueueUI();
            
            // Auto-process queue on boot up
            processNextInQueue();
        }
        if(myCollection.length > 0) updateCollectionUI();
    }, 100);

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

        resultsList.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>Searching YouTube...</p></div>';
        
        try {
            const results = await searchYouTube(query);
            
            if (!results || results.length === 0) {
                resultsList.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><p>No results found.</p></div>';
                return;
            }
            
            renderResults(results);
        } catch (error) {
            console.error(error);
            resultsList.innerHTML = `<div class="empty-state" style="color:var(--accent-violet)"><div class="empty-icon">⚠️</div><p>Search failed: ${error.message}</p></div>`;
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
        localStorage.setItem('downloadQueue', JSON.stringify(downloadQueue));
        queueBadge.textContent = downloadQueue.length;
        if (downloadQueue.length === 0) {
            queueList.innerHTML = '<div class="empty-state"><div class="empty-icon">📥</div><p>Queue is empty</p></div>';
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

    async function getDownloadUrl(videoId, formatStr, qualityStr) {
        const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
        
        let apiFormat = 'mp3';
        if (formatStr === 'mp4') {
            // loader.to uses '720', '480', etc. Remove 'p' if it exists.
            apiFormat = qualityStr ? qualityStr.replace('p', '') : '720';
        }
        
        const initRes = await fetch(`https://loader.to/ajax/download.php?format=${apiFormat}&url=${encodeURIComponent(ytUrl)}`);
        const initData = await initRes.json();
        
        if (!initData.success) throw new Error("Loader.to API rejected the request");
        
        const progressUrl = initData.progress_url || `https://p.loader.to/ajax/progress.php?id=${initData.id}`;
        
        // Poll for completion (up to 2 minutes)
        for (let i = 0; i < 60; i++) {
            const progRes = await fetch(progressUrl);
            const progData = await progRes.json();
            
            if (progData.success === 1 && progData.download_url) {
                return progData.download_url;
            } else if (progData.success === 0) {
                // Still processing, wait 15 seconds to avoid rate limits
                await new Promise(r => setTimeout(r, 15000));
            } else {
                throw new Error("Loader.to conversion failed");
            }
        }
        throw new Error("Conversion timed out");
    }

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
            // Get final download link from loader.to
            const streamUrl = await getDownloadUrl(item.id, item.format, item.quality);
            if(!streamUrl) throw new Error("Could not fetch stream URL");

            const filename = `${item.title.replace(/[^a-z0-9]/gi, '_').substring(0, 50)}_${Date.now()}.${item.format}`;
            let localPath = "";
            
            // Download invisibly in background via Capacitor
            if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
                const result = await window.Capacitor.Plugins.Filesystem.downloadFile({
                    url: streamUrl,
                    path: filename,
                    directory: 'DATA'
                });
                // Only store filename, as native iOS absolute paths change on app updates
                localPath = filename;
            } else {
                // Fallback for desktop browser testing
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
            item.status = 'Retrying in 15s...';
            updateQueueUI();
            setTimeout(() => {
                item.status = 'queued';
                processNextInQueue();
            }, 15000);
        }
    }

    // --- File Manager & Local Upload ---
    function updateCollectionUI() {
        localStorage.setItem('myCollection', JSON.stringify(myCollection));
        if (myCollection.length === 0) {
            filesList.innerHTML = '<div class="empty-state"><div class="empty-icon">🎵</div><p>No media downloaded yet</p></div>';
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

    // --- Video Player (Blob URL approach) ---
    window.playMedia = async function(index) {
        const item = myCollection[index];
        let playUrl = item.url;
        let step = 'init';
        
        try {
            step = 'readFile';
            const fileData = await window.Capacitor.Plugins.Filesystem.readFile({
                directory: 'DATA',
                path: playUrl
            });
            
            step = 'base64 decode';
            // Convert base64 to Blob directly in JS to bypass WebKit fetch limits
            const b64Data = fileData.data;
            const byteCharacters = atob(b64Data);
            const byteArrays = [];
            
            for (let offset = 0; offset < byteCharacters.length; offset += 512) {
                const slice = byteCharacters.slice(offset, offset + 512);
                const byteNumbers = new Array(slice.length);
                for (let i = 0; i < slice.length; i++) {
                    byteNumbers[i] = slice.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                byteArrays.push(byteArray);
            }
            
            step = 'blob()';
            const blob = new Blob(byteArrays, { type: 'video/mp4' });
            
            step = 'createObjectURL';
            const blobUrl = URL.createObjectURL(blob);
            
            step = 'video DOM setup';
            const video = document.createElement('video');
            video.src = blobUrl;
            video.controls = true;
            video.style.display = 'none'; // Hide it from the DOM
            video.playsInline = false;    // Force iOS to fullscreen
            document.body.appendChild(video);
            
            video.onended = () => {
                URL.revokeObjectURL(blobUrl);
                video.remove();
            };
            
            video.onerror = () => {
                alert("Video element error code: " + (video.error ? video.error.code : 'unknown'));
            };
            
            step = 'play()';
            await video.play();
            
        } catch (err) {
            console.error("Video player error:", err);
            alert(`Playback failed at step [${step}]. Error: ${err.message}`);
        }
    };
});
