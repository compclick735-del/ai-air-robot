/**
 * air_model.js
 * ระบบประมวลผลทำนายคุณภาพอากาศ (Air Quality Prediction Engine)
 * สำหรับโรงเรียนชุมแพศึกษา
 */

function predictAirQuality(inputs) {
    // inputs = [temp, hum, pm25, pm10, no2, so2, co, proximity, popDensity]
    if (!inputs || inputs.length < 9) {
        return [0.25, 0.25, 0.25, 0.25];
    }

    const [temp, hum, pm25, pm10, no2, so2, co, proximity, popDensity] = inputs;

    // คำนวณคะแนนความเสี่ยง (Risk Score) จากพารามิเตอร์สิ่งแวดล้อม
    let riskScore = 0;

    // ประเมิน PM2.5
    if (pm25 > 75) riskScore += 3.5;
    else if (pm25 > 37.5) riskScore += 2.0;
    else if (pm25 > 15.0) riskScore += 1.0;

    // ประเมิน CO (Carbon Monoxide)
    if (co > 30.0) riskScore += 3.0;
    else if (co > 9.0) riskScore += 1.5;

    // ปัจจัยแวดล้อม (ระยะห่างนิคมอุตสาหกรรม + ความหนาแน่นประชากร)
    if (proximity < 3.0) riskScore += 1.0;
    if (popDensity > 700) riskScore += 0.5;

    // คำนวณความน่าจะเป็นของแต่ละระดับ [Good, Moderate, Poor, Hazardous]
    let probs = [0.05, 0.05, 0.05, 0.05];

    if (riskScore < 1.5) {
        probs = [0.88, 0.08, 0.03, 0.01]; // Good
    } else if (riskScore < 3.0) {
        probs = [0.10, 0.78, 0.09, 0.03]; // Moderate
    } else if (riskScore < 5.0) {
        probs = [0.03, 0.12, 0.75, 0.10]; // Poor
    } else {
        probs = [0.01, 0.04, 0.10, 0.85]; // Hazardous
    }

    return probs;
}