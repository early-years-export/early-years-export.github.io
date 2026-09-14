(function () {
    // 1. Create the UI Overlay
    const ui = document.createElement('div');
    Object.assign(ui.style, {
        position: 'fixed', top: '20px', right: '20px', width: '400px',
        padding: '15px', background: '#333', color: '#fff',
        zIndex: '999999', borderRadius: '8px', fontFamily: 'sans-serif',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
    });

    let token = null;
    let childrenList = [];

    // 2. Extract Data from LocalStorage
    try {
        let persistRoot = localStorage.getItem('persist:root');
        if (persistRoot) {
            let rootObj = JSON.parse(persistRoot);
            let loginObj = JSON.parse(rootObj.login);
            let persistLoginObj = JSON.parse(rootObj.persistLogin);
            
            if (persistLoginObj && persistLoginObj.loginData && persistLoginObj.loginData.children) {
                childrenList = persistLoginObj.loginData.children.map(c => ({ id: c.childId, name: c.name }));
            }
            if (loginObj && loginObj.activeTokens && loginObj.activeTokens.instanceTokens) {
                let tokens = Object.values(loginObj.activeTokens.instanceTokens);
                if (tokens.length > 0) token = tokens[0];
            }
        }
    } catch (e) {
        console.error("EYLog Exporter Error:", e);
    }

    if (!token || childrenList.length === 0) {
        ui.innerHTML = '<h3>Observation Exporter</h3><div style="color:#ff6b6b;">Error: Could not find auth token or children data. Are you logged in?</div>';
        document.body.appendChild(ui);
        setTimeout(() => ui.remove(), 5000);
        return;
    }

    // 3. Render Dropdown UI
    let optionsHTML = childrenList.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    
    ui.innerHTML = `
        <h3 style="margin-top:0;">Observation Exporter</h3>
        <label style="display:block; margin-bottom:5px; font-size:0.9em;">Select Child:</label>
        <select id="eylog-child-select" style="width:100%; padding:5px; margin-bottom:10px; border-radius:4px; color:#333;">
            ${optionsHTML}
        </select>
        <button id="eylog-start-btn" style="width:100%; padding:8px; background:#ffcc00; color:#0033a0; border:none; border-radius:4px; font-weight:bold; cursor:pointer;">Start Export</button>
        <div id="eylog-status" style="margin-top:10px; font-size:0.9em;">Ready.</div>
    `;
    
    document.body.appendChild(ui);
    
    const status = document.getElementById('eylog-status');
    const startBtn = document.getElementById('eylog-start-btn');
    const childSelect = document.getElementById('eylog-child-select');

    function log(msg) {
        console.log(msg);
        status.innerText = msg;
    }

    // 4. Load zip.js
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@zip.js/zip.js@2.7.34/dist/zip.min.js';
    document.head.appendChild(script);

    // 5. Main Execution on Button Click
    script.onload = () => {
        startBtn.addEventListener('click', async () => {
            startBtn.disabled = true;
            childSelect.disabled = true;
            startBtn.style.opacity = '0.5';

            const childId = childSelect.value;
            const childNameRaw = childSelect.options[childSelect.selectedIndex].text;
            const childNameSafe = childNameRaw.replace(/[^a-zA-Z0-9]/g, '_');

            try {
                log('Waiting for save location...');
                const handle = await window.showSaveFilePicker({
                    suggestedName: `observations_${childNameSafe}_${childId}.zip`,
                    types: [{ description: 'ZIP Archive', accept: { 'application/zip': ['.zip'] } }]
                });

                const writable = await handle.createWritable();
                const zipWriter = new zip.ZipWriter(writable);

                // Base HTML string
                let html = `<!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <title>Observations - ${childNameRaw}</title>
                    <style>
                        body { font-family:sans-serif; background:#f4f4f4; margin: 20px; }
                        .masonry { column-count: 1; column-gap: 1em; max-width:800px; margin: 0 auto; }
                        .obs { background:#fff; padding:15px; margin-bottom:1em; border-radius:8px; box-shadow:0 2px 5px rgba(0,0,0,0.1); }
                        .meta { font-size: 0.85em; color: #666; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 5px;}
                        .media-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 15px; }
                        .media-grid img, .media-grid video { height: 240px; width: auto; object-fit: cover; border-radius: 4px; cursor: pointer;}
                        h4 { margin-bottom:2px; } 
                        p { margin-top:2px; white-space: pre-wrap; }
                        #lightbox { display: none; position: fixed; z-index: 999; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.9); align-items: center; justify-content: center; }
                        #lightbox-content { max-width: 90vw; max-height: 90vh; display: flex; align-items: center; justify-content: center;}
                        #lightbox-content img, #lightbox-content video { max-width: 100%; max-height: 90vh; }
                    </style>
                </head>
                <body>
                    <h1>Timeline Observations - ${childNameRaw}</h1>
                    <div class="masonry">`;

                let currentPage = 1;
                let lastPage = 1;
                const baseUrl = `https://eyparent-api.eylog.co.uk/api/parent-app/timeline/child/${childId}?activityType=OBSERVATION&page=`;

                do {
                    log(`Fetching page ${currentPage}...`);
                    let res = await fetch(baseUrl + currentPage, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    
                    let apiResponse = await res.json();
                    if (!apiResponse?.data?.timeline) break;
                    
                    lastPage = apiResponse.data.pagination.lastPage;

                    for (let item of apiResponse.data.timeline) {
                        if (!item.details) continue;

                        let author = item.details.observationBy?.name || 'Unknown';
                        html += `<div class="obs"><div class="meta"><strong>${author}</strong> &bull; ${item.timestamp} &bull; ID: ${item.id}</div>`;

                        let content = item.details.content;
                        if (content) {
                            ['fieldOne', 'fieldTwo', 'fieldThree', 'fieldFour'].forEach(f => {
                                if (content[f]?.value) {
                                    html += `<h4>${content[f].label}</h4><p>${content[f].value}</p>`;
                                }
                            });
                        }

                        if (item.details.media && item.details.media.length > 0) {
                            html += `<div class="media-grid">`;
                            for (let mediaContainer of item.details.media) {
                                let media = mediaContainer.media;
                                if (!media?.url) continue;

                                let isVideo = media.contentType === 'video';
                                let extension = isVideo ? '.mp4' : '.png';
                                let fileName = `${item.id}_${mediaContainer.id}${extension}`;
                                let relativePath = `cache/${fileName}`;

                                log(`Streaming ${fileName}...`);
                                
                                // Fetch media WITHOUT the Bearer token to avoid CloudFront CORS blocks
                                let mediaRes = await fetch(media.url);
                                await zipWriter.add(relativePath, mediaRes.body);

                                if (isVideo) {
                                    html += `<video src="${relativePath}" onclick="openLightbox('${relativePath}', true)" muted loop></video>`;
                                } else {
                                    html += `<img src="${relativePath}" onclick="openLightbox('${relativePath}', false)" />`;
                                }
                            }
                            html += `</div>`;
                        }
                        html += `</div>`;
                    }
                    currentPage++;
                } while (currentPage <= lastPage);

                html += `</div>
                    <div id="lightbox" onclick="closeLightbox()">
                        <div id="lightbox-content" onclick="event.stopPropagation()"></div>
                    </div>
                    <script>
                        function openLightbox(src, isVideo) {
                            const lb = document.getElementById('lightbox');
                            const content = document.getElementById('lightbox-content');
                            content.innerHTML = isVideo ? \`<video controls autoplay><source src="\${src}" type="video/mp4"></video>\` : \`<img src="\${src}">\`;
                            lb.style.display = 'flex';
                        }
                        function closeLightbox() {
                            document.getElementById('lightbox').style.display = 'none';
                            document.getElementById('lightbox-content').innerHTML = '';
                        }
                    </script>
                </body>
                </html>`;

                log('Writing HTML index...');
                await zipWriter.add('index.html', new zip.TextReader(html));

                log('Finalizing ZIP file...');
                await zipWriter.close();

                log('Done! You can now extract your ZIP.');
                setTimeout(() => ui.remove(), 5000);

            } catch (err) {
                log('Error: ' + err.message);
                console.error(err);
                startBtn.disabled = false;
                childSelect.disabled = false;
                startBtn.style.opacity = '1';
            }
        });
    };
})();
