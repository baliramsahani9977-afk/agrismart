/* Open-Meteo geocoding and forecast client. No key or third-party package is required. */
(function (root) {
  'use strict';

  const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
  const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
  const WEATHER_CODES = {
    0: { description: 'Clear sky', icon: '☀️' },
    1: { description: 'Mainly clear', icon: '🌤️' },
    2: { description: 'Partly cloudy', icon: '⛅' },
    3: { description: 'Overcast', icon: '☁️' },
    45: { description: 'Fog', icon: '🌫️' },
    48: { description: 'Depositing rime fog', icon: '🌫️' },
    51: { description: 'Light drizzle', icon: '🌦️' },
    53: { description: 'Moderate drizzle', icon: '🌦️' },
    55: { description: 'Dense drizzle', icon: '🌧️' },
    56: { description: 'Light freezing drizzle', icon: '🌧️' },
    57: { description: 'Dense freezing drizzle', icon: '🌧️' },
    61: { description: 'Light rain', icon: '🌧️' },
    63: { description: 'Moderate rain', icon: '🌧️' },
    65: { description: 'Heavy rain', icon: '🌧️' },
    66: { description: 'Light freezing rain', icon: '🌧️' },
    67: { description: 'Heavy freezing rain', icon: '🌧️' },
    71: { description: 'Light snow', icon: '🌨️' },
    73: { description: 'Moderate snow', icon: '🌨️' },
    75: { description: 'Heavy snow', icon: '❄️' },
    77: { description: 'Snow grains', icon: '❄️' },
    80: { description: 'Light rain showers', icon: '🌦️' },
    81: { description: 'Moderate rain showers', icon: '🌧️' },
    82: { description: 'Violent rain showers', icon: '⛈️' },
    85: { description: 'Light snow showers', icon: '🌨️' },
    86: { description: 'Heavy snow showers', icon: '❄️' },
    95: { description: 'Thunderstorm', icon: '⛈️' },
    96: { description: 'Thunderstorm with slight hail', icon: '⛈️' },
    97: { description: 'Heavy thunderstorm', icon: '⛈️' },
    99: { description: 'Thunderstorm with heavy hail', icon: '⛈️' }
  };

  function describeWeatherCode(code) {
    const numericCode = Number(code);
    return WEATHER_CODES[numericCode] || { description: 'Conditions unavailable', icon: '—' };
  }

  function buildUrl(base, parameters) {
    const url = new URL(base);
    Object.entries(parameters).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    return url.toString();
  }

  function isCoordinate(value, minimum, maximum) {
    return value !== null && value !== undefined && String(value).trim() !== ''
      && Number.isFinite(Number(value)) && Number(value) >= minimum && Number(value) <= maximum;
  }

  async function requestJson(url, fetcher) {
    if (typeof fetcher !== 'function') throw new Error('Weather requests are not supported in this browser.');
    let response;
    try {
      response = await fetcher(url, { headers: { Accept: 'application/json' } });
    } catch {
      throw new Error('Could not connect to Open-Meteo. Check your internet connection and try again.');
    }
    if (!response || !response.ok) throw new Error('The weather service is temporarily unavailable. Please try again.');
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('The weather service returned an unreadable response. Please try again.');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('The weather service returned an unexpected response. Please try again.');
    }
    if (data.error) throw new Error('The weather service could not complete this request. Please try again.');
    return data;
  }

  async function searchLocations(query, fetcher) {
    const name = String(query == null ? '' : query).trim();
    if (name.length < 2) throw new Error('Enter at least two letters to search for a city or town.');
    const url = buildUrl(GEOCODING_URL, { name, count: 10, language: 'en', format: 'json' });
    const data = await requestJson(url, fetcher || root.fetch);
    if (data.results == null) return [];
    if (!Array.isArray(data.results)) throw new Error('The location search returned an unexpected response. Please try again.');
    return data.results.filter((place) => place
      && typeof place.name === 'string'
      && isCoordinate(place.latitude, -90, 90)
      && isCoordinate(place.longitude, -180, 180)
      && typeof place.country === 'string');
  }

  async function fetchForecast(location, fetcher) {
    if (!location || !isCoordinate(location.latitude, -90, 90) || !isCoordinate(location.longitude, -180, 180)) {
      throw new Error('Choose a valid location before loading its forecast.');
    }
    const url = buildUrl(FORECAST_URL, {
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min',
      temperature_unit: 'celsius',
      wind_speed_unit: 'kmh',
      timezone: 'auto',
      forecast_days: 6
    });
    const data = await requestJson(url, fetcher || root.fetch);
    if (!data.current || !data.daily || !Array.isArray(data.daily.time)) {
      throw new Error('A complete forecast was not available for this location. Please try another location.');
    }
    if (getNextFiveDays(data).length !== 5) {
      throw new Error('A complete five-day forecast was not available for this location. Please try again later.');
    }
    return data;
  }

  function getNextFiveDays(forecast) {
    const daily = forecast && forecast.daily;
    if (!daily || !Array.isArray(daily.time)) return [];
    const currentDate = forecast.current && typeof forecast.current.time === 'string'
      ? forecast.current.time.slice(0, 10)
      : daily.time[0];
    const indexes = daily.time.map((date, index) => ({ date, index }))
      .filter((item) => typeof item.date === 'string' && item.date > currentDate)
      .slice(0, 5);
    return indexes.map(({ date, index }) => ({
      date,
      high: Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max[index] : null,
      low: Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min[index] : null,
      weatherCode: Array.isArray(daily.weather_code) ? daily.weather_code[index] : null
    }));
  }

  function displayNumber(value, suffix) {
    if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return 'Unavailable';
    return `${Math.round(Number(value) * 10) / 10}${suffix}`;
  }

  function locationDescription(location) {
    return [location.admin1, location.country].filter((part) => typeof part === 'string' && part.trim()).join(', ')
      || location.country_code
      || 'Country unavailable';
  }

  function formattedDay(isoDate) {
    const parts = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(isoDate);
    if (!parts) return 'Date unavailable';
    const date = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), 12);
    return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function createElement(documentRef, tagName, className, text) {
    const element = documentRef.createElement(tagName);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }

  function initWeather(documentRef) {
    const doc = documentRef || root.document;
    const form = doc && doc.getElementById('weather-search-form');
    if (!form) return null;

    const input = doc.getElementById('weather-location');
    const searchButton = doc.getElementById('weather-search-button');
    const message = doc.getElementById('weather-message');
    const status = doc.getElementById('weather-status');
    const picker = doc.getElementById('weather-location-picker');
    const retryButton = doc.getElementById('weather-retry');
    const results = doc.getElementById('weather-results');
    let lastAction = null;

    function setBusy(isBusy, text) {
      searchButton.disabled = isBusy;
      message.className = `form-feedback weather-message${isBusy ? ' loading' : ''}`;
      message.textContent = text;
    }

    function fail(error) {
      status.textContent = 'WEATHER UNAVAILABLE';
      status.className = 'status-pill status-unavailable';
      results.hidden = true;
      setBusy(false, error.message || 'Weather data could not be loaded. Please try again.');
      message.classList.add('error');
      retryButton.hidden = false;
    }

    function placeLabel(place) {
      return [place.name, place.admin1, place.country].filter((part) => typeof part === 'string' && part.trim()).join(', ');
    }

    function renderForecast(location, forecast) {
      const current = forecast.current;
      const condition = describeWeatherCode(current.weather_code);
      doc.getElementById('weather-place-name').textContent = location.name;
      doc.getElementById('weather-place-region').textContent = locationDescription(location);
      doc.getElementById('current-weather-icon').textContent = condition.icon;
      doc.getElementById('current-weather-description').textContent = condition.description;
      doc.getElementById('current-temperature').textContent = displayNumber(current.temperature_2m, ' °C');
      doc.getElementById('current-apparent-temperature').textContent = displayNumber(current.apparent_temperature, ' °C');
      doc.getElementById('current-humidity').textContent = displayNumber(current.relative_humidity_2m, '%');
      doc.getElementById('current-wind').textContent = displayNumber(current.wind_speed_10m, ' km/h');
      const updated = typeof current.time === 'string' ? current.time.replace('T', ' ') : '';
      doc.getElementById('weather-updated').textContent = updated ? `Local forecast time: ${updated}` : '';

      const dailyContainer = doc.getElementById('weather-daily');
      dailyContainer.replaceChildren();
      getNextFiveDays(forecast).forEach((day) => {
        const dayCondition = describeWeatherCode(day.weatherCode);
        const card = createElement(doc, 'article', 'weather-day');
        createElement(doc, 'strong', '', formattedDay(day.date));
        const icon = createElement(doc, 'span', 'weather-icon', dayCondition.icon);
        icon.setAttribute('aria-label', dayCondition.description);
        card.append(icon);
        createElement(doc, 'p', '', dayCondition.description);
        const range = createElement(doc, 'div', 'weather-range');
        range.textContent = `${displayNumber(day.high, '°')} / `;
        const low = createElement(doc, 'span', '', displayNumber(day.low, '°'));
        range.append(low);
        card.append(range);
        dailyContainer.append(card);
      });
      results.hidden = false;
      status.textContent = 'LIVE DATA';
      status.className = 'status-pill status-local';
      retryButton.hidden = true;
      setBusy(false, `Live forecast loaded for ${placeLabel(location)}.`);
      message.classList.add('success');
      if (typeof root.CustomEvent === 'function') {
        doc.dispatchEvent(new root.CustomEvent('agri-weather-updated', { detail: { location, forecast } }));
      }
    }

    async function loadForecast(location) {
      lastAction = { type: 'forecast', location };
      picker.hidden = true;
      results.hidden = true;
      retryButton.hidden = true;
      status.textContent = 'LOADING';
      status.className = 'status-pill status-demo';
      setBusy(true, `Loading live weather for ${placeLabel(location)}…`);
      try {
        const forecast = await fetchForecast(location);
        renderForecast(location, forecast);
      } catch (error) {
        fail(error);
      }
    }

    async function search(query) {
      lastAction = { type: 'search', query };
      picker.hidden = true;
      results.hidden = true;
      retryButton.hidden = true;
      if (String(query || '').trim().length < 2) {
        status.textContent = 'READY TO SEARCH';
        status.className = 'status-pill status-local';
        setBusy(false, 'Enter at least two letters to search for a city or town.');
        message.classList.add('error');
        input.focus();
        return;
      }
      status.textContent = 'SEARCHING';
      status.className = 'status-pill status-demo';
      setBusy(true, 'Searching locations…');
      try {
        const locations = await searchLocations(query);
        if (!locations.length) {
          fail(new Error(`No matching city or town was found for “${query.trim()}”. Check the spelling or add a region or country.`));
          return;
        }
        if (locations.length === 1) {
          await loadForecast(locations[0]);
          return;
        }
        status.textContent = 'CHOOSE LOCATION';
        status.className = 'status-pill status-local';
        setBusy(false, `Found ${locations.length} possible locations. Select the correct one below.`);
        picker.replaceChildren();
        const label = createElement(doc, 'label', '', 'Choose a location');
        const select = createElement(doc, 'select');
        select.setAttribute('aria-label', 'Choose the matching city or town');
        locations.forEach((place, index) => {
          const option = createElement(doc, 'option', '', placeLabel(place));
          option.value = String(index);
          select.append(option);
        });
        label.append(select);
        const choose = createElement(doc, 'button', '', 'Show this forecast');
        choose.type = 'button';
        choose.addEventListener('click', () => {
          const place = locations[Number(select.value)];
          if (place) loadForecast(place);
        });
        picker.append(label, choose);
        picker.hidden = false;
      } catch (error) {
        fail(error);
      }
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      search(input.value);
    });
    retryButton.addEventListener('click', () => {
      if (!lastAction) return;
      if (lastAction.type === 'forecast') loadForecast(lastAction.location);
      else search(lastAction.query);
    });
    return { search, loadForecast };
  }

  root.AgriWeather = Object.freeze({
    searchLocations,
    fetchForecast,
    describeWeatherCode,
    getNextFiveDays,
    initWeather,
    endpoints: Object.freeze({ geocoding: GEOCODING_URL, forecast: FORECAST_URL })
  });
  if (root.document) initWeather(root.document);
})(typeof globalThis !== 'undefined' ? globalThis : window);
