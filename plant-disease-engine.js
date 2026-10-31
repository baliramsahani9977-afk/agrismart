(() => {
  const MODEL_CLASSES = Object.freeze([
    Object.freeze({ id: 'bean_spot', label: 'Bean angular leaf spot', crop: 'bean' }),
    Object.freeze({ id: 'cassava_mosaic', label: 'Cassava mosaic disease', crop: 'cassava' }),
    Object.freeze({ id: 'healthy', label: 'Healthy maize leaf', crop: 'maize' }),
    Object.freeze({ id: 'maize_blight', label: 'Maize northern leaf blight', crop: 'maize' }),
    Object.freeze({ id: 'maize_rust', label: 'Maize common rust', crop: 'maize' })
  ]);
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const MAX_IMAGE_PIXELS = 20_000_000;
  const MIN_SCREENING_SCORE = 0.55;
  const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
  const MEAN = [0.485, 0.456, 0.406];
  const STD = [0.229, 0.224, 0.225];
  const INPUT_SIZE = 224;

  function validateImageFile(file) {
    if (!file || typeof file !== 'object') return 'Choose a leaf image first.';
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) return 'Choose a JPG, PNG, GIF, or WebP image.';
    if (!Number.isFinite(file.size) || file.size <= 0) return 'The selected image is empty or unreadable.';
    if (file.size > MAX_IMAGE_BYTES) return 'That image is larger than 5 MB. Choose a smaller file.';
    return null;
  }

  function validateCrop(crop) {
    if (!['maize', 'cassava', 'bean', 'other'].includes(crop)) return 'Choose which crop is shown in the image.';
    if (crop === 'other') return 'This classifier supports only maize, cassava, and bean images. It will not analyze this image.';
    return null;
  }

  function makeInputTensorData(imageData, width = INPUT_SIZE, height = INPUT_SIZE) {
    if (!imageData || !imageData.data || imageData.data.length !== width * height * 4) {
      throw new TypeError('The decoded image data has an unexpected size.');
    }
    const plane = width * height;
    const tensor = new Float32Array(3 * plane);
    for (let pixel = 0; pixel < plane; pixel += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        const value = imageData.data[pixel * 4 + channel] / 255;
        tensor[channel * plane + pixel] = (value - MEAN[channel]) / STD[channel];
      }
    }
    return tensor;
  }

  function interpretLogits(logits, crop) {
    const cropError = validateCrop(crop);
    if (cropError) return { kind: 'unsupported', message: cropError };
    if (!logits || logits.length !== MODEL_CLASSES.length) {
      return { kind: 'invalid', message: 'The model returned an unexpected result. Try a different image.' };
    }
    const values = Array.from(logits, Number);
    if (values.some((value) => !Number.isFinite(value))) {
      return { kind: 'invalid', message: 'The model returned an unreadable result. Try a different image.' };
    }
    const max = Math.max(...values);
    const exponents = values.map((value) => Math.exp(value - max));
    const denominator = exponents.reduce((sum, value) => sum + value, 0);
    if (!Number.isFinite(denominator) || denominator <= 0) {
      return { kind: 'invalid', message: 'The model could not score this image. Try another clear leaf photo.' };
    }
    const ranked = exponents.map((score, index) => ({
      ...MODEL_CLASSES[index],
      score: score / denominator
    })).sort((left, right) => right.score - left.score);
    const top = ranked[0];
    if (top.crop !== crop) {
      return {
        kind: 'mismatch',
        message: `The model's top match (${top.label}) does not match the crop you selected. No diagnosis is shown. Check the crop selection or use a clear image of a supported crop.`,
        candidate: top
      };
    }
    if (top.score < MIN_SCREENING_SCORE) {
      return {
        kind: 'uncertain',
        message: 'No clear match among this model’s supported classes. The image may be unclear or show an unsupported condition.',
        candidate: top,
        score: top.score
      };
    }
    return { kind: 'prediction', ...top, runnerUp: ranked[1] };
  }

  window.AgriPlantDiseaseEngine = Object.freeze({
    MODEL_CLASSES,
    MAX_IMAGE_BYTES,
    MAX_IMAGE_PIXELS,
    MIN_SCREENING_SCORE,
    INPUT_SIZE,
    validateImageFile,
    validateCrop,
    makeInputTensorData,
    interpretLogits
  });
})();
