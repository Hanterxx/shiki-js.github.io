(function () {
  'use strict';

  var PLUGIN_ID = 'lampa_shikimori_catalog';
  var VERSION = '1.4.0';
  var API_ORIGIN = 'https://shikimori.io';
  var FALLBACK_API_ORIGIN = 'https://shikimori.one';
  var GRAPHQL_PATH = '/api/graphql';
  var PAGE_SIZE = 24;
  var CACHE_TTL = 15 * 60 * 1000;
  var CACHE_PREFIX = 'lampa_shikimori_v1:';

  var previousInstance = window[PLUGIN_ID];
  if (previousInstance && previousInstance.version === VERSION && previousInstance.initialized) return;
  window[PLUGIN_ID] = previousInstance || {};
  window[PLUGIN_ID].version = VERSION;

  function lampaReady() {
    return window.Lampa && Lampa.Component && Lampa.Activity && Lampa.Listener && Lampa.Scroll && Lampa.Controller && Lampa.Template;
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
  var activeCatalog = null;

  var labels = {
    kind: { tv: 'TV-серіал', movie: 'Фільм', ova: 'OVA', ona: 'ONA', special: 'Спецвипуск', tv_special: 'TV-спецвипуск', music: 'Музичне' },
    status: { anons: 'Анонсовано', ongoing: 'Виходить', released: 'Завершено' },
    season: { winter: 'Зима', spring: 'Весна', summer: 'Літо', fall: 'Осінь' }
  };

  var LIST_QUERY = 'query AnimeCatalog($page: PositiveInt!, $limit: PositiveInt!, $order: OrderEnum, $kind: AnimeKindString, $status: AnimeStatusString, $season: SeasonString, $genre: String) { animes(page: $page, limit: $limit, order: $order, kind: $kind, status: $status, season: $season, genre: $genre, censored: true) { id name russian kind status score episodes episodesAired duration airedOn { date } releasedOn { date } season url poster { main2xUrl originalUrl } genres { id name russian } } }';
  var DETAIL_QUERY = 'query AnimeDetail($ids: String) { animes(ids: $ids, limit: 1, censored: true) { id name russian english japanese kind status score episodes episodesAired duration airedOn { date } releasedOn { date } season rating url description poster { originalUrl main2xUrl } genres { id name russian } studios { id name } } }';

  function proxyOrigin() {
    var proxy = '';
    try { proxy = localStorage.getItem(CACHE_PREFIX + 'proxy') || ''; } catch (e) {}
    return proxy.replace(/\/$/, '');
  }

  function endpoint(path, origin) {
    var proxy = proxyOrigin();
    return proxy ? proxy + path : (origin || API_ORIGIN) + path;
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

    var origins = proxyOrigin() ? [''] : [API_ORIGIN, FALLBACK_API_ORIGIN];

    function attempt(index) {
      return fetch(endpoint(GRAPHQL_PATH, origins[index]), {
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
      }).catch(function (error) {
        if (index + 1 < origins.length && String(error.message || '').indexOf('Ліміт') < 0) return attempt(index + 1);
        throw error;
      });
    }

    return attempt(0);
  }

  function lampaGet(url) {
    return new Promise(function (resolve, reject) {
      if (!Lampa.Reguest) return reject(new Error('Lampa.Reguest недоступний'));
      var network = new Lampa.Reguest();
      if (network.timeout) network.timeout(15000);
      network.silent(url, resolve, function (error) { reject(error instanceof Error ? error : new Error('Помилка мережі Lampa')); });
    });
  }

  function requestRest(path) {
    var origins = proxyOrigin() ? [''] : [API_ORIGIN, FALLBACK_API_ORIGIN];
    function attempt(index) {
      var url = endpoint(path, origins[index]);
      return fetch(url, { headers: { 'Accept': 'application/json' }, mode: 'cors', credentials: 'omit' })
        .then(function (response) { if (!response.ok) throw new Error('HTTP ' + response.status); return response.json(); })
        .catch(function () { return lampaGet(url); })
        .catch(function (error) {
          if (index + 1 < origins.length) return attempt(index + 1);
          throw error;
        });
    }
    return attempt(0);
  }

  function requestGenres() {
    var cached = cacheGet('genres');
    if (cached) return Promise.resolve(cached);
    var origins = proxyOrigin() ? [''] : [API_ORIGIN, FALLBACK_API_ORIGIN];
    function attempt(index) {
      return fetch(endpoint('/api/genres', origins[index]), { headers: { 'Accept': 'application/json' }, mode: 'cors', credentials: 'omit' })
        .then(function (response) { if (!response.ok) throw new Error('HTTP ' + response.status); return response.json(); })
        .catch(function (error) {
          if (index + 1 < origins.length) return attempt(index + 1);
          return requestRest('/api/genres');
        });
    }
    return attempt(0).then(function (items) {
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
  function displayDate(value) {
    var match = String(dateValue(value)).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? match[3] + '.' + match[2] + '.' + match[1] : '';
  }

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

  function absoluteAsset(url) {
    if (!url) return '';
    return /^https?:\/\//i.test(url) ? url : API_ORIGIN + (url.charAt(0) === '/' ? url : '/' + url);
  }

  function normalizeRestAnime(anime) {
    var image = anime.image || {};
    return {
      id: anime.id,
      name: anime.name,
      russian: anime.russian,
      english: anime.english,
      japanese: anime.japanese,
      kind: anime.kind,
      status: anime.status,
      score: Number(anime.score || 0),
      episodes: anime.episodes || 0,
      episodesAired: anime.episodes_aired || 0,
      duration: anime.duration,
      airedOn: { date: anime.aired_on || '' },
      releasedOn: { date: anime.released_on || '' },
      season: anime.season,
      rating: anime.rating,
      url: absoluteAsset(anime.url),
      description: anime.description || '',
      poster: { main2xUrl: absoluteAsset(image.original || image.preview), originalUrl: absoluteAsset(image.original || image.preview) },
      genres: anime.genres || [],
      studios: anime.studios || []
    };
  }

  function restQuery(page) {
    var params = ['page=' + page, 'limit=' + PAGE_SIZE, 'order=' + encodeURIComponent(state.order), 'censored=true'];
    if (state.kind) params.push('kind=' + encodeURIComponent(state.kind));
    if (state.status) params.push('status=' + encodeURIComponent(state.status));
    if (state.season) params.push('season=' + encodeURIComponent(state.season));
    if (state.genre) params.push('genre=' + encodeURIComponent(state.genre));
    return '/api/animes?' + params.join('&');
  }

  function requestRestPage(page) {
    return requestRest(restQuery(page)).then(function (items) {
      return (Array.isArray(items) ? items : []).map(normalizeRestAnime);
    });
  }

  function loadDetail(id) {
    return requestGraphQL(DETAIL_QUERY, { ids: String(id) }).then(function (data) {
      return data.animes && data.animes[0];
    }).catch(function () {
      return requestRest('/api/animes/' + encodeURIComponent(id)).then(normalizeRestAnime);
    });
  }

  function loadPage(page) {
    return requestGraphQL(LIST_QUERY, cleanVariables(page)).then(function (data) {
      return data.animes || [];
    }).catch(function () {
      return requestRestPage(page);
    }).then(function (animes) {
      var items = animes.map(asCard);
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
      items: items.map(function (item) {
        return { title: item.title, value: item.value, selected: item.value === selected, separator: Boolean(item.separator) };
      }),
      onSelect: function (item) { Lampa.Controller.toggle('content'); callback(item.value, item.title); },
      onBack: function () { Lampa.Controller.toggle('content'); }
    });
  }

  function refreshCatalog() {
    if (activeCatalog && typeof activeCatalog.reload === 'function') activeCatalog.reload();
  }

  function yearItems() {
    var year = new Date().getFullYear();
    var seasons = [{ title: 'Усі сезони', value: '' }];
    var upcomingYear = year + 1;
    seasons.push({ title: 'Наступний рік', separator: true });
    seasons.push({ title: 'Увесь ' + upcomingYear + ' рік', value: String(upcomingYear) });
    ['winter', 'spring', 'summer', 'fall'].forEach(function (s) {
      seasons.push({ title: labels.season[s] + ' ' + upcomingYear, value: s + '_' + upcomingYear });
    });
    seasons.push({ title: 'Останні п’ять років', separator: true });
    for (var y = year; y >= year - 4; y--) {
      seasons.push({ title: 'Увесь ' + y + ' рік', value: String(y) });
      ['winter', 'spring', 'summer', 'fall'].forEach(function (s) {
        seasons.push({ title: labels.season[s] + ' ' + y, value: s + '_' + y });
      });
    }
    seasons.push({ title: 'За десятиліттями', separator: true });
    for (var decade = Math.floor(year / 10) * 10; decade >= 1910; decade -= 10) {
      seasons.push({ title: decade + '-ті', value: String(decade).slice(0, 3) + 'x' });
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

  function openInLampa(anime) {
    var titles = [anime.russian, anime.name].filter(function (value, index, array) {
      return value && array.indexOf(value) === index;
    });
    var expectedType = anime.kind === 'movie' ? 'movie' : 'tv';
    var targetYear = parseInt(dateValue(anime.airedOn).slice(0, 4), 10) || 0;

    function normalize(value) {
      return String(value || '').toLowerCase().replace(/[^a-zа-яёіїєґ0-9]+/gi, ' ').trim();
    }

    function fallbackSearch() {
      if (Lampa.Search && Lampa.Search.open) Lampa.Search.open({ input: titles[0] || anime.name || '' });
      else notifyError(new Error('Не вдалося знайти відповідну картку в каталозі Lampa'));
    }

    function openFull(candidate) {
      Lampa.Activity.push({
        url: candidate.url || '',
        title: candidate.title || candidate.name || titles[0],
        component: 'full',
        id: candidate.id,
        method: candidate._media_type || (candidate.name || candidate.first_air_date ? 'tv' : 'movie'),
        card: candidate,
        source: candidate.source || 'tmdb'
      });
    }

    function scoreCandidates(candidates) {
      var normalizedTitles = titles.map(normalize);
      return candidates.map(function (candidate) {
        var score = candidate._media_type === expectedType ? 35 : 0;
        var candidateYear = parseInt(String(candidate.release_date || candidate.first_air_date || '').slice(0, 4), 10) || 0;
        var candidateTitles = [candidate.title, candidate.name, candidate.original_title, candidate.original_name].map(normalize).filter(Boolean);
        var exactTitle = candidateTitles.some(function (title) { return normalizedTitles.indexOf(title) >= 0; });
        var partialTitle = !exactTitle && candidateTitles.some(function (title) {
          return normalizedTitles.some(function (expected) { return expected && (title.indexOf(expected) >= 0 || expected.indexOf(title) >= 0); });
        });
        if (exactTitle) score += 55;
        else if (partialTitle) score += 25;
        if (targetYear && candidateYear) score += candidateYear === targetYear ? 30 : Math.abs(candidateYear - targetYear) === 1 ? 12 : 0;
        return { item: candidate, score: score, year: candidateYear || '—' };
      }).sort(function (a, b) { return b.score - a.score; });
    }

    function choose(candidates) {
      if (Lampa.Loading && Lampa.Loading.stop) Lampa.Loading.stop();
      if (!candidates.length) return fallbackSearch();
      var scored = scoreCandidates(candidates);
      if (scored[0].score >= 75) return openFull(scored[0].item);

      var items = scored.slice(0, 7).map(function (entry) {
        return {
          title: (entry.item.title || entry.item.name || 'Без назви') + ' (' + entry.year + ')',
          subtitle: entry.item._media_type === 'movie' ? 'Фільм у Lampa' : 'Серіал у Lampa',
          candidate: entry.item
        };
      });
      items.push({ title: 'Пошук вручну', subtitle: titles[0] || anime.name, manual: true });
      Lampa.Select.show({
        title: 'Оберіть картку Lampa',
        items: items,
        onSelect: function (selected) {
          if (selected.manual) fallbackSearch();
          else openFull(selected.candidate);
        },
        onBack: function () { Lampa.Controller.toggle('content'); }
      });
    }

    function collect(result) {
      var candidates = [];
      if (result && result.movie && Array.isArray(result.movie.results)) result.movie.results.forEach(function (item) { item._media_type = 'movie'; candidates.push(item); });
      if (result && result.tv && Array.isArray(result.tv.results)) result.tv.results.forEach(function (item) { item._media_type = 'tv'; candidates.push(item); });
      return candidates;
    }

    function searchAt(index, accumulated) {
      if (index >= titles.length || !Lampa.Api || !Lampa.Api.search) return choose(accumulated);
      Lampa.Api.search({ query: encodeURIComponent(titles[index]) }, function (result) {
        var found = collect(result);
        if (found.length || index + 1 >= titles.length) choose(accumulated.concat(found));
        else searchAt(index + 1, accumulated);
      });
    }

    if (Lampa.Loading && Lampa.Loading.start) Lampa.Loading.start(function () { if (Lampa.Loading.stop) Lampa.Loading.stop(); });
    searchAt(0, []);
  }

  function Catalog(object) {
    var comp = this;
    var scroll = new Lampa.Scroll({ mask: true, over: true, step: 250, end_ratio: 2 });
    var filterButton = $('<div class="settings-folder selector shikimori-filter"><div class="settings-folder__icon"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 5h16v2H4V5m3 6h10v2H7v-2m3 6h4v2h-4v-2Z"/></svg></div><div class="settings-folder__name">Фільтри й сортування</div><div class="settings-folder__value"></div></div>');
    var body = $('<div class="category-full shikimori-grid"></div>');
    var currentPage = 1;
    var loading = false;
    var hasMore = true;
    var destroyed = false;
    var requestToken = 0;
    var lastFocused = filterButton[0];

    function navigator() {
      return window.Navigator || Lampa.Navigator;
    }

    function controllerIsContent() {
      var enabled = Lampa.Controller.enabled && Lampa.Controller.enabled();
      return Boolean(enabled && enabled.name === 'content');
    }

    function updateFilterText() {
      var season = state.season ? state.season.replace('_', ' ') : 'усі сезони';
      var status = labels.status[state.status] || 'усі статуси';
      var kind = labels.kind[state.kind] || 'усі типи';
      filterButton.find('.settings-folder__value').text(season + ' · ' + status + ' · ' + kind + ' · ' + state.genreTitle);
    }

    function isAttached(element) {
      return Boolean(element && document.body && document.body.contains(element));
    }

    function focusCollection() {
      var collection = scroll.render(true);
      Lampa.Controller.collectionSet(collection);
      var target = isAttached(lastFocused) ? lastFocused : filterButton[0];
      Lampa.Controller.collectionFocus(target, collection);
    }

    function showMessage(text, className) {
      body.html('<div class="shikimori-state ' + (className || '') + '">' + safe(text) + '</div>');
    }

    function appendCards(cards) {
      cards.forEach(function (data) {
        try {
          var anime = data.shikimori;
          var card = Lampa.Template.get('card', data);
          card.addClass('selector');
          card.attr('data-shikimori-id', data.id);

          var image = card.find('img');
          if (data.poster) image.attr('src', data.poster).removeClass('lazy');
          image.on('error', function () { this.onerror = null; this.src = './img/img_broken.svg'; });

          card.find('.card__title').text(data.title);
          if (data.release_year) card.find('.card__age').text(data.release_year);
          if (anime && anime.kind) card.find('.card__view').append('<div class="card__type">' + safe(labels.kind[anime.kind] || anime.kind) + '</div>');
          if (anime && Number(anime.score) > 0) card.find('.card__view').append('<div class="card__vote">' + Number(anime.score).toFixed(1) + '</div>');
          var premiere = anime && anime.status === 'anons' ? displayDate(anime.airedOn) : '';
          if (premiere) card.find('.card__view').append('<div class="shikimori-airdate">' + premiere + '</div>');

          card.on('hover:focus', function () {
            lastFocused = card[0];
            scroll.update(card);
            if (data.poster && Lampa.Background) Lampa.Background.change(data.poster);
          });
          card.on('hover:enter click', function () { openInLampa(anime); });
          card.on('hover:long', function () { Lampa.Activity.push({ title: data.title, component: 'shikimori_detail', anime_id: String(data.id), card: data }); });
          body.append(card);
        } catch (error) {
          console.warn('[Shikimori] card skipped:', data && data.id, error.message);
        }
      });
    }

    this.loadData = function () {
      if (loading || !hasMore || destroyed) return;
      loading = true;
      var token = requestToken;
      if (this.activity && this.activity.loader) this.activity.loader(true);

      loadPage(currentPage).then(function (data) {
        if (destroyed || token !== requestToken) return;
        loading = false;
        if (comp.activity && comp.activity.loader) comp.activity.loader(false);
        hasMore = data.results.length === PAGE_SIZE;

        if (!data.results.length && currentPage === 1) showMessage('За вибраними фільтрами нічого не знайдено.', 'shikimori-state--empty');
        else appendCards(data.results);

        if (comp.activity && comp.activity.toggle) comp.activity.toggle();
        if (controllerIsContent()) focusCollection();
      }).catch(function (error) {
        if (destroyed || token !== requestToken) return;
        loading = false;
        hasMore = false;
        if (comp.activity && comp.activity.loader) comp.activity.loader(false);
        if (currentPage === 1) showMessage('Не вдалося завантажити каталог: ' + (error.message || 'помилка мережі'), 'shikimori-state--error');
        notifyError(error);
        if (comp.activity && comp.activity.toggle) comp.activity.toggle();
      });
    };

    this.reload = function () {
      requestToken += 1;
      loading = false;
      currentPage = 1;
      hasMore = true;
      lastFocused = filterButton[0];
      body.empty();
      updateFilterText();
      this.loadData();
      if (controllerIsContent()) focusCollection();
    };

    this.create = function () {
      activeCatalog = this;
      scroll.minus();
      updateFilterText();
      filterButton.on('hover:focus', function () { lastFocused = filterButton[0]; scroll.update(filterButton); });
      filterButton.on('hover:enter click', openFilters);
      scroll.append(filterButton);
      scroll.append(body);
      scroll.onScroll = function () { if (Lampa.Layer && Lampa.Layer.visible) Lampa.Layer.visible(scroll.render(true)); };
      scroll.onWheel = function (step) {
        if (!Lampa.Controller.own(comp)) comp.start();
        var nav = navigator();
        if (nav) nav.move(step > 0 ? 'down' : 'up');
      };
      scroll.onEnd = function () {
        if (!loading && hasMore) { currentPage += 1; comp.loadData(); }
      };
      this.loadData();
      return this.render();
    };

    this.start = function () {
      activeCatalog = this;
      Lampa.Controller.add('content', {
        link: this,
        invisible: true,
        toggle: function () { if (scroll.restorePosition) scroll.restorePosition(); focusCollection(); },
        left: function () { var nav = navigator(); if (nav && nav.canmove('left')) nav.move('left'); else Lampa.Controller.toggle('menu'); },
        right: function () { var nav = navigator(); if (nav && nav.canmove('right')) nav.move('right'); },
        up: function () { var nav = navigator(); if (nav && nav.canmove('up')) nav.move('up'); else Lampa.Controller.toggle('head'); },
        down: function () { var nav = navigator(); if (nav && nav.canmove('down')) nav.move('down'); },
        back: function () { Lampa.Activity.backward(); }
      });
      Lampa.Controller.toggle('content');
    };

    this.pause = function () {};
    this.stop = function () {};
    this.render = function () { return scroll.render(); };
    this.destroy = function () {
      destroyed = true;
      requestToken += 1;
      if (activeCatalog === this) activeCatalog = null;
      scroll.destroy();
      filterButton.remove();
      body.remove();
    };
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
    function move(direction) {
      var nav = window.Navigator || Lampa.Navigator;
      if (nav) nav.move(direction);
    }
    this.create = function () {
      var self = this;
      this.activity.loader(true);
      scroll.append(body); html.append(scroll.render());
      loadDetail(object.anime_id).then(function (anime) {
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
      Lampa.Controller.add('content', { link: this, invisible: true, toggle: function(){ Lampa.Controller.collectionSet(scroll.render()); if(openButton) Lampa.Controller.collectionFocus(openButton, scroll.render()); }, up:function(){move('up');}, down:function(){move('down');}, left:function(){Lampa.Controller.toggle('menu');}, right:function(){}, back:function(){Lampa.Activity.backward();} });
      Lampa.Controller.toggle('content');
    };
    this.pause = function(){};
    this.stop = function(){};
    this.render = function(){ return html; };
    this.destroy = function(){ scroll.destroy(); html.remove(); };
  }

  function addStyles() {
    if ($('#shikimori-plugin-style').length) return;
    $('body').append('<style id="shikimori-plugin-style">.shikimori-filter{margin:0 0 1.5em}.shikimori-grid{min-height:12em}.shikimori-state{padding:3em 1em;text-align:center;font-size:1.15em;opacity:.75}.shikimori-state--error{color:#ffb3b3}.shikimori-airdate{position:absolute;left:.3em;bottom:.3em;padding:.25em .55em;border-radius:1em;background:rgba(0,0,0,.72);color:#fff;font-size:.9em;font-weight:600;z-index:2}.shikimori-detail{padding:2.2em 3em}.shikimori-detail__hero{display:flex;gap:2.2em;max-width:1200px}.shikimori-detail__poster{width:16em;max-height:25em;object-fit:cover;border-radius:.6em}.shikimori-detail__info{max-width:48em}.shikimori-detail__title{font-size:2.2em;font-weight:700;line-height:1.15}.shikimori-detail__original{opacity:.55;margin:.45em 0 1em}.shikimori-detail__meta{font-size:1.15em;margin-bottom:1.1em}.shikimori-detail__line{margin:.5em 0}.shikimori-detail__description{line-height:1.45;margin:1.4em 0;white-space:pre-line}.shikimori-detail__button{display:inline-block;padding:.8em 1.2em;border-radius:.4em;background:rgba(255,255,255,.12)}.shikimori-detail__button.focus{background:#fff;color:#111}.shikimori-detail__notice,.shikimori-detail__error{opacity:.6;margin-top:1.2em}@media(max-width:700px){.shikimori-detail{padding:1em}.shikimori-detail__hero{display:block}.shikimori-detail__poster{width:10em;margin-bottom:1em}.shikimori-detail__title{font-size:1.6em}}</style>');
  }

  function addMenuButtonWhenReady(icon) {
    var plugin = window[PLUGIN_ID];

    function openCatalog() {
      Lampa.Activity.push({ url: 'shikimori', title: 'Shikimori · поточний сезон', component: 'shikimori_catalog', page: 1 });
    }

    function addButton() {
      if (plugin.menuAdded) return true;

      try {
        var button = Lampa.Menu.addButton(icon, 'Shikimori', openCatalog);
        if (!button || !button.length) return false;

        button.attr('data-action', 'shikimori');
        button.addClass('menu__item--shikimori');
        plugin.menuAdded = true;
        return true;
      } catch (error) {
        console.warn('[Shikimori] menu is not ready yet:', error.message);
        return false;
      }
    }

    if (window.appready && addButton()) return;

    Lampa.Listener.follow('menu', function (event) {
      if (event && (event.type === 'start' || event.type === 'end')) addButton();
    });

    Lampa.Listener.follow('app', function (event) {
      if (event && event.type === 'ready') addButton();
    });
  }

  function init() {
    if (window[PLUGIN_ID].initialized) return;
    if (!Lampa.Manifest || Number(Lampa.Manifest.app_digital || 0) < 300) {
      notifyError(new Error('Потрібна Lampa 3.0 або новіша.'));
      return;
    }
    addStyles();
    Lampa.Component.add('shikimori_catalog', Catalog);
    Lampa.Component.add('shikimori_detail', Detail);
    var icon = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2m-4.8 8.5h2.4v-2h1.8v2h2.4v1.8h-2.4v2H9.6v-2H7.2m9.1 4.2c-1.2 0-2.2-1-2.2-2.2h1.5c0 .4.3.7.7.7s.7-.3.7-.7h1.5c0 1.2-1 2.2-2.2 2.2Z"/></svg>';
    addMenuButtonWhenReady(icon);
    window[PLUGIN_ID].initialized = true;
    console.log('[Shikimori] plugin ' + VERSION + ' ready');
  }

  if (lampaReady()) init();
  else {
    var timer = setInterval(function(){ if(lampaReady()){ clearInterval(timer); init(); } }, 250);
    setTimeout(function(){ clearInterval(timer); }, 30000);
  }
})();
