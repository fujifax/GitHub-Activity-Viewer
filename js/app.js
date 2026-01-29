/* ===== Constants ===== */
const GITHUB_API = 'https://api.github.com';
const GITHUB_GRAPHQL = 'https://api.github.com/graphql';
const CACHE_DURATION = 5 * 60 * 1000;
const REPOS_PER_PAGE = 10;

const LANGUAGE_COLORS = {
    JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5', Java: '#b07219',
    'C++': '#f34b7d', C: '#555555', 'C#': '#178600', Go: '#00ADD8', Rust: '#dea584',
    Ruby: '#701516', PHP: '#4F5D95', Swift: '#F05138', Kotlin: '#A97BFF', Dart: '#00B4AB',
    Scala: '#c22d40', Shell: '#89e051', HTML: '#e34c26', CSS: '#563d7c', SCSS: '#c6538c',
    Vue: '#41b883', Svelte: '#ff3e00', Lua: '#000080', R: '#198CE7', MATLAB: '#e16737',
    Perl: '#0298c3', Haskell: '#5e5086', Elixir: '#6e4a7e', Clojure: '#db5855',
    Objective_C: '#438eff', Vim_Script: '#199f4b', Jupyter_Notebook: '#DA5B0B',
    TeX: '#3D6117', PowerShell: '#012456', Dockerfile: '#384d54', Makefile: '#427819',
};

const EVENT_ICONS = {
    PushEvent: '📝', CreateEvent: '🆕', DeleteEvent: '🗑️', ForkEvent: '🍴',
    IssuesEvent: '🔖', IssueCommentEvent: '💬', PullRequestEvent: '🔀',
    PullRequestReviewEvent: '👀', WatchEvent: '⭐', ReleaseEvent: '🚀',
    PublicEvent: '🌐', MemberEvent: '👥',
};

const EVENT_LABELS = {
    PushEvent: 'プッシュ', CreateEvent: '作成', DeleteEvent: '削除',
    ForkEvent: 'フォーク', IssuesEvent: 'Issue', IssueCommentEvent: 'コメント',
    PullRequestEvent: 'PR', PullRequestReviewEvent: 'レビュー',
    WatchEvent: 'スター', ReleaseEvent: 'リリース',
    PublicEvent: '公開', MemberEvent: 'メンバー',
};

/* ===== Cache Manager ===== */
class CacheManager {
    constructor() {
        this.prefix = 'ghav_';
    }

    get(key) {
        try {
            const raw = localStorage.getItem(this.prefix + key);
            if (!raw) return null;
            const { data, timestamp } = JSON.parse(raw);
            if (Date.now() - timestamp > CACHE_DURATION) {
                localStorage.removeItem(this.prefix + key);
                return null;
            }
            return data;
        } catch {
            return null;
        }
    }

    set(key, data) {
        try {
            localStorage.setItem(this.prefix + key, JSON.stringify({ data, timestamp: Date.now() }));
        } catch { /* quota exceeded */ }
    }

    getTimestamp(key) {
        try {
            const raw = localStorage.getItem(this.prefix + key);
            if (!raw) return null;
            return JSON.parse(raw).timestamp;
        } catch {
            return null;
        }
    }

    clear() {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k.startsWith(this.prefix)) keys.push(k);
        }
        keys.forEach(k => localStorage.removeItem(k));
    }
}

/* ===== GitHub API ===== */
class GitHubAPI {
    constructor(token = '') {
        this.token = token;
        this.rateLimit = null;
    }

    get headers() {
        const h = { Accept: 'application/vnd.github.v3+json' };
        if (this.token) h.Authorization = `Bearer ${this.token}`;
        return h;
    }

    async fetch(url) {
        const res = await fetch(url, { headers: this.headers });
        this.rateLimit = {
            limit: res.headers.get('X-RateLimit-Limit'),
            remaining: res.headers.get('X-RateLimit-Remaining'),
            reset: res.headers.get('X-RateLimit-Reset'),
        };
        if (!res.ok) {
            if (res.status === 404) throw new Error('ユーザーが見つかりません');
            if (res.status === 403) throw new Error('APIレート制限に達しました。トークンを設定してください。');
            throw new Error(`API エラー (${res.status})`);
        }
        return res.json();
    }

    async getUser(username) {
        return this.fetch(`${GITHUB_API}/users/${username}`);
    }

    async getAllRepos(username) {
        let page = 1;
        let allRepos = [];
        while (true) {
            const repos = await this.fetch(
                `${GITHUB_API}/users/${username}/repos?per_page=100&page=${page}&sort=updated`
            );
            allRepos = allRepos.concat(repos);
            if (repos.length < 100) break;
            page++;
            if (page > 10) break; // safety limit
        }
        return allRepos;
    }

