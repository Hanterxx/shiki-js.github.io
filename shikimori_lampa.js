(function () {
  'use strict';

  var PLUGIN_ID = 'lampa_shikimori_catalog';
  var VERSION = '1.0.0';
  var API_ORIGIN = 'https://shikimori.one';
  var GRAPHQL_PATH = '/api/graphql';
  var PAGE_SIZE = 24;
  var CACHE_TTL = 15 * 60 * 1000;
  var CACHE_PREFIX = 'lampa_shikimori_v1:';

  if (window[PLUGIN_ID]) return;
  window[PLUGIN_ID] = { version: VERSION };

  function lampaReady() {
    return window.Lampa && Lampa.Component && Lampa.Activity && Lampa.Maker;
  }

  function currentSeason() {
    var now = new Date();
    var month = now.getMonth() + 1;
    var name = month <= 2 || month === 12 ? 'winter' : month <= 5 ? 'spring' : month <= 8 ? 'summer' : 'fall';
    return name + '_' + now.getFullYear();
  }

  var state = {
    season: currentSeason(),
    status: '',
    kind: '',
    genre: '',
    genreTitle: 'Усі жанри',
    order: 'popularity'
  };

  var labels = {
    kind: { tv: 'TV-серіал', movie: 'Фільм', ova: 'OVA', ona: 'ONA', special: 'Спецвипуск', tv_special: 'TV-спецвипуск', music: 'Музичне' },
    status: { anons: 'Анонсовано', ongoing: 'Виходить', released: 'Завершено' },
    season: { winter: 'Зима', spring: 'Весна', summer: 'Літо', fall: 'Осінь' }
  };

  var LIST_QUERY = 'query AnimeCatalog($page: PositiveInt!, $limit: PositiveInt!, $order: OrderEnum, $kind: AnimeKindString, $status: AnimeStatusString, $season: SeasonString, $genre: String) { animes(page: $page, limit: $limit, order: $order, kind: $kind, status: $status, season: $season, genre: $genre, censored: true) { id name russian kind status score episodes episodesAired duration airedOn { date } releasedOn { date } season url poster { main2xUrl originalUrl } genres { id name russian } } }';
  var DETAIL_QUERY = 'query AnimeDetail($ids: String) { animes(ids: $ids, limit: 1, censored: true) { id name russian english japanese kind status score episodes episodesAired duration airedOn { date } releasedOn { date } season rating url description poster { originalUrl main2xUrl } genres { id name russian } studios { id name } } }';

  function endpoint(path) {
    var proxy = '';
    try { proxy = localStorage.getItem(CACHE_PREFIX + 'proxy') || ''; } catch (e) {}
    if (!proxy) return API_ORIGIN + path;
    return proxy.replace(/\/$/, '') + path;
  }

  function cacheGet(key) {
    try {
      var item = JSON.parse(localStorage.getItem(CACHE_PREFIX + key) || 'null');
      if (item && Date.now() - item.time < CACHE_TTL) return item.value;
    } catch (e) {}
    return null;
  }

  function cacheSet(key, value) {
    try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ time: Date.now(), value: value })); } catch (e) {}
  }

  function requestGraphQL(query, variables) {
    var cacheKey = 'gql:' + JSON.stringify(variables) + ':' + (query === DETAIL_QUERY ? 'detail' : 'list');
    var cached = cacheGet(cacheKey);
    if (cached) return Promise.resolve(cached);

    return fetch(endpoint(GRAPHQL_PATH), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query: query, variables: variables }),
      mode: 'cors',
      credentials: 'omit'
    }).then(function (response) {
      if (response.status === 429) throw new Error('Ліміт Shikimori вичерпано. Спробуйте пізніше.');
      if (!response.ok) throw new Error('Shikimori повернув HTTP ' + response.status);
      return response.json();
    }).then(function (json) {
      if (json.errors && json.errors.length) throw new Error(json.errors[0].message || 'Помилка GraphQL');
      cacheSet(cacheKey, json.data);
      return json.data;
    });
  }

  function requestGenres() {
    var cached = cacheGet('genres');
    if (cached) return Promise.resolve(cached);
    return fetch(endpoint('/api/genres'), { headers: { 'Accept': 'application/json' }, mode: 'cors', credentials: 'omit' })
      .then(function (response) {
        if (!response.ok) throw new Error('Не вдалося завантажити жанри');
        return response.json();
      }).then(function (items) {
        var result = items.filter(function (item) {
          return String(item.entry_type || '').toLowerCase() === 'anime' || String(item.kind || '').toLowerCase() === 'anime';
        });
        cacheSet('genres', result);
        return result;
      });
  }

  function cleanVariables(page) {
    var variables = { page: page, limit: PAGE_SIZE, order: state.order };
    if (state.kind) variables.kind = state.kind;
    if (state.status) variables.status = state.status;
    if (state.season) variables.season = state.season;
    if (state.genre) variables.genre = String(state.genre);
    return variables;
  }

  function titleFor(anime) { return anime.russian || anime.name || 'Без назви'; }
  function dateValue(value) { return value && (value.date || value) || ''; }

  function asCard(anime) {
    var year = dateValue(anime.airedOn).slice(0, 4);
    return {
      id: anime.id,
      title: titleFor(anime),
      original_title: anime.name,
      original_name: anime.kind === 'tv' ? anime.name : '',
      release_date: dateValue(anime.airedOn),
      first_air_date: anime.kind === 'tv' ? dateValue(anime.airedOn) : '',
      release_year: year,
      vote_average: anime.score || 0,
      poster: anime.poster && (anime.poster.main2xUrl || anime.poster.originalUrl),
      overview: anime.description || '',
      source: 'shikimori',
      shikimori: anime,
      params: { style: { name: 'default' } }
    };
  }

  function loadPage(page) {
    return requestGraphQL(LIST_QUERY, cleanVariables(page)).then(function (data) {
      var items = (data.animes || []).map(asCard);
      return { results: items, page: page, total_pages: items.length === PAGE_SIZE ? page + 1 : page };
    });
  }

  function notifyError(error) {
    var text = error && error.message ? error.message : 'Не вдалося отримати дані Shikimori';
    if (Lampa.Noty && Lampa.Noty.show) Lampa.Noty.show(text);
    else if (Lampa.Bell && Lampa.Bell.push) Lampa.Bell.push({ text: text });
    console.error('[Shikimori]', error);
  }

  function select(title, items, selected, callback) {
    Lampa.Select.show({
      title: title,
      items: items.map(function (item) { return { title: item.title, value: item.value, selected: item.value === selected }; }),
      onSelect: function (item) { Lampa.Controller.toggle('content'); callback(item.value, item.title); },
      onBack: function () { Lampa.Controller.toggle('content'); }
    });
  }

  function refreshCatalog() {
    var active = Lampa.Activity.active();
    if (active && active.component === 'shikimori_catalog' && active.activity) active.activity.refresh();
  }

  function yearItems() {
    var year = new Date().getFullYear();
    var seasons = [{ title: 'Усі сезони', value: '' }];
    for (var y = year + 1; y >= year - 12; y--) {
      ['winter', 'spring', 'summer', 'fall'].forEach(function (s) {
        seasons.push({ title: labels.season[s] + ' ' + y, value: s + '_' + y });
      });
    }
    return seasons;
  }

  function openFilters() {
    var root = [
      { title: 'Сезон і рік — ' + (state.season ? state.season.replace('_', ' ') : 'усі'), value: 'season' },
      { title: 'Статус — ' + (labels.status[state.status] || 'усі'), value: 'status' },
      { title: 'Тип — ' + (labels.kind[state.kind] || 'усі'), value: 'kind' },
      { title: 'Жанр — ' + state.genreTitle, value: 'genre' },
      { title: 'Сортування — ' + ({ popularity: 'популярність', ranked: 'рейтинг', aired_on: 'дата виходу', name: 'назва' }[state.order]), value: 'order' },
      { title: 'Скинути фільтри', value: 'reset' }
    ];
    select('Фільтри аніме', root, '', function (key) {
      if (key === 'reset') { state = { season: currentSeason(), status: '', kind: '', genre: '', genreTitle: 'Усі жанри', order: 'popularity' }; return refreshCatalog(); }
      if (key === 'season') return select('Сезон і рік', yearItems(), state.season, function (v) { state.season = v; refreshCatalog(); });
      if (key === 'status') return select('Статус', [{title:'Усі',value:''},{title:'Анонсовано',value:'anons'},{title:'Виходить',value:'ongoing'},{title:'Завершено',value:'released'}], state.status, function(v){state.status=v;refreshCatalog();});
      if (key === 'kind') return select('Тип', [{title:'Усі',value:''},{title:'TV-серіал',value:'tv'},{title:'Фільм',value:'movie'},{title:'OVA',value:'ova'},{title:'ONA',value:'ona'},{title:'Спецвипуск',value:'special'},{title:'Музичне',value:'music'}], state.kind, function(v){state.kind=v;refreshCatalog();});
      if (key === 'order') return select('Сортування', [{title:'Популярність',value:'popularity'},{title:'Рейтинг',value:'ranked'},{title:'Дата виходу',value:'aired_on'},{title:'Назва',value:'name'}], state.order, function(v){state.order=v;refreshCatalog();});
      if (key === 'genre') {
        requestGenres().then(function (genres) {
          var list = [{ title: 'Усі жанри', value: '' }].concat(genres.map(function (g) { return { title: g.russian || g.name, value: String(g.id) }; }));
          select('Жанр', list, state.genre, function(v, t){state.genre=v;state.genreTitle=t;refreshCatalog();});
        }).catch(notifyError);
      }
    });
  }

  function Catalog(object) {
    var comp = Lampa.Maker.make('Category', object);
    var filterIcon;
    comp.use({
      onCreate: function () {
        var self = this;
        this.activity.loader(true);
        loadPage(1).then(function (data) { self.build(data); }).catch(function (e) { notifyError(e); self.empty({ title: 'Помилка Shikimori', descr: e.message }); });
      },
      onNext: function (resolve, reject) {
        var self = this;
        loadPage(object.page || 2).then(function (data) {
          if (!data.results.length) { self.total_pages = object.page || 1; reject(); }
          else resolve(data);
        }).catch(function(e){ notifyError(e); reject(); });
      },
      onInstance: function (card, data) {
        card.use({
          onlyEnter: function () { Lampa.Activity.push({ title: data.title, component: 'shikimori_detail', anime_id: String(data.id), card: data }); },
          onFocus: function () { if (data.poster && Lampa.Background) Lampa.Background.change(data.poster); }
        });
      },
      onStart: function () {
        if (!filterIcon && Lampa.Head && Lampa.Head.addIcon) {
          filterIcon = Lampa.Head.addIcon('<svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 5h16v2H4V5m3 6h10v2H7v-2m3 6h4v2h-4v-2Z"/></svg>', openFilters);
          filterIcon.addClass('shikimori-filter-head');
        }
      },
      onPause: function () { if (filterIcon) { filterIcon.remove(); filterIcon = null; } },
      onDestroy: function () { if (filterIcon) filterIcon.remove(); }
    });
    return comp;
  }

  function safe(text) {
    var node = document.createElement('div'); node.textContent = text == null ? '' : String(text); return node.innerHTML;
  }

  function meta(anime) {
    var parts = [];
    if (anime.kind) parts.push(labels.kind[anime.kind] || anime.kind);
    if (anime.status) parts.push(labels.status[anime.status] || anime.status);
    if (anime.score) parts.push('★ ' + anime.score);
    if (anime.episodes) parts.push((anime.episodesAired || 0) + '/' + anime.episodes + ' еп.');
    if (anime.duration) parts.push(anime.duration + ' хв');
    return parts.join(' · ');
  }

  function Detail(object) {
    var scroll = new Lampa.Scroll({ mask: true, over: true, step: 250 });
    var html = $('<div class="shikimori-detail"></div>');
    var body = $('<div class="shikimori-detail__body"></div>');
    var openButton;
    this.create = function () {
      var self = this;
      this.activity.loader(true);
      scroll.append(body); html.append(scroll.render());
      requestGraphQL(DETAIL_QUERY, { ids: String(object.anime_id) }).then(function (data) {
        var anime = data.animes && data.animes[0];
        if (!anime) throw new Error('Аніме не знайдено');
        var poster = anime.poster && (anime.poster.originalUrl || anime.poster.main2xUrl) || '';
        var genres = (anime.genres || []).map(function(g){ return g.russian || g.name; }).join(', ');
        var studios = (anime.studios || []).map(function(s){ return s.name; }).join(', ');
        body.html('<div class="shikimori-detail__hero">' + (poster ? '<img class="shikimori-detail__poster" src="'+safe(poster)+'">' : '') + '<div class="shikimori-detail__info"><div class="shikimori-detail__title">'+safe(titleFor(anime))+'</div><div class="shikimori-detail__original">'+safe(anime.name)+'</div><div class="shikimori-detail__meta">'+safe(meta(anime))+'</div>' + (genres ? '<div class="shikimori-detail__line"><b>Жанри:</b> '+safe(genres)+'</div>' : '') + (studios ? '<div class="shikimori-detail__line"><b>Студії:</b> '+safe(studios)+'</div>' : '') + '<div class="shikimori-detail__line"><b>Період:</b> '+safe(dateValue(anime.airedOn) || '—')+' — '+safe(dateValue(anime.releasedOn) || '…')+'</div><div class="shikimori-detail__description">'+safe(anime.description || 'Опис відсутній.')+'</div><div class="selector shikimori-detail__button">Відкрити на Shikimori</div><div class="shikimori-detail__notice">Інформаційний каталог. Джерела відтворення не додаються.</div></div></div>');
        openButton = body.find('.shikimori-detail__button');
        openButton.on('hover:enter click', function(){
          var url = /^https?:\/\//i.test(anime.url || '') ? anime.url : API_ORIGIN + (String(anime.url || '').charAt(0) === '/' ? anime.url : '/' + anime.url);
          window.open(url, '_blank');
        });
        openButton.on('hover:focus', function(){ scroll.update(openButton, true); });
        self.activity.loader(false); self.activity.toggle();
      }).catch(function(e){ notifyError(e); self.activity.loader(false); body.html('<div class="shikimori-detail__error">Не вдалося завантажити картку.<br>'+safe(e.message)+'</div>'); self.activity.toggle(); });
      return this.render();
    };
    this.start = function () {
      Lampa.Controller.add('content', { link: this, invisible: true, toggle: function(){ Lampa.Controller.collectionSet(scroll.render()); if(openButton) Lampa.Controller.collectionFocus(openButton, scroll.render()); }, up:function(){Navigator.move('up');}, down:function(){Navigator.move('down');}, left:function(){Lampa.Controller.toggle('menu');}, right:function(){}, back:function(){Lampa.Activity.backward();} });
      Lampa.Controller.toggle('content');
    };
    this.pause = function(){};
    this.stop = function(){};
    this.render = function(){ return html; };
    this.destroy = function(){ scroll.destroy(); html.remove(); };
  }

  function addStyles() {
    if ($('#shikimori-plugin-style').length) return;
    $('body').append('<style id="shikimori-plugin-style">.shikimori-detail{padding:2.2em 3em}.shikimori-detail__hero{display:flex;gap:2.2em;max-width:1200px}.shikimori-detail__poster{width:16em;max-height:25em;object-fit:cover;border-radius:.6em}.shikimori-detail__info{max-width:48em}.shikimori-detail__title{font-size:2.2em;font-weight:700;line-height:1.15}.shikimori-detail__original{opacity:.55;margin:.45em 0 1em}.shikimori-detail__meta{font-size:1.15em;margin-bottom:1.1em}.shikimori-detail__line{margin:.5em 0}.shikimori-detail__description{line-height:1.45;margin:1.4em 0;white-space:pre-line}.shikimori-detail__button{display:inline-block;padding:.8em 1.2em;border-radius:.4em;background:rgba(255,255,255,.12)}.shikimori-detail__button.focus{background:#fff;color:#111}.shikimori-detail__notice,.shikimori-detail__error{opacity:.6;margin-top:1.2em}@media(max-width:700px){.shikimori-detail{padding:1em}.shikimori-detail__hero{display:block}.shikimori-detail__poster{width:10em;margin-bottom:1em}.shikimori-detail__title{font-size:1.6em}}</style>');
  }

  function init() {
    if (window[PLUGIN_ID].ready) return;
    window[PLUGIN_ID].ready = true;
    if (!Lampa.Manifest || Number(Lampa.Manifest.app_digital || 0) < 300) {
      notifyError(new Error('Потрібна Lampa 3.0 або новіша.'));
      return;
    }
    addStyles();
    Lampa.Component.add('shikimori_catalog', Catalog);
    Lampa.Component.add('shikimori_detail', Detail);
    var icon = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2m-4.8 8.5h2.4v-2h1.8v2h2.4v1.8h-2.4v2H9.6v-2H7.2m9.1 4.2c-1.2 0-2.2-1-2.2-2.2h1.5c0 .4.3.7.7.7s.7-.3.7-.7h1.5c0 1.2-1 2.2-2.2 2.2Z"/></svg>';
    Lampa.Menu.addButton(icon, 'Shikimori', function () { Lampa.Activity.push({ url: 'shikimori', title: 'Shikimori · поточний сезон', component: 'shikimori_catalog', page: 1 }); });
    console.log('[Shikimori] plugin ' + VERSION + ' ready');
  }

  if (lampaReady()) init();
  else {
    var timer = setInterval(function(){ if(lampaReady()){ clearInterval(timer); init(); } }, 250);
    setTimeout(function(){ clearInterval(timer); }, 30000);
  }
})();
