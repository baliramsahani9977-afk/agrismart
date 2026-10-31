/*
 * Transparent range-screening rules. This is deterministic software, not machine learning.
 * A crop is listed only if all three sourced variables fall within its absolute ranges.
 * Ranking is by count of inputs in the source's optimal ranges; ties use crop name.
 */
(function (root) {
  'use strict';

  const FACTORS = [
    { key: 'temperature', inputKey: 'temperature', label: 'Mean temperature during crop growth', unit: '\u00B0C', inputMin: -100, inputMax: 100 },
    { key: 'annualRainfall', inputKey: 'rainfall', label: 'Annual rainfall', unit: 'mm/year', inputMin: 0 },
    { key: 'ph', inputKey: 'ph', label: 'Soil pH', unit: 'pH', inputMin: 0, inputMax: 14 }
  ];
  const OPTIONAL_NUMBERS = [
    { key: 'nitrogen', label: 'Nitrogen', min: 0 },
    { key: 'phosphorus', label: 'Phosphorus', min: 0 },
    { key: 'potassium', label: 'Potassium', min: 0 },
    { key: 'humidity', label: 'Relative humidity', min: 0, max: 100 }
  ];

  function parseNumber(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function formatRange(range) {
    return `${range.absoluteMin}-${range.absoluteMax} ${range.unit} (absolute); ${range.optimalMin}-${range.optimalMax} ${range.unit} (optimal)`;
  }

  function validate(input) {
    const errors = [];
    const values = {};
    if (!input || typeof input !== 'object') {
      return { ok: false, errors: ['Enter field values before requesting a screening.'], values };
    }

    for (const factor of FACTORS) {
      const value = parseNumber(input[factor.inputKey]);
      if (value === null) {
        errors.push(`${factor.label} is required for the sourced range comparison.`);
      } else if (!Number.isFinite(value) || value < factor.inputMin || (factor.inputMax !== undefined && value > factor.inputMax)) {
        const limit = factor.inputMax === undefined ? `at least ${factor.inputMin} ${factor.unit}` : `from ${factor.inputMin} to ${factor.inputMax} ${factor.unit}`;
        errors.push(`${factor.label} must be a number ${limit}.`);
      } else {
        values[factor.inputKey] = value;
      }
    }

    for (const optional of OPTIONAL_NUMBERS) {
      const value = parseNumber(input[optional.key]);
      if (value !== null && (!Number.isFinite(value) || value < optional.min || (optional.max !== undefined && value > optional.max))) {
        const limit = optional.max === undefined ? `at least ${optional.min}` : `from ${optional.min} to ${optional.max}${optional.key === 'humidity' ? '%' : ''}`;
        errors.push(`${optional.label} must be a number ${limit}.`);
      } else if (value !== null) {
        values[optional.key] = value;
      }
    }

    if (input.location != null && String(input.location).length > 100) {
      errors.push('Location must be 100 characters or fewer.');
    }
    if (input.soilType && !['Clay', 'Loamy', 'Sandy', 'Silty', 'Other / unsure'].includes(input.soilType)) {
      errors.push('Choose a listed soil type or leave the field blank.');
    }
    return { ok: errors.length === 0, errors, values };
  }

  function compareValue(value, range, label) {
    let status = 'outside';
    if (value >= range.optimalMin && value <= range.optimalMax) status = 'optimal';
    else if (value >= range.absoluteMin && value <= range.absoluteMax) status = 'within-absolute';
    return {
      key: label.key,
      label: label.label,
      value,
      unit: range.unit,
      status,
      sourceRange: formatRange(range)
    };
  }

  function getDataWarnings(input) {
    const nutrientLabels = { nitrogen: 'N', phosphorus: 'P', potassium: 'K' };
    const suppliedNutrients = Object.keys(nutrientLabels).filter((key) => parseNumber(input[key]) !== null);
    const missing = [
      'Numeric NPK values are not scored: units, extraction method, sampling depth, and locally calibrated crop-specific interpretation are not supplied. The values are only checked for valid numeric input.',
      'Relative humidity and the selected soil texture are not scored because the selected FAO crop sheets do not provide comparable numeric humidity ranges or a safe mapping from the selected texture options.',
      'Location is collected as context only; the results are not geolocated or checked against local climate, season, irrigation, variety, pests, or market conditions.',
      'The source ranges are broad species-level ecological references. Annual rainfall does not indicate how much water is available during the crop season, and crop-cycle length is not assessed.',
      'The three scored variables are treated as equally important for this simple ranking. That equal-count rule is a transparent software choice, not an agronomic weighting established by FAO.'
    ];
    if (suppliedNutrients.length) {
      missing.unshift(`NPK values received (${suppliedNutrients.map((key) => nutrientLabels[key]).join(', ')}), but not interpreted or scored.`);
    } else {
      missing.unshift('No NPK values were supplied; nutrient suitability is unknown and not scored.');
    }
    if (input.humidity !== '' && input.humidity != null) {
      missing.unshift('Humidity was received but not scored because the selected reference sheets do not specify comparable humidity bands.');
    }
    return missing;
  }

  function isUsableDataset(data) {
    if (!data || typeof data.sourceName !== 'string' || !Array.isArray(data.crops) || data.crops.length === 0) return false;
    return data.crops.every((crop) => {
      if (!crop || typeof crop.name !== 'string' || typeof crop.sourceUrl !== 'string' || !crop.requirements) return false;
      return FACTORS.every((factor) => {
        const range = crop.requirements[factor.key];
        return range && [range.absoluteMin, range.absoluteMax, range.optimalMin, range.optimalMax].every(Number.isFinite)
          && range.absoluteMin <= range.optimalMin && range.optimalMin <= range.optimalMax && range.optimalMax <= range.absoluteMax;
      });
    });
  }

  function recommend(input, dataset) {
    const data = dataset || root.AgriCropData;
    const validation = validate(input);
    if (!validation.ok) {
      return { status: 'invalid', errors: validation.errors, candidates: [], excluded: [], missingInformation: [] };
    }
    if (!isUsableDataset(data)) {
      return {
        status: 'no-data',
        errors: [],
        candidates: [],
        excluded: [],
        missingInformation: ['A versioned crop dataset with sourced temperature, annual-rainfall, and soil-pH optimal and absolute ranges is required before any candidates can be screened.']
      };
    }

    const assessed = data.crops.map((crop) => {
      const factors = FACTORS.map((factor) => compareValue(
        validation.values[factor.inputKey],
        crop.requirements[factor.key],
        factor
      ));
      return {
        id: crop.id,
        name: crop.name,
        scientificName: crop.scientificName,
        sourceUrl: crop.sourceUrl,
        sourceLabel: crop.sourceLabel,
        sourceSoilFertility: crop.sourceSoilFertility,
        limitations: crop.limitations,
        factors,
        optimalMatches: factors.filter((factor) => factor.status === 'optimal').length,
        absoluteMatches: factors.filter((factor) => factor.status !== 'outside').length
      };
    });

    const candidates = assessed
      .filter((crop) => crop.absoluteMatches === FACTORS.length)
      .sort((a, b) => b.optimalMatches - a.optimalMatches || a.name.localeCompare(b.name));
    const excluded = assessed
      .filter((crop) => crop.absoluteMatches !== FACTORS.length)
      .map((crop) => ({
        name: crop.name,
        reasons: crop.factors.filter((factor) => factor.status === 'outside').map((factor) => `${factor.label}: input ${factor.value} ${factor.unit} is outside the absolute source range (${factor.sourceRange}).`)
      }));

    return {
      status: candidates.length ? 'results' : 'no-candidates',
      errors: [],
      candidates,
      excluded,
      rankedBy: 'Crops outside any absolute range are omitted. Remaining candidates are ranked by the number of the three inputs inside the source optimal ranges (higher first), with alphabetical tie-breaks. Each input is counted equally; this is a transparent screening rule, not an FAO weighting. No probabilities or yield estimates are calculated.',
      missingInformation: getDataWarnings(input),
      sourceName: data.sourceName,
      sourceNotice: data.sourceNotice,
      temperatureBasis: data.temperatureBasis,
      rainfallBasis: data.rainfallBasis,
      methodologyUrl: data.methodologyUrl,
      nutrientMethodologyUrl: data.nutrientMethodologyUrl,
      dataSheetFields: data.dataSheetFields,
      disclaimer: 'Preliminary global range screening only. This is not a yield guarantee, planting instruction, trained model, or substitute for a local agricultural adviser or soil laboratory.'
    };
  }

  root.AgriCropEngine = Object.freeze({ recommend, validate, factors: FACTORS });
})(typeof globalThis !== 'undefined' ? globalThis : window);