    async getEvents(username) {
        let allEvents = [];
        for (let page = 1; page <= 3; page++) {
            try {
                const events = await this.fetch(
                    `${GITHUB_API}/users/${username}/events/public?per_page=100&page=${page}`
                );
                allEvents = allEvents.concat(events);
                if (events.length < 100) break;
            } catch {
                break;
            }
        }
        return allEvents;
    }

    async getContributions(username) {
        if (!this.token) return null;
        const query = `query($username: String!) {
            user(login: $username) {
                contributionsCollection {
                    contributionCalendar {
                        totalContributions
                        weeks {
                            contributionDays {
                                contributionCount
                                date
                            }
                        }
                    }
                }
            }
        }`;

        const res = await fetch(GITHUB_GRAPHQL, {
            method: 'POST',
            headers: { ...this.headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, variables: { username } }),
        });

        if (!res.ok) return null;
        const json = await res.json();
        return json?.data?.user?.contributionsCollection?.contributionCalendar || null;
    }
}

/* ===== Heatmap Renderer ===== */
class HeatmapRenderer {
    constructor(container) {
        this.container = container;
        this.tooltip = null;
        this.createTooltip();
    }

    createTooltip() {
        this.tooltip = document.createElement('div');
        this.tooltip.className = 'heatmap-tooltip';
        document.body.appendChild(this.tooltip);
    }

    render(data) {
        // data: { [dateStr]: count } or contribution calendar object
        const cellSize = 13;
        const cellGap = 3;
        const totalSize = cellSize + cellGap;
        const labelOffset = 30;
        const topOffset = 20;

        const today = new Date();
        const oneYearAgo = new Date(today);
        oneYearAgo.setFullYear(today.getFullYear() - 1);
        oneYearAgo.setDate(oneYearAgo.getDate() + 1);

        // Align to Sunday
        const startDate = new Date(oneYearAgo);
        startDate.setDate(startDate.getDate() - startDate.getDay());

        // Build date array
        const days = [];
        const d = new Date(startDate);
        while (d <= today) {
            days.push(new Date(d));
            d.setDate(d.getDate() + 1);
        }

        const weeks = Math.ceil(days.length / 7);
        const svgWidth = weeks * totalSize + labelOffset + 10;
        const svgHeight = 7 * totalSize + topOffset + 10;

        // Find max for level calculation
        const counts = days.map(day => {
            const key = this.formatDate(day);
            return data[key] || 0;
        });
        const maxCount = Math.max(...counts, 1);

        // Build SVG
        let svg = `<svg width="${svgWidth}" height="${svgHeight}" xmlns="http://www.w3.org/2000/svg">`;

        // Month labels
        const months = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
        let lastMonth = -1;
        days.forEach((day, i) => {
            const week = Math.floor(i / 7);
            if (day.getMonth() !== lastMonth && day.getDay() <= 3) {
                lastMonth = day.getMonth();
                const x = labelOffset + week * totalSize;
                svg += `<text x="${x}" y="12" class="heatmap-month-label">${months[day.getMonth()]}</text>`;
            }
        });

        // Day labels
        const dayLabels = ['', '月', '', '水', '', '金', ''];
        dayLabels.forEach((label, i) => {
            if (label) {
                const y = topOffset + i * totalSize + cellSize - 2;
                svg += `<text x="0" y="${y}" class="heatmap-day-label">${label}</text>`;
            }
        });

        // Cells
        days.forEach((day, i) => {
            const week = Math.floor(i / 7);
            const dayOfWeek = i % 7;
            const x = labelOffset + week * totalSize;
            const y = topOffset + dayOfWeek * totalSize;
            const key = this.formatDate(day);
            const count = data[key] || 0;
            const level = this.getLevel(count, maxCount);
            const color = this.getLevelColor(level);

            svg += `<rect class="heatmap-cell-rect" x="${x}" y="${y}" width="${cellSize}" height="${cellSize}"
                     fill="${color}" data-date="${key}" data-count="${count}"
                     data-tip="${key}: ${count}回のコントリビューション"/>`;
        });

        svg += '</svg>';
        this.container.innerHTML = svg;

        // Tooltip events
        this.container.querySelectorAll('.heatmap-cell-rect').forEach(rect => {
            rect.addEventListener('mouseenter', (e) => {
                this.tooltip.textContent = e.target.dataset.tip;
                this.tooltip.classList.add('visible');
            });
            rect.addEventListener('mousemove', (e) => {
                this.tooltip.style.left = e.clientX + 10 + 'px';
                this.tooltip.style.top = e.clientY - 30 + 'px';
            });
            rect.addEventListener('mouseleave', () => {
                this.tooltip.classList.remove('visible');
            });
        });
    }

