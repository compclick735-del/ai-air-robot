/*
    🎯 LOCATION-AWARE SMART AIR QUALITY AI ROBOT
    MATRIX MINI R4 — v2.2 (no preheat gate / read gas immediately)

    Board   : Arduino UNO R4 WiFi (Matrix Mini R4)
    Sensors : MQ-2 (A1) | SHT30 (I2C 0x44) | Sharp GP2Y1014AU (D7 + A2)
*/

#include <WiFiS3.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include "MatrixMiniR4.h"

// ═══════════════════════════════════════════════════════
//  WIFI / MQTT CREDENTIALS
// ═══════════════════════════════════════════════════════
const char* WIFI_SSID = "Noppakhuez";
const char* WIFI_PASS = "npk192315";

const char*    MQTT_HOST = "10.243.178.6";
const uint16_t MQTT_PORT = 1883;
const char*    MQTT_USER = "";
const char*    MQTT_PASS = "";

// ═══════════════════════════════════════════════════════
//  MQTT TOPICS
// ═══════════════════════════════════════════════════════
static const char* TOPIC_TELEMETRY = "pollution/env/predicted";
static const char* TOPIC_CONTROL   = "pollution/robot/control";
static const char* TOPIC_CONFIG    = "pollution/robot/config";
static const char* TOPIC_STATUS    = "pollution/robot/status";

WiFiClient   r4Client;
PubSubClient mqttClient(r4Client);
String       clientId;

// ═══════════════════════════════════════════════════════
//  ADC / PIN CONFIG
// ═══════════════════════════════════════════════════════
static const int MQ2_PIN      = A1;
static const int DUST_LED_PIN = 7;    // ILED (Active LOW) — R 150Ω + C 220µF
static const int DUST_VO_PIN  = A2;

static const uint8_t SHT30_ADDR = 0x44;

static const float ADC_BITS = 14.0f;
static const float ADC_MAX  = 16383.0f;
static const float ADC_VREF = 5.0f;

// ═══════════════════════════════════════════════════════
//  🌫️ GP2Y1014AU — CALIBRATION
// ═══════════════════════════════════════════════════════
static const unsigned int DUST_SAMPLING_TIME_US = 280;
static const unsigned int DUST_DELTA_TIME_US    = 40;
static const int          DUST_SAMPLE_COUNT     = 5;
static const unsigned long DUST_CYCLE_MS        = 10;

float DUST_VOC = 0.60f;
static const float DUST_SENSITIVITY = 0.17f;

// ═══════════════════════════════════════════════════════
//  💨 MQ-2 — CALIBRATION  (ไม่มี preheat gate แล้ว)
// ═══════════════════════════════════════════════════════
static const float MQ2_RL_KOHM         = 10.0f;
static const float MQ2_CLEAN_AIR_RATIO = 9.83f;
static const float MQ2_CURVE_A         = 574.25f;
static const float MQ2_CURVE_B         = -2.222f;

float MQ2_R0 = 10.0f;
static const unsigned long MQ2_STABLE_MS = 3UL * 60UL * 1000UL;  // ใช้แค่ติดป้ายสถานะ

// ═══════════════════════════════════════════════════════
//  🏎️ MOTOR — SLEW RATE + FAILSAFE
// ═══════════════════════════════════════════════════════
int targetM1 = 0, targetM2 = 0;
int currentM1 = 0, currentM2 = 0;
unsigned long lastMotorUpdate = 0;

static const int MOTOR_RAMP_INTERVAL = 15;
static const int RAMP_STEP_ACCEL     = 5;
static const int RAMP_STEP_DECEL     = 25;
static const int MOTOR_MAX           = 100;

// ═══════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════
unsigned long timer_telemetry      = 0;
unsigned long lastReconnectAttempt = 0;
unsigned long lastWifiAttempt      = 0;
static const unsigned long WIFI_RETRY_MS = 10000;
static const unsigned long MQTT_RETRY_MS = 3000;

float lastTemp = NAN, lastHum = NAN;
bool  shtValid = false;
float lastPM25 = NAN, lastDustVoltage = NAN;
bool  pm25Valid = false;


