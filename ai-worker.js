importScripts('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs');
importScripts('https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd');

let model = null;
let nextTrackId = 1;
let trackedObjects = [];

// โหลดโมเดล AI ใน Worker Background
async function init() {
  model = await cocoSsd.load();
  self.postMessage({ type: 'READY' });
}
init();

// คำนวณ Intersection over Union (IoU) สำหรับ Tracking
function calculateIoU(boxA, boxB) {
  const [x1, y1, w1, h1] = boxA;
  const [x2, y2, w2, h2] = boxB;

  const xA = Math.max(x1, x2);
  const yA = Math.max(y1, y2);
  const xB = Math.min(x1 + w1, x2 + w2);
  const yB = Math.min(y1 + h1, y2 + h2);

  const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
  const boxAArea = w1 * h1;
  const boxBArea = w2 * h2;

  return interArea / (boxAArea + boxBArea - interArea);
}

// Simple IoU Tracker
function updateTracking(detections) {
  const currentTracks = [];

  detections.forEach(det => {
    let bestMatch = null;
    let highestIoU = 0.3; // Threshold

    trackedObjects.forEach(track => {
      const iou = calculateIoU(det.bbox, track.bbox);
      if (iou > highestIoU) {
        highestIoU = iou;
        bestMatch = track;
      }
    });

    if (bestMatch) {
      currentTracks.push({ ...det, id: bestMatch.id });
    } else {
      currentTracks.push({ ...det, id: nextTrackId++ });
    }
  });

  trackedObjects = currentTracks;
  return trackedObjects;
}

// รับเฟรมภาพจาก Main Thread
self.onmessage = async (e) => {
  if (e.data.type === 'PROCESS_FRAME' && model) {
    const imageBitmap = e.data.imageBitmap;
    
    // Run Inference
    const predictions = await model.detect(imageBitmap);
    const people = predictions.filter(p => p.class === 'person');
    
    // Run Tracker
    const trackedPeople = updateTracking(people);
    
    // คืน Memory Bitmap
    imageBitmap.close();

    self.postMessage({
      type: 'DETECTION_RESULT',
      results: trackedPeople,
      count: trackedPeople.length
    });
  }
};