    getLevel(count, max) {
        if (count === 0) return 0;
        const ratio = count / max;
        if (ratio <= 0.25) return 1;
        if (ratio <= 0.5) return 2;
        if (ratio <= 0.75) return 3;
        return 4;
    }

    getLevelColor(level) {
        const style = getComputedStyle(document.documentElement);
        return style.getPropertyValue(`--heatmap-${level}`).trim();
    }

    formatDate(date) {
        return date.toISOString().split('T')[0];
    }
}

/* ===== Utility Functions ===== */
function formatNumber(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toString();
}

function formatDate(dateStr) {
    const d = new Date(dateStr);
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function timeAgo(dateStr) {
    const now = new Date();
    const date = new Date(dateStr);
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);

    if (minutes < 1) return 'たった今';
    if (minutes < 60) return `${minutes}分前`;
    if (hours < 24) return `${hours}時間前`;
    if (days < 7) return `${days}日前`;
    if (weeks < 5) return `${weeks}週間前`;
    if (months < 12) return `${months}ヶ月前`;
    return `${years}年前`;
}

function getLangColor(lang) {
    return LANGUAGE_COLORS[lang] || LANGUAGE_COLORS[lang?.replace(/[ -]/g, '_')] || '#8b8b8b';
}

/* ===== Main App ===== */
class App {
    constructor() {
        this.api = new GitHubAPI();
        this.cache = new CacheManager();
        this.heatmap = null;
        this.languageChart = null;

        this.currentUser = null;
        this.userData = null;
        this.repos = [];
        this.events = [];
        this.contributions = null;

        this.displayedRepos = 0;
        this.filteredRepos = [];

        this.settings = this.loadSettings();
        this.init();
    }

    /* ----- Initialization ----- */
    init() {
        this.applyTheme();
        this.bindEvents();

        // Check URL hash
        const hash = window.location.hash.slice(1);
        if (hash) {
            document.getElementById('search-input').value = hash;
            this.search(hash);
        }
    }

