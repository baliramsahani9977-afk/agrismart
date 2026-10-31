/* Form-to-engine adapter and safe renderer for the crop screening UI. */
(function (root) {
  'use strict';

  function addTextElement(parent, tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text;
    parent.append(element);
    return element;
  }

  function renderResults(container, result) {
    container.replaceChildren();
    if (!result || result.status === 'invalid') {
      addTextElement(container, 'h4', 'result-heading', 'Please review these inputs');
      const errors = document.createElement('ul');
      errors.className = 'result-list result-errors';
      const messages = result && Array.isArray(result.errors) ? result.errors : ['The form values could not be checked. Review the required fields and try again.'];
      messages.forEach((error) => addTextElement(errors, 'li', '', error));
      container.append(errors);
      return;
    }

    if (result.status === 'no-data') {
      addTextElement(container, 'h4', 'result-heading', 'Screening is unavailable');
      (result.missingInformation || []).forEach((item) => addTextElement(container, 'p', 'form-feedback', item));
      return;
    }

    if (result.status === 'no-candidates') {
      addTextElement(container, 'h4', 'result-heading', 'No candidates match all absolute ranges');
      addTextElement(container, 'p', 'form-feedback', 'The values entered do not fit all three sourced environmental ranges for any crop in this small dataset. This is not proof that nothing can grow there; local varieties, irrigation, season, and other conditions are not represented.');
    } else if (result.status === 'results' && Array.isArray(result.candidates)) {
      addTextElement(container, 'h4', 'result-heading', 'Preliminary crop candidates');
      addTextElement(container, 'p', 'form-feedback', `Ranked by the number of inputs within the source optimal ranges. ${result.rankedBy || ''}`);
      const cards = document.createElement('div');
      cards.className = 'candidate-list';
      result.candidates.forEach((crop, index) => {
        const card = document.createElement('article');
        card.className = 'candidate-card';
        const heading = document.createElement('div');
        heading.className = 'candidate-heading';
        addTextElement(heading, 'span', 'candidate-rank', `#${index + 1}`);
        const nameBlock = document.createElement('div');
        addTextElement(nameBlock, 'h5', '', crop.name);
        addTextElement(nameBlock, 'em', 'scientific-name', crop.scientificName || '');
        heading.append(nameBlock);
        addTextElement(heading, 'span', 'candidate-match', `${crop.optimalMatches}/3 optimal`);
        card.append(heading);
        addTextElement(card, 'p', 'candidate-explanation', `${crop.optimalMatches} of 3 inputs fall in FAO's optimal ranges; the remaining ${3 - crop.optimalMatches} fall within its broader absolute ranges.`);
        const factorList = document.createElement('ul');
        factorList.className = 'factor-list';
        (crop.factors || []).forEach((factor) => {
          const row = document.createElement('li');
          const statusLabel = factor.status === 'optimal' ? 'Optimal range' : 'Absolute range only';
          addTextElement(row, 'span', 'factor-name', factor.label);
          addTextElement(row, 'span', `factor-status ${factor.status}`, `${factor.value} ${factor.unit} - ${statusLabel}`);
          factorList.append(row);
        });
        card.append(factorList);
        if (crop.sourceUrl) {
          const source = document.createElement('a');
          source.className = 'source-link';
          source.href = crop.sourceUrl;
          source.target = '_blank';
          source.rel = 'noopener noreferrer';
          source.textContent = crop.sourceLabel || 'Crop source';
          card.append(source);
        }
        addTextElement(card, 'p', 'candidate-limit', crop.limitations || 'Check this crop against local growing conditions and variety information.');
        if (crop.sourceSoilFertility) {
          addTextElement(card, 'p', 'candidate-limit', `EcoCrop soil-fertility descriptor: ${crop.sourceSoilFertility}. This qualitative label is not inferred from the numeric NPK fields.`);
        }
        cards.append(card);
      });
      container.append(cards);
    } else {
      throw new Error('The recommendation engine returned an unrecognized result.');
    }

    if (!Array.isArray(result.excluded) || !Array.isArray(result.missingInformation)) {
      throw new Error('The recommendation engine returned incomplete result details.');
    }
    if (result.excluded.length) {
      const details = document.createElement('details');
      addTextElement(details, 'summary', '', `Crops outside at least one absolute range (${result.excluded.length})`);
      const excludedList = document.createElement('ul');
      excludedList.className = 'result-list';
      result.excluded.forEach((crop) => addTextElement(excludedList, 'li', '', `${crop.name}: ${crop.reasons.join(' ')}`));
      details.append(excludedList);
      container.append(details);
    }

    addTextElement(container, 'h5', 'result-subheading', 'Important data gaps');
    const gaps = document.createElement('ul');
    gaps.className = 'result-list';
    result.missingInformation.forEach((item) => addTextElement(gaps, 'li', '', item));
    container.append(gaps);
    addTextElement(container, 'p', 'source-note', result.sourceNotice || 'Review the linked crop data sheets before using this screening.');

    const method = document.createElement('p');
    method.className = 'source-note';
    method.append(document.createTextNode(`Temperature basis: ${result.temperatureBasis || 'not specified'} Annual-rainfall basis: ${result.rainfallBasis || 'not specified'} `));
    [
      ['https://www.fao.org/land-water/resources/tools/databases/ecocrop/en', 'About FAO EcoCrop and its limitations'],
      [result.methodologyUrl, 'FAO EcoCrop temperature and rainfall basis'],
      [result.nutrientMethodologyUrl, 'Penn State Extension soil testing']
    ].forEach(([url, label], index) => {
      if (!url) return;
      if (index > 0) method.append(document.createTextNode(' '));
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = label;
      method.append(link);
    });
    container.append(method);
    addTextElement(container, 'p', 'result-disclaimer', result.disclaimer || 'Preliminary guidance only; verify with a local agricultural adviser.');
  }

  function connect(form, results, engineProvider, options) {
    const settings = options || {};
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      try {
        const engine = typeof engineProvider === 'function' ? engineProvider() : (engineProvider || root.AgriCropEngine);
        if (!engine || typeof engine.recommend !== 'function') throw new Error('Crop recommendation engine is unavailable.');
        const input = Object.fromEntries(new FormData(form).entries());
        const result = engine.recommend(input);
        renderResults(results, result);
        if (settings.scroll !== false && typeof results.scrollIntoView === 'function') {
          results.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      } catch (error) {
        results.replaceChildren();
        addTextElement(results, 'h4', 'result-heading', 'Crop screening could not run');
        addTextElement(results, 'p', 'form-feedback error', 'Please refresh the page and try again. If the problem continues, check that the crop data and engine scripts are available.');
      }
    });
  }

  root.AgriCropForm = Object.freeze({ connect, renderResults });
})(typeof globalThis !== 'undefined' ? globalThis : window);
