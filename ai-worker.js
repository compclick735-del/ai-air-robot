importScripts('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js');

let yoloModel = null;
const YOLO_MODEL_URL = "https://cdn.jsdelivr.net/gh/compclick735-del/yolo-web-model@main/model/model.json";
const PERSON_CLASS_ID = 0;
let isInferencing = false;

// 1. โหลดโมเดล YOLOv8 ใน Background Worker
async function initWorker() {
  try {
    await tf.ready();
    yoloModel = await tf.loadGraphModel(YOLO_MODEL_URL);
    
    // Warmup Model ป้องกันอาการกระตุกในเฟรมแรก
    const dummyTensor = tf.zeros([1, 640, 640, 3]);
    yoloModel.execute(dummyTensor);
    tf.dispose(dummyTensor);

    self.postMessage({ type: 'MODEL_READY' });
  } catch (err) {
    self.postMessage({ type: 'MODEL_ERROR', error: err.message });
  }
}
initWorker();

// 2. รับเฟรมภาพจาก Main Thread
self.onmessage = async (e) => {
  if (e.data.type === 'PROCESS_FRAME' && yoloModel && !isInferencing) {
    isInferencing = true;
    const imageBitmap = e.data.imageBitmap;

    try {
      // 2.1 Pre-processing & Inference ผ่าน TensorFlow.js
      const rawResults = tf.tidy(() => {
        const imgTensor = tf.browser.fromPixels(imageBitmap);
        const resized = tf.image.resizeBilinear(imgTensor, [640, 640]);
        const normalized = resized.div(255.0);
        const batched = normalized.expandDims(0);
        
        const output = yoloModel.execute(batched);
        const transposed = output.squeeze([0]).transpose([1, 0]);
        
        const boxes = transposed.slice([0, 0], [-1, 4]);
        const scores = transposed.slice([0, 4], [-1, -1]);
        const maxScores = scores.max(1);
        const classIds = scores.argMax(1);

        return {
          boxes: boxes.arraySync(),
          scores: maxScores.arraySync(),
          classIds: classIds.arraySync(),
          imgW: imageBitmap.width,
          imgH: imageBitmap.height
        };
      });

      // 2.2 กรองคัดเลือกเฉพาะ Person (Class 0) ที่ Confidence >= 40%
      const candidateBoxes = [];
      const candidateScores = [];

      for (let i = 0; i < rawResults.scores.length; i++) {
        if (rawResults.classIds[i] === PERSON_CLASS_ID && rawResults.scores[i] >= 0.40) {
          const [cx, cy, w, h] = rawResults.boxes[i];
          const x = (cx - w / 2) * (rawResults.imgW / 640);
          const y = (cy - h / 2) * (rawResults.imgH / 640);
          const width = w * (rawResults.imgW / 640);
          const height = h * (rawResults.imgH / 640);

          candidateBoxes.push([y, x, y + height, x + width]);
          candidateScores.push(rawResults.scores[i]);
        }
      }

      // 2.3 คำนวณ NMS (Non-Max Suppression) ตัด Bounding Box ที่ซ้ำซ้อน
      let detections = [];
      if (candidateBoxes.length > 0) {
        const tensorBoxes = tf.tensor2d(candidateBoxes);
        const tensorScores = tf.tensor1d(candidateScores);
        const nms = await tf.image.nonMaxSuppressionAsync(tensorBoxes, tensorScores, 5, 0.45, 0.40);
        const selectedIndices = await nms.array();
        tf.dispose([tensorBoxes, tensorScores, nms]);

        detections = selectedIndices.map(idx => ({
          x: candidateBoxes[idx][1],
          y: candidateBoxes[idx][0],
          width: candidateBoxes[idx][3] - candidateBoxes[idx][1],
          height: candidateBoxes[idx][2] - candidateBoxes[idx][0],
          score: candidateScores[idx],
          imgW: rawResults.imgW,
          imgH: rawResults.imgH
        }));
      }

      // คืนความจำ RAM
      imageBitmap.close();

      // ส่งผลลัพธ์พิกัดกลับ Main Thread
      self.postMessage({
        type: 'DETECTION_RESULT',
        results: detections,
        count: detections.length
      });

    } catch (err) {
      if (imageBitmap) imageBitmap.close();
      self.postMessage({ type: 'DETECTION_ERROR', error: err.message });
    } finally {
      isInferencing = false;
    }
  }
};