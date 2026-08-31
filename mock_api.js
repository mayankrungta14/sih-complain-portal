// mock_api.js - Completely replaces the Python Backend for GitHub Pages

const GEMINI_API_KEY = "AQ.Ab8RN6LpMAzHrrJyoX19UZxhNnGQbNeEXosqsp3xsVKR2xjSrg"; // PASTE YOUR API KEY HERE

// Initialize Fake Database in LocalStorage
if (!localStorage.getItem('sih_complaints')) {
    localStorage.setItem('sih_complaints', JSON.stringify([]));
}

// Intercept all fetch calls to the backend
const originalFetch = window.fetch;
window.fetch = async function(url, options = {}) {
    if (typeof url === 'string' && url.startsWith('/api/')) {
        return handleMockApi(url, options);
    }
    return originalFetch.apply(this, arguments);
};

// Mock Backend Logic
async function handleMockApi(url, options) {
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    
    const jsonResponse = (data) => new Response(JSON.stringify(data), { status: 200, headers: {'Content-Type': 'application/json'} });

    try {
        if (url.includes('/api/auth/unified_login')) {
            const { identifier } = body;
            if (identifier.includes('@gov.in')) {
                return jsonResponse({
                    status: "success", type: "officer", next_step: "department_code",
                    message: "Official email recognized. Please select your department code."
                });
            } else {
                return jsonResponse({
                    status: "success", type: "citizen", next_step: "otp",
                    message: "Citizen identifier recognized. Generating mock OTP..."
                });
            }
        }

        if (url.includes('/api/auth/officer_verify')) {
            return jsonResponse({
                status: "success", type: "officer",
                user: { email: body.email, department_code: body.department_code, name: "Mock Officer" }
            });
        }

        if (url.includes('/api/languages')) {
            return jsonResponse([
                { code: "hi", name: "Hindi" },
                { code: "ta", name: "Tamil" },
                { code: "te", name: "Telugu" },
                { code: "bn", name: "Bengali" },
                { code: "mr", name: "Marathi" },
                { code: "gu", name: "Gujarati" }
            ]);
        }

        if (url.includes('/api/translate_ui')) {
            // For hackathon speed, we use AI to translate dynamically
            const prompt = `Translate this JSON array to ${body.target_language}: ${JSON.stringify(body.texts)}. Return ONLY a JSON array of strings in the exact same order.`;
            try {
                const aiRes = await originalFetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ contents: [{parts: [{text: prompt}]}], generationConfig: {responseMimeType: "application/json"} })
                });
                const data = await aiRes.json();
                let text = data.candidates[0].content.parts[0].text;
                text = text.replace(/```json/g, '').replace(/```/g, '');
                return jsonResponse({ translations: JSON.parse(text) });
            } catch (e) {
                // If API fails, just return English
                return jsonResponse({ translations: body.texts });
            }
        }

        if (url.includes('/api/auth/citizen_profile')) {
            return jsonResponse({
                status: "success", type: "citizen",
                user: { phone: body.identifier, name: "Citizen User", home_address: "123 Local Street" }
            });
        }

        if (url.includes('/api/complaint/analyze')) {
            const prompt = `
            Analyze this citizen complaint: "${body.text}" in language: "${body.language}".
            Perform a 3-Step Urgency & Routing Evaluation:
            Step 1: NLP Hazard Scan. Step 2: Contextual Impact Assessment. Step 3: Assign Urgency Tier: 1 (Critical Emergency), 2 (High), or 3 (Normal).
            Assign to ALL relevant department codes (WTR, ELE, RDS, SNT, POL, OTH).
            Return ONLY JSON format exactly like this:
            {"detected_language": "${body.language}", "departments": [{"code": "WTR", "name": "Water Supply"}], "urgency_tier": 3, "urgency_label": "NORMAL", "urgency_reason": "None", "clarifying_question": "Any landmarks?", "summary_regional": "Short regional summary", "summary_english": "Short english summary", "sla_hours": 72}
            `;
            const aiRes = await callGemini(prompt);
            return jsonResponse(aiRes);
        }

        if (url.includes('/api/complaint/create')) {
            const complaints = JSON.parse(localStorage.getItem('sih_complaints'));
            const baseGid = Math.random().toString(36).substring(2, 8).toUpperCase();
            const primaryDept = body.departments[0];
            const primaryGid = `${primaryDept.code}-${baseGid}`;
            
            // Simple duplicate logic without Gemini for speed in browser
            let parentId = null;
            const recent = complaints.filter(c => c.department_code === primaryDept.code && c.parent_id === null && c.status !== 'Resolved');
            for (let existing of recent) {
                if (existing.latitude && body.latitude) {
                    if (Math.abs(existing.latitude - body.latitude) < 0.005) {
                        parentId = existing.grievance_id;
                        break;
                    }
                }
            }

            const createdGids = [];
            body.departments.forEach((dept, idx) => {
                const gid = idx === 0 ? primaryGid : `${dept.code}-${baseGid}`;
                const parent = idx === 0 ? parentId : null;
                complaints.push({
                    grievance_id: gid,
                    citizen_phone: body.citizen_phone,
                    citizen_name: body.citizen_name,
                    citizen_home_address: body.citizen_home_address,
                    complaint_text: body.complaint_text,
                    department_code: dept.code,
                    department_name: dept.name,
                    incident_location: body.incident_location,
                    latitude: body.latitude,
                    longitude: body.longitude,
                    urgency_tier: body.urgency_tier,
                    status: "Submitted",
                    created_at: new Date().toISOString(),
                    parent_id: parent
                });
                createdGids.push(gid);
            });

            localStorage.setItem('sih_complaints', JSON.stringify(complaints));

            return jsonResponse({
                status: "success",
                grievance_id: primaryGid,
                all_grievance_ids: createdGids,
                sla_deadline: "48 Hours",
                regional_sms: `Your grievance ${primaryGid} is registered successfully.`,
                receipt_data: { grievance_id: primaryGid, department: primaryDept.name, summary_regional: body.summary_regional, date: new Date().toLocaleString() }
            });
        }

        if (url.includes('/api/officer/complaints')) {
            const urlObj = new URL('http://localhost' + url);
            const dept = urlObj.searchParams.get('department_code');
            const complaints = JSON.parse(localStorage.getItem('sih_complaints'));
            
            let parents = complaints.filter(c => c.parent_id === null);
            if (dept !== 'ALL') parents = parents.filter(c => c.department_code === dept);
            
            parents = parents.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            
            const res = parents.map(p => {
                const children = complaints.filter(c => c.parent_id === p.grievance_id);
                return { ...p, duplicate_count: children.length, children: children };
            });
            return jsonResponse(res);
        }

        if (url.includes('/api/officer/update_status')) {
            const complaints = JSON.parse(localStorage.getItem('sih_complaints'));
            complaints.forEach(c => {
                if (c.grievance_id === body.grievance_id || c.parent_id === body.grievance_id) {
                    c.status = body.status;
                }
            });
            localStorage.setItem('sih_complaints', JSON.stringify(complaints));
            return jsonResponse({ status: "success", message: "Status updated locally." });
        }

    } catch (e) {
        console.error("Mock API Error:", e);
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
}

// Helper to call Gemini directly from browser
async function callGemini(prompt) {
    try {
        const res = await originalFetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                contents: [{parts: [{text: prompt}]}],
                generationConfig: {responseMimeType: "application/json"}
            })
        });
        const data = await res.json();
        let text = data.candidates[0].content.parts[0].text;
        text = text.replace(/```json/g, '').replace(/```/g, '');
        return JSON.parse(text);
    } catch (e) {
        // Fallback if AI fails or Key is wrong
        return {
            departments: [{code: "OTH", name: "General"}],
            urgency_tier: 3, urgency_label: "NORMAL",
            clarifying_question: "Where exactly did this happen?",
            summary_regional: "Mock offline summary.",
            summary_english: "Mock offline summary.",
            sla_hours: 72, is_fallback: true
        };
    }
}
