importScripts(
    'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js'
);

// ============================================================
// YOLO26 TensorFlow.js Web Worker (Optimized Version)
// ============================================================

let yoloModel = null;
let isInferencing = false;

// URL ของ YOLO26 Graph Model
const YOLO_MODEL_URL = 'https://cdn.jsdelivr.net/gh/compclick735-del/yolo-26@v1.0.0/model.json';

// COCO Class 0 = person
const PERSON_CLASS_ID = 0;

// ============================================================
// Inference Settings
// ============================================================

const INPUT_SIZE = 640;
const CONFIDENCE_THRESHOLD = 0.40;
const NMS_IOU_THRESHOLD = 0.45;
const MAX_DETECTIONS = 5;

// ============================================================
// Utility Functions
// ============================================================

function postError(message, details = '') {
    self.postMessage({
        type: 'MODEL_ERROR',
        error: details ? `${message}: ${details}` : message
    });
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function sigmoid(value) {
    return 1 / (1 + Math.exp(-value));
}

function disposeTensors(output) {
    if (!output) return;
    if (output instanceof tf.Tensor) {
        output.dispose();
    } else if (Array.isArray(output)) {
        output.forEach(tensor => tensor instanceof tf.Tensor && tensor.dispose());
    } else if (typeof output === 'object') {
        Object.values(output).forEach(tensor => tensor instanceof tf.Tensor && tensor.dispose());
    }
}

// ============================================================
// Tensor Output Parser
// ============================================================

function flattenModelOutputs(output) {
    if (output == null) return [];

    if (output instanceof tf.Tensor) {
        return [{
            values: output.dataSync(), // TypedArray Direct Reference
            shape: output.shape.slice()
        }];
    }

    if (Array.isArray(output)) {
        const result = [];
        for (const item of output) {
            result.push(...flattenModelOutputs(item));
        }
        return result;
    }

    if (typeof output === 'object') {
        const result = [];
        for (const key of Object.keys(output)) {
            result.push(...flattenModelOutputs(output[key]));
        }
        return result;
    }

    return [];
}

// ============================================================
// Zero-Allocation Decode YOLO Output
// ============================================================

function decodeTensorOutput(outputInfo, imageW, imageH) {
    const { values, shape } = outputInfo;

    if (!values || values.length === 0 || !shape || shape.length === 0) {
        return [];
    }

    let dims = shape.slice();
    if (dims.length > 1 && dims[0] === 1) {
        dims = dims.slice(1); // ตัด Batch Dim [1, N, C] -> [N, C]
    }

    if (dims.length !== 2) return [];

    // ตรวจสอบรูปทรง Tensor
    const isTransposed = (dims[0] >= 5 && dims[0] <= 85) && (dims[1] > dims[0]);
    const numDetections = isTransposed ? dims[1] : dims[0];
    const numFeatures = isTransposed ? dims[0] : dims[1];

    // Direct Index Lookup เพื่อหลีกเลี่ยง GC/Array Slice
    const getValue = (r, c) => isTransposed ? values[c * numDetections + r] : values[r * numFeatures + c];

    const detections = [];

    // --------------------------------------------------------
    // Format 1: [N, 6] (x1, y1, x2, y2, score, classId)
    // --------------------------------------------------------
    if (numFeatures === 6) {
        for (let r = 0; r < numDetections; r++) {
            const score = Number(getValue(r, 4));
            const classId = Number(getValue(r, 5));

            if (!Number.isFinite(score) || !Number.isFinite(classId)) continue;
            if (classId !== PERSON_CLASS_ID || score < CONFIDENCE_THRESHOLD) continue;

            const x1 = Number(getValue(r, 0));
            const y1 = Number(getValue(r, 1));
            const x2 = Number(getValue(r, 2));
            const y2 = Number(getValue(r, 3));

            const minX = clamp(Math.min(x1, x2), 0, INPUT_SIZE);
            const minY = clamp(Math.min(y1, y2), 0, INPUT_SIZE);
            const maxX = clamp(Math.max(x1, x2), 0, INPUT_SIZE);
            const maxY = clamp(Math.max(y1, y2), 0, INPUT_SIZE);

            const width = maxX - minX;
            const height = maxY - minY;

            if (width <= 0 || height <= 0) continue;

            detections.push({
                x: minX * (imageW / INPUT_SIZE),
                y: minY * (imageH / INPUT_SIZE),
                width: width * (imageW / INPUT_SIZE),
                height: height * (imageH / INPUT_SIZE),
                score: score,
                imgW: imageW,
                imgH: imageH
            });
        }
        return detections;
    }

    // --------------------------------------------------------
    // Format 2: Raw YOLO [N, 4 + classes] (cx, cy, w, h, class_scores...)
    // --------------------------------------------------------
    if (numFeatures >= 5) {
        const numClasses = numFeatures - 4;

        for (let r = 0; r < numDetections; r++) {
            let cx = Number(getValue(r, 0));
            let cy = Number(getValue(r, 1));
            let w = Number(getValue(r, 2));
            let h = Number(getValue(r, 3));

            if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(w) || !Number.isFinite(h)) {
                continue;
            }

            // คำนวณหา Class ที่ Score สูงสุด
            let bestClass = -1;
            let bestScore = -Infinity;

            for (let c = 0; c < numClasses; c++) {
                let score = Number(getValue(r, 4 + c));
                if (!Number.isFinite(score)) continue;

                if (score < 0 || score > 1) {
                    score = sigmoid(score);
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestClass = c;
                }
            }

            if (bestClass !== PERSON_CLASS_ID || bestScore < CONFIDENCE_THRESHOLD) {
                continue;
            }

            // แปลง Normalized Coordinates (0..1) เป็น Pixels หากจำเป็น
            const maxBoxValue = Math.max(Math.abs(cx), Math.abs(cy), Math.abs(w), Math.abs(h));
            if (maxBoxValue <= 2) {
                cx *= INPUT_SIZE;
                cy *= INPUT_SIZE;
                w *= INPUT_SIZE;
                h *= INPUT_SIZE;
            }

            const x1 = cx - (w / 2);
            const y1 = cy - (h / 2);
            const x2 = cx + (w / 2);
            const y2 = cy + (h / 2);

            const clippedX1 = clamp(x1, 0, INPUT_SIZE);
            const clippedY1 = clamp(y1, 0, INPUT_SIZE);
            const clippedX2 = clamp(x2, 0, INPUT_SIZE);
            const clippedY2 = clamp(y2, 0, INPUT_SIZE);

            const width = clippedX2 - clippedX1;
            const height = clippedY2 - clippedY1;

            if (width <= 0 || height <= 0) continue;

            detections.push({
                x: clippedX1 * (imageW / INPUT_SIZE),
                y: clippedY1 * (imageH / INPUT_SIZE),
                width: width * (imageW / INPUT_SIZE),
                height: height * (imageH / INPUT_SIZE),
                score: bestScore,
                imgW: imageW,
                imgH: imageH
            });
        }
    }

    return detections;
}

