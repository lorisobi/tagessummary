const listEl = document.getElementById('article-list');
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error-msg');

let allVideos = [];

async function loadVideos() {
    try {
        const res = await fetch('/api/videos');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        
        allVideos = json.videos || [];
        loadingEl.style.display = 'none';

        if (!allVideos.length) {
            errorEl.style.display = 'block';
            errorEl.textContent = 'Noch keine Beiträge vorhanden. Bitte später nochmal vorbeischauen.';
            return;
        }

        renderVideos(allVideos);
    } catch (err) {
        loadingEl.style.display = 'none';
        errorEl.style.display = 'block';
        errorEl.textContent = `Fehler beim Laden der Beiträge: ${err.message}`;
    }
}

function renderVideos(videos) {
    listEl.innerHTML = '';
    
    if (videos.length === 0) {
        listEl.innerHTML = '<p class="no-results">In dieser Kategorie wurden keine Beiträge gefunden.</p>';
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

        // Robust Markdown-to-HTML algorithm
        const parseMarkdown = (text) => {
            let html = text || '';
            html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            const lines = html.split('\n');
            let inList = false;
            const processedLines = [];
            lines.forEach(line => {
                const trimmed = line.trim();
                if (!trimmed) {
                    if (inList) { processedLines.push('</ul>'); inList = false; }
                    return;
                }
                if (trimmed === '---') {
                    if (inList) { processedLines.push('</ul>'); inList = false; }
                    processedLines.push('<hr>');
                    return;
                }
                if (trimmed.startsWith('###')) {
                    if (inList) { processedLines.push('</ul>'); inList = false; }
                    processedLines.push(`<h3>${trimmed.replace(/^###\s*/, '')}</h3>`);
                    return;
                }
                const isBullet = trimmed.match(/^[-*•]\s*/);
                if (isBullet) {
                    if (!inList) { processedLines.push('<ul>'); inList = true; }
                    processedLines.push(`<li>${trimmed.replace(/^[-*•]\s*/, '')}</li>`);
                } else {
                    if (inList) { processedLines.push('</ul>'); inList = false; }
                    processedLines.push(`<p>${trimmed}</p>`);
                }
            });
            if (inList) processedLines.push('</ul>');
            return processedLines.join('\n');
        };

        const summaryHtml = parseMarkdown(video.summary);
        const linkHref = video.url || 'https://www.tagesschau.de/';

        const transcriptHtml = video.transcript 
            ? `<div class="article-transcript">
                <details>
                    <summary>Wörtliches Transkript anzeigen</summary>
                    <p>${video.transcript.replace(/\n/g, '<br>')}</p>
                </details>
               </div>`
            : '';

        // Badge Mapping
        let badgeText = '';
        if (video.program === '100s') badgeText = '100 Sek';
        else if (video.program === '20uhr') badgeText = '20 Uhr';
        else if (video.program === 'tt') badgeText = 'Tagesthemen';
        else if (video.program === 'standard') badgeText = 'Tagesschau';
        else if (video.source === 'youtube') badgeText = 'YouTube';
        
        const badgeHtml = badgeText ? `<span class="article-badge">${badgeText}</span>` : '';

        el.innerHTML = `
            <div class="article-meta">
                <span class="article-date">${dateStr}</span>
                ${badgeHtml}
            </div>
            <h2 class="article-title">${video.title}</h2>
            <div class="article-summary">${summaryHtml}</div>
            ${transcriptHtml}
            <a href="${linkHref}" target="_blank" rel="noopener noreferrer" class="article-link">
                Zum Beitrag
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
            </a>
        `;
        listEl.appendChild(el);
    });
}

// Filter functionality
const filterButtons = document.querySelectorAll('.filter-btn');
filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const filter = btn.getAttribute('data-filter');
        
        // Update UI
        filterButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Filter videos
        if (filter === 'all') {
            renderVideos(allVideos);
        } else {
            const filtered = allVideos.filter(v => v.program === filter);
            renderVideos(filtered);
        }
    });
});

loadVideos();

// Reload button functionality
const reloadBtn = document.getElementById('reload-btn');
if (reloadBtn) {
    reloadBtn.addEventListener('click', () => {
        // Simple visual feedback
        reloadBtn.style.opacity = '0.5';
        reloadBtn.disabled = true;
        location.reload();
    });
}

// Back to top functionality
const backToTopBtn = document.getElementById('back-to-top');
const logoTop = document.getElementById('logo-top');

const scrollToTop = () => {
    window.scrollTo({
        top: 0,
        behavior: 'smooth'
    });
};

if (backToTopBtn) {
    window.addEventListener('scroll', () => {
        if (window.scrollY > 300) {
            backToTopBtn.classList.add('visible');
        } else {
            backToTopBtn.classList.remove('visible');
        }
    });

    backToTopBtn.addEventListener('click', scrollToTop);
}

if (logoTop) {
    logoTop.addEventListener('click', scrollToTop);
}
