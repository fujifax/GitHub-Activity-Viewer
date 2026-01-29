/**
 * GitHub Activity Viewer - テストスイート
 */

const fs = require('fs');
const path = require('path');

// Load HTML for DOM tests
const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');

// Load app module
const {
    CacheManager, GitHubAPI, HeatmapRenderer, App,
    formatNumber, formatDate, timeAgo, getLangColor,
    LANGUAGE_COLORS, EVENT_ICONS, EVENT_LABELS,
    GITHUB_API, CACHE_DURATION, REPOS_PER_PAGE,
} = require('../js/app.js');

/* ============================================================
 * 1. ユーティリティ関数テスト
 * ============================================================ */
describe('formatNumber', () => {
    test('1000未満はそのまま表示', () => {
        expect(formatNumber(0)).toBe('0');
        expect(formatNumber(1)).toBe('1');
        expect(formatNumber(999)).toBe('999');
    });

    test('1000以上はK表記', () => {
        expect(formatNumber(1000)).toBe('1.0K');
        expect(formatNumber(1500)).toBe('1.5K');
        expect(formatNumber(99999)).toBe('100.0K');
    });

    test('100万以上はM表記', () => {
        expect(formatNumber(1000000)).toBe('1.0M');
        expect(formatNumber(2500000)).toBe('2.5M');
    });
});

describe('formatDate', () => {
    test('ISO文字列を日本語形式に変換', () => {
        const result = formatDate('2024-03-15T10:00:00Z');
        expect(result).toBe('2024/3/15');
    });

    test('年月日が正しく表示される', () => {
        const result = formatDate('2023-01-01T00:00:00Z');
        expect(result).toBe('2023/1/1');
    });

    test('12月31日', () => {
        // Use noon UTC to avoid timezone offset issues
        const result = formatDate('2024-12-31T12:00:00Z');
        expect(result).toBe('2024/12/31');
    });
});

describe('timeAgo', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2025-06-15T12:00:00Z'));
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('1分未満は「たった今」', () => {
        expect(timeAgo('2025-06-15T11:59:30Z')).toBe('たった今');
    });

    test('分単位', () => {
        expect(timeAgo('2025-06-15T11:55:00Z')).toBe('5分前');
    });

    test('時間単位', () => {
        expect(timeAgo('2025-06-15T09:00:00Z')).toBe('3時間前');
    });

    test('日単位', () => {
        expect(timeAgo('2025-06-12T12:00:00Z')).toBe('3日前');
    });

    test('週単位', () => {
        expect(timeAgo('2025-06-01T12:00:00Z')).toBe('2週間前');
    });

    test('月単位', () => {
        expect(timeAgo('2025-03-15T12:00:00Z')).toBe('3ヶ月前');
    });

    test('年単位', () => {
        expect(timeAgo('2023-06-15T12:00:00Z')).toBe('2年前');
    });
});

describe('getLangColor', () => {
    test('既知の言語は正しい色を返す', () => {
        expect(getLangColor('JavaScript')).toBe('#f1e05a');
        expect(getLangColor('TypeScript')).toBe('#3178c6');
        expect(getLangColor('Python')).toBe('#3572A5');
    });

    test('不明な言語はデフォルト色', () => {
        expect(getLangColor('UnknownLang')).toBe('#8b8b8b');
    });

    test('nullの場合はデフォルト色', () => {
        expect(getLangColor(null)).toBe('#8b8b8b');
    });

    test('undefinedの場合はデフォルト色', () => {
        expect(getLangColor(undefined)).toBe('#8b8b8b');
    });
});

/* ============================================================
 * 2. 定数テスト
 * ============================================================ */
