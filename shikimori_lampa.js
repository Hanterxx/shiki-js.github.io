(function () {
    'use strict';

    if (window.plugin_shikimori_ready) return;
    window.plugin_shikimori_ready = true;

    var PLUGIN_MANIFEST = {
        type: 'video',
        version: '2.4.0',
        name: 'Shikimori',
        description: 'Каталог аниме Shikimori (GraphQL + REST v1) для Lampa с полной карточкой, хронологией и поиском TMDB',
        component: 'shikimori_main'
    };

    var CONFIG = {
        primaryDomain: 'https://shikimori.io',
        fallbackDomain: 'https://shikimori.one',
        timeout: 12000,
        cacheLifeMinutes: 30,
        pageSize: 20,
        minIntervalMs: 260
    };

    var KIND_LABELS = {
        tv: 'TV Сериал',
        movie: 'Фильм',
        ova: 'OVA',
        ona: 'ONA',
        special: 'Спешл',
        tv_special: 'TV Спешл',
        music: 'Клип',
        pv: 'Промо',
        cm: 'Реклама'
    };

    var STATUS_LABELS = {
        anons: 'Анонс',
        ongoing: 'Онгоинг',
        released: 'Вышло'
    };

    var RATING_LABELS = {
        none: 'Без рейтинга',
        g: 'G (0+)',
        pg: 'PG (7+)',
        pg_13: 'PG-13 (13+)',
        r: 'R-17 (17+)',
        r_plus: 'R+ (18+)',
        rx: 'Rx (18+)'
    };

    var RELATION_LABELS = {
        sequel: 'Сиквел',
        prequel: 'Приквел',
        side_story: 'Побочная история',
        parent_story: 'Основная история',
        summary: 'Рекап / Обобщение',
        full_story: 'Полная версия',
        spin_off: 'Спин-офф',
        adaptation: 'Адаптация',
        character: 'Общие персонажи',
        alternative_version: 'Альтернативная версия',
        alternative_setting: 'Альтернативный сеттинг',
        other: 'Другое'
    };

    var CATALOG_SECTIONS = [
        { id: 'ongoing_popular', title: 'Популярные онгоинги сезона', order: 'popularity', status: 'ongoing' },
        { id: 'popular_all', title: 'Популярные аниме всех времён', order: 'popularity', status: '' },
        { id: 'top_ranked', title: 'Высокий рейтинг Shikimori', order: 'ranked', status: 'released' },
        { id: 'recent_aired', title: 'Новинки и свежие релизы', order: 'aired_on', status: 'ongoing,released' },
        { id: 'upcoming_anons', title: 'Ожидаемые анонсы', order: 'popularity', status: 'anons' },
        { id: 'movies_top', title: 'Полнометражные аниме-фильмы', order: 'popularity', kind: 'movie' },
        { id: 'ova_ona', title: 'OVA / ONA и специальные выпуски', order: 'popularity', kind: 'ova,ona,special,tv_special' }
    ];

    var GENRES_LIST = [
        { id: '1', title: 'Экшен (Action)' },
        { id: '2', title: 'Приключения (Adventure)' },
        { id: '4', title: 'Комедия (Comedy)' },
        { id: '8', title: 'Драма (Drama)' },
        { id: '10', title: 'Фэнтези (Fantasy)' },
        { id: '24', title: 'Фантастика (Sci-Fi)' },
        { id: '22', title: 'Романтика (Romance)' },
        { id: '7', title: 'Детектив / Тайна (Mystery)' },
        { id: '117', title: 'Триллер (Suspense)' },
        { id: '37', title: 'Сверхъестественное (Supernatural)' },
        { id: '14', title: 'Ужасы (Horror)' },
        { id: '40', title: 'Психологическое (Psychological)' },
        { id: '36', title: 'Повседневность (Slice of Life)' },
        { id: '18', title: 'Меха (Mecha)' },
        { id: '38', title: 'Военное (Military)' },
        { id: '13', title: 'Исторический (Historical)' },
        { id: '30', title: 'Спорт (Sports)' },
        { id: '27', title: 'Сёнен (Shounen)' },
        { id: '42', title: 'Сэйнэн (Seinen)' },
        { id: '25', title: 'Сёдзё (Shoujo)' }
    ];

    var memoryCache = {};
    var inflightRequests = {};
    var lastRequestTime = 0;

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function cleanShikimoriText(text) {
        if (!text) return '';
        var str = String(text);
        str = str.replace(/\[spoiler(?:=[^\]]*)?\]([\s\S]*?)\[\/spoiler\]/gi, ' [Спойлер: $1] ');
        str = str.replace(/\[(?:character|person|anime|manga|ranobe|club|user|url|image)[^\]]*\]([\s\S]*?)\[\/(?:character|person|anime|manga|ranobe|club|user|url|image)\]/gi, '$1');
        str = str.replace(/\[\/?[a-z0-9_=-]+(?:\s+[^\]]*)?\]/gi, '');
        str = str.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        return str;
    }

    function getBaseDomain() {
        try {
            if (window.Lampa && Lampa.Storage) {
                var saved = Lampa.Storage.get('shikimori_domain', '');
                if (saved && /^https:\/\/shikimori\.(io|one|me)$/i.test(saved)) {
                    return saved;
                }
            }
        } catch (e) {}
        return CONFIG.primaryDomain;
    }

    function resolveImageUrl(url, domain) {
        var base = domain || getBaseDomain();
        if (!url) return '';
        var str = String(url).trim();
        if (str.indexOf('missing_') !== -1) return '';
        if (str.indexOf('http://') === 0 || str.indexOf('https://') === 0) {
            return str.replace(/^https?:\/\/shikimori\.(one|org|me)\//i, base + '/');
        }
        if (str.indexOf('//') === 0) return 'https:' + str;
        if (str.indexOf('/') === 0) return base + str;
        return base + '/' + str;
    }

    function getCache(key) {
        var now = Date.now();
        var item = memoryCache[key];
        if (item && item.expires > now) {
            return item.value;
        }
        if (item) delete memoryCache[key];
        return null;
    }

    function setCache(key, value, ttlMinutes) {
        var ttl = (ttlMinutes || CONFIG.cacheLifeMinutes) * 60 * 1000;
        memoryCache[key] = {
            value: value,
            expires: Date.now() + ttl
        };
    }

    function scheduleTask(fn) {
        var now = Date.now();
        var wait = Math.max(0, CONFIG.minIntervalMs - (now - lastRequestTime));
        lastRequestTime = now + wait;
        if (wait === 0) {
            fn();
        } else {
            setTimeout(fn, wait);
        }
    }

    function httpRequest(options, onSuccess, onError) {
        var cacheKey = options.cacheKey || (options.method || 'GET') + ':' + options.url + ':' + (options.body || '');
        if (!options.noCache) {
            var cached = getCache(cacheKey);
            if (cached) {
                onSuccess(cached);
                return;
            }
        }

        if (inflightRequests[cacheKey]) {
            inflightRequests[cacheKey].push({ onSuccess: onSuccess, onError: onError });
            return;
        }

        inflightRequests[cacheKey] = [{ onSuccess: onSuccess, onError: onError }];

        function finishSuccess(data) {
            if (!options.noCache) setCache(cacheKey, data, options.ttlMinutes);
            var callbacks = inflightRequests[cacheKey] || [];
            delete inflightRequests[cacheKey];
            for (var i = 0; i < callbacks.length; i++) {
                try { callbacks[i].onSuccess(data); } catch (e) {}
            }
        }

        function finishError(err) {
            var callbacks = inflightRequests[cacheKey] || [];
            delete inflightRequests[cacheKey];
            for (var i = 0; i < callbacks.length; i++) {
                try { if (callbacks[i].onError) callbacks[i].onError(err); } catch (e) {}
            }
        }

        scheduleTask(function () {
            var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
            var timer = setTimeout(function () {
                if (controller) controller.abort();
            }, options.timeout || CONFIG.timeout);

            var fetchOpts = {
                method: options.method || 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            };
            if (options.body) {
                fetchOpts.headers['Content-Type'] = 'application/json';
                fetchOpts.body = options.body;
            }
            if (controller) fetchOpts.signal = controller.signal;

            if (typeof fetch === 'function') {
                fetch(options.url, fetchOpts)
                    .then(function (res) {
                        clearTimeout(timer);
                        if (res.status === 429) {
                            throw new Error('Превышен лимит запросов Shikimori API (HTTP 429). Подождите несколько секунд.');
                        }
                        if (!res.ok) {
                            throw new Error('Ошибка сервера Shikimori (HTTP ' + res.status + ')');
                        }
                        return res.json();
                    })
                    .then(function (json) {
                        if (json && json.errors && json.errors.length) {
                            throw new Error(json.errors[0].message || 'Ошибка запроса GraphQL');
                        }
                        finishSuccess(json);
                    })
                    .catch(function (err) {
                        clearTimeout(timer);
                        if (!options.retriedFallback && options.url.indexOf(CONFIG.primaryDomain) === 0) {
                            var fallbackUrl = options.url.replace(CONFIG.primaryDomain, CONFIG.fallbackDomain);
                            delete inflightRequests[cacheKey];
                            httpRequest({
                                url: fallbackUrl,
                                method: options.method,
                                body: options.body,
                                cacheKey: cacheKey,
                                retriedFallback: true
                            }, finishSuccess, finishError);
                            return;
                        }
                        finishError(err || new Error('Ошибка сети при обращении к Shikimori'));
                    });
            } else if (window.Lampa && Lampa.Reguest) {
                var net = new Lampa.Reguest();
                net.timeout(options.timeout || CONFIG.timeout);
                net.silent(options.url, function (json) {
                    clearTimeout(timer);
                    finishSuccess(json);
                }, function (a, c) {
                    clearTimeout(timer);
                    finishError(new Error(net.errorDecode ? net.errorDecode(a, c) : 'Ошибка сети Lampa.Reguest'));
                }, options.body ? JSON.parse(options.body) : false);
            } else {
                clearTimeout(timer);
                finishError(new Error('Отсутствует транспорт выполнения сетевых запросов'));
            }
        });
    }

    function normalizeAnimeItem(raw) {
        if (!raw) return null;
        var id = String(raw.id || '');
        var russian = raw.russian || '';
        var name = raw.name || '';
        var english = Array.isArray(raw.english) ? (raw.english[0] || '') : (raw.english || '');
        var japanese = Array.isArray(raw.japanese) ? (raw.japanese[0] || '') : (raw.japanese || '');
        var synonyms = Array.isArray(raw.synonyms) ? raw.synonyms.filter(Boolean) : [];
        var kind = raw.kind || 'tv';
        var status = raw.status || 'released';
        var rating = raw.rating || 'none';
        var scoreNum = parseFloat(raw.score) || 0;

        var airedDate = '';
        var airedYear = '';
        if (raw.airedOn && typeof raw.airedOn === 'object') {
            airedDate = raw.airedOn.date || '';
            airedYear = raw.airedOn.year ? String(raw.airedOn.year) : (airedDate ? airedDate.slice(0, 4) : '');
        } else if (raw.aired_on) {
            airedDate = String(raw.aired_on);
            airedYear = airedDate.slice(0, 4);
        }

        var releasedDate = '';
        if (raw.releasedOn && typeof raw.releasedOn === 'object') {
            releasedDate = raw.releasedOn.date || '';
        } else if (raw.released_on) {
            releasedDate = String(raw.released_on);
        }

        var posterMain = '';
        var posterOriginal = '';
        if (raw.poster && typeof raw.poster === 'object') {
            posterOriginal = resolveImageUrl(raw.poster.originalUrl || raw.poster.mainUrl || raw.poster.previewUrl);
            posterMain = resolveImageUrl(raw.poster.mainUrl || raw.poster.originalUrl || raw.poster.previewUrl);
        } else if (raw.image && typeof raw.image === 'object') {
            posterOriginal = resolveImageUrl(raw.image.original || raw.image.preview);
            posterMain = resolveImageUrl(raw.image.preview || raw.image.original);
        }

        var genres = Array.isArray(raw.genres) ? raw.genres.map(function (g) {
            return {
                id: String(g.id || ''),
                name: g.russian || g.name || '',
                originalName: g.name || '',
                kind: g.kind || 'genre'
            };
        }) : [];

        var studios = Array.isArray(raw.studios) ? raw.studios.map(function (s) {
            return {
                id: String(s.id || ''),
                name: s.name || ''
            };
        }) : [];

        var scoresStats = Array.isArray(raw.scoresStats) ? raw.scoresStats : (Array.isArray(raw.rates_scores_stats) ? raw.rates_scores_stats.map(function (item) {
            return { score: item.name, count: item.value };
        }) : []);

        var totalVotes = 0;
        for (var i = 0; i < scoresStats.length; i++) {
            totalVotes += Number(scoresStats[i].count || 0);
        }

        var relatedList = [];
        if (Array.isArray(raw.related)) {
            for (var r = 0; r < raw.related.length; r++) {
                var rel = raw.related[r];
                if (rel && rel.anime && rel.anime.id) {
                    var relAnime = normalizeAnimeItem(rel.anime);
                    if (relAnime) {
                        relAnime.relationKind = rel.relationKind || (rel.relation ? String(rel.relation).toLowerCase().replace(/\s+/g, '_') : 'other');
                        relAnime.relationText = rel.relationText || rel.relation_russian || RELATION_LABELS[relAnime.relationKind] || rel.relation || 'Связанное';
                        relatedList.push(relAnime);
                    }
                }
            }
        }

        var chronologyList = [];
        if (Array.isArray(raw.chronology)) {
            for (var c = 0; c < raw.chronology.length; c++) {
                var ch = normalizeAnimeItem(raw.chronology[c]);
                if (ch) chronologyList.push(ch);
            }
        }

        var screenshots = [];
        if (Array.isArray(raw.screenshots)) {
            for (var s = 0; s < raw.screenshots.length; s++) {
                var sc = raw.screenshots[s];
                var orig = resolveImageUrl(sc.originalUrl || sc.original);
                var thumb = resolveImageUrl(sc.x332Url || sc.preview || orig);
                if (orig || thumb) {
                    screenshots.push({ original: orig || thumb, preview: thumb || orig });
                }
            }
        }

        var videos = [];
        if (Array.isArray(raw.videos)) {
            for (var v = 0; v < raw.videos.length; v++) {
                var vd = raw.videos[v];
                if (vd && vd.url) {
                    videos.push({
                        id: String(vd.id || v),
                        name: vd.name || vd.kind || 'Видео',
                        kind: vd.kind || 'pv',
                        url: vd.url,
                        imageUrl: resolveImageUrl(vd.imageUrl || vd.image_url)
                    });
                }
            }
        }

        var displayTitle = russian || name || english || 'Без названия';

        return {
            id: id,
            shikimori_id: id,
            mal_id: raw.malId || raw.myanimelist_id || id,
            title: displayTitle,
            name: displayTitle,
            russian: russian,
            original_title: name,
            original_name: name,
            english: english,
            japanese: japanese,
            license_name_ru: raw.licenseNameRu || raw.license_name_ru || '',
            synonyms: synonyms,
            description: cleanShikimoriText(raw.description),
            kind: kind,
            kind_label: KIND_LABELS[kind] || kind.toUpperCase(),
            status: status,
            status_label: STATUS_LABELS[status] || status,
            rating: rating,
            rating_label: RATING_LABELS[rating] || rating,
            score: scoreNum > 0 ? scoreNum.toFixed(2) : '0.00',
            vote_average: scoreNum,
            total_votes: totalVotes,
            scores_stats: scoresStats,
            episodes: Number(raw.episodes) || 0,
            episodes_aired: Number(raw.episodesAired !== undefined ? raw.episodesAired : raw.episodes_aired) || 0,
            duration: Number(raw.duration) || 0,
            aired_on: airedDate,
            released_on: releasedDate,
            release_date: airedDate || (airedYear ? airedYear + '-01-01' : ''),
            first_air_date: kind !== 'movie' ? (airedDate || (airedYear ? airedYear + '-01-01' : '')) : '',
            release_year: airedYear || '—',
            next_episode_at: raw.nextEpisodeAt || raw.next_episode_at || null,
            poster: posterMain || './img/img_broken.svg',
            poster_original: posterOriginal || posterMain || './img/img_broken.svg',
            img: posterMain || './img/img_broken.svg',
            background_image: (screenshots[0] && screenshots[0].original) || posterOriginal || posterMain || '',
            genres: genres,
            studios: studios,
            related: relatedList,
            chronology: chronologyList,
            screenshots: screenshots,
            videos: videos,
            source: 'shikimori',
            type: kind === 'movie' ? 'movie' : 'tv'
        };
    }

    var ShikimoriAPI = {
        fetchCatalog: function (params, onSuccess, onError) {
            var page = Number(params.page) || 1;
            var limit = Number(params.limit) || CONFIG.pageSize;
            var order = params.order || 'popularity';
            var args = [
                'page: ' + page,
                'limit: ' + limit,
                'order: ' + order,
                'censored: true'
            ];
            if (params.status) args.push('status: "' + String(params.status).replace(/"/g, '') + '"');
            if (params.kind) args.push('kind: "' + String(params.kind).replace(/"/g, '') + '"');
            if (params.genre) args.push('genre: "' + String(params.genre).replace(/"/g, '') + '"');
            if (params.season) args.push('season: "' + String(params.season).replace(/"/g, '') + '"');
            if (params.score) args.push('score: ' + Number(params.score));
            if (params.search) {
                var cleanSearch = String(params.search).replace(/\\/g, '\\\\').replace(/"/g, '\\"').trim();
                args.push('search: "' + cleanSearch + '"');
            }

            var query = '{ animes(' + args.join(', ') + ') { id malId name russian english japanese kind rating score status episodes episodesAired duration airedOn { year month day date } releasedOn { year month day date } poster { originalUrl mainUrl previewUrl } genres { id name russian kind } studios { id name } } }';

            httpRequest({
                url: getBaseDomain() + '/api/graphql',
                method: 'POST',
                body: JSON.stringify({ query: query })
            }, function (json) {
                var list = (json && json.data && Array.isArray(json.data.animes)) ? json.data.animes : [];
                var normalized = [];
                for (var i = 0; i < list.length; i++) {
                    var item = normalizeAnimeItem(list[i]);
                    if (item) normalized.push(item);
                }
                onSuccess({
                    results: normalized,
                    page: page,
                    total_pages: normalized.length >= limit ? page + 1 : page
                });
            }, function () {
                var queryParts = [
                    'page=' + encodeURIComponent(page),
                    'limit=' + encodeURIComponent(limit),
                    'order=' + encodeURIComponent(order),
                    'censored=true'
                ];
                if (params.status) queryParts.push('status=' + encodeURIComponent(params.status));
                if (params.kind) queryParts.push('kind=' + encodeURIComponent(params.kind));
                if (params.genre) queryParts.push('genre=' + encodeURIComponent(params.genre));
                if (params.search) queryParts.push('search=' + encodeURIComponent(params.search));

                httpRequest({
                    url: getBaseDomain() + '/api/animes?' + queryParts.join('&'),
                    method: 'GET'
                }, function (restList) {
                    var arr = Array.isArray(restList) ? restList : [];
                    var normalized = [];
                    for (var i = 0; i < arr.length; i++) {
                        var item = normalizeAnimeItem(arr[i]);
                        if (item) normalized.push(item);
                    }
                    onSuccess({
                        results: normalized,
                        page: page,
                        total_pages: normalized.length >= limit ? page + 1 : page
                    });
                }, onError);
            });
        },

        fetchAnimeFull: function (animeId, onSuccess, onError) {
            var cleanId = String(animeId).replace(/[^0-9]/g, '');
            if (!cleanId) {
                if (onError) onError(new Error('Некорректный ID аниме Shikimori'));
                return;
            }

            var query = '{ animes(ids: "' + cleanId + '", limit: 1) { id malId name russian licenseNameRu english japanese synonyms kind rating score status episodes episodesAired duration airedOn { year month day date } releasedOn { year month day date } nextEpisodeAt franchise description poster { originalUrl mainUrl previewUrl } genres { id name russian kind } studios { id name imageUrl } scoresStats { score count } statusesStats { status count } related { id relationKind relationText anime { id name russian kind score status episodes episodesAired airedOn { year date } poster { mainUrl previewUrl originalUrl } } } screenshots { id originalUrl x332Url } videos { id url name kind imageUrl } chronology { id name russian kind score status episodes airedOn { year date } poster { mainUrl previewUrl originalUrl } } } }';

            httpRequest({
                url: getBaseDomain() + '/api/graphql',
                method: 'POST',
                body: JSON.stringify({ query: query })
            }, function (json) {
                var raw = json && json.data && Array.isArray(json.data.animes) && json.data.animes[0];
                if (!raw) {
                    if (onError) onError(new Error('Карточка аниме не найдена в базе Shikimori'));
                    return;
                }
                onSuccess(normalizeAnimeItem(raw));
            }, function () {
                httpRequest({
                    url: getBaseDomain() + '/api/animes/' + cleanId,
                    method: 'GET'
                }, function (restAnime) {
                    if (!restAnime || !restAnime.id) {
                        if (onError) onError(new Error('Карточка аниме не найдена'));
                        return;
                    }
                    httpRequest({
                        url: getBaseDomain() + '/api/animes/' + cleanId + '/related',
                        method: 'GET'
                    }, function (relatedData) {
                        restAnime.related = Array.isArray(relatedData) ? relatedData : [];
                        onSuccess(normalizeAnimeItem(restAnime));
                    }, function () {
                        onSuccess(normalizeAnimeItem(restAnime));
                    });
                }, onError);
            });
        },

        fetchSimilar: function (animeId, onSuccess, onError) {
            var cleanId = String(animeId).replace(/[^0-9]/g, '');
            httpRequest({
                url: getBaseDomain() + '/api/animes/' + cleanId + '/similar',
                method: 'GET'
            }, function (list) {
                var arr = Array.isArray(list) ? list : [];
                var results = [];
                for (var i = 0; i < arr.length; i++) {
                    var item = normalizeAnimeItem(arr[i]);
                    if (item) results.push(item);
                }
                onSuccess(results);
            }, onError);
        },

        fetchCalendar: function (onSuccess, onError) {
            httpRequest({
                url: getBaseDomain() + '/api/calendar',
                method: 'GET',
                ttlMinutes: 15
            }, function (entries) {
                var arr = Array.isArray(entries) ? entries : [];
                var results = [];
                for (var i = 0; i < arr.length; i++) {
                    var entry = arr[i];
                    if (entry && entry.anime) {
                        var item = normalizeAnimeItem(entry.anime);
                        if (item) {
                            item.next_episode = entry.next_episode;
                            item.next_episode_at = entry.next_episode_at;
                            results.push(item);
                        }
                    }
                }
                onSuccess(results);
            }, onError);
        }
    };

    function injectPluginStyles() {
        if (document.getElementById('shikimori-lampa-plugin-styles')) return;
        var style = document.createElement('style');
        style.id = 'shikimori-lampa-plugin-styles';
        style.type = 'text/css';
        style.innerHTML = [
            '.shiki-wrap { padding: 1.5em 2em 3em 2em; }',
            '.shiki-toolbar { display: flex; flex-wrap: wrap; gap: 0.75em; margin-bottom: 1.8em; align-items: center; }',
            '.shiki-btn { background: rgba(255,255,255,0.08); color: #fff; padding: 0.65em 1.2em; border-radius: 0.5em; cursor: pointer; font-size: 1.05em; font-weight: 500; transition: background 0.18s ease, transform 0.18s ease; display: inline-flex; align-items: center; gap: 0.5em; border: 1px solid rgba(255,255,255,0.08); }',
            '.shiki-btn.focus, .shiki-btn:hover { background: #fff; color: #111; transform: scale(1.03); border-color: #fff; }',
            '.shiki-btn--primary { background: rgba(56, 189, 248, 0.18); border-color: rgba(56, 189, 248, 0.45); }',
            '.shiki-section { margin-bottom: 2.4em; }',
            '.shiki-section__head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 1em; }',
            '.shiki-section__title { font-size: 1.45em; font-weight: 600; color: #fff; }',
            '.shiki-section__more { font-size: 0.95em; color: rgba(255,255,255,0.65); cursor: pointer; padding: 0.35em 0.8em; border-radius: 0.4em; }',
            '.shiki-section__more.focus, .shiki-section__more:hover { background: #fff; color: #111; }',
            '.shiki-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(11.5em, 1fr)); gap: 1.35em; }',
            '.shiki-card { position: relative; cursor: pointer; border-radius: 0.6em; transition: transform 0.18s ease; display: flex; flex-direction: column; }',
            '.shiki-card__poster-wrap { position: relative; width: 100%; padding-top: 142%; border-radius: 0.6em; overflow: hidden; background: rgba(255,255,255,0.05); border: 2px solid transparent; }',
            '.shiki-card.focus .shiki-card__poster-wrap, .shiki-card:hover .shiki-card__poster-wrap { border-color: #fff; transform: translateY(-0.25em); box-shadow: 0 0.8em 2em rgba(0,0,0,0.55); }',
            '.shiki-card__img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }',
            '.shiki-card__badge-score { position: absolute; top: 0.55em; left: 0.55em; background: rgba(15, 23, 42, 0.88); color: #38bdf8; font-weight: 700; font-size: 0.85em; padding: 0.2em 0.5em; border-radius: 0.35em; }',
            '.shiki-card__badge-kind { position: absolute; bottom: 0.55em; right: 0.55em; background: rgba(15, 23, 42, 0.88); color: #fff; font-size: 0.78em; padding: 0.2em 0.5em; border-radius: 0.35em; }',
            '.shiki-card__title { margin-top: 0.6em; font-size: 1em; font-weight: 500; color: #fff; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }',
            '.shiki-card__meta { margin-top: 0.25em; font-size: 0.85em; color: rgba(255,255,255,0.55); }',
            '.shiki-full { padding: 1.8em 2.2em 4em 2.2em; color: #fff; }',
            '.shiki-full__top { display: flex; gap: 2.2em; align-items: flex-start; flex-wrap: wrap; }',
            '.shiki-full__poster { width: 16.5em; flex-shrink: 0; border-radius: 0.75em; overflow: hidden; background: rgba(255,255,255,0.06); box-shadow: 0 1.2em 2.8em rgba(0,0,0,0.6); }',
            '.shiki-full__poster img { width: 100%; display: block; object-fit: cover; }',
            '.shiki-full__info { flex: 1; min-width: 18em; }',
            '.shiki-full__title { font-size: 2.2em; font-weight: 700; line-height: 1.18; margin-bottom: 0.25em; }',
            '.shiki-full__subtitles { font-size: 1em; color: rgba(255,255,255,0.65); margin-bottom: 1.1em; line-height: 1.5; }',
            '.shiki-full__actions { display: flex; flex-wrap: wrap; gap: 0.75em; margin-bottom: 1.4em; }',
            '.shiki-full__specs { display: grid; grid-template-columns: repeat(auto-fit, minmax(13em, 1fr)); gap: 0.75em 1.4em; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 0.65em; padding: 1.1em 1.3em; margin-bottom: 1.3em; }',
            '.shiki-spec__label { font-size: 0.82em; color: rgba(255,255,255,0.5); margin-bottom: 0.15em; }',
            '.shiki-spec__value { font-size: 1em; font-weight: 600; color: #fff; }',
            '.shiki-genres { display: flex; flex-wrap: wrap; gap: 0.5em; margin-bottom: 1.4em; }',
            '.shiki-genre-tag { background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.9); padding: 0.35em 0.8em; border-radius: 0.4em; font-size: 0.9em; cursor: pointer; }',
            '.shiki-genre-tag.focus, .shiki-genre-tag:hover { background: #fff; color: #111; }',
            '.shiki-descr { font-size: 1.08em; line-height: 1.62; color: rgba(255,255,255,0.88); margin-bottom: 2em; white-space: pre-line; max-width: 68ch; }',
            '.shiki-episodes-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(9.5em, 1fr)); gap: 0.65em; margin-top: 0.8em; }',
            '.shiki-ep-item { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); padding: 0.65em 0.85em; border-radius: 0.45em; cursor: pointer; }',
            '.shiki-ep-item.focus, .shiki-ep-item:hover { background: #fff; color: #111; }',
            '.shiki-status-box { padding: 2.5em; text-align: center; background: rgba(255,255,255,0.04); border-radius: 0.75em; margin: 1.5em 0; }'
        ].join('\n');
        document.head.appendChild(style);
    }

    function matchAndWatchInLampa(anime) {
        if (!window.Lampa) return;

        var queries = [];
        if (anime.russian) queries.push(anime.russian);
        if (anime.original_title && queries.indexOf(anime.original_title) === -1) queries.push(anime.original_title);
        if (anime.english && queries.indexOf(anime.english) === -1) queries.push(anime.english);

        var targetYear = parseInt(anime.release_year, 10) || 0;
        var expectedType = anime.kind === 'movie' ? 'movie' : 'tv';

        function openGlobalSearchFallback() {
            if (Lampa.Search && typeof Lampa.Search.open === 'function') {
                Lampa.Search.open({ input: anime.russian || anime.original_title || anime.title });
            } else if (Lampa.Noty) {
                Lampa.Noty.show('Поиск Lampa недоступен');
            }
        }

        if (!Lampa.Api || typeof Lampa.Api.search !== 'function') {
            openGlobalSearchFallback();
            return;
        }

        if (Lampa.Loading) Lampa.Loading.start(function () { Lampa.Loading.stop(); });

        Lampa.Api.search({ query: encodeURIComponent(queries[0] || anime.title) }, function (searchResult) {
            if (Lampa.Loading) Lampa.Loading.stop();

            var candidates = [];
            if (searchResult && searchResult.movie && Array.isArray(searchResult.movie.results)) {
                for (var m = 0; m < searchResult.movie.results.length; m++) {
                    var mov = searchResult.movie.results[m];
                    mov._media_type = 'movie';
                    candidates.push(mov);
                }
            }
            if (searchResult && searchResult.tv && Array.isArray(searchResult.tv.results)) {
                for (var t = 0; t < searchResult.tv.results.length; t++) {
                    var tv = searchResult.tv.results[t];
                    tv._media_type = 'tv';
                    candidates.push(tv);
                }
            }

            if (!candidates.length && queries[1]) {
                Lampa.Api.search({ query: encodeURIComponent(queries[1]) }, function (retryResult) {
                    if (retryResult && retryResult.tv && Array.isArray(retryResult.tv.results)) {
                        candidates = candidates.concat(retryResult.tv.results.map(function (x) { x._media_type = 'tv'; return x; }));
                    }
                    if (retryResult && retryResult.movie && Array.isArray(retryResult.movie.results)) {
                        candidates = candidates.concat(retryResult.movie.results.map(function (x) { x._media_type = 'movie'; return x; }));
                    }
                    presentCandidates(candidates);
                });
                return;
            }

            presentCandidates(candidates);
        });

        function presentCandidates(candidates) {
            if (!candidates || !candidates.length) {
                openGlobalSearchFallback();
                return;
            }

            var scored = candidates.map(function (c) {
                var score = 0;
                var cYear = parseInt((c.release_date || c.first_air_date || '').slice(0, 4), 10) || 0;
                var cTitle = String(c.title || c.name || '').toLowerCase().trim();
                var cOrig = String(c.original_title || c.original_name || '').toLowerCase().trim();

                if (c._media_type === expectedType) score += 25;
                if (targetYear && cYear) {
                    if (cYear === targetYear) score += 40;
                    else if (Math.abs(cYear - targetYear) === 1) score += 20;
                }
                if (anime.russian && cTitle === anime.russian.toLowerCase().trim()) score += 50;
                if (anime.original_title && (cOrig === anime.original_title.toLowerCase().trim() || cTitle === anime.original_title.toLowerCase().trim())) score += 50;
                if (anime.english && (cOrig === anime.english.toLowerCase().trim() || cTitle === anime.english.toLowerCase().trim())) score += 40;
                if (Array.isArray(c.genre_ids) && c.genre_ids.indexOf(16) !== -1) score += 20;

                return { item: c, score: score, year: cYear || '—' };
            });

            scored.sort(function (a, b) { return b.score - a.score; });

            var menuItems = scored.slice(0, 8).map(function (entry) {
                var c = entry.item;
                var title = c.title || c.name || c.original_title || c.original_name;
                var orig = c.original_title || c.original_name || '';
                var typeLabel = c._media_type === 'movie' ? 'Фильм' : 'Сериал';
                var rating = c.vote_average ? Number(c.vote_average).toFixed(1) : '—';
                return {
                    title: title + ' (' + entry.year + ')',
                    subtitle: typeLabel + (orig ? ' · ' + orig : '') + ' · TMDB ' + rating,
                    card: c
                };
            });

            menuItems.push({
                title: 'Глобальный поиск в Lampa по названию',
                subtitle: 'Искать "' + (anime.russian || anime.title) + '" во всех источниках',
                searchFallback: true
            });

            if (Lampa.Select && typeof Lampa.Select.show === 'function') {
                var activeController = Lampa.Controller.enabled().name;
                Lampa.Select.show({
                    title: 'Сопоставление с каталогом Lampa (TMDB)',
                    items: menuItems,
                    onSelect: function (selected) {
                        if (selected.searchFallback) {
                            openGlobalSearchFallback();
                            return;
                        }
                        var card = selected.card;
                        Lampa.Activity.push({
                            url: '',
                            card: card,
                            id: card.id,
                            method: card._media_type || (card.name ? 'tv' : 'movie'),
                            source: 'tmdb',
                            component: 'full'
                        });
                    },
                    onBack: function () {
                        Lampa.Controller.toggle(activeController || 'content');
                    }
                });
            }
        }
    }

    function createCardElement(anime, onSelect, onFocus) {
        var card = $('<div class="shiki-card selector">' +
            '<div class="shiki-card__poster-wrap">' +
                '<img class="shiki-card__img" src="' + escapeHtml(anime.poster) + '" alt="' + escapeHtml(anime.title) + '" loading="lazy" />' +
                (Number(anime.score) > 0 ? '<div class="shiki-card__badge-score">★ ' + escapeHtml(anime.score) + '</div>' : '') +
                '<div class="shiki-card__badge-kind">' + escapeHtml(anime.kind_label) + '</div>' +
            '</div>' +
            '<div class="shiki-card__title">' + escapeHtml(anime.title) + '</div>' +
            '<div class="shiki-card__meta">' + escapeHtml(anime.release_year) + ' · ' + escapeHtml(anime.status_label) + '</div>' +
        '</div>');

        card.find('img').on('error', function () {
            $(this).attr('src', './img/img_broken.svg');
        });

        card.on('hover:focus', function () {
            if (onFocus) onFocus(anime, card[0]);
            if (window.Lampa && Lampa.Background && anime.poster_original) {
                Lampa.Background.immediately(anime.poster_original);
            }
        });

        card.on('hover:enter click', function () {
            if (onSelect) onSelect(anime);
        });

        return card;
    }

    function openAnimeFullActivity(anime) {
        if (!window.Lampa || !Lampa.Activity) return;
        Lampa.Activity.push({
            url: '',
            title: 'Shikimori — ' + (anime.title || 'Аниме'),
            component: 'shikimori_full',
            anime_id: anime.id,
            card: anime,
            page: 1
        });
    }

    function openCategoryActivity(params) {
        if (!window.Lampa || !Lampa.Activity) return;
        Lampa.Activity.push({
            url: '',
            title: 'Shikimori — ' + (params.title || 'Каталог'),
            component: 'shikimori_category',
            filter_params: params,
            page: 1
        });
    }

    function showGenresSelector(activeController) {
        if (!window.Lampa || !Lampa.Select) return;
        var items = GENRES_LIST.map(function (g) {
            return {
                title: g.title,
                genre_id: g.id
            };
        });
        Lampa.Select.show({
            title: 'Жанры и категории Shikimori',
            items: items,
            onSelect: function (item) {
                openCategoryActivity({
                    title: 'Жанр: ' + item.title,
                    genre: item.genre_id,
                    order: 'popularity'
                });
            },
            onBack: function () {
                Lampa.Controller.toggle(activeController || 'content');
            }
        });
    }

    function showSearchPrompt() {
        if (!window.Lampa) return;
        if (Lampa.Input && typeof Lampa.Input.edit === 'function') {
            Lampa.Input.edit({
                title: 'Поиск аниме в Shikimori',
                value: '',
                free: true,
                nosave: true
            }, function (newValue) {
                var query = (newValue || '').trim();
                if (query) {
                    openCategoryActivity({
                        title: 'Поиск: ' + query,
                        search: query,
                        order: 'popularity'
                    });
                }
            });
        } else if (Lampa.Search && typeof Lampa.Search.open === 'function') {
            Lampa.Search.open({});
        }
    }

    function ShikimoriMainComponent(object) {
        var scroll = new Lampa.Scroll({ mask: true, over: true, step: 260 });
        var html = $('<div class="shikimori-main-container"></div>');
        var content = $('<div class="shiki-wrap"></div>');
        var lastFocused = null;
        var self = this;

        this.create = function () {
            injectPluginStyles();
            this.activity.loader(true);

            var toolbar = $('<div class="shiki-toolbar"></div>');
            var buttons = [
                { title: 'Поиск аниме', primary: true, action: function () { showSearchPrompt(); } },
                { title: 'Онгоинги сезона', action: function () { openCategoryActivity({ title: 'Онгоинги сезона', status: 'ongoing', order: 'popularity' }); } },
                { title: 'Топ рейтинга', action: function () { openCategoryActivity({ title: 'Топ рейтинга Shikimori', status: 'released', order: 'ranked' }); } },
                { title: 'Популярное', action: function () { openCategoryActivity({ title: 'Популярные аниме', order: 'popularity' }); } },
                { title: 'Анонсы', action: function () { openCategoryActivity({ title: 'Ожидаемые анонсы', status: 'anons', order: 'popularity' }); } },
                { title: 'Фильмы', action: function () { openCategoryActivity({ title: 'Аниме-фильмы', kind: 'movie', order: 'popularity' }); } },
                { title: 'Жанры', action: function () { showGenresSelector('content'); } },
                { title: 'Календарь релизов', action: function () { openCategoryActivity({ title: 'Календарь выхода серий', calendar: true }); } }
            ];

            buttons.forEach(function (btnConfig) {
                var btn = $('<div class="shiki-btn selector ' + (btnConfig.primary ? 'shiki-btn--primary' : '') + '">' + escapeHtml(btnConfig.title) + '</div>');
                btn.on('hover:focus', function () {
                    lastFocused = btn[0];
                    scroll.update(btn, true);
                });
                btn.on('hover:enter click', function () {
                    btnConfig.action();
                });
                toolbar.append(btn);
            });

            content.append(toolbar);
            var sectionsHolder = $('<div class="shiki-sections-holder"></div>');
            content.append(sectionsHolder);

            scroll.Minus();
            scroll.append(content);
            html.append(scroll.render());

            this.loadSections(sectionsHolder);
            return this.render();
        };

        this.loadSections = function (holder) {
            var loadedCount = 0;
            var anySuccess = false;

            CATALOG_SECTIONS.forEach(function (sec) {
                var secBlock = $('<div class="shiki-section"></div>');
                holder.append(secBlock);

                ShikimoriAPI.fetchCatalog({
                    page: 1,
                    limit: 12,
                    order: sec.order,
                    status: sec.status,
                    kind: sec.kind
                }, function (data) {
                    loadedCount++;
                    if (data && data.results && data.results.length) {
                        anySuccess = true;
                        var head = $('<div class="shiki-section__head">' +
                            '<div class="shiki-section__title">' + escapeHtml(sec.title) + '</div>' +
                            '<div class="shiki-section__more selector">Смотреть все →</div>' +
                        '</div>');

                        head.find('.shiki-section__more').on('hover:focus', function () {
                            lastFocused = this;
                            scroll.update($(this), true);
                        }).on('hover:enter click', function () {
                            openCategoryActivity({
                                title: sec.title,
                                order: sec.order,
                                status: sec.status,
                                kind: sec.kind
                            });
                        });

                        var grid = $('<div class="shiki-grid"></div>');
                        data.results.slice(0, 6).forEach(function (anime) {
                            var card = createCardElement(anime, function (selected) {
                                openAnimeFullActivity(selected);
                            }, function (focusedAnime, el) {
                                lastFocused = el;
                                scroll.update($(el), true);
                            });
                            grid.append(card);
                        });

                        secBlock.append(head).append(grid);
                    }
                    checkComplete();
                }, function () {
                    loadedCount++;
                    checkComplete();
                });
            });

            function checkComplete() {
                if (loadedCount >= CATALOG_SECTIONS.length) {
                    self.activity.loader(false);
                    if (!anySuccess) {
                        var errBox = $('<div class="shiki-status-box">' +
                            '<div style="font-size:1.3em;margin-bottom:0.6em;">Не удалось загрузить данные Shikimori</div>' +
                            '<div style="color:rgba(255,255,255,0.6);margin-bottom:1.2em;">Проверьте интернет-соединение или повторите попытку.</div>' +
                            '<div class="shiki-btn selector">Повторить загрузку</div>' +
                        '</div>');
                        errBox.find('.selector').on('hover:focus', function () {
                            lastFocused = this;
                        }).on('hover:enter click', function () {
                            holder.empty();
                            self.activity.loader(true);
                            self.loadSections(holder);
                        });
                        holder.append(errBox);
                    }
                    self.activity.toggle();
                }
            }
        };

        this.start = function () {
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render());
                    Lampa.Controller.collectionFocus(lastFocused || false, scroll.render());
                },
                left: function () {
                    if (Lampa.Navigator.canmove('left')) Lampa.Navigator.move('left');
                    else Lampa.Controller.toggle('menu');
                },
                right: function () {
                    if (Lampa.Navigator.canmove('right')) Lampa.Navigator.move('right');
                },
                up: function () {
                    if (Lampa.Navigator.canmove('up')) Lampa.Navigator.move('up');
                    else Lampa.Controller.toggle('head');
                },
                down: function () {
                    if (Lampa.Navigator.canmove('down')) Lampa.Navigator.move('down');
                },
                back: function () {
                    Lampa.Activity.backward();
                }
            });
            Lampa.Controller.toggle('content');
        };

        this.pause = function () {};
        this.stop = function () {};
        this.render = function () { return html; };
        this.destroy = function () {
            scroll.destroy();
            html.remove();
        };
    }

    function ShikimoriCategoryComponent(object) {
        var scroll = new Lampa.Scroll({ mask: true, over: true, step: 260, end_ratio: 2 });
        var html = $('<div class="shikimori-category-container"></div>');
        var content = $('<div class="shiki-wrap"></div>');
        var grid = $('<div class="shiki-grid"></div>');
        var lastFocused = null;
        var currentPage = 1;
        var totalPages = 1;
        var isLoadingNext = false;
        var self = this;
        var filterParams = object.filter_params || {};

        this.create = function () {
            injectPluginStyles();
            this.activity.loader(true);

            var headerBar = $('<div class="shiki-toolbar"></div>');
            var backBtn = $('<div class="shiki-btn selector">← Назад</div>');
            backBtn.on('hover:focus', function () {
                lastFocused = this;
                scroll.update($(this), true);
            }).on('hover:enter click', function () {
                Lampa.Activity.backward();
            });
            headerBar.append(backBtn);

            if (!filterParams.calendar) {
                var sortBtn = $('<div class="shiki-btn selector">Сортировка</div>');
                sortBtn.on('hover:focus', function () {
                    lastFocused = this;
                    scroll.update($(this), true);
                }).on('hover:enter click', function () {
                    Lampa.Select.show({
                        title: 'Сортировка каталога',
                        items: [
                            { title: 'По популярности', order: 'popularity' },
                            { title: 'По рейтингу Shikimori', order: 'ranked' },
                            { title: 'По дате выхода', order: 'aired_on' },
                            { title: 'По алфавиту', order: 'name' }
                        ],
                        onSelect: function (s) {
                            filterParams.order = s.order;
                            currentPage = 1;
                            grid.empty();
                            self.activity.loader(true);
                            self.loadPage(1);
                        },
                        onBack: function () {
                            Lampa.Controller.toggle('content');
                        }
                    });
                });
                headerBar.append(sortBtn);
            }

            content.append(headerBar);
            content.append(grid);
            scroll.Minus();
            scroll.onEnd = function () {
                if (!filterParams.calendar && !isLoadingNext && currentPage < totalPages) {
                    isLoadingNext = true;
                    self.loadPage(currentPage + 1);
                }
            };
            scroll.append(content);
            html.append(scroll.render());

            this.loadPage(1);
            return this.render();
        };

        this.loadPage = function (page) {
            if (filterParams.calendar) {
                ShikimoriAPI.fetchCalendar(function (items) {
                    self.activity.loader(false);
                    if (!items || !items.length) {
                        self.showEmpty('В календаре онгоингов сейчас нет записей.');
                        return;
                    }
                    items.slice(0, 60).forEach(function (anime) {
                        var card = createCardElement(anime, function (selected) {
                            openAnimeFullActivity(selected);
                        }, function (a, el) {
                            lastFocused = el;
                            scroll.update($(el), true);
                        });
                        grid.append(card);
                    });
                    self.activity.toggle();
                }, function (err) {
                    self.activity.loader(false);
                    self.showEmpty(err && err.message ? err.message : 'Ошибка загрузки календаря');
                });
                return;
            }

            ShikimoriAPI.fetchCatalog({
                page: page,
                limit: CONFIG.pageSize,
                order: filterParams.order || 'popularity',
                status: filterParams.status || '',
                kind: filterParams.kind || '',
                genre: filterParams.genre || '',
                search: filterParams.search || ''
            }, function (data) {
                self.activity.loader(false);
                isLoadingNext = false;
                currentPage = data.page;
                totalPages = data.total_pages;

                if (page === 1 && (!data.results || !data.results.length)) {
                    self.showEmpty('По вашему запросу ничего не найдено.');
                    return;
                }

                data.results.forEach(function (anime) {
                    var card = createCardElement(anime, function (selected) {
                        openAnimeFullActivity(selected);
                    }, function (a, el) {
                        lastFocused = el;
                        scroll.update($(el), true);
                    });
                    grid.append(card);
                });

                self.activity.toggle();
            }, function (err) {
                self.activity.loader(false);
                isLoadingNext = false;
                if (page === 1) {
                    self.showEmpty(err && err.message ? err.message : 'Не удалось загрузить список аниме.');
                }
            });
        };

        this.showEmpty = function (message) {
            grid.empty();
            var box = $('<div class="shiki-status-box">' +
                '<div style="font-size:1.25em;margin-bottom:0.8em;">' + escapeHtml(message) + '</div>' +
                '<div class="shiki-btn selector">Повторить</div>' +
            '</div>');
            box.find('.selector').on('hover:focus', function () {
                lastFocused = this;
            }).on('hover:enter click', function () {
                box.remove();
                self.activity.loader(true);
                self.loadPage(1);
            });
            content.append(box);
            this.activity.toggle();
        };

        this.start = function () {
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render());
                    Lampa.Controller.collectionFocus(lastFocused || false, scroll.render());
                },
                left: function () {
                    if (Lampa.Navigator.canmove('left')) Lampa.Navigator.move('left');
                    else Lampa.Controller.toggle('menu');
                },
                right: function () {
                    if (Lampa.Navigator.canmove('right')) Lampa.Navigator.move('right');
                },
                up: function () {
                    if (Lampa.Navigator.canmove('up')) Lampa.Navigator.move('up');
                    else Lampa.Controller.toggle('head');
                },
                down: function () {
                    if (Lampa.Navigator.canmove('down')) Lampa.Navigator.move('down');
                },
                back: function () {
                    Lampa.Activity.backward();
                }
            });
            Lampa.Controller.toggle('content');
        };

        this.pause = function () {};
        this.stop = function () {};
        this.render = function () { return html; };
        this.destroy = function () {
            scroll.destroy();
            html.remove();
        };
    }

    function ShikimoriFullComponent(object) {
        var scroll = new Lampa.Scroll({ mask: true, over: true, step: 280 });
        var html = $('<div class="shikimori-full-container"></div>');
        var body = $('<div class="shiki-full"></div>');
        var lastFocused = null;
        var self = this;

        this.create = function () {
            injectPluginStyles();
            this.activity.loader(true);

            scroll.Minus();
            scroll.append(body);
            html.append(scroll.render());

            var targetId = object.anime_id || (object.card && object.card.id);
            ShikimoriAPI.fetchAnimeFull(targetId, function (anime) {
                self.activity.loader(false);
                self.buildCard(anime);
                self.activity.toggle();
            }, function (err) {
                self.activity.loader(false);
                if (object.card && object.card.id) {
                    self.buildCard(normalizeAnimeItem(object.card));
                    self.activity.toggle();
                } else {
                    var box = $('<div class="shiki-status-box">' +
                        '<div style="font-size:1.3em;margin-bottom:0.6em;">' + escapeHtml(err && err.message ? err.message : 'Ошибка загрузки карточки аниме') + '</div>' +
                        '<div class="shiki-btn selector">Вернуться назад</div>' +
                    '</div>');
                    box.find('.selector').on('hover:focus', function () { lastFocused = this; }).on('hover:enter click', function () { Lampa.Activity.backward(); });
                    body.append(box);
                    self.activity.toggle();
                }
            });

            return this.render();
        };

        this.buildCard = function (anime) {
            body.empty();
            if (window.Lampa && Lampa.Background && anime.background_image) {
                Lampa.Background.immediately(anime.background_image);
            }

            var topWrap = $('<div class="shiki-full__top"></div>');
            var posterBox = $('<div class="shiki-full__poster"><img src="' + escapeHtml(anime.poster_original || anime.poster) + '" alt="' + escapeHtml(anime.title) + '" /></div>');
            posterBox.find('img').on('error', function () {
                $(this).attr('src', './img/img_broken.svg');
            });

            var infoBox = $('<div class="shiki-full__info"></div>');
            infoBox.append('<div class="shiki-full__title">' + escapeHtml(anime.russian || anime.title) + '</div>');

            var altNames = [];
            if (anime.original_title) altNames.push('Оригинал: ' + anime.original_title);
            if (anime.english && anime.english !== anime.original_title) altNames.push('EN: ' + anime.english);
            if (anime.japanese) altNames.push('JP: ' + anime.japanese);
            if (anime.license_name_ru && anime.license_name_ru !== anime.russian) altNames.push('Лицензия РФ: ' + anime.license_name_ru);
            if (anime.synonyms && anime.synonyms.length) altNames.push('Альт.: ' + anime.synonyms.slice(0, 4).join(', '));

            if (altNames.length) {
                infoBox.append('<div class="shiki-full__subtitles">' + escapeHtml(altNames.join(' · ')) + '</div>');
            }

            var actionsBar = $('<div class="shiki-full__actions"></div>');

            var watchBtn = $('<div class="shiki-btn shiki-btn--primary selector">▶ Смотреть в Lampa</div>');
            watchBtn.on('hover:focus', function () { lastFocused = this; scroll.update($(this), true); });
            watchBtn.on('hover:enter click', function () {
                matchAndWatchInLampa(anime);
            });
            actionsBar.append(watchBtn);

            var similarBtn = $('<div class="shiki-btn selector">Похожие аниме</div>');
            similarBtn.on('hover:focus', function () { lastFocused = this; scroll.update($(this), true); });
            similarBtn.on('hover:enter click', function () {
                ShikimoriAPI.fetchSimilar(anime.id, function (simList) {
                    if (!simList || !simList.length) {
                        if (Lampa.Noty) Lampa.Noty.show('Похожие аниме не найдены');
                        return;
                    }
                    Lampa.Select.show({
                        title: 'Похожие на «' + anime.title + '»',
                        items: simList.slice(0, 15).map(function (item) {
                            return {
                                title: item.title + ' (' + item.release_year + ')',
                                subtitle: item.kind_label + ' · ★ ' + item.score,
                                anime: item
                            };
                        }),
                        onSelect: function (chosen) {
                            openAnimeFullActivity(chosen.anime);
                        },
                        onBack: function () {
                            Lampa.Controller.toggle('content');
                        }
                    });
                });
            });
            actionsBar.append(similarBtn);

            if (anime.videos && anime.videos.length) {
                var videoBtn = $('<div class="shiki-btn selector">Трейлеры и видео (' + anime.videos.length + ')</div>');
                videoBtn.on('hover:focus', function () { lastFocused = this; scroll.update($(this), true); });
                videoBtn.on('hover:enter click', function () {
                    Lampa.Select.show({
                        title: 'Видеоматериалы',
                        items: anime.videos.map(function (v) {
                            return { title: v.name, subtitle: v.url, video: v };
                        }),
                        onSelect: function (sel) {
                            if (Lampa.Noty) Lampa.Noty.show('Ссылка: ' + sel.video.url);
                            Lampa.Controller.toggle('content');
                        },
                        onBack: function () {
                            Lampa.Controller.toggle('content');
                        }
                    });
                });
                actionsBar.append(videoBtn);
            }

            infoBox.append(actionsBar);

            var specsGrid = $('<div class="shiki-full__specs"></div>');
            var specsData = [
                { label: 'Рейтинг Shikimori', value: (Number(anime.score) > 0 ? '★ ' + anime.score : 'Нет оценок') + (anime.total_votes ? ' (' + anime.total_votes + ' оценок)' : '') },
                { label: 'Тип релиза', value: anime.kind_label },
                { label: 'Статус выхода', value: anime.status_label },
                { label: 'Год / Сезон', value: anime.release_year },
                { label: 'Эпизоды', value: (anime.status === 'ongoing' ? anime.episodes_aired + ' из ' + (anime.episodes || '?') : (anime.episodes || '1')) + ' эп.' },
                { label: 'Длительность', value: anime.duration ? anime.duration + ' мин. / эп.' : 'Не указана' },
                { label: 'Дата начала', value: anime.aired_on || 'Неизвестно' },
                { label: 'Дата окончания', value: anime.released_on || (anime.status === 'ongoing' ? 'Выходит' : '—') },
                { label: 'Возрастной рейтинг', value: anime.rating_label },
                { label: 'Студия', value: anime.studios && anime.studios.length ? anime.studios.map(function (s) { return s.name; }).join(', ') : 'Не указана' }
            ];

            specsData.forEach(function (sp) {
                specsGrid.append('<div><div class="shiki-spec__label">' + escapeHtml(sp.label) + '</div><div class="shiki-spec__value">' + escapeHtml(sp.value) + '</div></div>');
            });
            infoBox.append(specsGrid);

            if (anime.genres && anime.genres.length) {
                var genresRow = $('<div class="shiki-genres"></div>');
                anime.genres.forEach(function (g) {
                    var tag = $('<div class="shiki-genre-tag selector">' + escapeHtml(g.name) + '</div>');
                    tag.on('hover:focus', function () { lastFocused = this; scroll.update($(this), true); });
                    tag.on('hover:enter click', function () {
                        openCategoryActivity({
                            title: 'Жанр: ' + g.name,
                            genre: g.id,
                            order: 'popularity'
                        });
                    });
                    genresRow.append(tag);
                });
                infoBox.append(genresRow);
            }

            infoBox.append('<div class="shiki-descr">' + escapeHtml(anime.description || 'Описание на русском языке пока отсутствует в базе Shikimori.') + '</div>');

            topWrap.append(posterBox).append(infoBox);
            body.append(topWrap);

            var totalEpCount = Math.max(anime.episodes || 0, anime.episodes_aired || 0);
            if (totalEpCount > 0) {
                var epSection = $('<div class="shiki-section"></div>');
                epSection.append('<div class="shiki-section__head"><div class="shiki-section__title">Список эпизодов (' + totalEpCount + ')</div></div>');
                var epGrid = $('<div class="shiki-episodes-grid"></div>');
                var maxRender = Math.min(totalEpCount, 48);
                for (var ep = 1; ep <= maxRender; ep++) {
                    (function (epNum) {
                        var isAired = anime.status === 'released' || epNum <= anime.episodes_aired;
                        var epItem = $('<div class="shiki-ep-item selector">' +
                            '<div style="font-weight:600;">Эпизод ' + epNum + '</div>' +
                            '<div style="font-size:0.8em;opacity:0.65;">' + (isAired ? 'Вышел' : 'Анонс') + ' · ' + (anime.duration || 24) + ' мин.</div>' +
                        '</div>');
                        epItem.on('hover:focus', function () { lastFocused = this; scroll.update($(this), true); });
                        epItem.on('hover:enter click', function () {
                            matchAndWatchInLampa(anime);
                        });
                        epGrid.append(epItem);
                    })(ep);
                }
                epSection.append(epGrid);
                body.append(epSection);
            }

            if (anime.related && anime.related.length) {
                var relSection = $('<div class="shiki-section"></div>');
                relSection.append('<div class="shiki-section__head"><div class="shiki-section__title">Связанные произведения (Сиквелы, Приквелы, OVA, Фильмы)</div></div>');
                var relGrid = $('<div class="shiki-grid"></div>');
                anime.related.forEach(function (relItem) {
                    var card = createCardElement(relItem, function (selected) {
                        openAnimeFullActivity(selected);
                    }, function (a, el) {
                        lastFocused = el;
                        scroll.update($(el), true);
                    });
                    if (relItem.relationText) {
                        card.find('.shiki-card__meta').text(relItem.relationText + ' · ' + relItem.release_year);
                    }
                    relGrid.append(card);
                });
                relSection.append(relGrid);
                body.append(relSection);
            }

            if (anime.chronology && anime.chronology.length > 1) {
                var chronoSection = $('<div class="shiki-section"></div>');
                chronoSection.append('<div class="shiki-section__head"><div class="shiki-section__title">Хронология франшизы</div></div>');
                var chronoGrid = $('<div class="shiki-grid"></div>');
                anime.chronology.forEach(function (chItem) {
                    var card = createCardElement(chItem, function (selected) {
                        openAnimeFullActivity(selected);
                    }, function (a, el) {
                        lastFocused = el;
                        scroll.update($(el), true);
                    });
                    chronoGrid.append(card);
                });
                chronoSection.append(chronoGrid);
                body.append(chronoSection);
            }
        };

        this.start = function () {
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render());
                    Lampa.Controller.collectionFocus(lastFocused || false, scroll.render());
                },
                left: function () {
                    if (Lampa.Navigator.canmove('left')) Lampa.Navigator.move('left');
                    else Lampa.Controller.toggle('menu');
                },
                right: function () {
                    if (Lampa.Navigator.canmove('right')) Lampa.Navigator.move('right');
                },
                up: function () {
                    if (Lampa.Navigator.canmove('up')) Lampa.Navigator.move('up');
                    else Lampa.Controller.toggle('head');
                },
                down: function () {
                    if (Lampa.Navigator.canmove('down')) Lampa.Navigator.move('down');
                },
                back: function () {
                    Lampa.Activity.backward();
                }
            });
            Lampa.Controller.toggle('content');
        };

        this.pause = function () {};
        this.stop = function () {};
        this.render = function () { return html; };
        this.destroy = function () {
            scroll.destroy();
            html.remove();
        };
    }

    function registerGlobalSearchSource() {
        if (!window.Lampa || !Lampa.Search || typeof Lampa.Search.addSource !== 'function') return;

        var searchSource = {
            title: 'Shikimori',
            search: function (params, onComplete) {
                var query = decodeURIComponent(params.query || '').trim();
                if (!query) {
                    onComplete([]);
                    return;
                }
                ShikimoriAPI.fetchCatalog({
                    search: query,
                    limit: 20,
                    page: 1,
                    order: 'popularity'
                }, function (data) {
                    if (!data.results || !data.results.length) {
                        onComplete([]);
                        return;
                    }
                    onComplete([{
                        title: 'Аниме в каталоге Shikimori',
                        results: data.results
                    }]);
                }, function () {
                    onComplete([]);
                });
            },
            onCancel: function () {},
            params: {
                lazy: true,
                align_left: true
            },
            onMore: function (params, close) {
                close();
                openCategoryActivity({
                    title: 'Поиск: ' + params.query,
                    search: params.query,
                    order: 'popularity'
                });
            },
            onSelect: function (params, close) {
                close();
                if (params && params.element) {
                    openAnimeFullActivity(params.element);
                }
            }
        };

        Lampa.Search.addSource(searchSource);
    }

    function addMenuButton() {
        var svgIcon = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

        function openMainSection() {
            Lampa.Activity.push({
                url: '',
                title: 'Shikimori — Каталог аниме',
                component: 'shikimori_main',
                page: 1
            });
        }

        if (Lampa.Menu && typeof Lampa.Menu.addButton === 'function') {
            Lampa.Menu.addButton(svgIcon, 'Shikimori', openMainSection);
        } else {
            var menuItem = $('<li class="menu__item selector" data-action="shikimori">' +
                '<div class="menu__ico">' + svgIcon + '</div>' +
                '<div class="menu__text">Shikimori</div>' +
            '</li>');
            menuItem.on('hover:enter click', openMainSection);
            $('.menu .menu__list').eq(0).append(menuItem);
        }
    }

    function initPlugin() {
        if (!window.Lampa) return;

        if (Lampa.Manifest) {
            Lampa.Manifest.plugins = PLUGIN_MANIFEST;
        }

        Lampa.Component.add('shikimori_main', ShikimoriMainComponent);
        Lampa.Component.add('shikimori_category', ShikimoriCategoryComponent);
        Lampa.Component.add('shikimori_full', ShikimoriFullComponent);

        addMenuButton();
        registerGlobalSearchSource();
    }

    if (window.Lampa) {
        if (window.appready) {
            initPlugin();
        } else if (Lampa.Listener) {
            Lampa.Listener.follow('app', function (e) {
                if (e.type === 'ready') initPlugin();
            });
        }
    }

    window.ShikimoriLampaPlugin = {
        manifest: PLUGIN_MANIFEST,
        api: ShikimoriAPI,
        normalizeAnimeItem: normalizeAnimeItem,
        cleanShikimoriText: cleanShikimoriText,
        genres: GENRES_LIST,
        sections: CATALOG_SECTIONS
    };
})();
