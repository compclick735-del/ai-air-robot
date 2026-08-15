export default async function handler(req, res) {
  // ตั้งค่า CORS Header รองรับทุก Origin
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // ตอบรับ Preflight OPTIONS Request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // ดึง API Key จาก Environment Variable บน Vercel Dashboard
  const API_KEY = process.env.WEATHER_API_KEY || "4642af1ae8c5becc27c24372d72c8601"; 
  const { lat, lon } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ error: 'Missing lat or lon parameters' });
  }

  try {
    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${API_KEY}`
    );

    if (!response.ok) {
      throw new Error(`OpenWeather API error: ${response.status}`);
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error('Serverless Weather Proxy Error:', error);
    return res.status(500).json({ error: 'Failed to fetch environmental data' });
  }
}