describe('Constants', () => {
    test('GITHUB_APIが正しいURL', () => {
        expect(GITHUB_API).toBe('https://api.github.com');
    });

    test('CACHE_DURATIONは5分', () => {
        expect(CACHE_DURATION).toBe(5 * 60 * 1000);
    });

    test('REPOS_PER_PAGEは10', () => {
        expect(REPOS_PER_PAGE).toBe(10);
    });

    test('LANGUAGE_COLORSに主要言語が含まれる', () => {
        const expectedLangs = ['JavaScript', 'TypeScript', 'Python', 'Java', 'Go', 'Rust', 'Ruby'];
        expectedLangs.forEach(lang => {
            expect(LANGUAGE_COLORS).toHaveProperty(lang);
            expect(LANGUAGE_COLORS[lang]).toMatch(/^#[0-9a-fA-F]{3,8}$/);
        });
    });

    test('EVENT_ICONSに主要イベントが含まれる', () => {
        const events = ['PushEvent', 'CreateEvent', 'ForkEvent', 'PullRequestEvent', 'WatchEvent'];
        events.forEach(e => {
            expect(EVENT_ICONS).toHaveProperty(e);
        });
    });

    test('EVENT_LABELSに主要イベントが含まれる', () => {
        expect(EVENT_LABELS.PushEvent).toBe('プッシュ');
        expect(EVENT_LABELS.PullRequestEvent).toBe('PR');
        expect(EVENT_LABELS.WatchEvent).toBe('スター');
    });
});

/* ============================================================
 * 3. CacheManager テスト
 * ============================================================ */
describe('CacheManager', () => {
    let cache;

    beforeEach(() => {
        localStorage.clear();
        cache = new CacheManager();
    });

    test('データの保存と取得', () => {
        cache.set('testKey', { name: 'test' });
        const result = cache.get('testKey');
        expect(result).toEqual({ name: 'test' });
    });

    test('存在しないキーはnullを返す', () => {
        expect(cache.get('nonExistent')).toBeNull();
    });

    test('期限切れデータはnullを返す', () => {
        cache.set('expiredKey', { data: 'old' });
        // Advance time past cache duration
        const originalNow = Date.now;
        Date.now = () => originalNow() + CACHE_DURATION + 1000;
        expect(cache.get('expiredKey')).toBeNull();
        Date.now = originalNow;
    });

    test('プレフィックス付きでlocalStorageに保存', () => {
        cache.set('myKey', 'hello');
        expect(localStorage.getItem('ghav_myKey')).not.toBeNull();
        const stored = JSON.parse(localStorage.getItem('ghav_myKey'));
        expect(stored.data).toBe('hello');
        expect(stored.timestamp).toBeDefined();
    });

    test('getTimestampがタイムスタンプを返す', () => {
        const before = Date.now();
        cache.set('tsKey', 'data');
        const ts = cache.getTimestamp('tsKey');
        expect(ts).toBeGreaterThanOrEqual(before);
        expect(ts).toBeLessThanOrEqual(Date.now());
    });

    test('getTimestampは存在しないキーでnull', () => {
        expect(cache.getTimestamp('nope')).toBeNull();
    });

    test('clearはプレフィックス付きキーのみ削除', () => {
        cache.set('a', 1);
        cache.set('b', 2);
        localStorage.setItem('other_key', 'keep');

        cache.clear();

        expect(cache.get('a')).toBeNull();
        expect(cache.get('b')).toBeNull();
        expect(localStorage.getItem('other_key')).toBe('keep');
    });

    test('不正なJSONデータの場合nullを返す', () => {
        localStorage.setItem('ghav_broken', 'not json');
        expect(cache.get('broken')).toBeNull();
    });

    test('getTimestampが不正データでnull', () => {
        localStorage.setItem('ghav_broken2', '{invalid');
        expect(cache.getTimestamp('broken2')).toBeNull();
    });
});

/* ============================================================
 * 4. GitHubAPI テスト
 * ============================================================ */
describe('GitHubAPI', () => {
    let api;

    beforeEach(() => {
        api = new GitHubAPI();
        global.fetch = jest.fn();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('headers', () => {
        test('トークンなしの場合Acceptのみ', () => {
            expect(api.headers).toEqual({
                Accept: 'application/vnd.github.v3+json',
            });
        });

        test('トークンありの場合Authorizationを含む', () => {
            api.token = 'ghp_test123';
            expect(api.headers).toEqual({
                Accept: 'application/vnd.github.v3+json',
                Authorization: 'Bearer ghp_test123',
            });
        });
    });

    describe('fetch', () => {
        test('正常なレスポンスを処理', async () => {
            global.fetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ login: 'testuser' }),
                headers: new Map([
                    ['X-RateLimit-Limit', '60'],
                    ['X-RateLimit-Remaining', '59'],
                    ['X-RateLimit-Reset', '1234567890'],
                ]),
            });

            const result = await api.fetch('https://api.github.com/users/test');
            expect(result).toEqual({ login: 'testuser' });
        });

        test('レート制限情報を保存', async () => {
            const mockHeaders = new Map([
                ['X-RateLimit-Limit', '60'],
                ['X-RateLimit-Remaining', '42'],
                ['X-RateLimit-Reset', '9999999999'],
            ]);

            global.fetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({}),
                headers: { get: (k) => mockHeaders.get(k) },
            });

            await api.fetch('https://api.github.com/test');
            expect(api.rateLimit.limit).toBe('60');
            expect(api.rateLimit.remaining).toBe('42');
        });

        test('404エラーで適切なメッセージ', async () => {
            global.fetch.mockResolvedValue({
                ok: false,
                status: 404,
                headers: { get: () => null },
            });

            await expect(api.fetch('https://api.github.com/users/nonexist'))
                .rejects.toThrow('ユーザーが見つかりません');
        });

        test('403エラーでレート制限メッセージ', async () => {
            global.fetch.mockResolvedValue({
                ok: false,
                status: 403,
                headers: { get: () => null },
            });

            await expect(api.fetch('https://api.github.com/test'))
                .rejects.toThrow('APIレート制限に達しました');
        });

        test('その他のエラーでステータスコード表示', async () => {
            global.fetch.mockResolvedValue({
                ok: false,
                status: 500,
                headers: { get: () => null },
            });

            await expect(api.fetch('https://api.github.com/test'))
                .rejects.toThrow('API エラー (500)');
        });
    });

    describe('getUser', () => {
        test('正しいURLでfetchを呼ぶ', async () => {
            global.fetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ login: 'octocat' }),
                headers: { get: () => null },
            });

            await api.getUser('octocat');
            expect(global.fetch).toHaveBeenCalledWith(
                'https://api.github.com/users/octocat',
                expect.objectContaining({ headers: expect.any(Object) })
            );
        });
    });

    describe('getAllRepos', () => {
        test('1ページ分のリポジトリを取得', async () => {
            const repos = Array.from({ length: 5 }, (_, i) => ({ name: `repo${i}` }));
            global.fetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(repos),
                headers: { get: () => null },
            });

            const result = await api.getAllRepos('testuser');
            expect(result).toHaveLength(5);
        });

        test('複数ページにまたがるリポジトリを全取得', async () => {
            const page1 = Array.from({ length: 100 }, (_, i) => ({ name: `repo${i}` }));
            const page2 = Array.from({ length: 30 }, (_, i) => ({ name: `repo${100 + i}` }));

            global.fetch
                .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(page1), headers: { get: () => null } })
                .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(page2), headers: { get: () => null } });

            const result = await api.getAllRepos('biguser');
            expect(result).toHaveLength(130);
        });
    });

    describe('getEvents', () => {
        test('イベントを取得', async () => {
            const events = [{ type: 'PushEvent' }, { type: 'CreateEvent' }];
            global.fetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(events),
                headers: { get: () => null },
            });

            const result = await api.getEvents('testuser');
            expect(result).toHaveLength(2);
        });

        test('エラー時は取得済み分を返す', async () => {
            const events = Array.from({ length: 100 }, () => ({ type: 'PushEvent' }));
            global.fetch
                .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(events), headers: { get: () => null } })
                .mockRejectedValueOnce(new Error('Network error'));

            const result = await api.getEvents('testuser');
            expect(result).toHaveLength(100);
        });
    });

    describe('getContributions', () => {
        test('トークンなしの場合nullを返す', async () => {
            api.token = '';
            const result = await api.getContributions('testuser');
            expect(result).toBeNull();
        });

        test('トークンありでGraphQLデータを取得', async () => {
            api.token = 'ghp_test';
            const calendarData = {
                totalContributions: 500,
                weeks: [{ contributionDays: [{ contributionCount: 5, date: '2025-01-01' }] }],
            };

            global.fetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    data: {
                        user: {
                            contributionsCollection: {
                                contributionCalendar: calendarData,
                            },
                        },
                    },
                }),
            });

            const result = await api.getContributions('testuser');
            expect(result.totalContributions).toBe(500);
        });

        test('GraphQLエラー時はnull', async () => {
            api.token = 'ghp_test';
            global.fetch.mockResolvedValue({ ok: false });

            const result = await api.getContributions('testuser');
            expect(result).toBeNull();
        });
    });
});

