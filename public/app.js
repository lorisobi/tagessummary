const listEl = document.getElementById('article-list');
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error-msg');

async function loadVideos() {
    try {
        const res = await fetch('/api/videos');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const videos = await res.json();

        loadingEl.style.display = 'none';

        if (!videos.length) {
            errorEl.style.display = 'block';
            errorEl.textContent = 'Noch keine Beiträge vorhanden. Bitte später nochmal vorbeischauen.';
            return;
        }

        videos.forEach((video, i) => {
            const el = document.createElement('article');
            el.className = 'article-card';
            el.style.animationDelay = `${i * 60}ms`;

            // Format date
            const date = new Date(video.published_at);
            const now = new Date();
            const isToday = date.toDateString() === now.toDateString();
            const timeStr = date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
            const dateStr = isToday
                ? `Heute, ${timeStr} Uhr`
                : date.toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' });

            // Parse markdown-style bullets into HTML list
            const lines = (video.summary || '').split('\n').filter(l => l.trim());
            const listItems = lines
                .filter(l => l.trim().startsWith('-') || l.trim().startsWith('•') || l.trim().startsWith('*'))
                .map(l => `<li>${l.replace(/^[-•*]\s*/, '').trim()}</li>`);

            const summaryHtml = listItems.length
                ? `<ul>${listItems.join('')}</ul>`
                : `<p>${(video.summary || '').replace(/\*\*/g, '').trim()}</p>`;

            const sourceLabel = video.source === 'tagesschau_api' ? '100 Sek' : 'YouTube';

            const linkHref = video.source === 'youtube'
                ? `https://www.youtube.com/watch?v=${video.video_id}`
                : 'https://www.tagesschau.de/';

            el.innerHTML = `
                <div class="article-meta">
                    <span class="article-date">${dateStr}</span>
                    <span class="article-source">${sourceLabel}</span>
                </div>
                <h2 class="article-title">${video.title}</h2>
                <div class="article-summary">${summaryHtml}</div>
                <a href="${linkHref}" target="_blank" rel="noopener noreferrer" class="article-link">
                    Zum Beitrag
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M5 12h14M12 5l7 7-7 7"/>
                    </svg>
                </a>
            `;
            listEl.appendChild(el);
        });

    } catch (err) {
        loadingEl.style.display = 'none';
        errorEl.style.display = 'block';
        errorEl.textContent = `Fehler beim Laden der Beiträge: ${err.message}`;
    }
}

loadVideos();
