importScripts(
    'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js'
);

// ============================================================
// YOLO26 TensorFlow.js Web Worker
// ============================================================

let yoloModel = null;
let isInferencing = false;

// URL ของ YOLO26 Graph Model
const YOLO_MODEL_URL =
    'https://github.com/compclick735-del/yolo-26/releases/download/v1.0.0/model.json';

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
// Utility
// ============================================================

function postError(message, details = '') {
    self.postMessage({
        type: 'MODEL_ERROR',
        error: details
            ? `${message}: ${details}`
            : message
    });
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function sigmoid(value) {
    return 1 / (1 + Math.exp(-value));
}

// ============================================================
// Tensor Output Parser
// รองรับ output จาก Graph Model หลายรูปแบบ
// ============================================================

function flattenModelOutputs(output) {

    if (output == null) {
        return [];
    }

    // Tensor
    if (output instanceof tf.Tensor) {

        const values = output.dataSync();
        const shape = output.shape.slice();

        return [{
            values: Array.from(values),
            shape: shape
        }];
    }

    // Array
    if (Array.isArray(output)) {

        const result = [];

        for (const item of output) {
            result.push(
                ...flattenModelOutputs(item)
            );
        }

        return result;
    }

    // Object / Named outputs
    if (typeof output === 'object') {

        const result = [];

        for (const key of Object.keys(output)) {

            result.push(
                ...flattenModelOutputs(output[key])
            );

        }

        return result;
    }

    return [];
}

// ============================================================
// Decode YOLO Output
//
// รองรับรูปแบบ:
//
// 1. [1, N, 6]
//    [x1, y1, x2, y2, confidence, classId]
//
// 2. [N, 6]
//
// 3. [1, 6, N]
//
// 4. [6, N]
//
// 5. [1, (4 + classes), N]
//    [cx, cy, w, h, class scores...]
//
// 6. [1, N, (4 + classes)]
// ============================================================

function decodeTensorOutput(
    outputInfo,
    imageW,
    imageH
) {

    const {
        values,
        shape
    } = outputInfo;

    if (
        !values ||
        values.length === 0 ||
        !shape ||
        shape.length === 0
    ) {
        return [];
    }

    // --------------------------------------------------------
    // Remove batch dimension
    // --------------------------------------------------------

    let dims = shape.slice();

    if (
        dims.length > 1 &&
        dims[0] === 1
    ) {
        dims = dims.slice(1);
    }

    // ต้องเป็น 2D
    if (dims.length !== 2) {
        return [];
    }

    let rows;
    let cols;
    let matrix;

    // --------------------------------------------------------
    // ตรวจว่าเป็น [features, detections]
    // หรือ [detections, features]
    // --------------------------------------------------------

    if (
        dims[0] === 6 ||
        (
            dims[0] >= 5 &&
            dims[0] <= 7 &&
            dims[1] > dims[0]
        )
    ) {

        // ----------------------------------------------------
        // [features, detections]
        // แปลงเป็น [detections, features]
        // ----------------------------------------------------

        rows = dims[1];
        cols = dims[0];

        matrix = new Array(rows);

        for (let r = 0; r < rows; r++) {

            const row = new Array(cols);

            for (let c = 0; c < cols; c++) {

                row[c] =
                    values[c * rows + r];

            }

            matrix[r] = row;
        }

    } else {

        // ----------------------------------------------------
        // [detections, features]
        // ----------------------------------------------------

        rows = dims[0];
        cols = dims[1];

        matrix = new Array(rows);

        for (let r = 0; r < rows; r++) {

            matrix[r] =
                values.slice(
                    r * cols,
                    (r + 1) * cols
                );

        }
    }

    const detections = [];

    // ========================================================
    // Format 1
    // [x1, y1, x2, y2, score, classId]
    // ========================================================

    if (cols === 6) {

        for (const row of matrix) {

            const x1 = Number(row[0]);
            const y1 = Number(row[1]);

            const x2 = Number(row[2]);
            const y2 = Number(row[3]);

            const score = Number(row[4]);
            const classId = Number(row[5]);

            if (
                !Number.isFinite(score) ||
                !Number.isFinite(classId)
            ) {
                continue;
            }

            // เอาเฉพาะ person
            if (
                classId !== PERSON_CLASS_ID ||
                score < CONFIDENCE_THRESHOLD
            ) {
                continue;
            }

            // ------------------------------------------------
            // Bounding box
            // ------------------------------------------------

            const minX =
                clamp(
                    Math.min(x1, x2),
                    0,
                    INPUT_SIZE
                );

            const minY =
                clamp(
                    Math.min(y1, y2),
                    0,
                    INPUT_SIZE
                );

            const maxX =
                clamp(
                    Math.max(x1, x2),
                    0,
                    INPUT_SIZE
                );

            const maxY =
                clamp(
                    Math.max(y1, y2),
                    0,
                    INPUT_SIZE
                );

            const width =
                maxX - minX;

            const height =
                maxY - minY;

            if (
                width <= 0 ||
                height <= 0
            ) {
                continue;
            }

            detections.push({

                x:
                    minX *
                    (imageW / INPUT_SIZE),

                y:
                    minY *
                    (imageH / INPUT_SIZE),

                width:
                    width *
                    (imageW / INPUT_SIZE),

                height:
                    height *
                    (imageH / INPUT_SIZE),

                score: score,

                imgW: imageW,

                imgH: imageH
            });
        }

        return detections;
    }

    // ========================================================
    // Raw YOLO
    //
    // [cx, cy, w, h, classScore1, classScore2, ...]
    // ========================================================

    if (cols >= 5) {

        const numClasses =
            cols - 4;

        for (const row of matrix) {

            if (row.length < 5) {
                continue;
            }

            let cx = Number(row[0]);
            let cy = Number(row[1]);

            let w = Number(row[2]);
            let h = Number(row[3]);

            if (
                !Number.isFinite(cx) ||
                !Number.isFinite(cy) ||
                !Number.isFinite(w) ||
                !Number.isFinite(h)
            ) {
                continue;
            }

            // ------------------------------------------------
            // หา class ที่ confidence สูงสุด
            // ------------------------------------------------

            let bestClass = -1;
            let bestScore = -Infinity;

            for (
                let classIndex = 0;
                classIndex < numClasses;
                classIndex++
            ) {

                let score =
                    Number(
                        row[4 + classIndex]
                    );

                if (!Number.isFinite(score)) {
                    continue;
                }

                // ถ้าเป็น logits
                if (
                    score < 0 ||
                    score > 1
                ) {
                    score =
                        sigmoid(score);
                }

                if (
                    score > bestScore
                ) {

                    bestScore =
                        score;

                    bestClass =
                        classIndex;
                }
            }

            // ไม่ใช่ person
            if (
                bestClass !== PERSON_CLASS_ID
            ) {
                continue;
            }

            // confidence ต่ำเกินไป
            if (
                bestScore <
                CONFIDENCE_THRESHOLD
            ) {
                continue;
            }

            // ------------------------------------------------
            // บางโมเดลคืนค่า 0..1
            // บางโมเดลคืนค่าเป็น pixel
            // ------------------------------------------------

            const maxBoxValue =
                Math.max(
                    Math.abs(cx),
                    Math.abs(cy),
                    Math.abs(w),
                    Math.abs(h)
                );

            if (
                maxBoxValue <= 2
            ) {

                cx *= INPUT_SIZE;
                cy *= INPUT_SIZE;

                w *= INPUT_SIZE;
                h *= INPUT_SIZE;
            }

            // ------------------------------------------------
            // CX CY WH -> X1 Y1 X2 Y2
            // ------------------------------------------------

            const x1 =
                cx - (w / 2);

            const y1 =
                cy - (h / 2);

            const x2 =
                cx + (w / 2);

            const y2 =
                cy + (h / 2);

            // ------------------------------------------------
            // Clamp
            // ------------------------------------------------

            const clippedX1 =
                clamp(
                    x1,
                    0,
                    INPUT_SIZE
                );

            const clippedY1 =
                clamp(
                    y1,
                    0,
                    INPUT_SIZE
                );

            const clippedX2 =
                clamp(
                    x2,
                    0,
                    INPUT_SIZE
                );

            const clippedY2 =
                clamp(
                    y2,
                    0,
                    INPUT_SIZE
                );

            const width =
                clippedX2 -
                clippedX1;

            const height =
                clippedY2 -
                clippedY1;

            if (
                width <= 0 ||
                height <= 0
            ) {
                continue;
            }

            detections.push({

                x:
                    clippedX1 *
                    (imageW / INPUT_SIZE),

                y:
                    clippedY1 *
                    (imageH / INPUT_SIZE),

                width:
                    width *
                    (imageW / INPUT_SIZE),

                height:
                    height *
                    (imageH / INPUT_SIZE),

                score:
                    bestScore,

                imgW:
                    imageW,

                imgH:
                    imageH
            });
        }
    }

    return detections;
}

// ============================================================
// YOLO Inference
// ============================================================

async function runInference(
    imageBitmap
) {

    const imageW =
        imageBitmap.width;

    const imageH =
        imageBitmap.height;

    // --------------------------------------------------------
    // Image -> Tensor
    // --------------------------------------------------------

    const input =
        tf.tidy(() => {

            const imgTensor =
                tf.browser.fromPixels(
                    imageBitmap
                );

            const resized =
                tf.image.resizeBilinear(
                    imgTensor,
                    [
                        INPUT_SIZE,
                        INPUT_SIZE
                    ]
                );

            const normalized =
                resized.div(255.0);

            return normalized.expandDims(0);
        });

    try {

        // ----------------------------------------------------
        // Run Graph Model
        // ----------------------------------------------------

        const output =
            yoloModel.execute(
                input
            );

        // ----------------------------------------------------
        // อ่าน output tensor
        // ----------------------------------------------------

        const outputInfos =
            flattenModelOutputs(
                output
            );

        // ----------------------------------------------------
        // Dispose output
        // ----------------------------------------------------

        if (
            output instanceof tf.Tensor
        ) {

            output.dispose();

        } else if (
            Array.isArray(output)
        ) {

            output.forEach(
                tensor => {

                    if (
                        tensor instanceof tf.Tensor
                    ) {
                        tensor.dispose();
                    }

                }
            );

        } else if (
            output &&
            typeof output === 'object'
        ) {

            Object.values(output)
                .forEach(
                    tensor => {

                        if (
                            tensor instanceof tf.Tensor
                        ) {
                            tensor.dispose();
                        }

                    }
                );
        }

        // ----------------------------------------------------
        // Decode
        // ----------------------------------------------------

        let detections = [];

        for (
            const outputInfo
            of outputInfos
        ) {

            const decoded =
                decodeTensorOutput(
                    outputInfo,
                    imageW,
                    imageH
                );

            detections.push(
                ...decoded
            );
        }

        // ----------------------------------------------------
        // Sort by confidence
        // ----------------------------------------------------

        detections =
            detections
                .sort(
                    (a, b) =>
                        b.score -
                        a.score
                )
                .slice(0, 100);

        if (
            detections.length === 0
        ) {
            return [];
        }

        // ====================================================
        // Final NMS
        // ====================================================

        const boxes =
            detections.map(
                detection => [

                    detection.y,

                    detection.x,

                    detection.y +
                    detection.height,

                    detection.x +
                    detection.width

                ]
            );

        const scores =
            detections.map(
                detection =>
                    detection.score
            );

        const tensorBoxes =
            tf.tensor2d(
                boxes
            );

        const tensorScores =
            tf.tensor1d(
                scores
            );

        try {

            const selected =
                await tf.image
                    .nonMaxSuppressionAsync(
                        tensorBoxes,
                        tensorScores,
                        MAX_DETECTIONS,
                        NMS_IOU_THRESHOLD,
                        CONFIDENCE_THRESHOLD
                    );

            const selectedIndices =
                await selected.array();

            selected.dispose();

            return selectedIndices.map(
                index =>
                    detections[index]
            );

        } finally {

            tensorBoxes.dispose();
            tensorScores.dispose();
        }

    } finally {

        input.dispose();
    }
}

// ============================================================
// Initialize Worker
// ============================================================

async function initWorker() {

    try {

        console.log(
            '[YOLO26] กำลังเริ่มต้น Worker...'
        );

        // ----------------------------------------------------
        // TensorFlow.js Ready
        // ----------------------------------------------------

        await tf.ready();

        console.log(
            '[YOLO26] TensorFlow.js พร้อมใช้งาน'
        );

        // ----------------------------------------------------
        // Load Model
        // ----------------------------------------------------

        console.log(
            '[YOLO26] กำลังโหลดโมเดล...'
        );

        yoloModel =
            await tf.loadGraphModel(
                YOLO_MODEL_URL
            );

        console.log(
            '[YOLO26] โหลดโมเดลสำเร็จ'
        );

        // ====================================================
        // Warmup
        // ====================================================

        const dummyTensor =
            tf.zeros([
                1,
                INPUT_SIZE,
                INPUT_SIZE,
                3
            ]);

        const warmupOutput =
            yoloModel.execute(
                dummyTensor
            );

        // ----------------------------------------------------
        // Dispose warmup output
        // ----------------------------------------------------

        if (
            warmupOutput instanceof tf.Tensor
        ) {

            warmupOutput.dispose();

        } else if (
            Array.isArray(warmupOutput)
        ) {

            warmupOutput.forEach(
                tensor => {

                    if (
                        tensor instanceof tf.Tensor
                    ) {

                        tensor.dispose();
                    }

                }
            );

        } else if (
            warmupOutput &&
            typeof warmupOutput === 'object'
        ) {

            Object.values(
                warmupOutput
            ).forEach(
                tensor => {

                    if (
                        tensor instanceof tf.Tensor
                    ) {

                        tensor.dispose();
                    }

                }
            );
        }

        dummyTensor.dispose();

        console.log(
            '[YOLO26] Warmup สำเร็จ'
        );

        // ----------------------------------------------------
        // แจ้ง Main Thread
        // ----------------------------------------------------

        self.postMessage({

            type: 'MODEL_READY',

            model: 'YOLO26',

            inputSize: INPUT_SIZE
        });

    } catch (err) {

        console.error(
            '[YOLO26] Worker initialization error:',
            err
        );

        postError(
            'โหลดโมเดล YOLO26 ไม่สำเร็จ',
            err?.message ||
            String(err)
        );
    }
}

// เริ่ม Worker
initWorker();

// ============================================================
// รับข้อมูลจาก Main Thread
// ============================================================

self.onmessage = async (
    event
) => {

    // --------------------------------------------------------
    // รับเฉพาะ PROCESS_FRAME
    // --------------------------------------------------------

    if (
        event.data?.type !==
        'PROCESS_FRAME'
    ) {
        return;
    }

    // --------------------------------------------------------
    // ถ้ายังโหลดโมเดลไม่เสร็จ
    // --------------------------------------------------------

    if (
        !yoloModel
    ) {

        self.postMessage({

            type:
                'DETECTION_ERROR',

            error:
                'YOLO26 model ยังโหลดไม่เสร็จ'
        });

        return;
    }

    // --------------------------------------------------------
    // ป้องกัน inference ซ้อน
    // --------------------------------------------------------

    if (
        isInferencing
    ) {
        return;
    }

    isInferencing =
        true;

    const imageBitmap =
        event.data.imageBitmap;

    try {

        if (!imageBitmap) {

            throw new Error(
                'ไม่พบ imageBitmap ที่ส่งมาจาก Main Thread'
            );
        }

        // ----------------------------------------------------
        // Inference
        // ----------------------------------------------------

        const detections =
            await runInference(
                imageBitmap
            );

        // ----------------------------------------------------
        // ส่งผลกลับ Main Thread
        // ----------------------------------------------------

        self.postMessage({

            type:
                'DETECTION_RESULT',

            results:
                detections,

            count:
                detections.length
        });

    } catch (err) {

        console.error(
            '[YOLO26] Inference Error:',
            err
        );

        self.postMessage({

            type:
                'DETECTION_ERROR',

            error:
                err?.message ||
                String(err)
        });

    } finally {

        // ----------------------------------------------------
        // ปิด ImageBitmap
        // ----------------------------------------------------

        if (
            imageBitmap
        ) {

            try {

                imageBitmap.close();

            } catch (_) {

                // ignore
            }
        }

        isInferencing =
            false;
    }
};