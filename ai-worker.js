// ai-worker.js
importScripts('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@latest/dist/tf.min.js');

let model = null;

// 1. โหลดโมเดล YOLOv8 ใน Worker Thread
async function loadYoloModel() {
  try {
    // กำหนด Path ของโมเดล YOLOv8 Graph Model
    model = await tf.loadGraphModel('/model/yolov8n_web_model/model.json');
    
    // Warm-up โมเดลสร้าง Memory Buffer ล่วงหน้า
    const dummyInput = tf.zeros([1, 640, 640, 3]);
    await model.executeAsync(dummyInput);
    tf.dispose(dummyInput);

    postMessage({ type: 'MODEL_READY' });
  } catch (err) {
    postMessage({ type: 'ERROR', message: err.message });
  }
}

loadYoloModel();

// 2. รับ Message จาก Main Thread
self.onmessage = async (e) => {
  const { type, imageBitmap } = e.data;

  if (type === 'DETECT' && model) {
    try {
      // แปลง ImageBitmap เป็น Tensor 640x640 แบบ Non-blocking
      const tensor = tf.tidy(() => {
        const img = tf.browser.fromPixels(imageBitmap);
        const resized = tf.image.resizeBilinear(img, [640, 640]);
        return resized.div(255.0).expandDims(0);
      });

      // รัน Inference
      const rawResults = await model.executeAsync(tensor);

      // โหลดข้อมูลแบบ Async (เลี่ยง arraySync() ที่ล็อค CPU)
      const outputData = await rawResults.data();
      
      // ดึงพิกัดกรอบ (Post-processing)
      const boxes = parseYOLOOutput(outputData, rawResults.shape);

      // เคลียร์หน่วยความจำ Tensors และ ImageBitmap
      tensor.dispose();
      tf.dispose(rawResults);
      imageBitmap.close(); // สำคัญมาก: ปิด ImageBitmap เพื่อป้องกัน Memory Leak

      // ส่งพิกัดที่คำนวณเสร็จแล้วกลับ Main Thread
      postMessage({ type: 'DETECTION_RESULT', boxes });
    } catch (err) {
      if (imageBitmap) imageBitmap.close();
      postMessage({ type: 'ERROR', message: err.message });
    }
  }
};

// ฟังก์ชัน Post-processing กรองเฉพาะ Person (Class ID 0) และ Conf >= 0.40
function parseYOLOOutput(data, shape) {
  const detectedBoxes = [];
  // โครงสร้าง Output YOLOv8: [1, 84, 8400] หรือ [1, 8400, 84]
  // ใส่ Logic คำนวณ NMS และกรองเฉพาะ Class 0 ตรงนี้...
  return detectedBoxes;
}