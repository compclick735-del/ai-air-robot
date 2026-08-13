// ==========================================
// 1. เรียกใช้งาน Web Worker
// ==========================================
const aiWorker = new Worker('ai-worker.js');
let isProcessingFrame = false;
let historyLog = []; // สำหรับเก็บข้อมูลทำ CSV Export

aiWorker.onmessage = (e) => {
  if (e.data.type === 'DETECTION_RESULT') {
    const people = e.data.results;
    
    // อัปเดต UI จำนวนคน
    const countElement = document.getElementById('peopleCount');
    if (countElement) countElement.innerText = e.data.count;

    // ตรวจจับคนและคุมหุ่นยนต์ (Deadband Logic)
    if (people.length > 0) {
      handlePersonTracking(people[0].bbox);
    }

    isProcessingFrame = false;
  }
};

// ส่งภาพจาก <video> หรือ <img> เข้า Worker
function sendFrameToWorker(videoElement) {
  if (isProcessingFrame) return;

  createImageBitmap(videoElement).then(imageBitmap => {
    isProcessingFrame = true;
    aiWorker.postMessage({ type: 'PROCESS_FRAME', imageBitmap }, [imageBitmap]);
  });
}

// ==========================================
// 2. Deadband Tracking Algorithm
// ==========================================
let lastCommand = 'STOP';

function handlePersonTracking(bbox) {
  const [x, y, width, height] = bbox;
  const personCenterX = x + width / 2;
  const frameCenterX = 200; // สมมติความกว้างกล้อง 400px (CIF)
  const deadband = 40;     // ระยะเบี่ยงเบนยอมรับได้ ±40px

  let currentCommand = 'STOP';

  if (personCenterX < frameCenterX - deadband) {
    currentCommand = 'TURN_LEFT';
  } else if (personCenterX > frameCenterX + deadband) {
    currentCommand = 'TURN_RIGHT';
  } else {
    currentCommand = 'FORWARD';
  }

  // ส่งคำสั่งเฉพาะตอนที่มีการเปลี่ยนสถานะจริงเท่านั้น
  if (currentCommand !== lastCommand) {
    sendMqttCommand(currentCommand);
    lastCommand = currentCommand;
  }
}

function sendMqttCommand(cmd) {
  console.log("MQTT Send Command:", cmd);
  // ผูกฟังก์ชันส่ง MQTT เดิมของคุณที่นี่
}

// ==========================================
// 3. ฟังก์ชันดึงมลพิษผ่าน Vercel Serverless
// ==========================================
async function fetchPollutionData(lat, lon) {
  try {
    // เรียกผ่าน Serverless Proxy ในโฟลเดอร์ api/
    const response = await fetch(`/api/weather?lat=${lat}&lon=${lon}`);
    const data = await response.json();
    
    // บันทึกลง Memory สำหรับ Export
    const pm25 = data.list[0].components.pm2_5;
    const co2 = data.list[0].components.co;
    
    historyLog.push({
      timestamp: new Date().toLocaleString(),
      pm25: pm25,
      co2: co2
    });

  } catch (err) {
    console.error("Error fetching pollution data:", err);
  }
}

// ==========================================
// 4. ฟังก์ชัน Export CSV Report
// ==========================================
function exportToCSV() {
  if (historyLog.length === 0) {
    alert("ยังไม่มีข้อมูลสำหรับส่งออก");
    return;
  }

  let csvContent = "data:text/csv;charset=utf-8,Timestamp,PM2.5,CO\n";
  historyLog.forEach(row => {
    csvContent += `${row.timestamp},${row.pm25},${row.co2}\n`;
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `Air_Report_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}