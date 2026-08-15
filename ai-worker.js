// ai-worker.js - โค้ดฉบับเต็มสำหรับรัน YOLOv8 (Person Detection) บน Web Worker

importScripts('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@latest/dist/tf.min.js');

let model = null;
const INPUT_SIZE = 640;
const CONF_THRESHOLD = 0.40; // เกณฑ์ Confidence 40%
const IOU_THRESHOLD = 0.45;  // เกณฑ์ NMS IoU
const PERSON_CLASS_ID = 0;   // Class 0 = Person ใน COCO Dataset

// -------------------------------------------------------------
// 1. โหลดโมเดล YOLOv8 และ ทำการ Warm-up
// -------------------------------------------------------------
async function initModel() {
  try {
    await tf.ready();
    
    // โหลด Graph Model (ปรับ Path model.json ให้ตรงตามโครงสร้างโฟลเดอร์ในโปรเจกต์)
    model = await tf.loadGraphModel('/model/yolov8n_web_model/model.json');
    
    // Warm-up โมเดลสร้าง Memory Buffer และ Compile GPU Shaders ล่วงหน้า
    const dummyInput = tf.zeros([1, INPUT_SIZE, INPUT_SIZE, 3]);
    const warmupResult = await model.executeAsync(dummyInput);
    
    // คืน Memory หลัง Warm-up
    dummyInput.dispose();
    if (Array.isArray(warmupResult)) {
      warmupResult.forEach(t => t.dispose());
    } else {
      warmupResult.dispose();
    }

    // แจ้ง Main Thread ว่าโมเดลพร้อมใช้งานแล้ว
    postMessage({ type: 'MODEL_READY' });
  } catch (err) {
    postMessage({ type: 'ERROR', message: `Model load failed: ${err.message}` });
  }
}

// เริ่มต้นโหลดโมเดลทันทีเมื่อ Worker เริ่มทำงาน
initModel();

// -------------------------------------------------------------
// 2. Event Listener รับข้อมูลภาพจาก Main Thread
// -------------------------------------------------------------
self.onmessage = async (e) => {
  const { type, imageBitmap } = e.data;

  if (type === 'DETECT') {
    if (!model) {
      if (imageBitmap) imageBitmap.close();
      return;
    }

    try {
      // รันการตรวจจับวัตถุ
      const boxes = await runInference(imageBitmap);

      // ส่งพิกัดตำแหน่งที่คำนวณเสร็จแล้วกลับไปยัง Main Thread
      postMessage({ type: 'DETECTION_RESULT', boxes });
    } catch (err) {
      postMessage({ type: 'ERROR', message: err.message });
    } finally {
      // คืน Memory ของ ImageBitmap ทุกครั้งเพื่อป้องกัน Memory Leak
      if (imageBitmap) {
        imageBitmap.close();
      }
    }
  }
};

// -------------------------------------------------------------
// 3. ฟังก์ชันแปลงภาพ ImageBitmap และรัน Inference
// -------------------------------------------------------------
async function runInference(imageBitmap) {
  // Pre-processing: แปลง ImageBitmap เป็น Tensor ขนาด [1, 640, 640, 3] แบบ Non-blocking
  const inputTensor = tf.tidy(() => {
    const img = tf.browser.fromPixels(imageBitmap);
    const resized = tf.image.resizeBilinear(img, [INPUT_SIZE, INPUT_SIZE]);
    return resized.div(255.0).expandDims(0);
  });

  // รัน โมเดล YOLOv8
  const outputTensor = await model.executeAsync(inputTensor);
  
  // Post-processing: ดึงพิกัดและประมวลผล NMS
  const boxes = await postProcessYOLOv8(outputTensor);

  // คืน Memory ของ Tensor ทั้งหมด
  inputTensor.dispose();
  if (Array.isArray(outputTensor)) {
    outputTensor.forEach(t => t.dispose());
  } else {
    outputTensor.dispose();
  }

  return boxes;
}

// -------------------------------------------------------------
// 4. Post-processing: ถอดโครงสร้าง Output -> Filter Person -> NMS
// -------------------------------------------------------------
async function postProcessYOLOv8(output) {
  const rawOutput = Array.isArray(output) ? output[0] : output;
  const shape = rawOutput.shape; // โครงสร้าง Output: [1, 84, 8400] หรือ [1, 8400, 84]

  let numAnchors, numAttributes;
  let isTransposed = false;

  if (shape[1] === 84) {
    numAttributes = shape[1]; // 84 = 4 (box coords) + 80 (class scores)
    numAnchors = shape[2];    // 8400 anchors
  } else {
    numAnchors = shape[1];
    numAttributes = shape[2];
    isTransposed = true;
  }

  // ดึงข้อมูล Float32Array แบบ Async (เลี่ยงการใช้ arraySync ที่ดักบล็อก CPU)
  const data = await rawOutput.data();

  const boxesArr = [];
  const scoresArr = [];

  // วนลูปสแกนเฉพาะ Class 0 (Person)
  for (let i = 0; i < numAnchors; i++) {
    let cx, cy, w, h, personScore;

    if (!isTransposed) {
      // โครงสร้าง [84, 8400]
      cx = data[0 * numAnchors + i];
      cy = data[1 * numAnchors + i];
      w  = data[2 * numAnchors + i];
      h  = data[3 * numAnchors + i];
      personScore = data[(4 + PERSON_CLASS_ID) * numAnchors + i];
    } else {
      // โครงสร้าง [8400, 84]
      const offset = i * numAttributes;
      cx = data[offset + 0];
      cy = data[offset + 1];
      w  = data[offset + 2];
      h  = data[offset + 3];
      personScore = data[offset + 4 + PERSON_CLASS_ID];
    }

    // กรองค่า Confidence เบื้องต้น
    if (personScore >= CONF_THRESHOLD) {
      // แปลงพิกัดจาก [center_x, center_y, width, height] เป็น [y1, x1, y2, x2]
      const x1 = Math.max(0, cx - w / 2);
      const y1 = Math.max(0, cy - h / 2);
      const x2 = Math.min(INPUT_SIZE, cx + w / 2);
      const y2 = Math.min(INPUT_SIZE, cy + h / 2);

      boxesArr.push([y1, x1, y2, x2]);
      scoresArr.push(personScore);
    }
  }

  if (boxesArr.length === 0) {
    return [];
  }

  // ทำ Non-Maximum Suppression (NMS) เพื่อตัดกรอบที่ซ้ำซ้อน
  const boxesTensor = tf.tensor2d(boxesArr);
  const scoresTensor = tf.tensor1d(scoresArr);

  const nmsIndicesTensor = await tf.image.nonMaxSuppressionAsync(
    boxesTensor,
    scoresTensor,
    20, // จำกัดไม่เกิน 20 คนต่อเฟรม
    IOU_THRESHOLD,
    CONF_THRESHOLD
  );

  const nmsIndices = await nmsIndicesTensor.data();

  // แปลงผลลัพธ์ NMS กลับเป็น JSON Object สเกลตามพิกัด 640x640
  const finalBoxes = [];
  for (let idx of nmsIndices) {
    const [y1, x1, y2, x2] = boxesArr[idx];
    const score = scoresArr[idx];

    finalBoxes.push({
      x: x1,
      y: y1,
      w: x2 - x1,
      h: y2 - y1,
      score: parseFloat(score.toFixed(2)),
      classId: PERSON_CLASS_ID,
      label: 'person'
    });
  }

  // คืน Memory NMS Tensors
  boxesTensor.dispose();
  scoresTensor.dispose();
  nmsIndicesTensor.dispose();

  return finalBoxes;
}