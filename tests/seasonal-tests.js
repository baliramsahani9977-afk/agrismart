(function () {
  'use strict';

  const seasonal = window.AgriSeasonal;
  const runButton = document.getElementById('run-tests');
  const summary = document.getElementById('summary');
  const resultList = document.getElementById('test-results');
  const tests = [];

  function test(name, run) { tests.push({ name, run }); }
  function assert(condition, message) { if (!condition) throw new Error(message); }
  function date(month, day) { return new Date(2026, month - 1, day, 12); }
  function place(name, latitude, longitude, countryCode, country) {
    return { name, latitude, longitude, country_code: countryCode, country: country || '' };
  }

  test('uses the Northern India default when no location is supplied', () => {
    const result = seasonal.calendarSeason(date(1, 15), null);
    assert(result.id === 'winter' && result.region === 'Northern India (default)', 'Expected Northern India winter default');
  });

  test('maps the Northern India calendar to summer, monsoon, and autumn', () => {
    assert(seasonal.calendarSeason(date(4, 10), null).id === 'summer', 'April should use the warm-season scene');
    assert(seasonal.calendarSeason(date(8, 10), null).id === 'monsoon', 'August should use the monsoon scene');
    assert(seasonal.calendarSeason(date(10, 10), null).id === 'autumn', 'October should use the autumn scene');
  });

  test('uses a regional monsoon calendar for Northeast India', () => {
    const result = seasonal.calendarSeason(date(5, 20), place('Shillong', 25.6, 91.9, 'IN', 'India'));
    assert(result.id === 'monsoon' && result.region === 'Northeast India', 'Northeast India monsoon months should differ from the default calendar');
  });

  test('uses the northeast monsoon period for Southeast India', () => {
    const result = seasonal.calendarSeason(date(11, 8), place('Chennai', 13.1, 80.3, 'IN', 'India'));
    assert(result.id === 'monsoon' && result.region === 'Southeast India', 'Southeast India should use its regional rainy-season window');
  });

  test('shifts conventional calendar seasons in the Southern Hemisphere', () => {
    assert(seasonal.calendarSeason(date(1, 15), place('Sydney', -33.8, 151.2, 'AU', 'Australia')).id === 'summer', 'January should be summer in the Southern Hemisphere');
    assert(seasonal.calendarSeason(date(7, 15), place('Sydney', -33.8, 151.2, 'AU', 'Australia')).id === 'winter', 'July should be winter in the Southern Hemisphere');
  });

  test('falls back to calendar and region when weather data is unavailable', () => {
    const scene = seasonal.resolveScene(date(10, 10), null, null);
    assert(scene.id === 'autumn', 'Calendar season should still be selected without weather');
    assert(scene.weatherMode === 'unknown' && scene.weatherLabel === 'Actual weather not checked', 'Unavailable live weather should be clearly labeled');
  });

  test('adds rain, fog, and snow effects only when reported or forecast', () => {
    const rain = seasonal.weatherCondition({ current: { weather_code: 2 }, daily: { weather_code: [2, 61] } });
    const fog = seasonal.weatherCondition({ current: { weather_code: 45 } });
    const snow = seasonal.weatherCondition({ current: { weather_code: 71 } });
    assert(rain.mode === 'rain-forecast', 'Forecast rain should enable rain effects');
    assert(fog.mode === 'fog' && snow.mode === 'snow', 'Current fog and snow codes should map to their effects');
  });

  test('keeps the calendar season distinct from actual weather conditions', () => {
    const scene = seasonal.resolveScene(date(10, 10), null, { current: { weather_code: 61 }, daily: { weather_code: [61] } });
    assert(scene.id === 'autumn', 'Rain should not replace the calendar season');
    assert(scene.weatherMode === 'rain' && scene.weatherLabel.includes('Rain'), 'Rain should be reported separately as a weather effect');
  });

  test('development preview overrides the visual only and records the calendar season', () => {
    const scene = seasonal.resolveScene(date(4, 10), null, null, 'winter');
    assert(scene.id === 'winter' && scene.preview, 'Preview should force the requested scene');
    assert(scene.calendarLabel === 'Summer' && scene.weatherLabel.includes('calendar: Summer'), 'The preview should retain the real calendar context in its label');
  });

  test('loads the monsoon rain renderer as a separate optional module', () => {
    assert(window.AgriMonsoonRain && typeof window.AgriMonsoonRain.init === 'function', 'Expected the separate rain animation module to load');
  });

  runButton.addEventListener('click', () => {
    resultList.replaceChildren();
    runButton.disabled = true;
    let passed = 0;
    let failed = 0;
    tests.forEach((item) => {
      const row = document.createElement('li');
      try {
        item.run();
        row.className = 'pass';
        row.textContent = `PASS - ${item.name}`;
        passed += 1;
      } catch (error) {
        row.className = 'fail';
        row.textContent = `FAIL - ${item.name}: ${error.message}`;
        failed += 1;
      }
      resultList.append(row);
    });
    summary.textContent = failed ? `${passed} passed, ${failed} failed out of ${tests.length} tests.` : `${passed}/${tests.length} tests passed.`;
    summary.className = failed ? 'fail' : 'pass';
    runButton.disabled = false;
  });
})();
