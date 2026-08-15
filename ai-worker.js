importScripts('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js');

let model = null;
const INPUT_SIZE = 640;
const SCORE_THRESHOLD = 0.45;
const IOU_THRESHOLD = 0.45;

self.onmessage = async (e) => {
  const { type, payload } = e.data;

  if (type === 'INIT_MODEL') {
    try {
      await tf.ready();
      model = await tf.loadGraphModel('/model/model.json');

      // Model Warmup
      const dummyInput = tf.zeros([1, INPUT_SIZE, INPUT_SIZE, 3]);
      const warmupResult = await model.executeAsync(dummyInput);
      dummyInput.dispose();
      if (Array.isArray(warmupResult)) warmupResult.forEach(t => t.dispose());
      else warmupResult.dispose();

      postMessage({ type: 'MODEL_LOADED', success: true });
    } catch (err) {
      postMessage({ type: 'MODEL_LOADED', success: false, error: err.message });
    }
  }

  if (type === 'DETECT') {
    const imageBitmap = payload?.imageBitmap;
    if (!model || !imageBitmap) {
      if (imageBitmap) imageBitmap.close();
      return;
    }

    try {
      const detections = await runInference(imageBitmap);
      postMessage({ type: 'DETECTION_RESULT', detections });
    } catch (err) {
      postMessage({ type: 'DETECTION_ERROR', error: err.message });
    } finally {
      if (imageBitmap) imageBitmap.close();
    }
  }
};

async function runInference(imageBitmap) {
  return tf.tidy(() => {
    // 1. Convert ImageBitmap to Tensor & Normalize
    const imgTensor = tf.browser.fromPixels(imageBitmap);
    const resized = tf.image.resizeBilinear(imgTensor, [INPUT_SIZE, INPUT_SIZE]);
    const normalized = resized.div(255.0);
    const inputTensor = normalized.expandDims(0);

    // 2. Run Model Inference
    const output = model.execute(inputTensor); // Tensor Shape: [1, 84, 8400]
    const rawRes = output.squeeze([0]); // Shape: [84, 8400]

    // 3. Transpose tensor to [8400, 84]
    const transposed = rawRes.transpose([1, 0]);
    const boxes = transposed.slice([0, 0], [-1, 4]); // [cx, cy, w, h]
    const scores = transposed.slice([0, 4], [-1, -1]).max(1); // Max score across classes

    // 4. Transform coordinates from (cx, cy, w, h) to (y1, x1, y2, x2)
    const cx = boxes.slice([0, 0], [-1, 1]);
    const cy = boxes.slice([0, 1], [-1, 1]);
    const w = boxes.slice([0, 2], [-1, 1]);
    const h = boxes.slice([0, 3], [-1, 1]);

    const x1 = cx.sub(w.div(2));
    const y1 = cy.sub(h.div(2));
    const x2 = cx.add(w.div(2));
    const y2 = cy.add(h.div(2));

    const formattedBoxes = tf.concat([y1, x1, y2, x2], 1);

    // 5. Non-Max Suppression (NMS)
    const nmsIndices = tf.image.nonMaxSuppression(
      formattedBoxes,
      scores,
      20,
      IOU_THRESHOLD,
      SCORE_THRESHOLD
    );

    const selectedBoxes = formattedBoxes.gather(nmsIndices).arraySync();
    const selectedScores = scores.gather(nmsIndices).arraySync();

    return selectedBoxes.map((box, i) => ({
      box: box, // [y1, x1, y2, x2]
      score: parseFloat(selectedScores[i].toFixed(2))
    }));
  });
}