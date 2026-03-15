import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { type } = req.query;

    // Browser health check
    if (req.method === "GET") {
        return res.status(200).json({ status: "Smart Mold Risk Detector API is running." });
    }

    // Upload sensor data (POST only)
    if (type === "upload_sensor" && req.method === "POST") {
        let raw;

        try {
            raw = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
        } catch (e) {
            return res.status(400).json({ error: "Invalid JSON in request body" });
        }

        const body = {
            ...raw,
            temperature: parseFloat(raw.temperature),
            humidity:    parseFloat(raw.humidity),
            pressure:    parseFloat(raw.pressure),
            light:       parseInt(raw.light)
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
        if (category === "moderate") category = "medium";

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
            const day   = dateStr.substring(0, firstSep);
            const month = dateStr.substring(firstSep + 1, secondSep);
            const year  = dateStr.substring(secondSep + 1);
            if (parseInt(day) <= 31 && year.length === 4) {
                convertedDate = `${year}-${month}-${day}`;
            }
        }

        const { error: sensorError } = await supabase
            .from('sensor_data')
            .insert([{
                UID:               body.UID,
                date:              convertedDate,
                time:              body.time,
                temperature:       body.temperature,
                humidity:          body.humidity,
                pressure:          body.pressure,
                light:             body.light,
                mold_risk_category: category
            }]);

        if (sensorError) {
            return res.status(500).json({ error: sensorError.message });
        }

        // Generate alert for medium / high / critical risk levels.
        // alerts.severity constraint only allows: low | medium | high
        const severityMap = { medium: 'low', high: 'medium', critical: 'high' };
        const alertSeverity = severityMap[category];

        if (alertSeverity) {
            const isSensorFailure = body.sensor_failure === true || body.sensor_failure === 'true';
            const alertType = isSensorFailure ? 'sensor_failure' : 'mold_risk';
            const message   = isSensorFailure
                ? `Sensor failure detected. Mold risk forced to ${category}.`
                : `Mold risk is ${category}. Temp: ${body.temperature}°C, Humidity: ${body.humidity}%.`;

            const { error: alertError } = await supabase
                .from('alerts')
                .insert([{
                    user_id:    body.UID,
                    alert_type: alertType,
                    message:    message,
                    severity:   alertSeverity
                }]);

            if (alertError) {
                console.error('Alert insert failed:', alertError.message);
            }
        }

        return res.status(201).json({ success: true });
    }

    return res.status(400).json({ error: "Invalid type. Use: upload_sensor" });
}
