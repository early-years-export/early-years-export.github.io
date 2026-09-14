(function () {
    // 1. Verify we are on Tapestry
    if (!window.location.hostname.includes('tapestryjournal.com')) {
        alert("Please run this exporter while logged into tapestryjournal.com");
        return;
    }

    // 2. Create the UI Overlay
    const ui = document.createElement('div');
    Object.assign(ui.style, {
        position: 'fixed', top: '20px', right: '20px', width: '300px',
        padding: '15px', background: '#333', color: '#fff',
        zIndex: '999999', borderRadius: '8px', fontFamily: 'sans-serif',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
    });

    ui.innerHTML = `
        <h3 style="margin-top:0;">Tapestry Exporter</h3>
        <p style="font-size:0.9em; color:#ccc; margin-bottom: 15px;">Ready to download your timeline.</p>
        <button id="tapestry-start-btn" style="width:100%; padding:8px; background:#4CAF50; color:#fff; border:none; border-radius:4px; font-weight:bold; cursor:pointer;">Start Export</button>
        <div id="tapestry-status" style="margin-top:10px; font-size:0.9em;">Ready.</div>
    `;
    document.body.appendChild(ui);
    
    const status = document.getElementById('tapestry-status');
    const startBtn = document.getElementById('tapestry-start-btn');

    function log(msg) {
        console.log(msg);
        status.innerText = msg;
    }

    // 3. Extract CSRF Token (Tapestry requires this for API calls)
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';

    // 4. Load zip.js dynamically
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@zip.js/zip.js@2.7.34/dist/zip.min.js';
    document.head.appendChild(script);

    // 5. Main Execution
    script.onload = () => {
        startBtn.addEventListener('click', async () => {
            startBtn.disabled = true;
            startBtn.style.opacity = '0.5';

            try {
                log('Waiting for save location...');
                const handle = await window.showSaveFilePicker({
                    suggestedName: `Tapestry_Observations.zip`,
                    types: [{ description: 'ZIP Archive', accept: { 'application/zip': ['.zip'] } }]
                });

                const writable = await handle.createWritable();
                const zipWriter = new zip.ZipWriter(writable);

                let html = `<!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <title>Tapestry Learning Journal</title>
                    <style>
                        body { font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background:#f0f2f5; margin: 20px; color: #1c1e21; }
                        .masonry { column-count: 1; column-gap: 1.5em; max-width:850px; margin: 0 auto; }
                        .obs { background:#fff; padding:20px; margin-bottom:1.5em; border-radius:12px; box-shadow:0 2px 8px rgba(0,0,0,0.08); break-inside: avoid; }
                        .meta { font-size: 0.9em; color: #65676b; margin-bottom: 12px; border-bottom: 1px solid #eee; padding-bottom: 8px;}
                        .title { margin: 0 0 10px 0; color: #050505; font-size: 1.4em;}
                        .notes { white-space: pre-wrap; margin-bottom: 15px; line-height: 1.5; }
                        
                        /* Media Grid */
                        .media-grid { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 15px; }
                        .media-item { position: relative; height: 260px; cursor: pointer; border-radius: 8px; overflow: hidden; background: #000; }
                        .media-item img, .media-item video { height: 100%; width: auto; object-fit: cover; display: block; transition: transform 0.3s; }
                        .media-item:hover img, .media-item:hover video { transform: scale(1.03); opacity: 0.9; }
                        
                        /* Video Play Button Overlay */
                        .video-overlay {
                            position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
                            width: 55px; height: 55px; background: rgba(0,0,0,0.6); border-radius: 50%;
                            display: flex; align-items: center; justify-content: center; pointer-events: none;
                            border: 3px solid rgba(255,255,255,0.8); box-shadow: 0 4px 10px rgba(0,0,0,0.3);
                        }
                        .video-overlay::after {
                            content: ''; display: block; border-style: solid; border-width: 12px 0 12px 18px;
                            border-color: transparent transparent transparent #fff; margin-left: 6px;
                        }

                        /* Lightbox */
                        #lightbox { display: none; position: fixed; z-index: 999; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.95); align-items: center; justify-content: center; }
                        #lightbox-content { max-width: 95vw; max-height: 95vh; display: flex; align-items: center; justify-content: center;}
                        #lightbox-content img, #lightbox-content video { max-width: 100%; max-height: 95vh; border-radius: 4px; }
                        #lightbox-close { position: absolute; top: 20px; right: 30px; color: white; font-size: 40px; cursor: pointer; font-weight: bold; }
                    </style>
                </head>
                <body>
                    <div class="masonry">`;

                let nextCursor = null;
                let pageCount = 1;
                let childNameCaptured = false;
                
                const reqHeaders = {
                    'Accept': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                };
                if (csrfToken) reqHeaders['X-CSRF-TOKEN'] = csrfToken;

                do {
                    log(`Fetching timeline page ${pageCount}...`);
                    
                    // Build URL with cursor if it exists
                    let url = `/api/4/pages/threads-list?perPage=50`;
                    if (nextCursor) url += `&cursor=${encodeURIComponent(nextCursor)}`;

                    let res = await fetch(url, { headers: reqHeaders });
                    
                    if (!res.ok) {
                        log(`API Error: ${res.status}`);
                        break;
                    }

                    let rawJson = await res.text();
                    
                    // Backup JSON to ZIP
                    await zipWriter.add(`cache/page_${pageCount}.json`, new zip.TextReader(rawJson));

                    let apiResponse = JSON.parse(rawJson);
                    if (!apiResponse.pages || apiResponse.pages.length === 0) break;

                    // Capture child's name for the header (only needed once)
                    if (!childNameCaptured && apiResponse.pages[0].children && apiResponse.pages[0].children.length > 0) {
                        const childName = apiResponse.pages[0].children[0].fullName;
                        html = html.replace('<div class="masonry">', `<h1 style="text-align:center;">${childName}'s Tapestry Journal</h1><div class="masonry">`);
                        childNameCaptured = true;
                    }

                    for (let item of apiResponse.pages) {
                        let author = item.author?.fullName || 'Unknown';
                        let dateObj = new Date(item.createdAt);
                        let dateStr = dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

                        html += `<div class="obs">
                                    <div class="meta"><strong>${author}</strong> &bull; ${dateStr} &bull; ID: ${item.id}</div>
                                    ${item.title ? `<h2 class="title">${item.title}</h2>` : ''}
                                    ${item.notes ? `<div class="notes">${item.notes}</div>` : ''}`;

                        if (item.media && item.media.length > 0) {
                            html += `<div class="media-grid">`;
                            
                            for (let m of item.media) {
                                if (!m.url) continue;

                                let isVideo = m.type === 'video';
                                let extension = isVideo ? '.mp4' : '.jpg';
                                let fileName = `${item.id}_${m.id}${extension}`;
                                let relativePath = `cache/${fileName}`;

                                log(`Streaming ${fileName}...`);
                                
                                // Fetch media and stream straight to ZIP
                                let mediaRes = await fetch(m.url);
                                await zipWriter.add(relativePath, mediaRes.body);

                                if (isVideo) {
                                    html += `<div class="media-item" onclick="openLightbox('${relativePath}', true)">
                                                <video src="${relativePath}#t=0.1" preload="metadata" muted></video>
                                                <div class="video-overlay"></div>
                                             </div>`;
                                } else {
                                    html += `<div class="media-item" onclick="openLightbox('${relativePath}', false)">
                                                <img src="${relativePath}" />
                                             </div>`;
                                }
                            }
                            html += `</div>`;
                        }
                        html += `</div>`;
                    }

                    nextCursor = apiResponse.nextCursor;
                    pageCount++;
                    
                } while (nextCursor);

                html += `</div>
                    <div id="lightbox" onclick="closeLightbox()">
                        <span id="lightbox-close">&times;</span>
                        <div id="lightbox-content" onclick="event.stopPropagation()"></div>
                    </div>
                    <script>
                        function openLightbox(src, isVideo) {
                            const lb = document.getElementById('lightbox');
                            const content = document.getElementById('lightbox-content');
                            content.innerHTML = isVideo ? \`<video controls autoplay style="max-height:90vh;"><source src="\${src}" type="video/mp4"></video>\` : \`<img src="\${src}">\`;
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
                setTimeout(() => ui.remove(), 6000);

            } catch (err) {
                log('Error: ' + err.message);
                console.error(err);
                startBtn.disabled = false;
                startBtn.style.opacity = '1';
            }
        });
    };
})();
