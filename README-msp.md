# Agri Smart MSP snapshot

The Crop Price Status panel uses `msp-data.json`, a curated snapshot of Cabinet-approved MSP tables published by the Press Information Bureau (Ministry of Agriculture & Farmers Welfare). The CACP page and DES Agri MSP page did not expose a usable data feed during implementation, and no public JSON API was identified. The dashboard therefore does not scrape those sites or claim to show live mandi prices.

## Current coverage

- Kharif Marketing Season 2026-27 and its published 2025-26 comparison column (14 mandated crops, with paddy/jowar grades and cotton staples listed separately).
- Rabi Marketing Season 2027-28 and its published 2026-27 comparison column (six mandated crops).
- Commercial jute and copra are not included in this snapshot.

Each row records its official source URL, source title, publication date, marketing season/year, unit, and MSP. `verifiedOn` records when the bundled snapshot was checked. The app stores a copy in browser local storage after loading; if the bundled data file cannot be fetched later, it labels and displays only that verified cached snapshot with its original dates and sources.

## Updating the data

When a new Cabinet MSP release is published, verify every crop and value against the official PIB table (and its previous-year column when shown), update the affected records and source metadata in `msp-data.json`, set `verifiedOn` to the date checked, then run:

```powershell
npm.cmd run test:msp
```

The tests validate the record schema and official source host, crop/season/year filters, comparisons, rendering, cache fallback, and the currently bundled figures. Do not substitute mandi prices for MSP or mark an announcement current until its source and marketing year are verified.
