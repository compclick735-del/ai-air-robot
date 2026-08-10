/**
 * air_model.js
 * ระบบประมวลผลทำนายคุณภาพอากาศ (Air Quality Prediction Engine)
 * สำหรับโรงเรียนชุมแพศึกษา
 */

/**
 * ฟังก์ชันหลัก: ทำนายความน่าจะเป็นของระดับคุณภาพอากาศ
 * @param {Array<number|string>} inputs - [temp, hum, pm25, pm10, no2, so2, co, proximity, popDensity]
 * @returns {Array<number>} [Good, Moderate, Poor, Hazardous]
 */
function predictAirQuality(inputs) {
    // 1. ตรวจสอบความถูกต้องของ Input
    if (!Array.isArray(inputs) || inputs.length < 9) {
        console.warn("air_model.js: ข้อมูล Input ไม่ครบถ้วน 9 ตัวแปร ใช้ค่ามาตรฐานสำรอง");
        return [0.25, 0.25, 0.25, 0.25];
    }

    // แปลงค่าทั้งหมดให้เป็น Float ป้องกัน Error จาก String และแก้ค่า NaN เป็น 0
    const [
        temp, hum, pm25, pm10,
        no2, so2, co, proximity, popDensity
    ] = inputs.map(val => {
        const parsed = parseFloat(val);
        return isNaN(parsed) ? 0 : parsed;
    });

    // 2. คำนวณคะแนนความเสี่ยง (Risk Score) จากพารามิเตอร์ทั้งหมด
    let riskScore = 0;

    // --- ฝุ่นมลพิษหลัก (PM2.5 & PM10) ---
    if (pm25 > 75.0) riskScore += 3.5;       // มีผลกระทบต่อสุขภาพ
    else if (pm25 > 37.5) riskScore += 2.0;  // เริ่มมีผลกระทบ (มาตรฐานใหม่ไทย)
    else if (pm25 > 15.0) riskScore += 1.0;  // ปานกลาง

    if (pm10 > 120.0) riskScore += 1.5;
    else if (pm10 > 50.0) riskScore += 0.8;

    // --- ก๊าซพิษ และสารเคมี (CO, NO2, SO2) ---
    if (co > 30.0) riskScore += 2.5;
    else if (co > 9.0) riskScore += 1.2;

    if (no2 > 170.0) riskScore += 1.2;
    else if (no2 > 60.0) riskScore += 0.6;

    if (so2 > 100.0) riskScore += 1.2;
    else if (so2 > 40.0) riskScore += 0.6;

    // --- ปัจจัยสภาพอากาศ (อุณหภูมิ + ความชื้น) ---
    // สภาพอากาศที่เอื้อให้ฝุ่นและมลพิษสะสมตัว (อากาศนิ่ง/ความชื้นสูง)
    if (hum > 80.0 && temp > 33.0) riskScore += 0.8;
    else if (hum > 85.0) riskScore += 0.4;

    // --- ปัจจัยแวดล้อมเชิงพื้นที่ ---
    if (proximity > 0 && proximity < 3.0) riskScore += 1.0; // ใกล้นิคมอุตสาหกรรม < 3 กม.
    if (popDensity > 700) riskScore += 0.5;                 // ความหนาแน่นประชากรสูง

    // 3. คำนวณความน่าจะเป็นของแต่ละระดับ [Good, Moderate, Poor, Hazardous]
    let probs = [0.05, 0.05, 0.05, 0.05];

    if (riskScore < 1.5) {
        probs = [0.88, 0.08, 0.03, 0.01]; // Good (ดีมาก/ดี)
    } else if (riskScore < 3.5) {
        probs = [0.10, 0.78, 0.09, 0.03]; // Moderate (ปานกลาง)
    } else if (riskScore < 6.0) {
        probs = [0.03, 0.12, 0.75, 0.10]; // Poor (เริ่มมีผลกระทบ)
    } else {
        probs = [0.01, 0.04, 0.10, 0.85]; // Hazardous (มีผลกระทบมาก)
    }

    return probs;
}

/**
 * ฟังก์ชันเสริม: แปลงผลการทำนายเป็น Object สำหรับนำไปแสดงผลบนหน้าเว็บ (UI) ได้ง่ายขึ้น
 * @param {Array<number|string>} inputs 
 * @returns {Object}
 */
function getAirQualityDetails(inputs) {
    const labels = ["Good", "Moderate", "Poor", "Hazardous"];
    const thaiLabels = ["ดีมาก", "ปานกลาง", "เริ่มมีผลกระทบ", "มีผลกระทบมาก"];
    const colors = ["#22c55e", "#eab308", "#f97316", "#ef4444"];

    const probs = predictAirQuality(inputs);
    const maxIndex = probs.indexOf(Math.max(...probs));

    return {
        probabilities: probs,
        status: labels[maxIndex],
        statusThai: thaiLabels[maxIndex],
        color: colors[maxIndex],
        confidence: (probs[maxIndex] * 100).toFixed(1) + "%"
    };
}