/* ============================================================
 * 5. HeatmapRenderer テスト
 * ============================================================ */
describe('HeatmapRenderer', () => {
    let container;
    let renderer;

    beforeEach(() => {
        document.body.innerHTML = '<div id="heatmap"></div>';
        container = document.getElementById('heatmap');
        // Set CSS custom properties for heatmap colors
        document.documentElement.style.setProperty('--heatmap-0', '#ebedf0');
        document.documentElement.style.setProperty('--heatmap-1', '#9be9a8');
        document.documentElement.style.setProperty('--heatmap-2', '#40c463');
        document.documentElement.style.setProperty('--heatmap-3', '#30a14e');
        document.documentElement.style.setProperty('--heatmap-4', '#216e39');
        renderer = new HeatmapRenderer(container);
    });

    afterEach(() => {
        // Clean up tooltips
        document.querySelectorAll('.heatmap-tooltip').forEach(t => t.remove());
    });

    test('ツールチップ要素が作成される', () => {
        expect(document.querySelector('.heatmap-tooltip')).not.toBeNull();
    });

    test('空データでSVGを生成', () => {
        renderer.render({});
        expect(container.querySelector('svg')).not.toBeNull();
    });

    test('データ付きでセルが生成される', () => {
        const today = new Date().toISOString().split('T')[0];
        renderer.render({ [today]: 5 });
        const rects = container.querySelectorAll('.heatmap-cell-rect');
        expect(rects.length).toBeGreaterThan(300); // ~365 days
    });

    test('getLevel - count=0はレベル0', () => {
        expect(renderer.getLevel(0, 10)).toBe(0);
    });

    test('getLevel - 低い比率はレベル1', () => {
        expect(renderer.getLevel(2, 10)).toBe(1);
    });

    test('getLevel - 中間比率はレベル2', () => {
        expect(renderer.getLevel(4, 10)).toBe(2);
    });

    test('getLevel - やや高い比率はレベル3', () => {
        expect(renderer.getLevel(7, 10)).toBe(3);
    });

    test('getLevel - 最高比率はレベル4', () => {
        expect(renderer.getLevel(10, 10)).toBe(4);
    });

    test('formatDateがISO形式を返す', () => {
        const date = new Date('2025-03-15T00:00:00Z');
        expect(renderer.formatDate(date)).toBe('2025-03-15');
    });

    test('月ラベルがSVGに含まれる', () => {
        renderer.render({});
        const monthLabels = container.querySelectorAll('.heatmap-month-label');
        expect(monthLabels.length).toBeGreaterThanOrEqual(10); // At least 10 months visible
    });

    test('曜日ラベルがSVGに含まれる', () => {
        renderer.render({});
        const dayLabels = container.querySelectorAll('.heatmap-day-label');
        expect(dayLabels.length).toBe(3); // 月, 水, 金
    });
});

