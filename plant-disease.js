(() => {
  const engine = window.AgriPlantDiseaseEngine;
  const form = document.getElementById('image-form');
  if (!engine || !form) return;

  // Model published under the MIT license; pin weights to the ONNX file's model-card revision.
  // Inference runs in this browser. User-selected images are never sent to Hugging Face.
  const MODEL_URL = 'https://huggingface.co/DrUkachi/ktt-crop-disease-classifier/resolve/0bc90b3/model.onnx?download=true';
  const ORT_VERSION = '1.22.0';
  const ORT_SCRIPT_URL = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort.min.js`;
  const ORT_WASM_PATH = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
  const MODEL_TIMEOUT_MS = 90_000;
  const INFERENCE_TIMEOUT_MS = 45_000;
  const imageInput = document.getElementById('plant-image');
  const cropInput = document.getElementById('plant-crop');
  const preview = document.getElementById('image-preview');
  const previewImage = document.getElementById('preview-image');
  const feedback = document.getElementById('image-feedback');
  const resultPanel = document.getElementById('disease-result');
  const analyzeButton = document.getElementById('analyze-plant');
  const clearButton = document.getElementById('clear-image');
  let previewUrl = null;
  let modelPromise = null;
  let session = null;
  let analyzing = false;

  function setFeedback(message, kind = '') {
    feedback.className = `form-feedback${kind ? ` ${kind}` : ''}`;
    feedback.textContent = message;
  }

  function clearResults() {
    resultPanel.replaceChildren();
    resultPanel.hidden = true;
  }

  function releasePreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    previewImage.removeAttribute('src');
    preview.hidden = true;
  }

  function clearImage(message = 'Choose a leaf photo from one of the supported crops.') {
    releasePreview();
    imageInput.value = '';
    analyzeButton.disabled = true;
    clearResults();
    setFeedback(message);
  }

  function addResultLine(parent, text, className = '') {
    const line = document.createElement('p');
    if (className) line.className = className;
    line.textContent = text;
    parent.append(line);
    return line;
  }

  function renderResult(result) {
    clearResults();
    resultPanel.hidden = false;
    const heading = document.createElement('strong');
    heading.className = 'disease-result-heading';
    const details = document.createElement('div');
    details.className = 'disease-result-details';

    if (result.kind === 'prediction') {
      heading.textContent = result.label;
      addResultLine(details, `Model score: ${(result.score * 100).toFixed(1)}% (softmax score; not calibrated diagnostic certainty).`);
      addResultLine(details, `Crop class: ${result.crop === 'bean' ? 'Bean' : result.crop === 'cassava' ? 'Cassava' : 'Maize'}.`);
      addResultLine(details, 'Next step: photograph the whole plant and affected area in natural light, then confirm with a local agricultural extension expert before taking treatment action.');
    } else {
      heading.textContent = result.kind === 'unsupported' ? 'Unsupported image' : 'No reliable class result';
      addResultLine(details, result.message);
      if (result.candidate) addResultLine(details, `Highest model score was ${((result.score ?? result.candidate.score) * 100).toFixed(1)}% for ${result.candidate.label}; this is not a diagnosis.`);
      addResultLine(details, 'Try a sharp, well-lit photo of one leaf from a supported crop. If symptoms remain, ask a local agricultural extension expert.');
    }

    const disclaimer = document.createElement('small');
    disclaimer.textContent = 'Preliminary image screening only. It can be wrong and must not be used alone to choose pesticides or other treatment.';
    resultPanel.append(heading, details, disclaimer);
  }

  function withTimeout(promise, timeoutMs, message) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  function loadRuntime() {
    if (window.ort) return Promise.resolve(window.ort);
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = ORT_SCRIPT_URL;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.onload = () => window.ort ? resolve(window.ort) : reject(new Error('runtime_unavailable'));
      script.onerror = () => reject(new Error('runtime_unavailable'));
      document.head.append(script);
    });
  }

  function loadModel() {
    if (session) return Promise.resolve(session);
    if (!modelPromise) {
      modelPromise = (async () => {
        const ort = await loadRuntime();
        ort.env.wasm.wasmPaths = ORT_WASM_PATH;
        ort.env.wasm.numThreads = 1;
        const loadedSession = await ort.InferenceSession.create(MODEL_URL, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all'
        });
        if (!loadedSession.inputNames?.length || !loadedSession.outputNames?.length) throw new Error('model_format');
        session = loadedSession;
        return session;
      })().catch((error) => {
        modelPromise = null;
        throw error;
      });
    }
    return withTimeout(modelPromise, MODEL_TIMEOUT_MS, 'model_timeout');
  }

  async function decodeImage(file) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      throw new Error('image_decode');
    }
    try {
      if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > engine.MAX_IMAGE_PIXELS) {
        throw new Error('image_dimensions');
      }
      const canvas = document.createElement('canvas');
      canvas.width = engine.INPUT_SIZE;
      canvas.height = engine.INPUT_SIZE;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('image_decode');
      context.drawImage(bitmap, 0, 0, engine.INPUT_SIZE, engine.INPUT_SIZE);
      const pixels = context.getImageData(0, 0, engine.INPUT_SIZE, engine.INPUT_SIZE);
      return engine.makeInputTensorData(pixels, engine.INPUT_SIZE, engine.INPUT_SIZE);
    } finally {
      bitmap.close();
    }
  }

  async function runInference(file) {
    const loadedSession = await loadModel();
    const ort = window.ort;
    const data = await decodeImage(file);
    const tensor = new ort.Tensor('float32', data, [1, 3, engine.INPUT_SIZE, engine.INPUT_SIZE]);
    const outputs = await withTimeout(
      loadedSession.run({ [loadedSession.inputNames[0]]: tensor }),
      INFERENCE_TIMEOUT_MS,
      'inference_timeout'
    );
    const output = outputs[loadedSession.outputNames[0]];
    if (!output?.data) throw new Error('model_format');
    return engine.interpretLogits(output.data, cropInput.value);
  }

  imageInput.addEventListener('change', () => {
    clearResults();
    const file = imageInput.files?.[0];
    const validationMessage = engine.validateImageFile(file);
    if (validationMessage) {
      clearImage(validationMessage);
      feedback.classList.add('error');
      return;
    }
    releasePreview();
    previewUrl = URL.createObjectURL(file);
    previewImage.src = previewUrl;
    preview.hidden = false;
    analyzeButton.disabled = false;
    setFeedback('Image preview ready. The original file stays on this device.', 'success');
  });

  previewImage.addEventListener('error', () => {
    clearImage('This file could not be displayed as an image. Choose a valid JPG, PNG, GIF, or WebP photo.');
    feedback.classList.add('error');
  });

  clearButton.addEventListener('click', () => clearImage());
  cropInput.addEventListener('change', () => {
    if (cropInput.value === 'other') {
      setFeedback('This model supports maize, cassava, and bean only. It will not analyze other crops.', 'error');
    } else if (imageInput.files?.[0]) {
      setFeedback('Crop selected. The model will compare only with its supported classes.', 'success');
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (analyzing) return;
    const file = imageInput.files?.[0];
    const fileError = engine.validateImageFile(file);
    if (fileError) {
      setFeedback(fileError, 'error');
      return;
    }
    const cropError = engine.validateCrop(cropInput.value);
    if (cropError) {
      setFeedback(cropError, 'error');
      if (cropInput.value === 'other') renderResult({ kind: 'unsupported', message: cropError });
      cropInput.focus();
      return;
    }

    analyzing = true;
    analyzeButton.disabled = true;
    clearButton.disabled = true;
    clearResults();
    setFeedback('Loading the small classifier and screening this image on your device. The first run needs an internet connection.', '');
    try {
      const result = await runInference(file);
      renderResult(result);
      setFeedback('Image screening finished on this device. No image was uploaded.', result.kind === 'prediction' ? 'success' : 'error');
    } catch (error) {
      const messages = {
        runtime_unavailable: 'Could not download the browser inference runtime. Check your internet connection and retry.',
        model_timeout: 'The classifier took too long to download. Check your connection and retry.',
        inference_timeout: 'Image screening took too long on this device. Try a smaller, clearer photo or another device.',
        image_decode: 'The selected file could not be decoded. Choose a valid JPG, PNG, GIF, or WebP image.',
        image_dimensions: 'This image has too many pixels to process safely. Resize it and try again.',
        model_format: 'The classifier returned an unexpected result. Please retry later.',
        no_model: 'The classifier is unavailable. Check your internet connection and retry.'
      };
      const message = messages[error.message] || 'The classifier could not be loaded or run. Check your internet connection and retry.';
      setFeedback(message, 'error');
      renderResult({ kind: 'error', message });
    } finally {
      analyzing = false;
      analyzeButton.disabled = !imageInput.files?.[0];
      clearButton.disabled = false;
    }
  });
})();
