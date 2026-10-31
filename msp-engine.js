(() => {
  const SEASONS = new Set(['Kharif', 'Rabi']);
  const SOURCE_HOSTS = new Set(['pib.gov.in', 'www.pib.gov.in']);
  const YEAR_PATTERN = /^\d{4}-\d{2}$/;

  function validDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
  }

  function validateMspDataset(data) {
    if (!data || typeof data !== 'object' || data.schemaVersion !== 1 || !validDate(data.verifiedOn)
      || !Array.isArray(data.records) || data.records.length === 0) {
      return 'The official MSP snapshot has an invalid format.';
    }
    const unique = new Set();
    for (const record of data.records) {
      if (!record || typeof record.cropId !== 'string' || !record.cropId.trim()
        || typeof record.crop !== 'string' || !record.crop.trim()
        || !SEASONS.has(record.season) || !YEAR_PATTERN.test(record.marketingYear)
        || !Number.isSafeInteger(record.mspRupeesPerQuintal) || record.mspRupeesPerQuintal <= 0
        || !validDate(record.publishedOn) || typeof record.sourceTitle !== 'string' || !record.sourceTitle.trim()) {
        return 'The official MSP snapshot contains an incomplete or invalid record.';
      }
      let source;
      try { source = new URL(record.sourceUrl); } catch { return 'An MSP source link is invalid.'; }
      if (source.protocol !== 'https:' || !SOURCE_HOSTS.has(source.hostname)) return 'An MSP record does not link to the official source host.';
      const key = `${record.season}|${record.marketingYear}|${record.cropId}`;
      if (unique.has(key)) return 'The official MSP snapshot contains duplicate crop records.';
      unique.add(key);
      if (record.comparedYear !== undefined && !YEAR_PATTERN.test(record.comparedYear)) return 'An MSP comparison year is invalid.';
    }
    return null;
  }

  function yearStart(marketingYear) {
    return Number(marketingYear.slice(0, 4));
  }

  function availableYears(records) {
    return [...new Set(records.map((record) => record.marketingYear))]
      .sort((left, right) => yearStart(right) - yearStart(left));
  }

  function latestYearForSeason(records, season) {
    const candidates = records.filter((record) => season === 'all' || record.season === season);
    return availableYears(candidates)[0] || null;
  }

  function searchText(record) {
    return [record.crop, ...(Array.isArray(record.aliases) ? record.aliases : [])]
      .join(' ').normalize('NFKD').toLocaleLowerCase();
  }

  function filterMspRecords(records, { query = '', season = 'all', year = 'latest' } = {}) {
    if (!Array.isArray(records)) return [];
    const validRecords = records.filter((record) => record && SEASONS.has(record.season));
    const seasons = season === 'all' ? ['Kharif', 'Rabi'] : [season];
    let selected;
    if (year === 'latest') {
      const latestForEachSeason = new Map(seasons.map((selectedSeason) => [selectedSeason, latestYearForSeason(validRecords, selectedSeason)]));
      selected = validRecords.filter((record) => record.marketingYear === latestForEachSeason.get(record.season));
    } else {
      selected = validRecords.filter((record) => record.marketingYear === year);
    }
    if (season !== 'all') selected = selected.filter((record) => record.season === season);

    const normalizedQuery = String(query).trim().normalize('NFKD').toLocaleLowerCase();
    if (normalizedQuery) selected = selected.filter((record) => searchText(record).includes(normalizedQuery));

    const byKey = new Map(validRecords.map((record) => [`${record.season}|${record.marketingYear}|${record.cropId}`, record]));
    return selected.sort((left, right) => left.crop.localeCompare(right.crop)).map((record) => {
      const prior = record.comparedYear
        ? byKey.get(`${record.season}|${record.comparedYear}|${record.cropId}`) || null
        : null;
      return {
        record,
        comparison: prior ? { record: prior, change: record.mspRupeesPerQuintal - prior.mspRupeesPerQuintal } : null
      };
    });
  }

  window.AgriMspEngine = Object.freeze({ validateMspDataset, availableYears, latestYearForSeason, filterMspRecords });
})();
