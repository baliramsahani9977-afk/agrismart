/*
 * Small, explicit crop screening dataset transcribed from FAO EcoCrop data sheets.
 * Values are environmental ranges, not fertilizer recommendations or yield forecasts.
 * Review each linked source before changing these values.
 */
(function (root) {
  'use strict';

  const data = {
    sourceName: 'FAO EcoCrop crop data sheets',
    sourceNotice: 'FAO describes EcoCrop as a broad global crop-requirements database. It was discontinued around 2015 and incorporated into GAEZ; these general ranges are not a current local planting recommendation.',
    dataSheetFields: 'Optimal ranges are the source data optimal min/max; absolute ranges are the source data absolute min/max.',
    temperatureBasis: 'Mean temperature during the crop growth period, following the EcoCrop methodology described in an FAO study.',
    rainfallBasis: 'Annual rainfall in millimetres, as labeled in EcoCrop.',
    methodologyUrl: 'https://www.fao.org/fileadmin/templates/est/Climate_change/Morocco/WB_FAO_study.pdf',
    nutrientMethodologyUrl: 'https://extension.psu.edu/soil-testing',
    crops: [
      {
        id: 'maize',
        name: 'Maize',
        scientificName: 'Zea mays ssp. mays',
        sourceUrl: 'https://ecocrop.apps.fao.org/ecocrop/srv/en/dataSheet?id=238663',
        sourceLabel: 'FAO EcoCrop data sheet: Zea mays ssp. mays',
        requirements: {
          temperature: { optimalMin: 18, optimalMax: 33, absoluteMin: 10, absoluteMax: 47, unit: '\u00B0C' },
          annualRainfall: { optimalMin: 600, optimalMax: 1200, absoluteMin: 400, absoluteMax: 1800, unit: 'mm/year' },
          ph: { optimalMin: 5, optimalMax: 7, absoluteMin: 4.5, absoluteMax: 8.5, unit: 'pH' }
        },
        sourceSoilFertility: 'high (optimal descriptor); low (absolute descriptor)',
        limitations: 'The source sheet gives broad species ranges and a generalized soil-texture descriptor. It does not represent a named variety, local season, irrigation plan, or a numeric NPK test target.'
      },
      {
        id: 'wheat',
        name: 'Common wheat',
        scientificName: 'Triticum aestivum',
        sourceUrl: 'https://ecocrop.apps.fao.org/ecocrop/srv/en/dataSheet?id=2114',
        sourceLabel: 'FAO EcoCrop data sheet: Triticum aestivum',
        requirements: {
          temperature: { optimalMin: 15, optimalMax: 23, absoluteMin: 5, absoluteMax: 27, unit: '\u00B0C' },
          annualRainfall: { optimalMin: 750, optimalMax: 900, absoluteMin: 300, absoluteMax: 1600, unit: 'mm/year' },
          ph: { optimalMin: 6, optimalMax: 7, absoluteMin: 5.5, absoluteMax: 8.5, unit: 'pH' }
        },
        sourceSoilFertility: 'high (optimal descriptor); moderate (absolute descriptor)',
        limitations: 'The source is for common wheat generally; it does not separate winter and spring types, cultivars, local sowing dates, irrigation, or a numeric NPK test target.'
      },
      {
        id: 'rice',
        name: 'Rice',
        scientificName: 'Oryza sativa',
        sourceUrl: 'https://ecocrop.apps.fao.org/ecocrop/srv/en/dataSheet?id=1574',
        sourceLabel: 'FAO EcoCrop data sheet: Oryza sativa',
        requirements: {
          temperature: { optimalMin: 20, optimalMax: 30, absoluteMin: 10, absoluteMax: 36, unit: '\u00B0C' },
          annualRainfall: { optimalMin: 1500, optimalMax: 2000, absoluteMin: 1000, absoluteMax: 4000, unit: 'mm/year' },
          ph: { optimalMin: 5.5, optimalMax: 7, absoluteMin: 4.5, absoluteMax: 9, unit: 'pH' }
        },
        sourceSoilFertility: 'high (optimal descriptor); moderate (absolute descriptor)',
        limitations: 'The sheet describes broad species-level ecological requirements. Annual rainfall does not establish paddy water availability, irrigation, drainage, flood control, cultivar, or local season.'
      },
      {
        id: 'sorghum',
        name: 'Sorghum',
        scientificName: 'Sorghum bicolor',
        sourceUrl: 'https://ecocrop.apps.fao.org/ecocrop/srv/en/dataSheet?id=48747',
        sourceLabel: 'FAO EcoCrop data sheet: Sorghum bicolor',
        requirements: {
          temperature: { optimalMin: 22, optimalMax: 35, absoluteMin: 8, absoluteMax: 40, unit: '\u00B0C' },
          annualRainfall: { optimalMin: 400, optimalMax: 600, absoluteMin: 300, absoluteMax: 700, unit: 'mm/year' },
          ph: { optimalMin: 5.5, optimalMax: 7.5, absoluteMin: 5, absoluteMax: 8, unit: 'pH' }
        },
        sourceSoilFertility: 'high (optimal descriptor); low (absolute descriptor)',
        limitations: 'The source sheet gives species-level ranges and does not identify a grain or forage cultivar, local season, irrigation plan, or a numeric NPK test target.'
      }
    ]
  };

  root.AgriCropData = Object.freeze(data);
})(typeof globalThis !== 'undefined' ? globalThis : window);