// ═══════════════════════════════════════════════════════
//  🏎️ MOTOR CONTROL
// ═══════════════════════════════════════════════════════
void setMotorTarget(int m1, int m2) {
  targetM1 = constrain(m1, -MOTOR_MAX, MOTOR_MAX);
  targetM2 = constrain(m2, -MOTOR_MAX, MOTOR_MAX);
}

void moveForward(int s)  { setMotorTarget( s, -s); }
void moveBackward(int s) { setMotorTarget(-s,  s); }
void turnLeft(int s)     { setMotorTarget(-s, -s); }
void turnRight(int s)    { setMotorTarget( s,  s); }
void robotStop()         { setMotorTarget( 0,  0); }

void moveForwardLeft(int f, int sl)   { setMotorTarget( sl, -f ); }
void moveForwardRight(int f, int sl)  { setMotorTarget( f,  -sl); }
void moveBackwardLeft(int f, int sl)  { setMotorTarget(-sl,  f ); }
void moveBackwardRight(int f, int sl) { setMotorTarget(-f,   sl); }

void robotEmergencyStop() {
  targetM1 = targetM2 = 0;
  currentM1 = currentM2 = 0;
  MiniR4.M1.setSpeed(0);
  MiniR4.M2.setSpeed(0);
}

int rampToward(int cur, int tgt) {
  bool decel = (abs(tgt) < abs(cur)) || ((long)tgt * (long)cur < 0);
  int step = decel ? RAMP_STEP_DECEL : RAMP_STEP_ACCEL;
  if (cur < tgt) return min(cur + step, tgt);
  if (cur > tgt) return max(cur - step, tgt);
  return cur;
}

void updateMotorSmooth() {
  if (millis() - lastMotorUpdate < (unsigned long)MOTOR_RAMP_INTERVAL) return;
  lastMotorUpdate = millis();

  int newM1 = rampToward(currentM1, targetM1);
  int newM2 = rampToward(currentM2, targetM2);

  if (newM1 != currentM1 || newM2 != currentM2) {
    currentM1 = newM1;
    currentM2 = newM2;
    MiniR4.M1.setSpeed(currentM1);
    MiniR4.M2.setSpeed(currentM2);
  }
}

bool robotIsMoving() { return (currentM1 != 0 || currentM2 != 0); }

void setLEDs(uint8_t r1,uint8_t g1,uint8_t b1, uint8_t r2,uint8_t g2,uint8_t b2) {
  MiniR4.LED.setColor(1, r1, g1, b1);
  MiniR4.LED.setColor(2, r2, g2, b2);
}


// ═══════════════════════════════════════════════════════
//  🌡️ SHT30 — BLOCKING READ + CRC CHECK  (~20ms)
// ═══════════════════════════════════════════════════════
uint8_t sht30CRC(const uint8_t* data, int len) {
  uint8_t crc = 0xFF;
  for (int i = 0; i < len; i++) {
    crc ^= data[i];
    for (uint8_t b = 0; b < 8; b++)
      crc = (crc & 0x80) ? (uint8_t)((crc << 1) ^ 0x31) : (uint8_t)(crc << 1);
  }
  return crc;
}

void sht30Read() {
  Wire.beginTransmission(SHT30_ADDR);
  Wire.write(0x24);
  Wire.write(0x00);
  if (Wire.endTransmission() != 0) { shtValid = false; return; }

  delay(20);

  if (Wire.requestFrom((int)SHT30_ADDR, 6) != 6) { shtValid = false; return; }

  uint8_t d[6];
  for (int i = 0; i < 6; i++) d[i] = Wire.read();

  if (sht30CRC(&d[0], 2) != d[2] || sht30CRC(&d[3], 2) != d[5]) {
    shtValid = false;
    Serial.println("⚠️ SHT30 CRC mismatch — ทิ้งค่านี้");
    return;
  }

  uint16_t rawT = ((uint16_t)d[0] << 8) | d[1];
  uint16_t rawH = ((uint16_t)d[3] << 8) | d[4];

  float t = -45.0f + 175.0f * (float)rawT / 65535.0f;
  float h = 100.0f * (float)rawH / 65535.0f;

  if (t < -40.0f || t > 125.0f || h < 0.0f || h > 100.0f) { shtValid = false; return; }

  lastTemp = t;
  lastHum  = h;
  shtValid = true;
}


