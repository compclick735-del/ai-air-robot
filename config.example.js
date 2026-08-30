/**
 * 🔐 CONFIG TEMPLATE
 * Copy this file to config.js and fill in your actual values:
 *   cp config.example.js config.js
 *
 * ⚠️ DO NOT commit config.js to Git!
 */
const CONFIG = {
    // ============================
    // 🌤️ OpenWeatherMap Air Pollution API
    // Get yours at: https://openweathermap.org/api
    // ============================
    WEATHER_API_KEY: "YOUR_OPENWEATHERMAP_API_KEY_HERE",

    // ============================
    // 🗄️ Supabase Database
    // Get yours at: https://supabase.com
    // ============================
    SUPABASE_URL: "https://YOUR_PROJECT_ID.supabase.co",
    SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0emNhbWdxZXVneWpzYnFmbHJuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Njg5MDkyNywiZXhwIjoyMTAyNDY2OTI3fQ.jMY5h015rEM0js0MYMLcC3eP_7CJPzRL68ApInt0qx8",

    // ============================
    // 📡 MQTT Broker Configuration
    // ============================
    MQTT: {
        broker: "YOUR_MQTT_BROKER_IP",
        port: 9001,
        path: "",
        topics: {
            subData: "pollution/env/predicted",
            pubControl: "pollution/robot/control",
            pubGPS: "pollution/robot/gps",
            pubEvac: "pollution/robot/evacuate"
        }
    },

    // ============================
    // 🤖 YOLO AI Model
    // ============================
    YOLO_MODEL_URL: "https://cdn.jsdelivr.net/gh/compclick735-del/yolo-web-model@main/model/model.json",

    // ============================
    // 🚨 Emergency Settings
    // ============================
    EMERGENCY_CONTACT_NUMBER: "1669",

    // ============================
    // 📍 Default GPS Location
    // ============================
    DEFAULT_LAT: 16.7164,
    DEFAULT_LON: 102.1158
};
