/**
 * 🔐 CONFIG TEMPLATE
 * Copy this file to config.js and fill in your actual values:
 *   cp config.example.js config.js
 *
 * ⚠️ DO NOT commit config.js to Git!
 */
window.CONFIG = {
    // ============================
    // 🌤️ OpenWeatherMap Air Pollution API
    // Get yours at: https://openweathermap.org/api
    // ============================
    WEATHER_API_KEY: "69c5ee3c1296056b0e9bde92ccc215fc",

    // ============================
    // 🗄️ Supabase Database
    // Get yours at: https://supabase.com
    // ============================
    SUPABASE_URL: "https://YOUR_PROJECT_ID.supabase.co",
    SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0emNhbWdxZXVneWpzYnFmbHJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4OTA5MjcsImV4cCI6MjEwMjQ2NjkyN30.QikhPrSY-qZWbuLzljiAlPYJVygMHoJ33geRaZcTuAM",

    // ============================
    // 📡 MQTT Broker Configuration
    // ============================
    MQTT: {
        broker: "YOUR_MQTT_BROKER_IP",
        port: 9001,
        path: "",
        topics: {
            sensor: "pollution/env/predicted",
            control: "pollution/robot/control",
            gps: "pollution/robot/gps",
            evacuation: "pollution/robot/evacuate"
        }
    },

    // ============================
    // 🤖 YOLO AI Model
    // ============================
    YOLO_MODEL_URL: "https://cdn.jsdelivr.net/gh/compclick735-del/yolo-web-model@main/model/model.json",

    ICON_STORAGE_BUCKET: "icon-images",
    USE_DEMO_MODE: false,

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
