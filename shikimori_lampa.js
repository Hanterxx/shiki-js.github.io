(function () {
    'use strict';

    if (window.plugin_shikimori_ready) return;
    window.plugin_shikimori_ready = true;

    var PLUGIN_MANIFEST = {
        type: 'video',
        version: '4.0.0', // Полный переход на Lampa.InteractionCategory
        name: 'Shikimori',
        description: 'Каталог аниме Shikimori (Native Lampa API)',
        component: 'shikimori_category'
    };

    var CONFIG = {
        primaryDomain: 'https://shikimori.io',
        fallbackDomain: 'https://shikimori.one',
        timeout: 12000,
        pageSize: 30
    };

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

    // Подготовка данных для нативного парсера Lampa
    function formatData(list) {
        var results = [];
        list.forEach(function (anime) {
            var posterUrl = '';
            if (anime.poster) posterUrl = anime.poster.mainUrl || anime.poster.originalUrl || anime.poster.previewUrl || '';
            else if (anime.image) posterUrl = anime.image.original || anime.image.preview || '';
            
            if (posterUrl && !posterUrl.startsWith('http')) {
                if (!posterUrl.startsWith('/')) posterUrl = '/' + posterUrl;
                posterUrl = CONFIG.primaryDomain + posterUrl;
            }

            var releaseYear = anime.airedOn && anime.airedOn.year ? anime.airedOn.year : (anime.aired_on ? anime.aired_on.slice(0, 4) : '');

            results.push({
                title: anime.russian || anime.name,
                original_title: anime.name,
                release_year: releaseYear, 
                img: posterUrl || './img/img_broken.svg',
                background_image: posterUrl || './img/img_broken.svg',
                score: anime.score,
                anime_data: anime // Сохраняем оригинал для передачи в плеер
            });
        });
        return results;
    }

    // ГЛАВНЫЙ КОМПОНЕНТ (на базе официального Lampa.InteractionCategory)
    function ShikimoriCategory(object) {
        var comp = new Lampa.InteractionCategory(object);

        comp.create = function () {
            var _this = this;
            this.activity.loader(true);
            
            ShikimoriAPI.fetchCatalog(object, function (list) {
                var data = {
                    results: formatData(list),
                    collection: true,
                    total_pages: list.length >= CONFIG.pageSize ? object.page + 1 : object.page
                };
                
                _this.build(data);
                
                if (!data.results.length) {
                    _this.empty('По данным фильтрам ничего не найдено');
                }
            }, this.empty.bind(this));
        };

        // Запрос следующей страницы по скроллу
        comp.nextPageReuest = function (obj, resolve, reject) {
            obj.page++;
            ShikimoriAPI.fetchCatalog(obj, function(list) {
                resolve({
                    results: formatData(list),
                    collection: true,
                    total_pages: list.length >= CONFIG.pageSize ? obj.page + 1 : obj.page
                });
            }, reject.bind(this));
        };

        // Настройка внешнего вида карточки при её создании
        comp.cardRender = function (obj, element, card) {
            card.onEnter = function () {
                matchAndWatchInLampa(element.anime_data);
            };
            
            if (element.score && parseFloat(element.score) > 0) {
                card.find('.card__view').append('<div class="card__vote">' + parseFloat(element.score).toFixed(1) + '</div>');
            }
        };

        // Меню фильтров
        comp.filter = function () {
            var filter_names = {
                order: { 'popularity': 'По популярности', 'ranked': 'По рейтингу', 'aired_on': 'По дате выхода', 'name': 'По алфавиту' },
                kind: { '': 'Все типы', 'tv': 'ТВ Сериал', 'movie': 'Фильм', 'ova': 'OVA', 'ona': 'ONA' },
                status: { '': 'Любой статус', 'released': 'Вышло', 'ongoing': 'Онгоинг', 'anons': 'Анонс' }
            };

            var items = [
                { title: 'Сортировка: ' + filter_names.order[object.order || 'popularity'], type: 'order' },
                { title: 'Тип: ' + filter_names.kind[object.kind || ''], type: 'kind' },
                { title: 'Статус: ' + filter_names.status[object.status || ''], type: 'status' },
                { title: 'Поиск: ' + (object.search || 'Отключен'), type: 'search' },
                { title: 'Сбросить фильтры', type: 'reset' }
            ];

            Lampa.Select.show({
                title: 'Фильтры Shikimori',
                items: items,
                onBack: function () { Lampa.Controller.toggle('content'); },
                onSelect: function (a) {
                    if (a.type === 'order') {
                        Lampa.Select.show({ title: 'Сортировка', items: [{ title: 'По популярности', value: 'popularity' }, { title: 'По рейтингу', value: 'ranked' }, { title: 'По дате выхода', value: 'aired_on' }, { title: 'По алфавиту', value: 'name' }], onSelect: function (b) { applyFilter('order', b.value); } });
                    } else if (a.type === 'kind') {
                        Lampa.Select.show({ title: 'Тип', items: [{ title: 'Все типы', value: '' }, { title: 'ТВ Сериал', value: 'tv' }, { title: 'Фильм', value: 'movie' }, { title: 'OVA', value: 'ova' }, { title: 'ONA', value: 'ona' }], onSelect: function (b) { applyFilter('kind', b.value); } });
                    } else if (a.type === 'status') {
                        Lampa.Select.show({ title: 'Статус', items: [{ title: 'Любой статус', value: '' }, { title: 'Вышло', value: 'released' }, { title: 'Онгоинг', value: 'ongoing' }, { title: 'Анонс', value: 'anons' }], onSelect: function (b) { applyFilter('status', b.value); } });
                    } else if (a.type === 'search') {
                        if (Lampa.Input) {
                            Lampa.Input.edit({ title: 'Поиск аниме', value: object.search || '', free: true, nosave: true }, function (val) { applyFilter('search', val); });
                        }
                    } else if (a.type === 'reset') {
                        object.order = 'popularity'; object.kind = ''; object.status = ''; object.search = '';
                        applyFilter('reset', '');
                    }
                }
            });

            function applyFilter(key, val) {
                var newObj = Lampa.Utils.cloneObj(object);
                newObj[key] = val;
                newObj.page = 1;
                if (key === 'reset') { newObj.order = 'popularity'; newObj.kind = ''; newObj.status = ''; newObj.search = ''; }
                Lampa.Activity.replace(newObj);
            }
        };

        // Открытие фильтров при клике "Вправо" с пульта
        comp.onRight = comp.filter.bind(comp);

        return comp;
    }

    function initPlugin() {
        if (!window.Lampa) return;
        if (Lampa.Manifest) Lampa.Manifest.plugins = PLUGIN_MANIFEST;

        Lampa.Component.add('shikimori_category', ShikimoriCategory);

        var svgIcon = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        
        function openMain() {
            Lampa.Activity.push({ url: '', title: 'Shikimori Каталог', component: 'shikimori_category', page: 1, order: 'popularity', kind: '', status: '', search: '' });
        }

        if (Lampa.Menu && typeof Lampa.Menu.addButton === 'function') {
            Lampa.Menu.addButton(svgIcon, 'Shikimori', openMain);
        } else {
            var item = $('<li class="menu__item selector" data-action="shikimori"><div class="menu__ico">' + svgIcon + '</div><div class="menu__text">Shikimori</div></li>');
            item.on('hover:enter click', openMain);
            $('.menu .menu__list').eq(0).append(item);
        }

        // Интеграция кнопки фильтра в верхнюю шапку (как в ПРимер.js)
        var filterButton = $("<div class=\"head__action head__settings selector\">\n            <svg height=\"36\" viewBox=\"0 0 38 36\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n                <rect x=\"1.5\" y=\"1.5\" width=\"35\" height=\"33\" rx=\"1.5\" stroke=\"currentColor\" stroke-width=\"3\"></rect>\n                <rect x=\"7\" y=\"8\" width=\"24\" height=\"3\" rx=\"1.5\" fill=\"currentColor\"></rect>\n                <rect x=\"7\" y=\"16\" width=\"24\" height=\"3\" rx=\"1.5\" fill=\"currentColor\"></rect>\n                <rect x=\"7\" y=\"25\" width=\"24\" height=\"3\" rx=\"1.5\" fill=\"currentColor\"></rect>\n                <circle cx=\"13.5\" cy=\"17.5\" r=\"3.5\" fill=\"currentColor\"></circle>\n                <circle cx=\"23.5\" cy=\"26.5\" r=\"3.5\" fill=\"currentColor\"></circle>\n                <circle cx=\"21.5\" cy=\"9.5\" r=\"3.5\" fill=\"currentColor\"></circle>\n            </svg>\n        </div>");
        
        var currentActivity;
        filterButton.hide().on('hover:enter click', function () {
            if (currentActivity && currentActivity.activity && currentActivity.activity.component) {
                var comp = typeof currentActivity.activity.component === 'function' ? currentActivity.activity.component() : currentActivity.activity.component;
                if (comp && comp.filter) comp.filter();
            }
        });
        $('.head .open--search').after(filterButton);

        Lampa.Listener.follow('activity', function (e) {
            if (e.type == 'start') currentActivity = e.object;
            setTimeout(function () {
                if (currentActivity && currentActivity.component !== 'shikimori_category') {
                    filterButton.hide();
                }
            }, 1000);

            if (e.type == 'start' && e.component == 'shikimori_category') {
                filterButton.show();
                currentActivity = e.object;
            }
        });
    }

    if (window.Lampa) {
        if (window.appready) initPlugin();
        else if (Lampa.Listener) Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') initPlugin(); });
    }
})();