// ═══════════════════════════════════════════════════════
//  💨 MQ-2  (อ่านทันที ไม่รอ preheat)
// ═══════════════════════════════════════════════════════
float mq2ReadRs() {
  int raw = analogRead(MQ2_PIN);
  float vrl = raw * (ADC_VREF / ADC_MAX);
  if (vrl < 0.01f) return NAN;
  return ((ADC_VREF - vrl) / vrl) * MQ2_RL_KOHM;
}

bool mq2Stable() { return millis() >= MQ2_STABLE_MS; }   // ป้ายสถานะเท่านั้น

void mq2Calibrate() {
  Serial.println("🔧 กำลังคาลิเบรต MQ-2 (ต้องอยู่ในอากาศสะอาด)...");
  float sum = 0; int n = 0;
  for (int i = 0; i < 60; i++) {
    float rs = mq2ReadRs();
    if (!isnan(rs)) { sum += rs; n++; }
    delay(30);
  }
  if (n > 0) {
    MQ2_R0 = (sum / n) / MQ2_CLEAN_AIR_RATIO;
    Serial.print("✅ MQ-2 R0 = "); Serial.print(MQ2_R0, 3); Serial.println(" kOhm");
  } else {
    Serial.println("🔴 คาลิเบรตล้มเหลว — ตรวจสายเซนเซอร์");
  }
}


// ═══════════════════════════════════════════════════════
//  🌫️ GP2Y1014AU — BLOCKING READ (~50ms)
// ═══════════════════════════════════════════════════════
float dustSampleVoltage() {
  digitalWrite(DUST_LED_PIN, LOW);
  delayMicroseconds(DUST_SAMPLING_TIME_US);
  int raw = analogRead(DUST_VO_PIN);
  delayMicroseconds(DUST_DELTA_TIME_US);
  digitalWrite(DUST_LED_PIN, HIGH);
  return raw * (ADC_VREF / ADC_MAX);
}

void dustRead() {
  float sum = 0;
  for (int i = 0; i < DUST_SAMPLE_COUNT; i++) {
    sum += dustSampleVoltage();
    delay(DUST_CYCLE_MS);
  }
  float v = sum / DUST_SAMPLE_COUNT;
  lastDustVoltage = v;

  float mg = DUST_SENSITIVITY * (v - DUST_VOC);
  if (mg < 0) mg = 0;
  lastPM25 = mg * 1000.0f;
  if (lastPM25 > 999.0f) lastPM25 = 999.0f;
  pm25Valid = true;
}

void dustCalibrate() {
  Serial.println("🔧 กำลังคาลิเบรต GP2Y10 (ต้องอยู่ในอากาศสะอาด)...");
  float sum = 0; const int N = 60;
  for (int i = 0; i < N; i++) { sum += dustSampleVoltage(); delay(10); }
  DUST_VOC = sum / N;
  Serial.print("✅ Dust Voc = "); Serial.print(DUST_VOC, 3); Serial.println(" V");
}


// ═══════════════════════════════════════════════════════
//  📩 MQTT CALLBACKS
// ═══════════════════════════════════════════════════════
void handleControl(byte* payload, unsigned int len) {
  if (len == 0) return;
  char c = (char)payload[0];

  switch (c) {
    case 'F': moveForward(100);          setLEDs(0,255,0,   0,255,0);   break;
    case 'B': moveBackward(100);         setLEDs(255,165,0, 255,165,0); break;
    case 'L': turnLeft(100);             setLEDs(0,0,255,   0,0,0);     break;
    case 'R': turnRight(100);            setLEDs(0,0,0,     0,0,255);   break;
    case 'G': moveForwardLeft(100,40);   setLEDs(0,255,255, 0,255,0);   break;
    case 'I': moveForwardRight(100,40);  setLEDs(0,255,0,   0,255,255); break;
    case 'H': moveBackwardLeft(100,40);  setLEDs(255,0,255, 255,165,0); break;
    case 'J': moveBackwardRight(100,40); setLEDs(255,0,255, 255,0,255); break;
    case 'S': robotStop();               setLEDs(0,0,0,     0,0,0);     break;
    default : return;
  }
}

