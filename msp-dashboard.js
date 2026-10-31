(() => {
  const engine = window.AgriMspEngine;
  const results = document.getElementById('msp-results');
  if (!engine || !results) return;

  const DATA_URL = './msp-data.json';
  const CACHE_KEY = 'agriSmartVerifiedMspSnapshotV1';
  const status = document.getElementById('msp-status');
  const feedback = document.getElementById('msp-feedback');
  const search = document.getElementById('msp-search');
  const season = document.getElementById('msp-season');
  const year = document.getElementById('msp-year');
  let dataset = null;

  function setStatus(label, type) {
    status.textContent = label;
    status.className = `status-pill ${type}`;
  }

  function showFeedback(message, { error = false, retry = false } = {}) {
    feedback.className = `form-feedback${error ? ' error' : ''}`;
    feedback.replaceChildren(document.createTextNode(message));
    if (retry) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'msp-retry';
      button.textContent = 'Retry';
      button.addEventListener('click', loadDataset);
      feedback.append(document.createTextNode(' '), button);
    }
  }

  function readCachedSnapshot() {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      return cached && !engine.validateMspDataset(cached) ? cached : null;
    } catch {
      return null;
    }
  }

  function cacheSnapshot(data) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* The fetched data still works for this visit. */ }
  }

  function formatRupees(value) {
    return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value);
  }

  function formatDate(value) {
    const date = new Date(`${value}T00:00:00Z`);
    return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
  }

  function appendTextCell(row, value, className = '') {
    const cell = document.createElement('td');
    if (className) cell.className = className;
    cell.textContent = value;
    row.append(cell);
    return cell;
  }

  function appendSourceCell(row, record) {
    const cell = document.createElement('td');
    const link = document.createElement('a');
    link.href = record.sourceUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = record.sourceTitle;
    const date = document.createElement('small');
    date.textContent = `Published ${formatDate(record.publishedOn)}`;
    cell.append(link, date);
    row.append(cell);
  }

  function addComparison(record, comparison) {
    if (!comparison) return 'No verified previous-year value';
    const delta = comparison.change;
    const prefix = delta > 0 ? '+' : delta < 0 ? '−' : '';
    return `${prefix}₹${formatRupees(Math.abs(delta))} vs ${record.comparedYear}`;
  }

  function renderRows() {
    results.replaceChildren();
    if (!dataset) return;
    const rows = engine.filterMspRecords(dataset.records, {
      query: search.value,
      season: season.value,
      year: year.value
    });
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'msp-empty';
      empty.textContent = 'No official MSP records match those filters. Try another crop, season, or marketing year.';
      results.append(empty);
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'msp-table-wrap';
    const table = document.createElement('table');
    table.className = 'msp-table';
    const head = document.createElement('thead');
    const headingRow = document.createElement('tr');
    ['Crop', 'Season', 'Marketing year', 'MSP (₹/quintal)', 'Previous-year change', 'Official source'].forEach((label) => {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = label;
      headingRow.append(cell);
    });
    head.append(headingRow);
    table.append(head);

    const body = document.createElement('tbody');
    rows.forEach(({ record, comparison }) => {
      const row = document.createElement('tr');
      appendTextCell(row, record.crop, 'msp-crop');
      appendTextCell(row, record.season);
      appendTextCell(row, record.marketingYear);
      appendTextCell(row, `₹${formatRupees(record.mspRupeesPerQuintal)}`, 'msp-value');
      const delta = appendTextCell(row, addComparison(record, comparison), comparison ? (comparison.change >= 0 ? 'msp-change-up' : 'msp-change-down') : '');
      if (!comparison) delta.classList.add('msp-muted');
      appendSourceCell(row, record);
      body.append(row);
    });
    table.append(body);
    wrapper.append(table);
    results.append(wrapper);
  }

  function updateYearOptions() {
    const selected = year.value || 'latest';
    const years = engine.availableYears(dataset.records);
    year.replaceChildren();
    const latest = document.createElement('option');
    latest.value = 'latest';
    latest.textContent = `Latest available by ${season.value === 'all' ? 'season' : season.value}`;
    year.append(latest);
    years.forEach((marketingYear) => {
      const option = document.createElement('option');
      option.value = marketingYear;
      option.textContent = marketingYear;
      year.append(option);
    });
    year.value = selected === 'latest' || years.includes(selected) ? selected : 'latest';
  }

  function explainSnapshot(data, fallback) {
    const latestRows = engine.filterMspRecords(data.records, { year: 'latest' });
    const latestKharif = latestRows.find((item) => item.record.season === 'Kharif')?.record;
    const latestRabi = latestRows.find((item) => item.record.season === 'Rabi')?.record;
    const dateFor = (record) => `${record.marketingYear} (release published ${formatDate(record.publishedOn)})`;
    const latestText = [
      latestKharif && `Kharif ${dateFor(latestKharif)}`,
      latestRabi && `Rabi ${dateFor(latestRabi)}`
    ].filter(Boolean).join('; ');
    if (fallback) {
      showFeedback(`Could not load the bundled MSP snapshot. Showing the verified copy cached in this browser (snapshot checked ${formatDate(data.verifiedOn)}): ${latestText}. Values retain their original season and source.`, { error: true, retry: true });
      setStatus('CACHED SNAPSHOT', 'status-demo');
    } else {
      showFeedback(`Verified official MSP snapshot checked ${formatDate(data.verifiedOn)}. Latest available: ${latestText}. These are announced support prices, not mandi quotes.`);
      setStatus('OFFICIAL MSP DATA', 'status-local');
    }
  }

  async function loadDataset() {
    setStatus('LOADING MSP DATA', 'status-demo');
    results.setAttribute('aria-busy', 'true');
    showFeedback('Loading the bundled official MSP snapshot…');
    try {
      const response = await fetch(DATA_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error('snapshot_unavailable');
      const data = await response.json();
      const validationError = engine.validateMspDataset(data);
      if (validationError) throw new Error(validationError);
      dataset = data;
      cacheSnapshot(data);
      updateYearOptions();
      explainSnapshot(data, false);
      renderRows();
    } catch {
      const cached = readCachedSnapshot();
      if (cached) {
        dataset = cached;
        updateYearOptions();
        explainSnapshot(cached, true);
        renderRows();
      } else {
        dataset = null;
        setStatus('DATA UNAVAILABLE', 'status-unavailable');
        showFeedback('The official MSP snapshot could not be loaded, and there is no verified cached copy in this browser. No price values are being shown.', { error: true, retry: true });
        const empty = document.createElement('p');
        empty.className = 'msp-empty';
        empty.textContent = 'Check that Agri Smart is running through a local web server, then retry.';
        results.replaceChildren(empty);
      }
    } finally {
      results.setAttribute('aria-busy', 'false');
    }
  }

  search.addEventListener('input', renderRows);
  season.addEventListener('change', () => { updateYearOptions(); renderRows(); });
  year.addEventListener('change', renderRows);
  loadDataset();
})();
