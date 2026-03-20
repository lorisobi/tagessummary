const listEl = document.getElementById('article-list');
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error-msg');

async function loadVideos() {
    try {
        const res = await fetch('/api/videos');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        console.log('[app.js] API response:', json);
        const videos = json.videos || [];
        console.log('[app.js] Videos count:', videos.length);

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

            // Robust Markdown-to-HTML algorithm for basic summary formatting
            const parseMarkdown = (text) => {
                let html = text || '';
                
                // 1. Handle bold (**text**)
                html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

                const lines = html.split('\n');
                let inList = false;
                const processedLines = [];
                
                lines.forEach(line => {
                    const trimmed = line.trim();
                    if (!trimmed) {
                        if (inList) {
                            processedLines.push('</ul>');
                            inList = false;
                        }
                        return;
                    }

                    // 2. Handle horizontal rules (---)
                    if (trimmed === '---') {
                        if (inList) {
                            processedLines.push('</ul>');
                            inList = false;
                        }
                        processedLines.push('<hr>');
                        return;
                    }

                    // 3. Handle headers (###)
                    if (trimmed.startsWith('###')) {
                        if (inList) {
                            processedLines.push('</ul>');
                            inList = false;
                        }
                        processedLines.push(`<h3>${trimmed.replace(/^###\s*/, '')}</h3>`);
                        return;
                    }
                    
                    // 4. Handle lists (lines starting with -, *, •)
                    const isBullet = trimmed.match(/^[-*•]\s*/);
                    if (isBullet) {
                        if (!inList) {
                            processedLines.push('<ul>');
                            inList = true;
                        }
                        processedLines.push(`<li>${trimmed.replace(/^[-*•]\s*/, '')}</li>`);
                    } else {
                        if (inList) {
                            processedLines.push('</ul>');
                            inList = false;
                        }
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

            el.innerHTML = `
                <div class="article-meta">
                    <span class="article-date">${dateStr}</span>
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

    } catch (err) {
        loadingEl.style.display = 'none';
        errorEl.style.display = 'block';
        errorEl.textContent = `Fehler beim Laden der Beiträge: ${err.message}`;
    }
}

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