void handleConfig(byte* payload, unsigned int len) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, len)) return;

  const char* cmd = doc["cmd"] | "";
  if (strcmp(cmd, "cal_dust") == 0) dustCalibrate();
  else if (strcmp(cmd, "cal_gas") == 0) mq2Calibrate();   // คาลิเบรตได้ทันที

  if (!doc["voc"].isNull()) DUST_VOC = doc["voc"].as<float>();
  if (!doc["r0"].isNull())  MQ2_R0   = doc["r0"].as<float>();
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  if (strcmp(topic, TOPIC_CONTROL) == 0)     handleControl(payload, length);
  else if (strcmp(topic, TOPIC_CONFIG) == 0) handleConfig(payload, length);
}


// ═══════════════════════════════════════════════════════
//  📶 NETWORK
// ═══════════════════════════════════════════════════════
void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED && WiFi.localIP() != IPAddress(0,0,0,0)) return;
  if (millis() - lastWifiAttempt < WIFI_RETRY_MS && lastWifiAttempt != 0) return;
  lastWifiAttempt = millis();

  setLEDs(255,0,0, 255,0,0);

  Serial.print("📶 Connecting WiFi: "); Serial.println(WIFI_SSID);
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  if (WiFi.status() == WL_CONNECTED && WiFi.localIP() != IPAddress(0,0,0,0)) {
    Serial.print("🟢 WiFi OK — IP: "); Serial.println(WiFi.localIP());
    Serial.print("   RSSI: "); Serial.print(WiFi.RSSI()); Serial.println(" dBm");
    setLEDs(0,0,0, 0,0,0);
  } else {
    Serial.println("🔴 WiFi failed — ลองใหม่ใน 10 วินาที (มอเตอร์ถูกล็อก)");
  }
}

bool reconnectMQTT() {
  if (WiFi.status() != WL_CONNECTED) return false;

  Serial.print("📡 Connecting MQTT "); Serial.print(MQTT_HOST); Serial.println("...");

  const char* user = (strlen(MQTT_USER) > 0) ? MQTT_USER : nullptr;
  const char* pass = (strlen(MQTT_PASS) > 0) ? MQTT_PASS : nullptr;

  bool ok = mqttClient.connect(clientId.c_str(), user, pass,
                               TOPIC_STATUS, 1, true, "{\"status\":\"offline\"}");

  if (ok) {
    Serial.println("🟢 MQTT Connected!");
    mqttClient.publish(TOPIC_STATUS, "{\"status\":\"online\"}", true);
    mqttClient.subscribe(TOPIC_CONTROL, 0);
    mqttClient.subscribe(TOPIC_CONFIG, 1);
    return true;
  }

  Serial.print("🔴 MQTT failed (rc="); Serial.print(mqttClient.state()); Serial.println(")");
  return false;
}


