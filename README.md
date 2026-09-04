# AI AIR ROBOT

ระบบต้นแบบสำหรับติดตามคุณภาพอากาศ ควบคุมหุ่นยนต์ และแจ้งเตือนการอพยพของโรงเรียนชุมแพศึกษา

## เริ่มใช้งาน

1. ติดตั้ง dependency ด้วย `npm install`
2. คัดลอก `config.example.js` เป็น `config.js`
3. กรอกค่า API, Supabase และ MQTT ใน `config.js`
4. เปิด `index.html` ผ่าน local server หรือ VS Code Live Server

ไฟล์ `config.js` ถูก ignore โดย Git และไม่ควร commit ขึ้น repository

## โหมดนำเสนอ

กด `Demo Mode` บนแถบด้านบนเพื่อป้อนข้อมูลเซนเซอร์จำลองเข้าสู่กราฟและระบบพยากรณ์ โดยไม่ต้องเชื่อม MQTT หรืออุปกรณ์เซนเซอร์จริง เหมาะสำหรับการตรวจ UI และการนำเสนอ offline บางส่วน

ตั้งค่าเริ่มต้นด้วย `USE_DEMO_MODE: true` ใน `config.js` ได้

## โหมดอุปกรณ์จริง

- MQTT sensor topic: `pollution/env/predicted`
- MQTT control topic: `pollution/robot/control`
- MQTT GPS topic: `pollution/robot/gps`
- MQTT evacuation topic: `pollution/robot/evacuate`
- กล้อง: Webcam/Mobile หรือ ESP32-CAM
- โมเดลบุคคล: โหลดจาก `YOLO_MODEL_URL`

ตรวจสอบว่า browser อนุญาตกล้องและอยู่ในเครือข่ายเดียวกับ MQTT broker ก่อนสาธิต

## Checklist ก่อนนำเสนอ

- ทดสอบ `Demo Mode` ล่วงหน้าและเตรียมข้อมูลเซนเซอร์จริงเป็นทางเลือก
- ตรวจ broker IP, MQTT WebSocket port และ topic ให้ตรงกับอุปกรณ์
- ตรวจ Supabase RLS และ Storage policy
- ทดสอบกล้องและโหลด YOLO model บนเครื่องที่จะใช้จริง
- เตรียมผลการประเมินโมเดล เช่น dataset, accuracy และ confusion matrix
- ห้ามใส่ API key หรือ credential ลงใน `index.html`

## ขอบเขตระบบ

โปรเจกต์นี้เป็น prototype สำหรับการสาธิตและทดสอบ workflow ยังไม่ควรใช้เป็นระบบแจ้งเตือนฉุกเฉินเพียงช่องทางเดียวโดยไม่มีการยืนยันจากเจ้าหน้าที่
