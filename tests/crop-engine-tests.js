(function () {
  'use strict';

  const engine = window.AgriCropEngine;
  const resultList = document.getElementById('test-results');
  const summary = document.getElementById('summary');
  const runButton = document.getElementById('run-tests');
  const integrationForm = document.getElementById('integration-crop-form');
  const integrationResults = document.getElementById('integration-crop-results');
  let integrationEngine = engine;
  const tests = [];
  if (window.AgriCropForm) {
    window.AgriCropForm.connect(integrationForm, integrationResults, () => integrationEngine, { scroll: false });
  }

  function test(name, run) { tests.push({ name, run }); }
  function assert(condition, message) {
    if (!condition) throw new Error(message || 'Assertion failed');
  }
  function sample(overrides) {
    return Object.assign({
      temperature: '25', rainfall: '800', ph: '6',
      nitrogen: '90', phosphorus: '42', potassium: '43', humidity: '65',
      location: 'Example region'
    }, overrides || {});
  }

  test('returns ranked crops with the strongest optimal-range match first', () => {
    const result = engine.recommend(sample());
    assert(result.status === 'results', 'Expected candidate results');
    assert(result.candidates[0].name === 'Maize', 'Maize should rank first for this test input');
    assert(result.candidates[0].optimalMatches === 3, 'Maize should match all three optimal ranges');
    assert(result.candidates[1].name === 'Common wheat', 'Wheat should follow with fewer optimal matches');
  });

  test('accepts exact absolute-range boundaries as lower-suitability candidates', () => {
    const result = engine.recommend(sample({ temperature: '10', rainfall: '400', ph: '4.5' }));
    const maize = result.candidates.find((crop) => crop.id === 'maize');
    assert(Boolean(maize), 'Maize should be inside all absolute boundaries');
    assert(maize.optimalMatches === 0, 'Boundary input should not be marked optimal');
    assert(maize.factors.every((factor) => factor.status === 'within-absolute'), 'All maize factors should be absolute-only');
  });

  test('rejects missing required screening values with clear validation errors', () => {
    const result = engine.recommend(sample({ rainfall: '' }));
    assert(result.status === 'invalid', 'Expected invalid result');
    assert(result.errors.some((message) => message.includes('Annual rainfall')), 'Expected rainfall validation message');
  });

  test('rejects invalid numeric ranges instead of scoring them', () => {
    const result = engine.recommend(sample({ ph: '14.1' }));
    assert(result.status === 'invalid', 'Expected invalid pH result');
    assert(result.errors.some((message) => message.includes('Soil pH')), 'Expected pH range message');
  });

  test('rejects negative nutrient measurements without applying an invented upper cutoff', () => {
    const negative = engine.recommend(sample({ nitrogen: '-0.1' }));
    const largeButFinite = engine.recommend(sample({ nitrogen: '50000' }));
    assert(negative.status === 'invalid', 'Negative N should fail basic input validation');
    assert(largeButFinite.status === 'results', 'Unitless N values should not be rejected by an arbitrary maximum');
    assert(largeButFinite.missingInformation.some((message) => message.includes('not scored')), 'N should still be disclosed as unscored');
  });

  test('validates the soil-type dropdown while clearly excluding it from scoring', () => {
    const invalid = engine.recommend(sample({ soilType: 'Moon dust' }));
    const valid = engine.recommend(sample({ soilType: 'Clay' }));
    assert(invalid.status === 'invalid', 'Unknown soil type should be rejected');
    assert(valid.status === 'results', 'A listed soil option should be accepted');
    assert(valid.missingInformation.some((message) => message.includes('soil texture') && message.includes('not scored')), 'Soil-type limitation should be disclosed');
  });

  test('returns no candidate when each crop fails at least one absolute range', () => {
    const result = engine.recommend(sample({ temperature: '0', rainfall: '100', ph: '2' }));
    assert(result.status === 'no-candidates', 'Expected no-candidates result');
    assert(result.candidates.length === 0, 'No crop should be returned as a candidate');
    assert(result.excluded.length === window.AgriCropData.crops.length, 'Every dataset crop should have an exclusion explanation');
  });

  test('discloses that entered NPK and humidity values are not scored', () => {
    const result = engine.recommend(sample());
    assert(result.missingInformation.some((message) => message.includes('NPK values received')), 'Expected NPK limitation');
    assert(result.missingInformation.some((message) => message.includes('Humidity was received')), 'Expected humidity limitation');
    assert(result.candidates.every((crop) => !('nutrientScore' in crop)), 'No nutrient score should be implied');
  });

  test('NPK changes do not alter ranks when nutrient thresholds are not in the dataset', () => {
    const baseline = engine.recommend(sample({ nitrogen: '10', phosphorus: '5', potassium: '8' }));
    const changedNpk = engine.recommend(sample({ nitrogen: '900', phosphorus: '700', potassium: '800' }));
    const baselineRanks = baseline.candidates.map((crop) => crop.id);
    const changedRanks = changedNpk.candidates.map((crop) => crop.id);
    assert(JSON.stringify(changedRanks) === JSON.stringify(baselineRanks), 'NPK values must not silently affect ranks without sourced, calibrated requirements');
    assert(changedNpk.missingInformation.some((message) => message.includes('NPK values received (N, P, K)')), 'NPK receipt should use the form labels and disclose that it is unscored');
  });

  test('stops safely when crop requirement data is empty or malformed', () => {
    const empty = engine.recommend(sample(), { sourceName: 'Empty', crops: [] });
    const malformed = engine.recommend(sample(), { sourceName: 'Bad', crops: [{ name: 'Unknown', sourceUrl: '#', requirements: {} }] });
    assert(empty.status === 'no-data', 'Expected a no-data response for an empty dataset');
    assert(malformed.status === 'no-data', 'Expected a no-data response for malformed ranges');
  });

  test('keeps input values unchanged while screening', () => {
    const input = sample();
    const before = JSON.stringify(input);
    engine.recommend(input);
    assert(JSON.stringify(input) === before, 'Input should not be mutated');
  });

  function submitIntegrationForm(values) {
    Object.entries(values).forEach(([name, value]) => {
      integrationForm.elements[name].value = value;
    });
    const event = new Event('submit', { bubbles: true, cancelable: true });
    integrationForm.dispatchEvent(event);
    return { event, text: integrationResults.textContent };
  }

  test('passes form fields through the adapter and displays engine-ranked candidates', () => {
    const submitted = submitIntegrationForm({
      location: 'Example region', soilType: 'Loamy', temperature: '25', nitrogen: '90',
      phosphorus: '42', potassium: '43', humidity: '65', ph: '6', rainfall: '800'
    });
    assert(submitted.event.defaultPrevented, 'The form should use the client-side screening handler');
    assert(submitted.text.includes('Preliminary crop candidates'), 'Expected the candidate result heading');
    assert(submitted.text.includes('Maize') && submitted.text.includes('3/3 optimal'), 'Expected the engine top candidate and its match count');
    assert(submitted.text.includes('Common wheat'), 'Expected the next engine-ranked candidate');
    assert(submitted.text.includes('NPK values received (N, P, K)'), 'Expected the supplied optional nutrients to reach result handling');
    assert(submitted.text.includes('Humidity was received'), 'Expected the supplied humidity value to reach result handling');
  });

  test('forwards every named field to the recommendation engine unchanged', () => {
    let captured;
    integrationEngine = { recommend(input) { captured = input; return { status: 'invalid', errors: ['Captured test input.'] }; } };
    const values = {
      location: 'Test farm', soilType: 'Clay', temperature: '22.5', nitrogen: '91',
      phosphorus: '33', potassium: '44', humidity: '58', ph: '6.2', rainfall: '910'
    };
    submitIntegrationForm(values);
    integrationEngine = engine;
    assert(captured && Object.keys(values).every((key) => captured[key] === values[key]), 'The adapter should forward location, soil type, climate, pH, and all NPK values');
    assert(integrationResults.textContent.includes('Captured test input.'), 'The adapter should render the engine response');
  });

  test('changed form values change the displayed suitability classification', () => {
    const submitted = submitIntegrationForm({
      location: '', soilType: '', temperature: '10', nitrogen: '', phosphorus: '',
      potassium: '', humidity: '', ph: '4.5', rainfall: '400'
    });
    assert(submitted.event.defaultPrevented, 'The form submission should be intercepted');
    assert(submitted.text.includes('Maize') && submitted.text.includes('0/3 optimal'), 'New values should produce the boundary-range result');
    assert(submitted.text.includes('Absolute range only'), 'The renderer should distinguish absolute from optimal range matches');
  });

  test('shows missing required form values instead of stale crop results', () => {
    const submitted = submitIntegrationForm({
      location: '', soilType: '', temperature: '25', nitrogen: '', phosphorus: '',
      potassium: '', humidity: '', ph: '', rainfall: '800'
    });
    assert(submitted.text.includes('Please review these inputs'), 'Expected validation heading');
    assert(submitted.text.includes('Soil pH is required'), 'Expected the required pH message');
    assert(!submitted.text.includes('Preliminary crop candidates'), 'Invalid values must not leave old candidates displayed');
  });

  test('shows range validation for an invalid numeric form value', () => {
    const submitted = submitIntegrationForm({
      location: '', soilType: '', temperature: '25', nitrogen: '', phosphorus: '',
      potassium: '', humidity: '', ph: '14.1', rainfall: '800'
    });
    assert(submitted.text.includes('Please review these inputs'), 'Expected validation heading for invalid pH');
    assert(submitted.text.includes('Soil pH must be a number'), 'Expected the engine pH range error in the form output');
    assert(!submitted.text.includes('Preliminary crop candidates'), 'Invalid numeric values must not be displayed as crop results');
  });

  test('shows a friendly message if the engine is unavailable during form submission', () => {
    integrationEngine = null;
    const submitted = submitIntegrationForm({
      location: '', soilType: '', temperature: '25', nitrogen: '', phosphorus: '',
      potassium: '', humidity: '', ph: '6', rainfall: '800'
    });
    integrationEngine = engine;
    assert(submitted.text.includes('Crop screening could not run'), 'Expected safe engine-unavailable feedback');
  });

  runButton.addEventListener('click', () => {
    resultList.replaceChildren();
    runButton.disabled = true;
    summary.className = '';

    if (!engine || !window.AgriCropData || !window.AgriCropForm) {
      const failure = document.createElement('li');
      failure.className = 'fail';
      failure.textContent = 'FAIL - Crop engine or crop data did not load. Check that you opened this test page from the project tests folder and that crop-engine.js and crop-data.js are present.';
      resultList.append(failure);
      summary.textContent = 'Tests could not run because a required script did not load.';
      summary.className = 'fail';
      runButton.disabled = false;
      return;
    }

    let passed = 0;
    let failed = 0;
    tests.forEach(({ name, run }) => {
      const item = document.createElement('li');
      try {
        run();
        item.className = 'pass';
        item.textContent = `PASS - ${name}`;
        passed += 1;
      } catch (error) {
        item.className = 'fail';
        item.textContent = `FAIL - ${name}: ${error.message}`;
        failed += 1;
      }
      resultList.append(item);
    });
    summary.textContent = failed === 0
      ? `${passed}/${tests.length} tests passed.`
      : `${passed} passed, ${failed} failed out of ${tests.length} tests.`;
    summary.className = failed === 0 ? 'pass' : 'fail';
    runButton.disabled = false;
  });
})();


