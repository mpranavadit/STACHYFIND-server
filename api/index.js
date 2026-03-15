import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { type } = req.query;

    // Upload sensor data
    if (type === "upload" && (req.method === "POST" || req.method === "GET")) {
        let raw;
        
        try {
            raw = req.method === "GET"
                ? req.query
                : (typeof req.body === "string" ? JSON.parse(req.body) : req.body);
        } catch (e) {
            return res.status(400).json({ error: "Invalid JSON in request body" });
        }

        const body = {
            ...raw,
            temperature: parseFloat(raw.temperature),
            humidity: parseFloat(raw.humidity),
            pressure: parseFloat(raw.pressure),
            light: parseInt(raw.light)
        };
        
        const requiredFields = ['UID', 'date', 'time', 'temperature', 'humidity', 'pressure', 'light', 'mold_risk_category'];
        for (const field of requiredFields) {
            if (body[field] === undefined || body[field] === null || body[field] === '') {
                return res.status(400).json({ error: `Missing required field: ${field}` });
            }
            if (['temperature', 'humidity', 'pressure', 'light'].includes(field) && isNaN(body[field])) {
                return res.status(400).json({ error: `Invalid numeric value for ${field}` });
            }
        }

        let category = String(body.mold_risk_category).toLowerCase().trim();
        if (category === "moderate") {
            category = "medium";
        }
        
        const validCategories = ['low', 'medium', 'high', 'critical'];
        if (!validCategories.includes(category)) {
            return res.status(400).json({ error: "mold_risk_category must be: low, medium, high, or critical" });
        }

        let convertedDate = body.date;
        const dateStr = String(body.date);
        let firstSep = dateStr.indexOf('/');
        if (firstSep === -1) firstSep = dateStr.indexOf('-');
        let secondSep = dateStr.indexOf('/', firstSep + 1);
        if (secondSep === -1) secondSep = dateStr.indexOf('-', firstSep + 1);
        if (firstSep > 0 && secondSep > firstSep) {
            const day = dateStr.substring(0, firstSep);
            const month = dateStr.substring(firstSep + 1, secondSep);
            const year = dateStr.substring(secondSep + 1);
            if (parseInt(day) <= 31 && year.length === 4) {
                convertedDate = `${year}-${month}-${day}`;
            }
        }

        const insertData = {
            UID: body.UID,
            date: convertedDate,
            time: body.time,
            temperature: body.temperature,
            humidity: body.humidity,
            pressure: body.pressure,
            light: body.light,
            mold_risk_category: category
        };

        const { error } = await supabase
            .from('sensor_data')
            .insert([insertData]);

        if (error) {
            return res.status(500).json({ error: error.message });
        }
        return res.status(201).json({ success: true });
    }

    return res.status(400).json({ error: "Invalid type. Use: upload" });
}