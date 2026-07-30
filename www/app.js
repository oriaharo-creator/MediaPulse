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

    async function getDownloadUrl(videoId, format, quality) {
        const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
        
        let errorLog = [];

        // STRATEGY 1: OceanSaver API (Very reliable for mobile/desktop, bypasses standard YouTube blocks)
        try {
            const osFormat = format === 'mp3' ? 'mp3' : '720';
            const res = await fetch(`https://p.oceansaver.in/ajax/download.php?format=${osFormat}&url=${encodeURIComponent(ytUrl)}`);
            if (res.ok) {
                const data = await res.json();
                if (data && data.success && data.id) {
                    // Poll for completion
                    for (let i = 0; i < 15; i++) {
                        await new Promise(r => setTimeout(r, 2000));
                        const progRes = await fetch(`https://p.oceansaver.in/ajax/progress.php?id=${data.id}`);
                        const progData = await progRes.json();
                        if (progData && progData.success && progData.progress === 1000 && progData.download_url) {
                            return progData.download_url;
                        }
                    }
                }
            }
        } catch(e) {
            errorLog.push("OSaver_Failed");
        }

        // STRATEGY 2: Dynamic Cobalt Instances
        let instancesToTry = [...COBALT_INSTANCES];
        try {
            const instancesRes = await fetch('https://instances.cobalt.best/api/instances');
            if (instancesRes.ok) {
                const data = await instancesRes.json();
                // Extremely lenient filter
                const validInstances = data.filter(i => i.cors === 1 && i.api_online);
                if (validInstances.length > 0) {
                    instancesToTry = validInstances.slice(0, 8).map(i => 'https://' + i.domain);
                }
            }
        } catch(e) {
            errorLog.push("DynamicFetch_Failed");
        }

        for (let instance of instancesToTry) {
            try {
                // Try Cobalt v10 endpoint first
                let res = await fetch(instance, {
                    method: 'POST',
                    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        url: ytUrl,
                        aFormat: format === 'mp3' ? 'mp3' : 'best',
                        vQuality: quality.replace('p', ''),
                        isAudioOnly: format === 'mp3'
                    })
                });
                
                // If 404, it might be a v7 instance, so try /api/json
                if (res.status === 404) {
                    res = await fetch(instance + '/api/json', {
                        method: 'POST',
                        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            url: ytUrl,
                            aFormat: format === 'mp3' ? 'mp3' : 'best',
                            vQuality: quality.replace('p', ''),
                            isAudioOnly: format === 'mp3'
                        })
                    });
                }
                
                if (res.ok) {
                    const data = await res.json();
                    if (data.url) return data.url;
                } else {
                    errorLog.push(`Cobalt_${res.status}`);
                }
            } catch (e) {
                errorLog.push(`Cobalt_Error`);
            }
        }
        
        // STRATEGY 3: Invidious
        try {
            const res = await fetch(`https://invidious.jing.rocks/api/v1/videos/${videoId}`);
            if (res.ok) {
                const data = await res.json();
                if (format === 'mp3') {
                    const audioStream = data.adaptiveFormats.find(f => f.type && f.type.includes('audio'));
                    if (audioStream) return audioStream.url;
                } else {
                    let videoStream = data.formatStreams.find(f => f.resolution && f.resolution.includes(quality));
                    return videoStream ? videoStream.url : data.formatStreams[0].url;
                }
            } else {
                errorLog.push(`Invidious_${res.status}`);
            }
        } catch(e) {
            errorLog.push("Invidious_Failed");
        }

        // STRATEGY 4: Dynamic Piped Instances (YouTube Viewing Tool API)
        try {
            const pipedRes = await fetch('https://api.piped.privacydev.net/instances');
            if (pipedRes.ok) {
                const instances = await pipedRes.json();
                // Filter for active API instances
                const validPiped = instances.filter(i => i.type === 'api' || i.api_url);
                const pipedApis = validPiped.slice(0, 5).map(i => i.api_url || i.url);
                
                for (let apiUrl of pipedApis) {
                    try {
                        const streamRes = await fetch(`${apiUrl}/streams/${videoId}`);
                        if (streamRes.ok) {
                            const data = await streamRes.json();
                            if (format === 'mp3' && data.audioStreams && data.audioStreams.length > 0) {
                                return data.audioStreams[0].url;
                            } else if (data.videoStreams && data.videoStreams.length > 0) {
                                // Find a stream with both video and audio, matching quality if possible
                                let validVideos = data.videoStreams.filter(v => v.videoOnly === false);
                                if (validVideos.length === 0) validVideos = data.videoStreams;
                                let targetVideo = validVideos.find(v => v.quality === quality) || validVideos[0];
                                return targetVideo.url;
                            }
                        } else {
                            errorLog.push(`Piped_${streamRes.status}`);
                        }
                    } catch (e) {
                        errorLog.push("PipedInst_Failed");
                    }
                }
            } else {
                errorLog.push(`PipedAPI_${pipedRes.status}`);
            }
        } catch(e) {
            errorLog.push("Piped_Failed");
        }

        // STRATEGY 5: Y2Mate AJAX API (Highly robust backend)
        try {
            const formData = new URLSearchParams();
            formData.append('k_query', ytUrl);
            formData.append('k_page', 'home');
            formData.append('hl', 'en');
            formData.append('q_auto', '0');
            
            const y2AnalyzeOptions = {
                url: 'https://www.y2mate.com/mates/analyzeV2/ajax',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                data: formData.toString()
            };
            const y2Analyze = await Capacitor.Plugins.CapacitorHttp.post(y2AnalyzeOptions);
            
            if (y2Analyze.status === 200) {
                const analyzeData = y2Analyze.data;
                const linkGroup = format === 'mp3' ? analyzeData.links?.mp3 : analyzeData.links?.mp4;
                if (linkGroup) {
                    const firstKey = Object.keys(linkGroup)[0];
                    const videoData = linkGroup[firstKey];
                    
                    const convertForm = new URLSearchParams();
                    convertForm.append('vid', analyzeData.vid);
                    convertForm.append('k', videoData.k);
                    
                    const y2ConvertOptions = {
                        url: 'https://www.y2mate.com/mates/convertV2/index',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        data: convertForm.toString()
                    };
                    const y2Convert = await Capacitor.Plugins.CapacitorHttp.post(y2ConvertOptions);
                    
                    if (y2Convert.status === 200) {
                        const convertData = y2Convert.data;
                        if (convertData.dlink) return convertData.dlink;
                    }
                }
            } else {
                errorLog.push(`Y2Mate_${y2Analyze.status}`);
            }
        } catch(e) {
            errorLog.push("Y2Mate_Failed");
        }

        throw new Error("API Blocked: " + errorLog.join(" | "));
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