// ═══════════════════════════════════════════════════════
//  📊 TELEMETRY  (บล็อก ~70ms ทุก 3 วินาที)
// ═══════════════════════════════════════════════════════
void publishTelemetry() {
  sht30Read();
  dustRead();

  JsonDocument doc;
  doc["device_id"] = clientId;
  doc["uptime_s"]  = millis() / 1000;
  doc["rssi"]      = WiFi.RSSI();

  doc["sht30_ok"] = shtValid;
  if (shtValid) {
    doc["Temperature"] = round(lastTemp * 10) / 10.0;
    doc["Humidity"]    = round(lastHum  * 10) / 10.0;
  } else {
    doc["Temperature"] = nullptr;
    doc["Humidity"]    = nullptr;
  }

  doc["pm25_ok"] = pm25Valid;
  if (pm25Valid) {
    float pm25Out = lastPM25;
    if (pm25Out <= 0 || pm25Out > 1000) pm25Out = 20;
    float pm10Out = pm25Out * 1.35f;

    doc["PM25"]         = round(pm25Out * 10) / 10.0;
    doc["PM10"]         = round(pm10Out * 10) / 10.0;
    doc["pm25_voltage"] = round(lastDustVoltage * 1000) / 1000.0;
    doc["pm25_voc"]     = DUST_VOC;
  } else {
    doc["PM25"] = nullptr;
    doc["PM10"] = nullptr;
  }

  float rs = mq2ReadRs();
  bool gasOk = !isnan(rs);                 // ไม่ผูกกับ preheat แล้ว
  doc["gas_ok"]       = gasOk;
  doc["gas_stable"]   = mq2Stable();       // false = ค่ายังไม่นิ่ง แต่ยังส่งค่าอยู่
  if (gasOk) {
    float ratio = rs / MQ2_R0;
    float ppm = constrain(MQ2_CURVE_A * pow(ratio, MQ2_CURVE_B), 0.0f, 10000.0f);
    doc["GasLPG_ppm"] = round(ppm * 100) / 100.0;
    doc["CO"]         = round(ppm * 100) / 100.0;
    doc["gas_rs_r0"]  = round(ratio * 1000) / 1000.0;
    doc["gas_rs"]     = round(rs * 100) / 100.0;
  } else {
    doc["GasLPG_ppm"] = nullptr;
    doc["CO"]         = nullptr;
  }

  char buf[512];
  size_t n = serializeJson(doc, buf);

  Serial.println("═════════════════════════════════════════");
  Serial.print("🌡️  Temp : "); shtValid ? Serial.println(String(lastTemp,1) + " *C") : Serial.println("N/A ❌");
  Serial.print("💦 Hum  : "); shtValid ? Serial.println(String(lastHum,1) + " %RH") : Serial.println("N/A ❌");
  Serial.print("🌫️  PM2.5: "); pm25Valid ? Serial.println(String(lastPM25,1) + " ug/m3") : Serial.println("N/A ❌");
  Serial.print("💨 Gas  : ");
  if (gasOk) {
    Serial.print(String(MQ2_CURVE_A * pow(rs / MQ2_R0, MQ2_CURVE_B), 2));
    Serial.println(mq2Stable() ? " ppm(CO)" : " ppm(CO) ⚠️ ยังไม่เสถียร");
  } else {
    Serial.println("N/A ❌");
  }
  Serial.println("═════════════════════════════════════════");

  if (mqttClient.connected()) {
    if (mqttClient.publish(TOPIC_TELEMETRY, (const uint8_t*)buf, n, false))
      Serial.println("📡 Published ✅\n");
    else
      Serial.println("⚠️ Publish failed (เพิ่ม MQTT_MAX_PACKET_SIZE?)\n");
  }
}


// ═══════════════════════════════════════════════════════
//  SETUP
// ═══════════════════════════════════════════════════════
void setup() {
  MiniR4.begin();
  MiniR4.PWR.setBattCell(2);
  robotEmergencyStop();

  Serial.begin(115200);
  delay(300);

  analogReadResolution((int)ADC_BITS);
  pinMode(MQ2_PIN, INPUT);
  pinMode(DUST_VO_PIN, INPUT);
  pinMode(DUST_LED_PIN, OUTPUT);
  digitalWrite(DUST_LED_PIN, HIGH);

  analogRead(DUST_VO_PIN);
  analogRead(MQ2_PIN);

  Wire.begin();
  Wire.setClock(100000);

  byte mac[6];
  WiFi.macAddress(mac);
  char idbuf[40];
  snprintf(idbuf, sizeof(idbuf), "ChumphaeAirBot_%02X%02X%02X", mac[3], mac[4], mac[5]);
  clientId = String(idbuf);
  Serial.print("🆔 Client ID: "); Serial.println(clientId);

  connectWiFi();

  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setKeepAlive(15);
  mqttClient.setBufferSize(512);
  reconnectMQTT();

  Serial.println("✅ System Ready — MQ-2 อ่านค่าทันที (ค่าช่วงแรกอาจยังไม่เสถียร)\n");
}


// ═══════════════════════════════════════════════════════
//  LOOP
// ═══════════════════════════════════════════════════════
void loop() {
  updateMotorSmooth();

  connectWiFi();
  if (WiFi.status() == WL_CONNECTED) {
    if (!mqttClient.connected()) {
      if (millis() - lastReconnectAttempt > MQTT_RETRY_MS) {
        lastReconnectAttempt = millis();
        reconnectMQTT();
      }
    } else {
      mqttClient.loop();
    }
  }

  updateMotorSmooth();

  if (millis() - timer_telemetry > 3000) {
    timer_telemetry = millis();
    publishTelemetry();
  }
}