/* ============================================================
 * 6. App クラステスト (DOM統合)
 * ============================================================ */
describe('App', () => {
    let app;

    beforeEach(() => {
        // Set up full DOM
        document.documentElement.setAttribute('data-theme', 'light');
        document.body.innerHTML = html.replace(
            /<script[^>]*src="https:\/\/cdn[^"]*"[^>]*><\/script>/g, ''
        ).replace(/<script[^>]*src="js\/app\.js"[^>]*><\/script>/g, '');

        localStorage.clear();

        // Mock Chart global
        global.Chart = jest.fn().mockImplementation(() => ({
            destroy: jest.fn(),
            update: jest.fn(),
            options: { plugins: {} },
        }));

        // Mock window.matchMedia
        window.matchMedia = jest.fn().mockReturnValue({
            matches: false,
            addEventListener: jest.fn(),
        });

        // Mock fetch
        global.fetch = jest.fn();

        // Suppress DOMContentLoaded auto-init; create App manually
        app = new App();
    });

    afterEach(() => {
        jest.restoreAllMocks();
        document.querySelectorAll('.heatmap-tooltip').forEach(t => t.remove());
    });

    describe('初期状態', () => {
        test('currentUserがnull', () => {
            expect(app.currentUser).toBeNull();
        });

        test('reposが空配列', () => {
            expect(app.repos).toEqual([]);
        });

        test('eventsが空配列', () => {
            expect(app.events).toEqual([]);
        });

        test('settingsがデフォルト値', () => {
            expect(app.settings.theme).toBe('light');
            expect(app.settings.token).toBe('');
            expect(app.settings.showStats).toBe(true);
            expect(app.settings.showLanguages).toBe(true);
            expect(app.settings.showRepos).toBe(true);
        });
    });

    describe('showSection', () => {
        test('指定セクションのみ表示', () => {
            app.showSection('loading');
            expect(document.getElementById('loading').classList.contains('hidden')).toBe(false);
            expect(document.getElementById('welcome-screen').classList.contains('hidden')).toBe(true);
            expect(document.getElementById('app-content').classList.contains('hidden')).toBe(true);
            expect(document.getElementById('error').classList.contains('hidden')).toBe(true);
        });

        test('welcome表示', () => {
            app.showSection('welcome-screen');
            expect(document.getElementById('welcome-screen').classList.contains('hidden')).toBe(false);
        });
    });

    describe('showError', () => {
        test('エラーメッセージを表示', () => {
            app.showError('テストエラー');
            expect(document.getElementById('error-message').textContent).toBe('テストエラー');
            expect(document.getElementById('error').classList.contains('hidden')).toBe(false);
        });
    });

    describe('toggleTheme', () => {
        test('ライトからダークに切替', () => {
            document.documentElement.setAttribute('data-theme', 'light');
            app.toggleTheme();
            expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
        });

        test('ダークからライトに切替', () => {
            document.documentElement.setAttribute('data-theme', 'dark');
            app.toggleTheme();
            expect(document.documentElement.getAttribute('data-theme')).toBe('light');
        });

        test('テーマがlocalStorageに保存される', () => {
            document.documentElement.setAttribute('data-theme', 'light');
            app.toggleTheme();
            expect(localStorage.getItem('ghav_theme')).toBe('dark');
        });
    });

    describe('openModal / closeModal', () => {
        test('モーダルを開く', () => {
            app.openModal('compare-modal');
            expect(document.getElementById('compare-modal').classList.contains('hidden')).toBe(false);
        });

        test('モーダルを閉じる', () => {
            app.openModal('compare-modal');
            app.closeModal('compare-modal');
            expect(document.getElementById('compare-modal').classList.contains('hidden')).toBe(true);
        });
    });

    describe('escapeHtml', () => {
        test('HTMLタグをエスケープ', () => {
            expect(app.escapeHtml('<script>alert("xss")</script>'))
                .not.toContain('<script>');
        });

        test('特殊文字をエスケープ', () => {
            const result = app.escapeHtml('a & b < c > d "e"');
            expect(result).toContain('&amp;');
            expect(result).toContain('&lt;');
            expect(result).toContain('&gt;');
        });

        test('通常テキストはそのまま', () => {
            expect(app.escapeHtml('Hello World')).toBe('Hello World');
        });
    });

    describe('renderProfile', () => {
        test('ユーザーデータをDOMに反映', () => {
            app.userData = {
                login: 'testuser',
                name: 'Test User',
                avatar_url: 'https://example.com/avatar.png',
                bio: 'Hello world',
                followers: 100,
                following: 50,
                html_url: 'https://github.com/testuser',
                company: 'TestCorp',
                location: 'Tokyo, Japan',
                blog: 'https://example.com',
                twitter_username: 'testtwitter',
            };

            app.renderProfile();

            expect(document.getElementById('profile-name').textContent).toBe('Test User');
            expect(document.getElementById('profile-login').textContent).toBe('@testuser');
            expect(document.getElementById('profile-bio').textContent).toBe('Hello world');
            expect(document.getElementById('followers-count').textContent).toBe('100');
            expect(document.getElementById('following-count').textContent).toBe('50');
            expect(document.getElementById('company-text').textContent).toBe('TestCorp');
            expect(document.getElementById('location-text').textContent).toBe('Tokyo, Japan');
        });

        test('nameがない場合loginを表示', () => {
            app.userData = {
                login: 'noname',
                name: null,
                avatar_url: '',
                bio: null,
                followers: 0,
                following: 0,
                html_url: '',
                blog: '',
                twitter_username: null,
            };

            app.renderProfile();
            expect(document.getElementById('profile-name').textContent).toBe('noname');
        });

        test('blogがhttp未始の場合httpsを付加', () => {
            app.userData = {
                login: 'test', name: 'Test', avatar_url: '', bio: '',
                followers: 0, following: 0, html_url: '',
                blog: 'example.com', twitter_username: null,
            };

            app.renderProfile();
            expect(document.getElementById('blog-link').href).toBe('https://example.com/');
        });
    });

    describe('renderStats', () => {
        test('統計を正しく計算して表示', () => {
            app.userData = { public_repos: 25, public_gists: 5, created_at: '2020-01-15T00:00:00Z' };
            app.repos = [
                { stargazers_count: 100, forks_count: 20 },
                { stargazers_count: 50, forks_count: 10 },
                { stargazers_count: 0, forks_count: 0 },
            ];

            app.renderStats();

            expect(document.getElementById('stat-repos').textContent).toBe('25');
            expect(document.getElementById('stat-stars').textContent).toBe('150');
            expect(document.getElementById('stat-forks').textContent).toBe('30');
            expect(document.getElementById('stat-gists').textContent).toBe('5');
            expect(document.getElementById('stat-created').textContent).toBe('2020/1/15');
        });
    });

    describe('renderActivity', () => {
        test('イベント数とコミット数を表示', () => {
            app.events = [
                { type: 'PushEvent', payload: { commits: [1, 2, 3] }, repo: { name: 'user/repo' }, created_at: '2025-01-01T00:00:00Z' },
                { type: 'PushEvent', payload: { commits: [1] }, repo: { name: 'user/repo2' }, created_at: '2025-01-02T00:00:00Z' },
                { type: 'CreateEvent', payload: {}, repo: { name: 'user/repo3' }, created_at: '2025-01-03T00:00:00Z' },
            ];

            app.renderActivity();

            expect(document.getElementById('activity-events').textContent).toBe('3');
            expect(document.getElementById('activity-commits').textContent).toBe('4');
        });

        test('最近のアクティビティリストを表示', () => {
            app.events = [
                { type: 'PushEvent', repo: { name: 'user/repo1' }, created_at: '2025-06-01T00:00:00Z' },
                { type: 'WatchEvent', repo: { name: 'user/repo2' }, created_at: '2025-06-02T00:00:00Z' },
            ];

            app.renderActivity();

            const items = document.querySelectorAll('.activity-item');
            expect(items.length).toBe(2);
        });
    });

    describe('applyFiltersAndSort', () => {
        beforeEach(() => {
            app.repos = [
                { name: 'alpha', language: 'JavaScript', stargazers_count: 10, forks_count: 2, updated_at: '2025-01-01', description: 'First', html_url: '#', topics: [] },
                { name: 'beta', language: 'Python', stargazers_count: 50, forks_count: 5, updated_at: '2025-06-01', description: 'Second', html_url: '#', topics: [] },
                { name: 'gamma', language: 'JavaScript', stargazers_count: 30, forks_count: 1, updated_at: '2025-03-01', description: 'Third', html_url: '#', topics: [] },
            ];
        });

        test('スター順にソート', () => {
            document.getElementById('sort-repos').value = 'stars';
            document.getElementById('filter-language').value = '';
            document.getElementById('repo-search').value = '';

            app.applyFiltersAndSort();

            expect(app.filteredRepos[0].name).toBe('beta');
            expect(app.filteredRepos[1].name).toBe('gamma');
            expect(app.filteredRepos[2].name).toBe('alpha');
        });

        test('名前順にソート', () => {
            document.getElementById('sort-repos').value = 'name';
            document.getElementById('filter-language').value = '';
            document.getElementById('repo-search').value = '';

            app.applyFiltersAndSort();

            expect(app.filteredRepos[0].name).toBe('alpha');
            expect(app.filteredRepos[1].name).toBe('beta');
            expect(app.filteredRepos[2].name).toBe('gamma');
        });

        test('言語フィルタ', () => {
            // Add the option to the select element first
            const select = document.getElementById('filter-language');
            const opt = document.createElement('option');
            opt.value = 'JavaScript';
            opt.textContent = 'JavaScript';
            select.appendChild(opt);

            document.getElementById('sort-repos').value = 'stars';
            select.value = 'JavaScript';
            document.getElementById('repo-search').value = '';

            app.applyFiltersAndSort();

            expect(app.filteredRepos).toHaveLength(2);
            expect(app.filteredRepos.every(r => r.language === 'JavaScript')).toBe(true);
        });

        test('テキスト検索', () => {
            document.getElementById('sort-repos').value = 'stars';
            document.getElementById('filter-language').value = '';
            document.getElementById('repo-search').value = 'alpha';

            app.applyFiltersAndSort();

            expect(app.filteredRepos).toHaveLength(1);
            expect(app.filteredRepos[0].name).toBe('alpha');
        });

        test('説明文でも検索可能', () => {
            document.getElementById('sort-repos').value = 'stars';
            document.getElementById('filter-language').value = '';
            document.getElementById('repo-search').value = 'Second';

            app.applyFiltersAndSort();

            expect(app.filteredRepos).toHaveLength(1);
            expect(app.filteredRepos[0].name).toBe('beta');
        });

        test('更新日順ソート', () => {
            document.getElementById('sort-repos').value = 'updated';
            document.getElementById('filter-language').value = '';
            document.getElementById('repo-search').value = '';

            app.applyFiltersAndSort();

            expect(app.filteredRepos[0].name).toBe('beta');
            expect(app.filteredRepos[2].name).toBe('alpha');
        });

        test('フォーク数順ソート', () => {
            document.getElementById('sort-repos').value = 'forks';
            document.getElementById('filter-language').value = '';
            document.getElementById('repo-search').value = '';

            app.applyFiltersAndSort();

            expect(app.filteredRepos[0].name).toBe('beta');
            expect(app.filteredRepos[2].name).toBe('gamma');
        });

        test('件数表示が更新される', () => {
            document.getElementById('sort-repos').value = 'stars';
            document.getElementById('filter-language').value = '';
            document.getElementById('repo-search').value = '';

            app.applyFiltersAndSort();

            expect(document.getElementById('repos-count').textContent).toBe('(3)');
        });
    });

    describe('showMoreRepos', () => {
        test('REPOS_PER_PAGE分ずつ表示', () => {
            app.filteredRepos = Array.from({ length: 25 }, (_, i) => ({
                name: `repo${i}`, language: 'JS', stargazers_count: 0, forks_count: 0,
                updated_at: '2025-01-01', description: '', html_url: '#', topics: [],
            }));
            app.displayedRepos = 0;
            document.getElementById('repos-list').innerHTML = '';

            app.showMoreRepos();

            const cards = document.querySelectorAll('.repo-card');
            expect(cards).toHaveLength(REPOS_PER_PAGE);
            expect(app.displayedRepos).toBe(REPOS_PER_PAGE);
        });

        test('全件表示後はもっと表示ボタンが非表示', () => {
            app.filteredRepos = [
                { name: 'r1', language: 'JS', stargazers_count: 0, forks_count: 0, updated_at: '2025-01-01', description: '', html_url: '#', topics: [] },
            ];
            app.displayedRepos = 0;
            document.getElementById('repos-list').innerHTML = '';

            app.showMoreRepos();

            expect(document.getElementById('load-more-repos').classList.contains('hidden')).toBe(true);
        });
    });

    describe('loadSettings / saveSettings', () => {
        test('デフォルト設定を読み込み', () => {
            const settings = app.loadSettings();
            expect(settings.theme).toBe('light');
            expect(settings.showStats).toBe(true);
        });

        test('保存された設定を読み込み', () => {
            localStorage.setItem('ghav_theme', 'dark');
            localStorage.setItem('ghav_showStats', 'false');
            const settings = app.loadSettings();
            expect(settings.theme).toBe('dark');
            expect(settings.showStats).toBe(false);
        });
    });

    describe('exportJSON', () => {
        test('JSONデータを生成して要素を作成', () => {
            app.currentUser = 'testuser';
            app.userData = { login: 'testuser' };
            app.repos = [
                { name: 'repo1', description: 'desc', language: 'JS', stargazers_count: 10, forks_count: 2, updated_at: '2025-01-01', html_url: '#', topics: ['test'] },
            ];

            // Mock URL.createObjectURL and link.click
            const mockUrl = 'blob:mock';
            global.URL.createObjectURL = jest.fn().mockReturnValue(mockUrl);
            global.URL.revokeObjectURL = jest.fn();
            const clickSpy = jest.fn();
            jest.spyOn(document, 'createElement').mockImplementation((tag) => {
                if (tag === 'a') {
                    return { click: clickSpy, set download(v) {}, set href(v) {} };
                }
                return document.createElement(tag);
            });

            app.exportJSON();

            expect(global.URL.createObjectURL).toHaveBeenCalled();
            expect(clickSpy).toHaveBeenCalled();
        });
    });
});