// ============================================================
// YOLO Inference Execution
// ============================================================

async function runInference(imageBitmap) {
    const imageW = imageBitmap.width;
    const imageH = imageBitmap.height;

    // Image Pre-processing
    const input = tf.tidy(() => {
        const imgTensor = tf.browser.fromPixels(imageBitmap);
        const resized = tf.image.resizeBilinear(imgTensor, [INPUT_SIZE, INPUT_SIZE]);
        const normalized = resized.div(255.0);
        return normalized.expandDims(0);
    });

    let rawOutput = null;

    try {
        // Run Inference
        rawOutput = yoloModel.execute(input);

        // Parse Tensor Data
        const outputInfos = flattenModelOutputs(rawOutput);

        // Decode Bounding Boxes
        let detections = [];
        for (const outputInfo of outputInfos) {
            const decoded = decodeTensorOutput(outputInfo, imageW, imageH);
            detections.push(...decoded);
        }

        // Sort Top Confidence
        detections.sort((a, b) => b.score - a.score);
        detections = detections.slice(0, 100);

        if (detections.length === 0) return [];

        // Apply Final Non-Maximum Suppression (NMS)
        const boxes = detections.map(d => [d.y, d.x, d.y + d.height, d.x + d.width]);
        const scores = detections.map(d => d.score);

        const tensorBoxes = tf.tensor2d(boxes);
        const tensorScores = tf.tensor1d(scores);

        try {
            const selected = await tf.image.nonMaxSuppressionAsync(
                tensorBoxes,
                tensorScores,
                MAX_DETECTIONS,
                NMS_IOU_THRESHOLD,
                CONFIDENCE_THRESHOLD
            );

            const selectedIndices = await selected.array();
            selected.dispose();

            return selectedIndices.map(index => detections[index]);
        } finally {
            tensorBoxes.dispose();
            tensorScores.dispose();
        }

    } finally {
        // Safely Dispose Raw Output and Input Tensors
        disposeTensors(rawOutput);
        input.dispose();
    }
}

// ============================================================
// Initialize Worker
// ============================================================

async function initWorker() {
    try {
        console.log('[YOLO26] กำลังเริ่มต้น Worker...');

        await tf.ready();
        console.log(`[YOLO26] TensorFlow.js พร้อมใช้งาน (Backend: ${tf.getBackend()})`);

        console.log('[YOLO26] กำลังโหลดโมเดล...');
        yoloModel = await tf.loadGraphModel(YOLO_MODEL_URL);
        console.log('[YOLO26] โหลดโมเดลสำเร็จ');

        // Warmup Model
        const dummyTensor = tf.zeros([1, INPUT_SIZE, INPUT_SIZE, 3]);
        const warmupOutput = yoloModel.execute(dummyTensor);

        disposeTensors(warmupOutput);
        dummyTensor.dispose();

        console.log('[YOLO26] Warmup สำเร็จ');

        self.postMessage({
            type: 'MODEL_READY',
            model: 'YOLO26',
            inputSize: INPUT_SIZE
        });

    } catch (err) {
        console.error('[YOLO26] Worker initialization error:', err);
        postError('โหลดโมเดล YOLO26 ไม่สำเร็จ', err?.message || String(err));
    }
}

initWorker();

// ============================================================
// Main Thread Communication
// ============================================================

self.onmessage = async (event) => {
    if (event.data?.type !== 'PROCESS_FRAME') return;

    if (!yoloModel) {
        self.postMessage({
            type: 'DETECTION_ERROR',
            error: 'YOLO26 model ยังโหลดไม่เสร็จ'
        });
        return;
    }

    if (isInferencing) return; // ข้ามเฟรมหากประมวลผลอยู่
    isInferencing = true;

    const imageBitmap = event.data.imageBitmap;

    try {
        if (!imageBitmap) {
            throw new Error('ไม่พบ imageBitmap ที่ส่งมาจาก Main Thread');
        }

        const detections = await runInference(imageBitmap);

        self.postMessage({
            type: 'DETECTION_RESULT',
            results: detections,
            count: detections.length
        });

    } catch (err) {
        console.error('[YOLO26] Inference Error:', err);
        self.postMessage({
            type: 'DETECTION_ERROR',
            error: err?.message || String(err)
        });

    } finally {
        if (imageBitmap) {
            try { imageBitmap.close(); } catch (_) {}
        }
        isInferencing = false;
    }
};