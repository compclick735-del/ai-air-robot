export default async function handler(req, res) {
  // ดึง API Key จาก Environment Variable บน Vercel
  const API_KEY = process.env.WEATHER_API_KEY; 
  const { lat, lon } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ error: 'Missing lat or lon parameters' });
  }

  try {
    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${API_KEY}`
    );
    const data = await response.json();

    // ปลดล็อก CORS ให้หน้าบ้านเรียกใช้ได้
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch environmental data' });
  }
}