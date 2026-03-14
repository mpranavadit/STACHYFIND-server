import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { type, uid, limit } = req.query;

    // Upload sensor data from ESP32
    if (type === "upload_sensor" && (req.method === "POST" || req.method === "GET")) {
        const raw = req.method === "GET"
            ? req.query
            : (typeof req.body === "string" ? JSON.parse(req.body) : req.body);

        // For GET requests, parse numeric fields from query string
        const body = req.method === "GET" ? {
            ...raw,
            temperature: parseFloat(raw.temperature),
            humidity:    parseFloat(raw.humidity),
            pressure:    parseFloat(raw.pressure),
            light:       parseInt(raw.light)
        } : raw;
        
        // Validate required fields
        const requiredFields = ['UID', 'date', 'time', 'temperature', 'humidity', 'pressure', 'light', 'mold_risk_category'];
        for (const field of requiredFields) {
            if (body[field] === undefined) {
                return res.status(400).json({ error: `Missing required field: ${field}` });
            }
        }

        // Convert date from dd/mm/yyyy or dd-mm-yyyy to yyyy-mm-dd (matching ESP32 logic)
        let convertedDate = body.date;
        const dateStr = body.date;
        let firstSep = dateStr.indexOf('/');
        if (firstSep === -1) firstSep = dateStr.indexOf('-');
        
        let secondSep = dateStr.indexOf('/', firstSep + 1);
        if (secondSep === -1) secondSep = dateStr.indexOf('-', firstSep + 1);
        
        if (firstSep > 0 && secondSep > firstSep) {
            const day = dateStr.substring(0, firstSep);
            const month = dateStr.substring(firstSep + 1, secondSep);
            const year = dateStr.substring(secondSep + 1);
            // Only convert if it looks like dd/mm/yyyy format (day <= 31)
            if (parseInt(day) <= 31 && year.length === 4) {
                convertedDate = `${year}-${month}-${day}`;
            }
        }

        // Validate and normalize mold_risk_category (matching ESP32 logic)
        let category = body.mold_risk_category.toLowerCase().trim();
        
        // Replace "moderate" with "medium" if needed
        if (category === "moderate") {
            category = "medium";
        }
        
        const validCategories = ['low', 'medium', 'high', 'critical'];
        if (!validCategories.includes(category)) {
            return res.status(400).json({ error: "mold_risk_category must be: low, moderate/medium, high, or critical" });
        }

        // Prepare data with converted values
        const insertData = {
            ...body,
            date: convertedDate,
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

    // Get latest sensor reading for a device
    if (type === "latest") {
        if (!uid) {
            return res.status(400).json({ error: "Missing uid parameter" });
        }

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
    }

    // Get sensor history for a device
    if (type === "history") {
        if (!uid) {
            return res.status(400).json({ error: "Missing uid parameter" });
        }

        const recordLimit = parseInt(limit) || 100;
        
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
    }

    // Get mold risk statistics
    if (type === "stats") {
        if (!uid) {
            return res.status(400).json({ error: "Missing uid parameter" });
        }

        const { data, error } = await supabase
            .from('sensor_data')
            .select('mold_risk_category')
            .eq('UID', uid);

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        // Calculate risk distribution
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
    }

    // Get average readings
    if (type === "averages") {
        if (!uid) {
            return res.status(400).json({ error: "Missing uid parameter" });
        }

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
    }

    return res.status(404).json({ error: "Invalid type. Use: upload_sensor, latest, history, stats, or averages" });
}