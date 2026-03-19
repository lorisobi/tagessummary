document.addEventListener('DOMContentLoaded', () => {
    fetchVideos();
});

async function fetchVideos() {
    const grid = document.getElementById('video-grid');
    const loading = document.getElementById('loading');

    try {
        const res = await fetch('/api/videos');
        if (!res.ok) throw new Error('API Error');
        const data = await res.json();
        const videos = data.videos || [];

        if (videos.length === 0) {
            loading.style.display = 'none';
            grid.innerHTML = '<p style="text-align: center; color: var(--text-secondary); grid-column: 1/-1; font-size: 1.2rem;">Noch keine Zusammenfassungen vorhanden. Bitte warte auf den nächsten Cronjob-Lauf.</p>';
        } else {
            loading.style.display = 'none';
            videos.forEach((video, index) => {
                grid.appendChild(createCard(video, index));
            });
        }
    } catch (error) {
        console.error(error);
        loading.innerHTML = '<p style="color: #ef4444;">Netzwerk- oder Serverfehler beim Laden der Nachrichten.</p>';
    }
}

function createCard(video, index) {
    const el = document.createElement('div');
    el.className = 'card';
    el.style.animation = `fadeUp 0.6s ease forwards ${index * 0.15}s`;
    el.style.opacity = '0';
    el.style.transform = 'translateY(30px)';
    
    // Parse Markdown roughly
    let htmlSummary = video.summary
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>');
    
    // Convert basic bullet points into UL
    htmlSummary = htmlSummary.replace(/^\s*[\-\*]\s+(.*)/gm, '<li>$1</li>');
    
    // Wrap consecutive LI's in UL (hacky but works for simple summaries)
    htmlSummary = htmlSummary.split('\n').filter(line => line.trim().length > 0).join('\n');
    htmlSummary = htmlSummary.replace(/(<li>.*<\/li>(\n<li>.*<\/li>)*)/g, '<ul>$&</ul>');

    // Remove stray newlines
    htmlSummary = htmlSummary.replace(/\n/g, '<br>');
    htmlSummary = htmlSummary.replace(/<br><ul>/g, '<ul>').replace(/<\/ul><br>/g, '</ul>');

    // Format date
    const date = new Date(video.published_at);
    // e.g. "Heute, 20:15" oder "18.03., 20:15"
    const today = new Date();
    const isToday = today.toDateString() === date.toDateString();
    
    const timeStr = date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const dateStr = isToday ? `Heute, ${timeStr} Uhr` : 
                    `${date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}, ${timeStr} Uhr`;

    const sourceLabel = video.source === 'tagesschau_api' ? 'Tagesschau 100s' : 'YouTube';
    const sourceClass = video.source === 'tagesschau_api' ? 'badge-api' : 'badge-yt';

    el.innerHTML = `
        <div class="card-meta">
            <div class="card-date">${dateStr}</div>
            <div class="badge ${sourceClass}">${sourceLabel}</div>
        </div>
        <h2 class="card-title">${video.title}</h2>
        <div class="card-summary">${htmlSummary}</div>
        <a href="${video.source === 'youtube' ? 'https://www.youtube.com/watch?v=' + video.video_id : 'https://www.tagesschau.de/'}" target="_blank" rel="noopener noreferrer" class="card-link">
            Beitrag ansehen
            <svg viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
        </a>
    `;
    return el;
}

// Add keyframes dynamically
const style = document.createElement('style');
style.textContent = `
    @keyframes fadeUp {
        to { opacity: 1; transform: translateY(0); }
    }
`;
document.head.appendChild(style);
