import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { type, uid, limit } = req.query;

    // ============================================
    // 1. UPLOAD SENSOR DATA
    // ============================================
    if (type === "upload_sensor" && (req.method === "POST" || req.method === "GET")) {
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

        try {
            const { error } = await supabase
                .from('sensor_data')
                .insert([insertData]);

            if (error) {
                return res.status(500).json({ error: error.message });
            }
            return res.status(201).json({ success: true });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }

    // ============================================
    // 2. GET LATEST SENSOR READING
    // ============================================
    if (type === "latest") {
        if (!uid) {
            return res.status(400).json({ error: "Missing uid parameter" });
        }

        try {
            const { data, error } = await supabase
                .from('sensor_data')
                .select('*')
                .eq('UID', uid)
                .order('date', { ascending: false })
                .order('time', { ascending: false })
                .limit(1)
                .single();

            if (error && error.code !== 'PGRST116') {
                return res.status(500).json({ error: error.message });
            }
            return res.status(200).json(data || {});
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }

    // ============================================
    // 3. GET SENSOR HISTORY
    // ============================================
    if (type === "history") {
        if (!uid) {
            return res.status(400).json({ error: "Missing uid parameter" });
        }

        const recordLimit = parseInt(limit) || 100;
        
        try {
            const { data, error } = await supabase
                .from('sensor_data')
                .select('*')
                .eq('UID', uid)
                .order('date', { ascending: false })
                .order('time', { ascending: false })
                .limit(recordLimit);

            if (error) {
                return res.status(500).json({ error: error.message });
            }
            return res.status(200).json(data || []);
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }

    // ============================================
    // 4. GET MOLD RISK STATISTICS
    // ============================================
    if (type === "stats") {
        if (!uid) {
            return res.status(400).json({ error: "Missing uid parameter" });
        }

        try {
            const { data, error } = await supabase
                .from('sensor_data')
                .select('mold_risk_category')
                .eq('UID', uid);

            if (error) {
                return res.status(500).json({ error: error.message });
            }

            const stats = {
                total: data?.length || 0,
                low: 0,
                medium: 0,
                high: 0,
                critical: 0
            };

            data?.forEach(record => {
                const category = record.mold_risk_category?.toLowerCase();
                if (category === 'low') stats.low++;
                else if (category === 'medium') stats.medium++;
                else if (category === 'high') stats.high++;
                else if (category === 'critical') stats.critical++;
            });

            return res.status(200).json(stats);
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }

    // ============================================
    // 5. GET AVERAGE READINGS
    // ============================================
    if (type === "averages") {
        if (!uid) {
            return res.status(400).json({ error: "Missing uid parameter" });
        }

        try {
            const { data, error } = await supabase
                .from('sensor_data')
                .select('temperature, humidity, pressure, light')
                .eq('UID', uid);

            if (error) {
                return res.status(500).json({ error: error.message });
            }

            if (!data || data.length === 0) {
                return res.status(200).json({ temperature: 0, humidity: 0, pressure: 0, light: 0, count: 0 });
            }

            const averages = {
                temperature: data.reduce((sum, r) => sum + (r.temperature || 0), 0) / data.length,
                humidity: data.reduce((sum, r) => sum + (r.humidity || 0), 0) / data.length,
                pressure: data.reduce((sum, r) => sum + (r.pressure || 0), 0) / data.length,
                light: data.reduce((sum, r) => sum + (r.light || 0), 0) / data.length,
                count: data.length
            };

            return res.status(200).json(averages);
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }

    return res.status(400).json({ error: "Invalid type. Use: upload_sensor, latest, history, stats, or averages" });
}