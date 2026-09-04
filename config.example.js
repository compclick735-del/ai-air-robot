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
    SUPABASE_ANON_KEY: "YOUR_SUPABASE_ANON_KEY_HERE",

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
