/* Seasonal scene selection and optional, user-requested location/weather context. */
(function (root) {
  'use strict';

  const SEASONS = ['winter', 'spring', 'summer', 'autumn', 'monsoon'];
  const SEASON_LABELS = { winter: 'Winter', spring: 'Spring', summer: 'Summer', autumn: 'Autumn', monsoon: 'Monsoon / rainy season' };
  const SEASON_ICONS = { winter: '❄️', spring: '🌱', summer: '☀️', autumn: '🍂', monsoon: '🌧️' };
  const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 97, 99]);
  const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);
  const FOG_CODES = new Set([45, 48]);

  function getRegion(location) {
    if (!location) return { india: true, hemisphere: 'north', zone: 'north-india', label: 'Northern India (default)' };
    const latitude = Number(location.latitude);
    const longitude = Number(location.longitude);
    const countryCode = String(location.country_code || location.countryCode || '').toUpperCase();
    const inIndia = countryCode === 'IN' || (Number.isFinite(latitude) && Number.isFinite(longitude)
      && latitude >= 6 && latitude <= 38 && longitude >= 68 && longitude <= 98);
    const hemisphere = Number.isFinite(latitude) && latitude < 0 ? 'south' : 'north';
    if (!inIndia) return { india: false, hemisphere, zone: hemisphere, label: [location.name, location.country].filter(Boolean).join(', ') || 'Selected location' };

    let zone = 'north-india';
    let label = 'India';
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      if (latitude >= 20 && longitude >= 88) { zone = 'northeast-india'; label = 'Northeast India'; }
      else if (latitude >= 8 && latitude <= 16 && longitude >= 78) { zone = 'southeast-india'; label = 'Southeast India'; }
      else if (latitude >= 8 && latitude <= 21 && longitude <= 77.5) { zone = 'southwest-india'; label = 'Southwest India'; }
      else { label = 'Northern India'; }
    } else if (location.name || location.country) {
      label = [location.name, location.country].filter(Boolean).join(', ');
    }
    return { india: true, hemisphere, zone, label };
  }

  function standardSeason(month, hemisphere) {
    const northMonth = hemisphere === 'south' ? ((month + 5) % 12) + 1 : month;
    if ([12, 1, 2].includes(northMonth)) return 'winter';
    if ([3, 4, 5].includes(northMonth)) return 'spring';
    if ([6, 7, 8].includes(northMonth)) return 'summer';
    return 'autumn';
  }

  function calendarSeason(date, location) {
    const region = getRegion(location);
    const month = date.getMonth() + 1;
    if (!region.india) {
      const id = standardSeason(month, region.hemisphere);
      return { id, label: SEASON_LABELS[id], region: region.label, hemisphere: region.hemisphere, basis: 'calendar' };
    }

    const monsoonMonths = {
      'north-india': [7, 8, 9],
      'southwest-india': [6, 7, 8, 9],
      'northeast-india': [5, 6, 7, 8, 9, 10],
      'southeast-india': [10, 11, 12]
    }[region.zone];
    let id;
    if (monsoonMonths.includes(month)) id = 'monsoon';
    else if ([12, 1, 2].includes(month)) id = 'winter';
    else if ([3, 4, 5, 6].includes(month)) id = 'summer';
    else id = 'autumn';
    return { id, label: SEASON_LABELS[id], region: region.label, hemisphere: 'north', basis: 'regional calendar' };
  }

  function weatherCondition(forecast) {
    if (!forecast || !forecast.current) return { mode: 'unknown', label: 'Actual weather not checked' };
    const currentCode = Number(forecast.current.weather_code);
    if (SNOW_CODES.has(currentCode)) return { mode: 'snow', label: 'Snow reported now' };
    if (FOG_CODES.has(currentCode)) return { mode: 'fog', label: 'Fog reported now' };
    if (RAIN_CODES.has(currentCode)) return { mode: 'rain', label: 'Rain or storm reported now' };

    const futureCodes = forecast.daily && Array.isArray(forecast.daily.weather_code)
      ? forecast.daily.weather_code.slice(1, 3).map(Number)
      : [];
    if (futureCodes.some((code) => SNOW_CODES.has(code))) return { mode: 'snow-forecast', label: 'Snow in the near forecast' };
    if (futureCodes.some((code) => FOG_CODES.has(code))) return { mode: 'fog-forecast', label: 'Fog in the near forecast' };
    if (futureCodes.some((code) => RAIN_CODES.has(code))) return { mode: 'rain-forecast', label: 'Rain in the near forecast' };
    const weather = root.AgriWeather && root.AgriWeather.describeWeatherCode(currentCode);
    return { mode: 'clear', label: weather ? `Weather now: ${weather.description}` : 'Current conditions available' };
  }

  function resolveScene(date, location, forecast, previewSeason) {
    const calendar = calendarSeason(date, location);
    const preview = SEASONS.includes(previewSeason) ? previewSeason : null;
    const condition = weatherCondition(forecast);
    const id = preview || calendar.id;
    const locationLabel = location
      ? ([location.name, location.country].filter(Boolean).join(', ') || `${Number(location.latitude).toFixed(2)}°, ${Number(location.longitude).toFixed(2)}°`)
      : 'Northern India (default)';
    return {
      id,
      label: SEASON_LABELS[id],
      calendarLabel: calendar.label,
      region: calendar.region,
      hemisphere: calendar.hemisphere,
      locationLabel,
      weatherMode: condition.mode,
      weatherLabel: preview ? `Preview · calendar: ${calendar.label} · ${condition.label}` : condition.label,
      preview: Boolean(preview)
    };
  }

  function previewOptionsFromUrl() {
    const allowedHosts = ['localhost', '127.0.0.1', '::1'];
    if (!root.location || !allowedHosts.includes(root.location.hostname)) return { season: null, rain: false };
    const parameters = new URLSearchParams(root.location.search);
    const value = parameters.get('season-preview');
    return { season: SEASONS.includes(value) ? value : null, rain: parameters.get('weather-preview') === 'rain' };
  }

  function initSeasonalScene(doc) {
    const documentRef = doc || root.document;
    const scene = documentRef && documentRef.getElementById('seasonal-scene');
    if (!scene) return null;
    const seasonLabel = documentRef.getElementById('seasonal-season-label');
    const locationLabel = documentRef.getElementById('seasonal-location-label');
    const weatherLabel = documentRef.getElementById('seasonal-weather-label');
    const icon = documentRef.getElementById('seasonal-indicator-icon');
    const locationButton = documentRef.getElementById('season-use-location');
    const feedback = documentRef.getElementById('season-location-feedback');
    const preview = previewOptionsFromUrl();
    let selectedLocation = null;
    let currentForecast = null;
    let midnightTimer;

    function render() {
      let state = resolveScene(new Date(), selectedLocation, currentForecast, preview.season);
      if (preview.rain) {
        state = Object.assign({}, state, {
          weatherMode: 'rain',
          weatherLabel: `Rain effect preview · not live weather · calendar: ${state.calendarLabel}`
        });
      }
      scene.classList.remove(...SEASONS.map((season) => `season-${season}`));
      scene.classList.remove('weather-rain', 'weather-rain-forecast', 'weather-snow', 'weather-snow-forecast', 'weather-fog', 'weather-fog-forecast', 'weather-clear', 'weather-unknown');
      scene.classList.add(`season-${state.id}`, `weather-${state.weatherMode}`);
      seasonLabel.textContent = `${state.label}${state.preview ? ' preview' : ''}`;
      locationLabel.textContent = selectedLocation ? state.locationLabel : 'Northern India (default)';
      weatherLabel.textContent = state.weatherLabel;
      icon.textContent = SEASON_ICONS[state.id];
      scene.setAttribute('aria-label', `${state.label} agricultural landscape for ${state.locationLabel}; ${state.weatherLabel}`);
      return state;
    }

    function scheduleMidnightRefresh() {
      root.clearTimeout(midnightTimer);
      const now = new Date();
      const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 2);
      midnightTimer = root.setTimeout(() => { render(); scheduleMidnightRefresh(); }, nextDay.getTime() - now.getTime());
    }

    async function loadCoordinates(latitude, longitude, name) {
      selectedLocation = { latitude, longitude, name: name || 'Approximate location', country: '', country_code: '' };
      currentForecast = null;
      render();
      feedback.textContent = 'Loading local weather to refine the seasonal scene…';
      try {
        if (!root.AgriWeather) throw new Error('Weather service unavailable');
        currentForecast = await root.AgriWeather.fetchForecast(selectedLocation);
        render();
        feedback.textContent = 'Location and current weather updated for this visit.';
      } catch {
        render();
        feedback.textContent = 'Location updated. Weather could not be loaded, so the scene is using the calendar and regional fallback.';
      }
    }

    locationButton.addEventListener('click', () => {
      feedback.textContent = '';
      if (!root.navigator || !root.navigator.geolocation) {
        feedback.textContent = 'Browser location is unavailable. Using Northern India by default; you can search a city in Weather Forecast.';
        return;
      }
      locationButton.disabled = true;
      locationButton.textContent = 'Finding location…';
      root.navigator.geolocation.getCurrentPosition((position) => {
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;
        const locationName = `Approx. location (${latitude.toFixed(2)}°, ${longitude.toFixed(2)}°)`;
        loadCoordinates(latitude, longitude, locationName).finally(() => {
          locationButton.disabled = false;
          locationButton.textContent = 'Refresh my location';
        });
      }, () => {
        locationButton.disabled = false;
        locationButton.textContent = 'Use my location';
        feedback.textContent = 'Location was not shared. Northern India remains the default; you can search a city in Weather Forecast instead.';
      }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 900000 });
    });

    documentRef.addEventListener('agri-weather-updated', (event) => {
      if (!event.detail || !event.detail.location || !event.detail.forecast) return;
      selectedLocation = event.detail.location;
      currentForecast = event.detail.forecast;
      render();
      feedback.textContent = 'Seasonal scene updated to match the selected forecast location.';
    });
    documentRef.addEventListener('visibilitychange', () => { if (!documentRef.hidden) render(); });
    render();
    scheduleMidnightRefresh();
    return { render, loadCoordinates };
  }

  root.AgriSeasonal = Object.freeze({
    calendarSeason,
    weatherCondition,
    resolveScene,
    initSeasonalScene,
    seasons: Object.freeze(SEASONS.slice())
  });
  if (root.document) initSeasonalScene(root.document);
})(typeof globalThis !== 'undefined' ? globalThis : window);
