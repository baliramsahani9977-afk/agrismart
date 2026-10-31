(function () {
  'use strict';

  const weather = window.AgriWeather;
  const runButton = document.getElementById('run-tests');
  const summary = document.getElementById('summary');
  const resultList = document.getElementById('test-results');
  const tests = [];

  function test(name, run) { tests.push({ name, run }); }
  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }
  function response(body, ok) {
    return { ok: ok !== false, json: async () => body };
  }
  function mockFetch(handler) {
    const calls = [];
    const fetcher = async (url, options) => {
      calls.push({ url: new URL(url), options });
      return handler(calls[calls.length - 1]);
    };
    fetcher.calls = calls;
    return fetcher;
  }
  function locationData(overrides) {
    return Object.assign({ name: 'Springfield', admin1: 'Illinois', country: 'United States', country_code: 'US', latitude: 39.8, longitude: -89.6 }, overrides || {});
  }
  function forecastData() {
    return {
      current: { time: '2026-10-28T12:00', temperature_2m: 19.4, apparent_temperature: 18.1, relative_humidity_2m: 63, wind_speed_10m: 11.2, weather_code: 2 },
      daily: {
        time: ['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'],
        temperature_2m_max: [20, 21, 18, 17, 16, 15],
        temperature_2m_min: [10, 11, 9, 8, 7, 6],
        weather_code: [1, 2, 3, 61, 0, 95]
      }
    };
  }

  test('maps documented clear-sky and thunderstorm codes to descriptions and icons', () => {
    assert(weather.describeWeatherCode(0).description === 'Clear sky', 'WMO code 0 should be clear sky');
    assert(weather.describeWeatherCode(95).description === 'Thunderstorm', 'WMO code 95 should be thunderstorm');
    assert(weather.describeWeatherCode(97).description === 'Heavy thunderstorm', 'WMO code 97 should be heavy thunderstorm');
    assert(weather.describeWeatherCode(999).description === 'Conditions unavailable', 'Unknown codes should have a safe fallback');
  });

  test('rejects empty and one-character location searches without calling the API', async () => {
    const fetcher = mockFetch(() => response({ results: [] }));
    for (const query of ['', ' A ']) {
      let rejected = false;
      try { await weather.searchLocations(query, fetcher); } catch (error) { rejected = error.message.includes('two letters'); }
      assert(rejected, `Expected a helpful validation error for “${query}”`);
    }
    assert(fetcher.calls.length === 0, 'Invalid queries should not make network requests');
  });

  test('sends a global geocoding search and returns location choices', async () => {
    const places = [locationData(), locationData({ name: 'Springfield', admin1: 'Missouri', latitude: 37.2, longitude: -93.3 })];
    const fetcher = mockFetch(() => response({ results: places }));
    const found = await weather.searchLocations('Springfield', fetcher);
    assert(found.length === 2, 'Both same-name places should be available to the user');
    assert(fetcher.calls[0].url.hostname === 'geocoding-api.open-meteo.com', 'Expected Open-Meteo geocoding endpoint');
    assert(fetcher.calls[0].url.searchParams.get('name') === 'Springfield', 'Search term should be sent');
    assert(fetcher.calls[0].url.searchParams.get('count') === '10', 'Search should request multiple matches');
  });

  test('returns an empty match list for a location that is not found', async () => {
    const found = await weather.searchLocations('NoSuchTown', mockFetch(() => response({ results: [] })));
    assert(found.length === 0, 'A no-match response should be handled as an empty list');
  });

  test('requests real current and six daily records for a five-day forward forecast', async () => {
    const fetcher = mockFetch(() => response(forecastData()));
    const forecast = await weather.fetchForecast(locationData(), fetcher);
    const request = fetcher.calls[0].url;
    assert(request.hostname === 'api.open-meteo.com', 'Expected Open-Meteo forecast endpoint');
    assert(request.searchParams.get('current').includes('apparent_temperature'), 'Request should include apparent temperature');
    assert(request.searchParams.get('current').includes('relative_humidity_2m'), 'Request should include humidity');
    assert(request.searchParams.get('daily').includes('temperature_2m_max'), 'Request should include daily highs');
    assert(request.searchParams.get('daily').includes('temperature_2m_min'), 'Request should include daily lows');
    assert(request.searchParams.get('forecast_days') === '6', 'Six records allow today to be skipped while showing the next five days');
    const nextDays = weather.getNextFiveDays(forecast);
    assert(nextDays.length === 5 && nextDays[0].date === '2026-10-29' && nextDays[4].date === '2026-11-02', 'Forecast should contain the five days after the current local day');
    assert(nextDays[0].high === 21 && nextDays[0].low === 11 && nextDays[0].weatherCode === 2, 'Forecast daily values should stay associated by date');
  });

  test('rejects invalid coordinates before making a forecast request', async () => {
    const fetcher = mockFetch(() => response(forecastData()));
    let rejected = false;
    try { await weather.fetchForecast({ latitude: null, longitude: -2 }, fetcher); } catch (error) { rejected = error.message.includes('valid location'); }
    assert(rejected, 'Invalid coordinates should show a clear error');
    assert(fetcher.calls.length === 0, 'Invalid coordinates should not call the API');
  });

  test('shows a friendly message when the API returns an HTTP error', async () => {
    const fetcher = mockFetch(() => response({ reason: 'upstream failure' }, false));
    let rejected = false;
    try { await weather.searchLocations('Nairobi', fetcher); } catch (error) { rejected = error.message.includes('temporarily unavailable'); }
    assert(rejected, 'HTTP failures should become friendly retryable errors');
  });

  test('shows a friendly message when the network request fails', async () => {
    const fetcher = mockFetch(() => { throw new Error('network detail'); });
    let rejected = false;
    try { await weather.searchLocations('Nairobi', fetcher); } catch (error) { rejected = error.message.includes('internet connection'); }
    assert(rejected, 'Network failures should become friendly connection errors');
  });

  test('handles malformed or incomplete forecast responses safely', async () => {
    let rejected = false;
    try { await weather.fetchForecast(locationData(), mockFetch(() => response({ current: {} }))); } catch (error) { rejected = error.message.includes('complete forecast'); }
    assert(rejected, 'Incomplete forecast payloads should not be rendered as weather');
  });

  runButton.addEventListener('click', async () => {
    resultList.replaceChildren();
    runButton.disabled = true;
    let passed = 0;
    let failed = 0;
    for (const item of tests) {
      const row = document.createElement('li');
      try {
        await item.run();
        row.className = 'pass';
        row.textContent = `PASS - ${item.name}`;
        passed += 1;
      } catch (error) {
        row.className = 'fail';
        row.textContent = `FAIL - ${item.name}: ${error.message}`;
        failed += 1;
      }
      resultList.append(row);
    }
    summary.textContent = failed ? `${passed} passed, ${failed} failed out of ${tests.length} tests.` : `${passed}/${tests.length} tests passed.`;
    summary.className = failed ? 'fail' : 'pass';
    runButton.disabled = false;
  });
})();
