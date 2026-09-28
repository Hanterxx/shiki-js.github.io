(function () {
    'use strict';

    if (window.plugin_shikimori_ready) return;
    window.plugin_shikimori_ready = true;

    var PLUGIN_MANIFEST = {
        type: 'video',
        version: '3.0.1',
        name: 'Shikimori',
        description: 'Каталог аниме Shikimori (Native UI) для Lampa',
        component: 'shikimori_page'
    };

    var CONFIG = {
        primaryDomain: 'https://shikimori.io',
        fallbackDomain: 'https://shikimori.one',
        timeout: 12000,
        pageSize: 30
    };

    function cleanShikimoriText(text) {
        if (!text) return '';
        return String(text).replace(/\[.*?\]/g, '').replace(/\r\n/g, '\n').trim();
    }

    var ShikimoriAPI = {
        fetchCatalog: function (params, onSuccess, onError) {
            var page = Number(params.page) || 1;
            var limit = Number(params.limit) || CONFIG.pageSize;
            var order = params.order || 'popularity';
            
            var args = ['page: ' + page, 'limit: ' + limit, 'order: ' + order, 'censored: true'];
            if (params.status) args.push('status: "' + params.status + '"');
            if (params.kind) args.push('kind: "' + params.kind + '"');
            if (params.search) args.push('search: "' + String(params.search).replace(/"/g, '\\"') + '"');

            var query = '{ animes(' + args.join(', ') + ') { id name russian kind score status episodes episodesAired airedOn { year } poster { originalUrl mainUrl } } }';

            fetch(CONFIG.primaryDomain + '/api/graphql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ query: query })
            })
            .then(function (res) { if (!res.ok) throw new Error(); return res.json(); })
            .then(function (json) {
                var list = (json && json.data && json.data.animes) ? json.data.animes : [];
                onSuccess(list);
            })
            .catch(function () {
                var q = ['page=' + page, 'limit=' + limit, 'order=' + order];
                if (params.status) q.push('status=' + params.status);
                if (params.kind) q.push('kind=' + params.kind);
                if (params.search) q.push('search=' + encodeURIComponent(params.search));
                
                var net = new Lampa.Reguest();
                net.silent(CONFIG.primaryDomain + '/api/animes?' + q.join('&'), function (restList) {
                    onSuccess(Array.isArray(restList) ? restList : []);
                }, function () {
                    if (onError) onError();
                });
            });
        }
    };

    function matchAndWatchInLampa(anime) {
        if (!window.Lampa) return;
        var queries = [anime.russian, anime.name].filter(Boolean);
        var targetYear = anime.airedOn && anime.airedOn.year ? parseInt(anime.airedOn.year) : (anime.aired_on ? parseInt(anime.aired_on.slice(0, 4)) : 0);
        var expectedType = anime.kind === 'movie' ? 'movie' : 'tv';

        function openGlobalSearchFallback() {
            if (Lampa.Search && typeof Lampa.Search.open === 'function') Lampa.Search.open({ input: anime.russian || anime.name });
        }

        if (!Lampa.Api || typeof Lampa.Api.search !== 'function') { openGlobalSearchFallback(); return; }

        if (Lampa.Loading && typeof Lampa.Loading.start === 'function') Lampa.Loading.start(function () { Lampa.Loading.stop(); });

        Lampa.Api.search({ query: encodeURIComponent(queries[0] || anime.name) }, function (res) {
            var candidates = [];
            if (res && res.movie && Array.isArray(res.movie.results)) { res.movie.results.forEach(function (m) { m._media_type = 'movie'; candidates.push(m); }); }
            if (res && res.tv && Array.isArray(res.tv.results)) { res.tv.results.forEach(function (t) { t._media_type = 'tv'; candidates.push(t); }); }
            
            if (!candidates.length && queries[1]) {
                Lampa.Api.search({ query: encodeURIComponent(queries[1]) }, function (retry) {
                    if (Lampa.Loading && typeof Lampa.Loading.stop === 'function') Lampa.Loading.stop();
                    if (retry && retry.tv && Array.isArray(retry.tv.results)) { retry.tv.results.forEach(function (t) { t._media_type = 'tv'; candidates.push(t); }); }
                    if (retry && retry.movie && Array.isArray(retry.movie.results)) { retry.movie.results.forEach(function (m) { m._media_type = 'movie'; candidates.push(m); }); }
                    presentCandidates(candidates);
                });
                return;
            }
            if (Lampa.Loading && typeof Lampa.Loading.stop === 'function') Lampa.Loading.stop();
            presentCandidates(candidates);
        }, function() {
            if (Lampa.Loading && typeof Lampa.Loading.stop === 'function') Lampa.Loading.stop();
            openGlobalSearchFallback();
        });

        function presentCandidates(candidates) {
            if (!candidates || !candidates.length) { openGlobalSearchFallback(); return; }
            var scored = candidates.map(function (c) {
                var s = 0;
                var cYear = parseInt((c.release_date || c.first_air_date || '').slice(0, 4), 10) || 0;
                var cTitle = String(c.title || c.name || '').toLowerCase().trim();
                if (c._media_type === expectedType) s += 25;
                if (targetYear && cYear) s += (cYear === targetYear ? 40 : (Math.abs(cYear - targetYear) === 1 ? 20 : 0));
                if (anime.russian && cTitle === anime.russian.toLowerCase().trim()) s += 50;
                return { item: c, score: s, year: cYear || '—' };
            });
            scored.sort(function (a, b) { return b.score - a.score; });

            if (scored[0].score >= 65) {
                var best = scored[0].item;
                Lampa.Activity.push({ url: '', card: best, id: best.id, method: best._media_type || (best.name ? 'tv' : 'movie'), source: 'tmdb', component: 'full' });
                return;
            }

            var menuItems = scored.slice(0, 6).map(function (entry) {
                var c = entry.item;
                return {
                    title: (c.title || c.name) + ' (' + entry.year + ')',
                    subtitle: (c._media_type === 'movie' ? 'Фильм' : 'Сериал') + ' · База Lampa',
                    card: c
                };
            });
            menuItems.push({ title: '🔍 Искать вручную', subtitle: 'Глобальный поиск по названию', searchFallback: true });

            if (Lampa.Select && typeof Lampa.Select.show === 'function') {
                var prevCtrl = Lampa.Controller.enabled().name;
                Lampa.Select.show({
                    title: 'Выберите подходящий тайтл',
                    items: menuItems,
                    onSelect: function (sel) {
                        if (sel.searchFallback) { openGlobalSearchFallback(); return; }
                        Lampa.Activity.push({ url: '', card: sel.card, id: sel.card.id, method: sel.card._media_type || (sel.card.name ? 'tv' : 'movie'), source: 'tmdb', component: 'full' });
                    },
                    onBack: function () { Lampa.Controller.toggle(prevCtrl || 'content'); }
                });
            }
        }
    }

    function ShikimoriComponent() {
        var comp = this;
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var html = $('<div></div>');
        var body = $('<div class="category-full"></div>');
        
        var current_page = 1;
        var is_loading = false;
        var has_more = true;
        var lastFocused = null;

        var filter_params = { order: 'popularity', kind: '', status: '', search: '' };
        var filter_names = {
            order: { 'popularity': 'По популярности', 'ranked': 'По рейтингу', 'aired_on': 'По дате выхода', 'name': 'По алфавиту', 'random': 'Случайные' },
            kind: { '': 'Все типы', 'tv': 'ТВ Сериал', 'movie': 'Фильм', 'ova': 'OVA', 'ona': 'ONA' },
            status: { '': 'Любой статус', 'released': 'Вышло', 'ongoing': 'Онгоинг', 'anons': 'Анонс' }
        };

        this.create = function () {
            html.append(scroll.render());
            scroll.append(body);

            this.buildFilterButton();
            this.loadData();

            scroll.onEnd = function () {
                if (!is_loading && has_more) {
                    current_page++;
                    comp.loadData();
                }
            };
            return this.render();
        };

        this.buildFilterButton = function () {
            var filter_btn = $('<div class="settings-folder selector" style="margin-bottom: 20px;"><div class="settings-folder__icon"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z"/></svg></div><div class="settings-folder__name">Фильтры, Сортировка и Поиск</div><div class="settings-folder__value">Настроить Shikimori</div></div>');

            filter_btn.on('hover:focus', function () { lastFocused = this; });
            filter_btn.on('hover:enter click', function () {
                var menu = [
                    { title: 'Сортировка: ' + filter_names.order[filter_params.order], type: 'order' },
                    { title: 'Тип: ' + filter_names.kind[filter_params.kind], type: 'kind' },
                    { title: 'Статус: ' + filter_names.status[filter_params.status], type: 'status' },
                    { title: 'Поиск по названию: ' + (filter_params.search || 'Отключен'), type: 'search' },
                    { title: 'Сбросить поиск', type: 'reset_search' }
                ];

                Lampa.Select.show({
                    title: 'Настройки Shikimori',
                    items: menu,
                    onSelect: function (a) {
                        if (a.type === 'order') {
                            Lampa.Select.show({ title: 'Сортировка', items: [{ title: 'По популярности', value: 'popularity' }, { title: 'По рейтингу', value: 'ranked' }, { title: 'По дате выхода', value: 'aired_on' }, { title: 'По алфавиту', value: 'name' }], onSelect: function (b) { filter_params.order = b.value; comp.reload(); } });
                        } else if (a.type === 'kind') {
                            Lampa.Select.show({ title: 'Тип', items: [{ title: 'Все типы', value: '' }, { title: 'ТВ Сериал', value: 'tv' }, { title: 'Фильм', value: 'movie' }, { title: 'OVA', value: 'ova' }, { title: 'ONA', value: 'ona' }], onSelect: function (b) { filter_params.kind = b.value; comp.reload(); } });
                        } else if (a.type === 'status') {
                            Lampa.Select.show({ title: 'Статус', items: [{ title: 'Любой статус', value: '' }, { title: 'Вышло', value: 'released' }, { title: 'Онгоинг', value: 'ongoing' }, { title: 'Анонс', value: 'anons' }], onSelect: function (b) { filter_params.status = b.value; comp.reload(); } });
                        } else if (a.type === 'search') {
                            if (Lampa.Input) {
                                Lampa.Input.edit({ title: 'Поиск аниме', value: filter_params.search, free: true, nosave: true }, function (new_val) {
                                    filter_params.search = new_val; comp.reload();
                                });
                            }
                        } else if (a.type === 'reset_search') {
                            filter_params.search = ''; comp.reload();
                        }
                    },
                    onBack: function () { Lampa.Controller.toggle('content'); }
                });
            });

            body.append(filter_btn);
        };

        this.reload = function () {
            body.find('.card').remove();
            body.find('.empty').remove();
            current_page = 1;
            has_more = true;
            this.loadData();
        };

        this.loadData = function () {
            is_loading = true;
            if (comp.activity && typeof comp.activity.loader === 'function') comp.activity.loader(true);

            ShikimoriAPI.fetchCatalog(
                { page: current_page, limit: CONFIG.pageSize, order: filter_params.order, kind: filter_params.kind, status: filter_params.status, search: filter_params.search },
                function (results) {
                    if (comp.activity && typeof comp.activity.loader === 'function') comp.activity.loader(false);
                    is_loading = false;
                    
                    if (results.length < CONFIG.pageSize) has_more = false;

                    if (results.length === 0 && current_page === 1) {
                        body.append('<div class="empty">По данным фильтрам ничего не найдено</div>');
                    } else {
                        comp.build(results);
                    }

                    if (Lampa.Controller.enabled().name === 'content') Lampa.Controller.toggle('content');
                },
                function () {
                    if (comp.activity && typeof comp.activity.loader === 'function') comp.activity.loader(false);
                    is_loading = false;
                    has_more = false;
                    if (current_page === 1) body.append('<div class="empty">Ошибка сети. Сервер Shikimori недоступен.</div>');
                }
            );
        };

        this.build = function (data) {
            data.forEach(function (anime) {
                var posterUrl = '';
                if (anime.poster) posterUrl = anime.poster.originalUrl || anime.poster.mainUrl || anime.poster.previewUrl || '';
                if (posterUrl && posterUrl.indexOf('/') === 0) posterUrl = CONFIG.primaryDomain + posterUrl;

                var releaseYear = anime.airedOn && anime.airedOn.year ? anime.airedOn.year : (anime.aired_on ? anime.aired_on.slice(0, 4) : '—');

                var item = {
                    title: anime.russian || anime.name,
                    original_title: anime.name,
                    release_date: releaseYear + '-01-01',
                    img: posterUrl || './img/img_broken.svg',
                    background: posterUrl || './img/img_broken.svg'
                };

                var card = Lampa.Template.get('card', item);
                card.find('.card__image').attr('src', item.img);

                if (anime.score && parseFloat(anime.score) > 0) {
                    card.find('.card__view').append('<div class="card__vote">' + parseFloat(anime.score).toFixed(1) + '</div>');
                }

                card.on('hover:focus', function () { lastFocused = card[0]; });
                card.on('hover:enter click', function () { matchAndWatchInLampa(anime); });

                body.append(card);
            });
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
        this.render = function () { return scroll.render(); };
        this.destroy = function () { scroll.destroy(); html.remove(); body.remove(); };
    }

    function initPlugin() {
        if (!window.Lampa) return;
        if (Lampa.Manifest) Lampa.Manifest.plugins = PLUGIN_MANIFEST;

        Lampa.Component.add('shikimori_page', ShikimoriComponent);

        var svgIcon = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        
        function openMain() {
            Lampa.Activity.push({ url: '', title: 'Shikimori Каталог', component: 'shikimori_page', page: 1 });
        }

        if (Lampa.Menu && typeof Lampa.Menu.addButton === 'function') {
            Lampa.Menu.addButton(svgIcon, 'Shikimori', openMain);
        } else {
            var item = $('<li class="menu__item selector" data-action="shikimori"><div class="menu__ico">' + svgIcon + '</div><div class="menu__text">Shikimori</div></li>');
            item.on('hover:enter click', openMain);
            $('.menu .menu__list').eq(0).append(item);
        }
    }

    if (window.Lampa) {
        if (window.appready) initPlugin();
        else if (Lampa.Listener) Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') initPlugin(); });
    }
})();