    bindEvents() {
        // Search
        document.getElementById('search-btn').addEventListener('click', () => {
            const val = document.getElementById('search-input').value.trim();
            if (val) this.search(val);
        });

        document.getElementById('search-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const val = e.target.value.trim();
                if (val) this.search(val);
            }
        });

        // Suggestions
        document.querySelectorAll('.suggestion-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const user = btn.dataset.user;
                document.getElementById('search-input').value = user;
                this.search(user);
            });
        });

        // Theme toggle
        document.getElementById('theme-toggle').addEventListener('click', () => this.toggleTheme());

        // Settings
        document.getElementById('settings-btn').addEventListener('click', () => this.openModal('settings-modal'));
        document.getElementById('save-settings').addEventListener('click', () => this.saveSettings());
        document.getElementById('toggle-token').addEventListener('click', () => {
            const input = document.getElementById('token-input');
            const btn = document.getElementById('toggle-token');
            if (input.type === 'password') {
                input.type = 'text';
                btn.textContent = '隠す';
            } else {
                input.type = 'password';
                btn.textContent = '表示';
            }
        });
        document.getElementById('clear-cache-btn').addEventListener('click', () => {
            this.cache.clear();
            alert('キャッシュをクリアしました');
        });

        // Compare
        document.getElementById('compare-btn').addEventListener('click', () => this.openModal('compare-modal'));
        document.getElementById('compare-start').addEventListener('click', () => this.startCompare());

        // Modal close
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', () => {
                const modalId = btn.dataset.modal;
                if (modalId) this.closeModal(modalId);
            });
        });
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', () => {
                overlay.closest('.modal').classList.add('hidden');
            });
        });

        // Keyboard
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal:not(.hidden)').forEach(m => m.classList.add('hidden'));
            }
        });

        // Filter & Sort
        document.getElementById('filter-language').addEventListener('change', () => this.applyFiltersAndSort());
        document.getElementById('sort-repos').addEventListener('change', () => this.applyFiltersAndSort());
        document.getElementById('repo-search').addEventListener('input', () => this.applyFiltersAndSort());

        // Load more
        document.getElementById('load-more-repos').addEventListener('click', () => this.showMoreRepos());

        // Refresh
        document.getElementById('refresh-btn').addEventListener('click', () => {
            if (this.currentUser) {
                this.cache.clear();
                this.search(this.currentUser);
            }
        });

        // Avatar click
        document.getElementById('profile-avatar').addEventListener('click', () => {
            if (this.userData) {
                document.getElementById('avatar-large').src = this.userData.avatar_url;
                this.openModal('avatar-modal');
            }
        });

        // Export
        document.getElementById('export-png-btn').addEventListener('click', () => this.exportPNG());
        document.getElementById('export-json-btn').addEventListener('click', () => this.exportJSON());
    }

    /* ----- Search ----- */
    async search(username) {
        this.currentUser = username;
        window.location.hash = username;

        this.showSection('loading');

        try {
            // Check cache
            const cachedUser = this.cache.get(`user_${username}`);
            const cachedRepos = this.cache.get(`repos_${username}`);
            const cachedEvents = this.cache.get(`events_${username}`);
            const cachedContrib = this.cache.get(`contrib_${username}`);

            // Fetch in parallel what's not cached
            const promises = [];

            if (cachedUser) {
                this.userData = cachedUser;
            } else {
                promises.push(
                    this.api.getUser(username).then(d => {
                        this.userData = d;
                        this.cache.set(`user_${username}`, d);
                    })
                );
            }

            if (cachedRepos) {
                this.repos = cachedRepos;
            } else {
                promises.push(
                    this.api.getAllRepos(username).then(d => {
                        this.repos = d;
                        this.cache.set(`repos_${username}`, d);
                    })
                );
            }

            if (cachedEvents) {
                this.events = cachedEvents;
            } else {
                promises.push(
                    this.api.getEvents(username).then(d => {
                        this.events = d;
                        this.cache.set(`events_${username}`, d);
                    })
                );
            }

            if (cachedContrib) {
                this.contributions = cachedContrib;
            } else {
                promises.push(
                    this.api.getContributions(username).then(d => {
                        this.contributions = d;
                        if (d) this.cache.set(`contrib_${username}`, d);
                    })
                );
            }

            await Promise.all(promises);

            // Render
            this.renderAll();
            this.showSection('app-content');
            this.updateCacheInfo(username);

        } catch (err) {
            this.showError(err.message);
        }
    }

    /* ----- Rendering ----- */
    renderAll() {
        this.renderProfile();
        this.renderStats();
        this.renderLanguages();
        this.renderActivity();
        this.renderHeatmap();
        this.renderRepos();
        this.applyVisibility();
    }

    renderProfile() {
        const u = this.userData;
        document.getElementById('profile-avatar').src = u.avatar_url;
        document.getElementById('profile-name').textContent = u.name || u.login;
        document.getElementById('profile-login').textContent = `@${u.login}`;
        document.getElementById('profile-bio').textContent = u.bio || '';
        document.getElementById('followers-count').textContent = formatNumber(u.followers);
        document.getElementById('following-count').textContent = formatNumber(u.following);
        document.getElementById('github-link').href = u.html_url;

        // Optional fields
        this.setDetail('profile-company', 'company-text', u.company);
        this.setDetail('profile-location', 'location-text', u.location);

        if (u.blog) {
            document.getElementById('profile-blog').classList.remove('hidden');
            const blogLink = document.getElementById('blog-link');
            const url = u.blog.startsWith('http') ? u.blog : `https://${u.blog}`;
            blogLink.href = url;
            blogLink.textContent = u.blog;
        } else {
            document.getElementById('profile-blog').classList.add('hidden');
        }

        if (u.twitter_username) {
            document.getElementById('profile-twitter').classList.remove('hidden');
            document.getElementById('twitter-text').textContent = u.twitter_username;
            document.getElementById('twitter-link').href = `https://twitter.com/${u.twitter_username}`;
        } else {
            document.getElementById('profile-twitter').classList.add('hidden');
        }
    }

    setDetail(wrapperId, textId, value) {
        const wrapper = document.getElementById(wrapperId);
        if (value) {
            wrapper.classList.remove('hidden');
            document.getElementById(textId).textContent = value;
        } else {
            wrapper.classList.add('hidden');
        }
    }

    renderStats() {
        const u = this.userData;
        const totalStars = this.repos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0);
        const totalForks = this.repos.reduce((sum, r) => sum + (r.forks_count || 0), 0);

        document.getElementById('stat-repos').textContent = formatNumber(u.public_repos);
        document.getElementById('stat-stars').textContent = formatNumber(totalStars);
        document.getElementById('stat-forks').textContent = formatNumber(totalForks);
        document.getElementById('stat-gists').textContent = formatNumber(u.public_gists);
        document.getElementById('stat-created').textContent = formatDate(u.created_at);
    }

    renderLanguages() {
        const langMap = {};
        this.repos.forEach(r => {
            if (r.language) {
                langMap[r.language] = (langMap[r.language] || 0) + (r.size || 1);
            }
        });

        const sorted = Object.entries(langMap).sort((a, b) => b[1] - a[1]);
        const top = sorted.slice(0, 8);
        const total = sorted.reduce((s, [, v]) => s + v, 0);

        // Destroy old chart
        if (this.languageChart) {
            this.languageChart.destroy();
            this.languageChart = null;
        }

        if (top.length === 0) {
            document.getElementById('language-chart').style.display = 'none';
            document.getElementById('language-legend').innerHTML = '<p style="color:var(--color-text-secondary);font-size:13px;">言語データなし</p>';
            return;
        }

        document.getElementById('language-chart').style.display = 'block';

        const labels = top.map(([l]) => l);
        const data = top.map(([, v]) => v);
        const colors = top.map(([l]) => getLangColor(l));

        const ctx = document.getElementById('language-chart').getContext('2d');
        this.languageChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: colors,
                    borderWidth: 2,
                    borderColor: getComputedStyle(document.documentElement).getPropertyValue('--color-card-bg').trim(),
                    hoverBorderWidth: 0,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                cutout: '65%',
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const pct = ((ctx.parsed / total) * 100).toFixed(1);
                                return `${ctx.label}: ${pct}%`;
                            },
                        },
                    },
                },
            },
        });

        // Legend
        const legendEl = document.getElementById('language-legend');
        legendEl.innerHTML = top.map(([lang, val]) => {
            const pct = ((val / total) * 100).toFixed(1);
            return `<div class="language-legend-item" data-lang="${lang}">
                <span class="language-legend-left">
                    <span class="language-dot" style="background:${getLangColor(lang)}"></span>
                    <span class="language-name">${lang}</span>
                </span>
                <span class="language-percent">${pct}%</span>
            </div>`;
        }).join('');

        // Click to filter repos by language
        legendEl.querySelectorAll('.language-legend-item').forEach(item => {
            item.addEventListener('click', () => {
                const lang = item.dataset.lang;
                document.getElementById('filter-language').value = lang;
                this.applyFiltersAndSort();
                document.getElementById('repos-list').scrollIntoView({ behavior: 'smooth' });
            });
        });

        // Populate language filter
        const filterSelect = document.getElementById('filter-language');
        const currentVal = filterSelect.value;
        filterSelect.innerHTML = '<option value="">すべての言語</option>';
        sorted.forEach(([lang]) => {
            const opt = document.createElement('option');
            opt.value = lang;
            opt.textContent = lang;
            filterSelect.appendChild(opt);
        });
        filterSelect.value = currentVal;
    }

    renderActivity() {
        const events = this.events;
        const commits = events
            .filter(e => e.type === 'PushEvent')
            .reduce((sum, e) => sum + (e.payload?.commits?.length || 0), 0);

        document.getElementById('activity-events').textContent = formatNumber(events.length);
        document.getElementById('activity-commits').textContent = formatNumber(commits);

        // Recent activity list
        const recentEl = document.getElementById('recent-activity');
        const recent = events.slice(0, 8);
        recentEl.innerHTML = recent.map(e => {
            const icon = EVENT_ICONS[e.type] || '📌';
            const label = EVENT_LABELS[e.type] || e.type.replace('Event', '');
            const repo = e.repo?.name || '';
            const time = timeAgo(e.created_at);
            return `<div class="activity-item">
                <span class="activity-item-icon">${icon}</span>
                <span class="activity-item-text"><strong>${label}</strong> ${repo}</span>
                <span class="activity-item-time">${time}</span>
            </div>`;
        }).join('');
    }

    renderHeatmap() {
        const container = document.getElementById('heatmap-container');
        const infoEl = document.getElementById('heatmap-info');

        if (!this.heatmap) {
            this.heatmap = new HeatmapRenderer(container);
        }

        let heatData = {};
        let totalContrib = 0;

        if (this.contributions) {
            // GraphQL data (accurate)
            totalContrib = this.contributions.totalContributions;
            this.contributions.weeks.forEach(week => {
                week.contributionDays.forEach(day => {
                    heatData[day.date] = day.contributionCount;
                });
            });
            infoEl.textContent = `過去1年間: ${totalContrib.toLocaleString()}回のコントリビューション`;
        } else {
            // Build from events (limited)
            this.events.forEach(e => {
                const date = e.created_at.split('T')[0];
                if (e.type === 'PushEvent') {
                    heatData[date] = (heatData[date] || 0) + (e.payload?.commits?.length || 1);
                } else {
                    heatData[date] = (heatData[date] || 0) + 1;
                }
            });
            const total = Object.values(heatData).reduce((s, v) => s + v, 0);
            infoEl.innerHTML = `イベントベース: ${total.toLocaleString()}件 <small>(トークン設定で正確なデータを取得)</small>`;
        }

        this.heatmap.render(heatData);
    }

    renderRepos() {
        this.displayedRepos = 0;
        this.applyFiltersAndSort();
    }

    applyFiltersAndSort() {
        const langFilter = document.getElementById('filter-language').value;
        const sortBy = document.getElementById('sort-repos').value;
        const searchTerm = document.getElementById('repo-search').value.toLowerCase().trim();

        let filtered = [...this.repos];

        // Filter by language
        if (langFilter) {
            filtered = filtered.filter(r => r.language === langFilter);
        }

        // Filter by search
        if (searchTerm) {
            filtered = filtered.filter(r =>
                r.name.toLowerCase().includes(searchTerm) ||
                (r.description || '').toLowerCase().includes(searchTerm)
            );
        }

        // Sort
        switch (sortBy) {
            case 'stars':
                filtered.sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0));
                break;
            case 'updated':
                filtered.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
                break;
            case 'name':
                filtered.sort((a, b) => a.name.localeCompare(b.name));
                break;
            case 'forks':
                filtered.sort((a, b) => (b.forks_count || 0) - (a.forks_count || 0));
                break;
        }

        this.filteredRepos = filtered;
        this.displayedRepos = 0;

        document.getElementById('repos-count').textContent = `(${filtered.length})`;
        document.getElementById('repos-list').innerHTML = '';
        this.showMoreRepos();
    }

    showMoreRepos() {
        const list = document.getElementById('repos-list');
        const next = this.filteredRepos.slice(this.displayedRepos, this.displayedRepos + REPOS_PER_PAGE);

        next.forEach(repo => {
            const card = document.createElement('div');
            card.className = 'repo-card';
            card.addEventListener('click', () => window.open(repo.html_url, '_blank'));

            const topics = (repo.topics || []).slice(0, 5).map(t =>
                `<span class="repo-topic">${t}</span>`
            ).join('');

            card.innerHTML = `
                <div class="repo-card-header">
                    <a href="${repo.html_url}" target="_blank" rel="noopener" class="repo-name" onclick="event.stopPropagation()">${repo.name}</a>
                    <span class="repo-visibility">${repo.private ? 'Private' : 'Public'}</span>
                </div>
                ${repo.description ? `<p class="repo-description">${this.escapeHtml(repo.description)}</p>` : '<p class="repo-description" style="opacity:0.5">説明なし</p>'}
                ${topics ? `<div class="repo-topics">${topics}</div>` : ''}
                <div class="repo-meta">
                    ${repo.language ? `<span class="repo-meta-item"><span class="repo-lang-dot" style="background:${getLangColor(repo.language)}"></span>${repo.language}</span>` : ''}
                    <span class="repo-meta-item">
                        <svg class="repo-star-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.751.751 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z"/></svg>
                        ${formatNumber(repo.stargazers_count)}
                    </span>
                    <span class="repo-meta-item">
                        <svg class="repo-fork-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75v-.878a2.25 2.25 0 111.5 0v.878a2.25 2.25 0 01-2.25 2.25h-1.5v2.128a2.251 2.251 0 11-1.5 0V8.5h-1.5A2.25 2.25 0 013.5 6.25v-.878a2.25 2.25 0 111.5 0zM5 3.25a.75.75 0 10-1.5 0 .75.75 0 001.5 0zm6.75.75a.75.75 0 100-1.5.75.75 0 000 1.5zM8 12.75a.75.75 0 100-1.5.75.75 0 000 1.5z"/></svg>
                        ${formatNumber(repo.forks_count)}
                    </span>
                    <span class="repo-meta-item">更新: ${timeAgo(repo.updated_at)}</span>
                </div>
            `;
            list.appendChild(card);
        });

        this.displayedRepos += next.length;

        const loadMoreBtn = document.getElementById('load-more-repos');
        if (this.displayedRepos < this.filteredRepos.length) {
            loadMoreBtn.classList.remove('hidden');
            loadMoreBtn.textContent = `もっと表示 (残り${this.filteredRepos.length - this.displayedRepos}件)`;
        } else {
            loadMoreBtn.classList.add('hidden');
        }
    }

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /* ----- Visibility ----- */
    applyVisibility() {
        const s = this.settings;
        const toggle = (selector, show) => {
            const el = document.querySelector(selector);
            if (el) el.style.display = show ? '' : 'none';
        };
        toggle('.stats-card', s.showStats);
        toggle('.language-card', s.showLanguages);
        toggle('.activity-card', s.showActivity);
        toggle('.heatmap-section', s.showHeatmap);
        toggle('.repos-section', s.showRepos);
    }

    /* ----- UI State ----- */
    showSection(id) {
        ['welcome-screen', 'loading', 'error', 'app-content'].forEach(s => {
            document.getElementById(s).classList.add('hidden');
        });
        document.getElementById(id).classList.remove('hidden');
    }

    showError(message) {
        document.getElementById('error-message').textContent = message;
        this.showSection('error');
    }

    updateCacheInfo(username) {
        const ts = this.cache.getTimestamp(`user_${username}`);
        if (ts) {
            document.getElementById('cache-time').textContent = `データ取得: ${timeAgo(new Date(ts).toISOString())}`;
        }

        const rl = this.api.rateLimit;
        if (rl && rl.remaining !== null) {
            document.getElementById('rate-limit-info').textContent = `API: ${rl.remaining}/${rl.limit}`;
        }
    }

    /* ----- Modal ----- */
    openModal(id) {
        document.getElementById(id).classList.remove('hidden');
        if (id === 'settings-modal') this.populateSettings();
    }

    closeModal(id) {
        document.getElementById(id).classList.add('hidden');
    }

    /* ----- Theme ----- */
    toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        this.settings.theme = next;
        localStorage.setItem('ghav_theme', next);

        // Re-render charts if visible
        if (this.languageChart) {
            this.languageChart.options.plugins = this.languageChart.options.plugins || {};
            this.languageChart.update();
        }
        if (this.heatmap && this.currentUser) {
            this.renderHeatmap();
        }
    }

    applyTheme() {
        const saved = this.settings.theme;
        if (saved === 'system') {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
                if (this.settings.theme === 'system') {
                    document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
                }
            });
        } else {
            document.documentElement.setAttribute('data-theme', saved || 'light');
        }
    }

    /* ----- Settings ----- */
    loadSettings() {
        return {
            theme: localStorage.getItem('ghav_theme') || 'light',
            token: localStorage.getItem('ghav_token') || '',
            showStats: localStorage.getItem('ghav_showStats') !== 'false',
            showLanguages: localStorage.getItem('ghav_showLanguages') !== 'false',
            showActivity: localStorage.getItem('ghav_showActivity') !== 'false',
            showHeatmap: localStorage.getItem('ghav_showHeatmap') !== 'false',
            showRepos: localStorage.getItem('ghav_showRepos') !== 'false',
        };
    }

    populateSettings() {
        document.getElementById('token-input').value = this.settings.token;
        document.querySelector(`input[name="theme"][value="${this.settings.theme}"]`).checked = true;
        document.getElementById('show-stats').checked = this.settings.showStats;
        document.getElementById('show-languages').checked = this.settings.showLanguages;
        document.getElementById('show-activity').checked = this.settings.showActivity;
        document.getElementById('show-heatmap').checked = this.settings.showHeatmap;
        document.getElementById('show-repos').checked = this.settings.showRepos;
    }

    saveSettings() {
        const token = document.getElementById('token-input').value.trim();
        const theme = document.querySelector('input[name="theme"]:checked').value;

        this.settings.token = token;
        this.settings.theme = theme;
        this.settings.showStats = document.getElementById('show-stats').checked;
        this.settings.showLanguages = document.getElementById('show-languages').checked;
        this.settings.showActivity = document.getElementById('show-activity').checked;
        this.settings.showHeatmap = document.getElementById('show-heatmap').checked;
        this.settings.showRepos = document.getElementById('show-repos').checked;

        localStorage.setItem('ghav_token', token);
        localStorage.setItem('ghav_theme', theme);
        localStorage.setItem('ghav_showStats', this.settings.showStats);
        localStorage.setItem('ghav_showLanguages', this.settings.showLanguages);
        localStorage.setItem('ghav_showActivity', this.settings.showActivity);
        localStorage.setItem('ghav_showHeatmap', this.settings.showHeatmap);
        localStorage.setItem('ghav_showRepos', this.settings.showRepos);

        this.api.token = token;
        this.applyTheme();
        this.applyVisibility();
        this.closeModal('settings-modal');

        // Re-fetch if user is loaded (for contributions with new token)
        if (this.currentUser && token) {
            this.cache.clear();
            this.search(this.currentUser);
        }
    }

    /* ----- Compare ----- */
    async startCompare() {
        const user1 = document.getElementById('compare-user1').value.trim();
        const user2 = document.getElementById('compare-user2').value.trim();
        if (!user1 || !user2) return;

        const loading = document.getElementById('compare-loading');
        const result = document.getElementById('compare-result');
        loading.classList.remove('hidden');
        result.classList.add('hidden');

        try {
            const [data1, data2, repos1, repos2] = await Promise.all([
                this.api.getUser(user1),
                this.api.getUser(user2),
                this.api.getAllRepos(user1),
                this.api.getAllRepos(user2),
            ]);

            const stars1 = repos1.reduce((s, r) => s + (r.stargazers_count || 0), 0);
            const stars2 = repos2.reduce((s, r) => s + (r.stargazers_count || 0), 0);
            const forks1 = repos1.reduce((s, r) => s + (r.forks_count || 0), 0);
            const forks2 = repos2.reduce((s, r) => s + (r.forks_count || 0), 0);

            const metrics = [
                { label: 'パブリックリポジトリ', v1: data1.public_repos, v2: data2.public_repos },
                { label: '総スター数', v1: stars1, v2: stars2 },
                { label: '総フォーク数', v1: forks1, v2: forks2 },
                { label: 'フォロワー', v1: data1.followers, v2: data2.followers },
                { label: 'フォロー', v1: data1.following, v2: data2.following },
                { label: 'Gist数', v1: data1.public_gists, v2: data2.public_gists },
            ];

            result.innerHTML = `
                <table class="compare-table">
                    <thead>
                        <tr>
                            <th>指標</th>
                            <th>
                                <div class="compare-user-header">
                                    <img src="${data1.avatar_url}" alt="${user1}">
                                    <span>${data1.login}</span>
                                </div>
                            </th>
                            <th>
                                <div class="compare-user-header">
                                    <img src="${data2.avatar_url}" alt="${user2}">
                                    <span>${data2.login}</span>
                                </div>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        ${metrics.map(m => `
                            <tr>
                                <td>${m.label}</td>
                                <td class="${m.v1 >= m.v2 ? 'compare-highlight' : ''}">${formatNumber(m.v1)}</td>
                                <td class="${m.v2 >= m.v1 ? 'compare-highlight' : ''}">${formatNumber(m.v2)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;

            loading.classList.add('hidden');
            result.classList.remove('hidden');
        } catch (err) {
            loading.classList.add('hidden');
            result.classList.remove('hidden');
            result.innerHTML = `<p style="color:var(--color-danger);text-align:center;">${err.message}</p>`;
        }
    }

    /* ----- Export ----- */
    async exportPNG() {
        if (typeof html2canvas === 'undefined') {
            alert('html2canvas が読み込めませんでした');
            return;
        }

        const section = document.getElementById('profile-card');
        try {
            const canvas = await html2canvas(section, {
                backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim(),
                scale: 2,
            });
            const link = document.createElement('a');
            link.download = `${this.currentUser}-profile.png`;
            link.href = canvas.toDataURL();
            link.click();
        } catch {
            alert('PNG出力に失敗しました');
        }
    }

    exportJSON() {
        const data = {
            user: this.userData,
            repos: this.repos.map(r => ({
                name: r.name,
                description: r.description,
                language: r.language,
                stars: r.stargazers_count,
                forks: r.forks_count,
                updated: r.updated_at,
                url: r.html_url,
                topics: r.topics,
            })),
            stats: {
                totalStars: this.repos.reduce((s, r) => s + (r.stargazers_count || 0), 0),
                totalForks: this.repos.reduce((s, r) => s + (r.forks_count || 0), 0),
            },
            exportedAt: new Date().toISOString(),
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const link = document.createElement('a');
        link.download = `${this.currentUser}-data.json`;
        link.href = URL.createObjectURL(blob);
        link.click();
        URL.revokeObjectURL(link.href);
    }
}

/* ===== Initialize ===== */
document.addEventListener('DOMContentLoaded', () => {
    new App();
});

/* ===== Module Exports (for testing) ===== */
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        CacheManager, GitHubAPI, HeatmapRenderer, App,
        formatNumber, formatDate, timeAgo, getLangColor,
        LANGUAGE_COLORS, EVENT_ICONS, EVENT_LABELS,
        GITHUB_API, CACHE_DURATION, REPOS_PER_PAGE,
    };
}
