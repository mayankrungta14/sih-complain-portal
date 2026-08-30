// Jan-Awaaz V3 Frontend Engine
const API_BASE = 'http://localhost:8000/api';

// Global App State
let appState = {
    selectedLanguage: { code: 'hi', name: 'Hindi', native_name: 'हिन्दी' },
    allLanguages: [],
    currentUser: null,       // { type: 'citizen' | 'officer', phone, email, name, home_address, department_code }
    currentAnalysis: null,   // Holds parsed complaint data
    lastReceiptData: null,   // Data for bilingual PDF
    activeFeedbackGid: null,
    selectedFeedbackRating: 5,
    leafletMap: null,
    mapMarkers: []
};

// Speech Recognition & Synthesis instances
let recognition = null;
let isRecording = false;

// ----------------- Initialization -----------------
document.addEventListener('DOMContentLoaded', () => {
    initSpeechRecognition();
    loadLanguagesList();
});

function showLoading(show, text = "Processing with AI...") {
    const el = document.getElementById('global-loading');
    document.getElementById('loading-text').innerText = text;
    if (show) el.classList.remove('hidden');
    else el.classList.add('hidden');
}

function navigateTo(viewId) {
    document.querySelectorAll('.view-panel').forEach(el => el.classList.remove('active'));
    const target = document.getElementById(viewId);
    if (target) target.classList.add('active');

    // Update Header logout visibility
    const logoutBtn = document.getElementById('nav-logout-btn');
    if (appState.currentUser) {
        logoutBtn.classList.remove('hidden');
    } else {
        logoutBtn.classList.add('hidden');
    }
}

function handleLogout() {
    appState.currentUser = null;
    navigateTo('view-landing');
}

// ----------------- 1. Language Sidebar & Dynamic Dialect Discovery -----------------
async function loadLanguagesList() {
    try {
        const res = await fetch(`${API_BASE}/languages`);
        appState.allLanguages = await res.json();
        renderLanguagesSidebar(appState.allLanguages);
    } catch (e) {
        console.error("Failed to load languages:", e);
    }
}

function renderLanguagesSidebar(languages) {
    const container = document.getElementById('languages-sidebar-list');
    document.getElementById('lang-count-badge').innerText = languages.length;
    container.innerHTML = '';

    languages.forEach(lang => {
        const isSelected = appState.selectedLanguage.code === lang.code;
        const div = document.createElement('div');
        div.className = `p-2.5 rounded-xl border cursor-pointer transition flex items-center justify-between text-xs ${
            isSelected ? 'bg-blue-900 text-white border-blue-900 font-bold shadow-sm' : 'bg-slate-50 text-slate-800 border-slate-200 hover:bg-blue-50 hover:border-blue-300'
        }`;
        div.onclick = () => selectLanguage(lang);

        div.innerHTML = `
            <div class="flex items-center gap-2">
                <span class="text-sm font-semibold">${lang.native_name}</span>
                <span class="opacity-75 text-[10px]">(${lang.name})</span>
            </div>
            ${lang.is_custom ? '<span class="bg-amber-400 text-blue-950 text-[9px] font-bold px-1.5 py-0.5 rounded">Dialect Added</span>' : ''}
        `;
        container.appendChild(div);
    });
}

function filterLanguages(query) {
    const q = query.toLowerCase();
    const filtered = appState.allLanguages.filter(l => 
        l.name.toLowerCase().includes(q) || l.native_name.toLowerCase().includes(q)
    );
    renderLanguagesSidebar(filtered);
}

async function selectLanguage(lang) {
    appState.selectedLanguage = lang;
    document.getElementById('selected-lang-label').innerText = `${lang.native_name} (${lang.name})`;
    renderLanguagesSidebar(appState.allLanguages);

    // Speak welcome prompt in that language
    speakText(`Jan-Awaaz portal in ${lang.name}`, lang.code);

    // Translate UI
    const i18nElements = document.querySelectorAll('[data-i18n-key]');
    if (i18nElements.length > 0 && lang.code !== 'en') {
        const stringsToTranslate = {};
        i18nElements.forEach(el => {
            stringsToTranslate[el.getAttribute('data-i18n-key')] = el.innerText;
        });

        showLoading(true, `Translating UI to ${lang.native_name}...`);
        try {
            const res = await fetch(`${API_BASE}/translate_ui`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ target_language: lang.name, strings: stringsToTranslate })
            });
            const translatedData = await res.json();
            
            i18nElements.forEach(el => {
                const key = el.getAttribute('data-i18n-key');
                if (translatedData[key]) {
                    el.innerText = translatedData[key];
                }
            });
        } catch(e) {
            console.error("Translation failed", e);
        }
        showLoading(false);
    }
}

// ----------------- 2. Voice AI Language Detection on Landing Page -----------------
function initSpeechRecognition() {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRec();
        recognition.continuous = false;
        recognition.interimResults = true;
    } else {
        console.warn("Speech recognition not supported in browser.");
    }
}

function toggleVoiceLanguageDetection() {
    if (!recognition) return alert("Speech recognition is not supported in this browser. Please select from the language list.");

    const micBtn = document.getElementById('voice-detect-btn');
    const statusText = document.getElementById('voice-status-text');
    const transcriptBox = document.getElementById('voice-transcript-box');
    const transcriptText = document.getElementById('voice-transcript-text');
    const actionControls = document.getElementById('voice-action-controls');

    if (!isRecording) {
        recognition.lang = ''; // Let browser auto-listen
        recognition.start();
        isRecording = true;
        micBtn.classList.add('pulse-mic', 'bg-red-700');
        statusText.innerText = "Listening... Speak in your regional language or dialect now!";
        transcriptBox.classList.remove('hidden');
        actionControls.classList.remove('hidden');

        recognition.onresult = (event) => {
            let text = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                text += event.results[i][0].transcript;
            }
            transcriptText.innerText = text;
        };

        recognition.onend = async () => {
            isRecording = false;
            micBtn.classList.remove('pulse-mic', 'bg-red-700');
            const spokenText = transcriptText.innerText.trim();
            if (spokenText) {
                statusText.innerText = "AI is analyzing spoken dialect...";
                showLoading(true, "AI Detecting Regional Dialect...");
                try {
                    const res = await fetch(`${API_BASE}/detect_language_voice`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: spokenText })
                    });
                    const data = await res.json();
                    showLoading(false);

                    selectLanguage({ code: data.code, name: data.name, native_name: data.native_name });
                    if (data.is_new) {
                        loadLanguagesList(); // Refresh sidebar with newly added dialect!
                        alert(`New Dialect Identified & Added: ${data.native_name} (${data.name})`);
                    }
                    statusText.innerText = `Switched to ${data.native_name} (${data.name})!`;
                } catch (e) {
                    showLoading(false);
                    statusText.innerText = "Could not identify dialect. Please pick from list.";
                }
            } else {
                statusText.innerText = "No voice heard. Tap mic and speak again.";
            }
        };
    } else {
        recognition.stop();
    }
}

function cancelVoiceInput() {
    if (recognition && isRecording) recognition.stop();
    document.getElementById('voice-transcript-text').innerText = '';
    document.getElementById('voice-transcript-box').classList.add('hidden');
    document.getElementById('voice-action-controls').classList.add('hidden');
    document.getElementById('voice-status-text').innerText = "Voice input cleared. Click mic to speak again.";
}

// ----------------- 3. Unified Gateway (Citizen vs Officer) -----------------
async function handleUnifiedLogin() {
    const input = document.getElementById('unified-identifier-input').value.trim();
    if (!input) return alert("Please enter a Mobile Number or Official Email");

    showLoading(true, "Verifying credentials with Gateway...");
    try {
        const res = await fetch(`${API_BASE}/auth/unified_login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier: input })
        });
        const data = await res.json();
        showLoading(false);

        if (data.user_type === 'officer') {
            const deptBox = document.getElementById('officer-dept-box');
            if (deptBox.classList.contains('hidden')) {
                deptBox.classList.remove('hidden');
                document.getElementById('unified-login-btn').querySelector('span').innerText = "Verify Department & Get OTP";
                return; // Wait for them to select department and click again
            }
            
            // They clicked again after seeing the dept box
            const selectedDept = document.getElementById('officer-dept-select').value;
            appState.pendingLogin = { type: 'officer', email: data.email, department_code: selectedDept };
            document.getElementById('otp-phone-subtext').innerText = `Official Officer Email: ${data.email} (${selectedDept}). OTP sent to linked phone.`;
            navigateTo('view-otp');
        } else {
            document.getElementById('officer-dept-box').classList.add('hidden');
            document.getElementById('otp-phone-subtext').innerText = `Citizen Mobile/Email: ${data.phone}. Use default OTP: 123456`;
            appState.pendingLogin = { 
                type: 'citizen', 
                phone: data.phone, 
                needs_profile: data.needs_profile,
                citizen: data.citizen 
            };
            navigateTo('view-otp');
        }
    } catch (e) {
        showLoading(false);
        alert("Server error connecting to gateway.");
    }
}

async function verifyOTPAndProceed() {
    const otp = document.getElementById('otp-input-field').value.trim();
    if (!otp) return alert("Please enter OTP");

    showLoading(true, "Authenticating session...");
    const pending = appState.pendingLogin;

    if (pending.type === 'officer') {
        const dept = document.getElementById('officer-dept-select').value;
        try {
            const res = await fetch(`${API_BASE}/auth/officer_verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: pending.email, department_code: dept, otp })
            });
            const data = await res.json();
            showLoading(false);
            appState.currentUser = { type: 'officer', email: data.email, department_code: data.department_code };
            loadOfficerDashboard();
        } catch (e) {
            showLoading(false);
            alert("Officer verification failed.");
        }
    } else {
        // Citizen login
        showLoading(false);
        appState.currentUser = {
            type: 'citizen',
            phone: pending.phone,
            name: pending.citizen?.name || '',
            home_address: pending.citizen?.home_address || ''
        };

        if (pending.needs_profile || !appState.currentUser.name) {
            navigateTo('view-citizen-profile');
        } else {
            loadCitizenDashboard();
        }
    }
}

// ----------------- 4. Citizen Profile Setup (Voice / Text) -----------------
function recordProfileVoice() {
    if (!recognition) return alert("Speech recognition unavailable.");
    recognition.start();
    showLoading(true, "Listening... Speak your Full Name and Home Address");

    recognition.onresult = (event) => {
        let text = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) text += event.results[i][0].transcript;
        
        // Populate inputs
        document.getElementById('citizen-home-address-input').value = text;
        const nameGuess = text.split(/,|\s+/).slice(0, 2).join(' ');
        document.getElementById('citizen-name-input').value = nameGuess || "Ramesh Kumar";
    };

    recognition.onend = () => showLoading(false);
}

async function saveCitizenProfile() {
    const name = document.getElementById('citizen-name-input').value.trim();
    const homeAddress = document.getElementById('citizen-home-address-input').value.trim();

    if (!name || !homeAddress) return alert("Please provide both your name and permanent home address");

    showLoading(true, "Saving Citizen Profile...");
    try {
        await fetch(`${API_BASE}/auth/citizen_profile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phone: appState.currentUser.phone,
                name,
                home_address: homeAddress,
                preferred_language: appState.selectedLanguage.code
            })
        });
        showLoading(false);
        appState.currentUser.name = name;
        appState.currentUser.home_address = homeAddress;
        loadCitizenDashboard();
    } catch (e) {
        showLoading(false);
        alert("Error saving profile");
    }
}

// ----------------- 5. Citizen Dashboard & Live Status Pipeline -----------------
async function loadCitizenDashboard() {
    navigateTo('view-citizen-dashboard');
    document.getElementById('dash-citizen-name').innerText = `Welcome, ${appState.currentUser.name || 'Citizen'}`;
    document.getElementById('dash-citizen-phone').innerText = `Mobile: ${appState.currentUser.phone} | Address: ${appState.currentUser.home_address || 'Not Set'}`;

    showLoading(true, "Loading your grievance pipeline...");
    try {
        const res = await fetch(`${API_BASE}/citizen/complaints?phone=${appState.currentUser.phone}`);
        const complaints = await res.json();
        showLoading(false);

        document.getElementById('citizen-complaint-count').innerText = complaints.length;
        const list = document.getElementById('citizen-complaint-list');
        list.innerHTML = '';

        if (complaints.length === 0) {
            list.innerHTML = `<div class="bg-white p-8 text-center rounded-2xl border border-slate-200 text-slate-500">
                <i class="fas fa-inbox text-4xl text-slate-300 mb-2"></i>
                <p>No grievances filed yet. Click "+ File New Grievance" above.</p>
            </div>`;
            return;
        }

        complaints.forEach(c => {
            const isResolved = c.status === 'Resolved';
            const isReOpened = c.status === 'Re-Opened';
            
            // Generate visual 4-step pipeline bar
            const stepSubmitted = 'bg-green-600 text-white';
            const stepAssigned = c.status !== 'Submitted' ? 'bg-green-600 text-white' : 'bg-slate-200 text-slate-600';
            const stepProgress = (c.status === 'In Progress' || isResolved || isReOpened) ? 'bg-green-600 text-white' : 'bg-slate-200 text-slate-600';
            const stepResolved = isResolved ? 'bg-green-600 text-white' : (isReOpened ? 'bg-amber-500 text-white' : 'bg-slate-200 text-slate-600');

            list.innerHTML += `
                <div class="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
                    <div class="flex flex-wrap justify-between items-center gap-2 border-b pb-3">
                        <div class="flex items-center gap-2">
                            <span class="font-mono font-black text-blue-950 text-base sm:text-lg">${c.grievance_id}</span>
                            <span class="bg-blue-100 text-blue-800 text-xs font-bold px-2 py-0.5 rounded">${c.department_code}</span>
                            ${c.urgency_tier === 1 ? '<span class="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded animate-pulse">Critical</span>' : ''}
                        </div>
                        <span class="text-xs font-bold px-3 py-1 rounded-full ${isResolved ? 'bg-green-100 text-green-800' : (isReOpened ? 'bg-amber-100 text-amber-800' : 'bg-blue-50 text-blue-800')}">
                            Status: ${c.status}
                        </span>
                    </div>

                    <!-- Pipeline Progress Bar -->
                    <div class="grid grid-cols-4 gap-2 text-center text-[10px] font-bold">
                        <div class="p-1.5 rounded ${stepSubmitted}">1. Submitted</div>
                        <div class="p-1.5 rounded ${stepAssigned}">2. Assigned</div>
                        <div class="p-1.5 rounded ${stepProgress}">3. In Progress</div>
                        <div class="p-1.5 rounded ${stepResolved}">4. ${isReOpened ? 'Re-Opened' : 'Resolved'}</div>
                    </div>

                    <div class="text-xs text-slate-700 space-y-1">
                        <p><strong>Incident Spot:</strong> ${c.incident_location}</p>
                        <p><strong>Summary:</strong> ${c.summary_regional || c.complaint_text}</p>
                    </div>

                    <!-- Action Buttons for Citizen -->
                    <div class="flex flex-wrap gap-2 pt-2 border-t text-xs">
                        <button class="bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5" onclick='triggerPDFDownloadFromRecord(${JSON.stringify(c)})'>
                            <i class="fas fa-file-pdf text-red-600"></i> Download PDF Receipt
                        </button>
                        ${isResolved ? `
                            <button class="bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold px-3 py-1.5 rounded-lg border border-amber-300 flex items-center gap-1.5" onclick="openFeedbackModal('${c.grievance_id}')">
                                <i class="fas fa-star text-amber-500"></i> Verify Work / Re-Open
                            </button>
                        ` : ''}
                    </div>
                </div>
            `;
        });
    } catch (e) {
        showLoading(false);
        alert("Could not load complaints list");
    }
}

// ----------------- 6. Multi-Modal Grievance Filing (3-Step Urgency & Location) -----------------
function openNewComplaintForm() {
    document.getElementById('comp-input-phase').classList.remove('hidden');
    document.getElementById('comp-analysis-phase').classList.add('hidden');
    document.getElementById('comp-success-phase').classList.add('hidden');
    document.getElementById('complaint-desc-input').value = '';
    document.getElementById('incident-location-input').value = '';
    navigateTo('view-file-complaint');
}

function toggleComplaintVoice() {
    if (!recognition) return alert("Speech recognition unavailable.");
    const micBtn = document.getElementById('comp-mic-btn');
    const inputArea = document.getElementById('complaint-desc-input');
    const status = document.getElementById('comp-voice-status');

    if (!isRecording) {
        recognition.start();
        isRecording = true;
        micBtn.classList.add('pulse-mic', 'bg-red-700');
        status.innerText = "Listening... Speak your complaint clearly.";

        recognition.onresult = (event) => {
            let text = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) text += event.results[i][0].transcript;
            inputArea.value = text;
        };

        recognition.onend = () => {
            isRecording = false;
            micBtn.classList.remove('pulse-mic', 'bg-red-700');
            status.innerText = "Recording finished. You can edit text or proceed.";
        };
    } else {
        recognition.stop();
    }
}

function clearComplaintText() {
    document.getElementById('complaint-desc-input').value = '';
    document.getElementById('comp-voice-status').innerText = "Voice cleared. Tap mic to re-record.";
}

async function processComplaintAI() {
    const text = document.getElementById('complaint-desc-input').value.trim();
    if (!text) return alert("Please enter or speak your complaint description.");

    showLoading(true, "AI Analyzing Urgency & Department Code...");
    try {
        const res = await fetch(`${API_BASE}/complaint/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, language: appState.selectedLanguage.name })
        });
        const data = await res.json();
        showLoading(false);
        appState.currentAnalysis = data;
        appState.currentAnalysis.original_text = text;

        // Render AI Results on UI
        const deptContainer = document.getElementById('res-dept-badges-container');
        deptContainer.innerHTML = data.departments.map(d => `<span class="font-bold text-blue-900 bg-blue-100 px-2 py-0.5 rounded text-xs">${d.code} - ${d.name}</span>`).join('');
        document.getElementById('res-sla-text').innerText = `${data.sla_hours} Hours`;
        
        let regionalSum = data.summary_regional;
        let englishSum = data.summary_english;
        
        if (data.is_fallback) {
            regionalSum = `⚠️ [API Rate Limit Exceeded] Offline Mode Summary: ${regionalSum}`;
            englishSum = `⚠️ [API Rate Limit Exceeded] Offline Mode Summary: ${englishSum}`;
        }
        
        document.getElementById('res-summary-regional').innerText = regionalSum;
        document.getElementById('res-summary-english').innerText = englishSum;
        document.getElementById('res-clarifying-question').innerText = data.clarifying_question;

        const urgencyContainer = document.getElementById('res-urgency-container');
        if (data.urgency_tier === 1) {
            urgencyContainer.innerHTML = `<span class="bg-red-600 text-white font-extrabold text-xs px-2.5 py-1 rounded-full animate-pulse"><i class="fas fa-triangle-exclamation"></i> TIER 1: CRITICAL EMERGENCY</span>`;
        } else if (data.urgency_tier === 2) {
            urgencyContainer.innerHTML = `<span class="bg-amber-500 text-white font-bold text-xs px-2.5 py-1 rounded-full">TIER 2: HIGH PRIORITY</span>`;
        } else {
            urgencyContainer.innerHTML = `<span class="bg-blue-600 text-white font-bold text-xs px-2.5 py-1 rounded-full">TIER 3: NORMAL</span>`;
        }

        document.getElementById('comp-input-phase').classList.add('hidden');
        document.getElementById('comp-analysis-phase').classList.remove('hidden');
    } catch (e) {
        showLoading(false);
        alert("Error analyzing complaint with AI.");
    }
}

// Location Options
function getGPSLocation() {
    if (!navigator.geolocation) return alert("Geolocation not supported.");
    showLoading(true, "Fetching GPS Coordinates...");
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            showLoading(false);
            appState.currentAnalysis.latitude = pos.coords.latitude;
            appState.currentAnalysis.longitude = pos.coords.longitude;
            document.getElementById('incident-location-input').value = `GPS: ${pos.coords.latitude.toFixed(4)}° N, ${pos.coords.longitude.toFixed(4)}° E`;
        },
        () => {
            showLoading(false);
            alert("Could not retrieve GPS. Please type the location.");
        }
    );
}

async function handlePhotoUpload(input) {
    const file = input.files[0];
    if (!file) return;

    showLoading(true, "AI Vision scanning photo for landmark & hazards...");
    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await fetch(`${API_BASE}/complaint/analyze_location_image`, {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        showLoading(false);

        document.getElementById('incident-location-input').value = data.location_guess;
        alert(`AI Photo Analysis:\n- Location: ${data.location_guess}\n- Hazard Detected: ${data.hazard_detected ? 'Yes' : 'No'}\n(${data.hazard_description})`);
    } catch (e) {
        showLoading(false);
        alert("Error processing image.");
    }
}

function focusIncidentText() {
    document.getElementById('incident-location-input').focus();
}

function speakConfirmationSummary() {
    if (!appState.currentAnalysis) return;
    const summary = appState.currentAnalysis.summary_regional;
    speakText(summary, appState.selectedLanguage.code);
}

function speakText(text, langCode = 'hi') {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = langCode === 'hi' ? 'hi-IN' : (langCode === 'ta' ? 'ta-IN' : (langCode === 'te' ? 'te-IN' : 'en-IN'));
        window.speechSynthesis.speak(utter);
    }
}

async function submitFinalGrievance() {
    const incidentLoc = document.getElementById('incident-location-input').value.trim();
    if (!incidentLoc) return alert("Please provide the incident location.");

    showLoading(true, "Registering Grievance with Government Server...");
    const analysis = appState.currentAnalysis;

    try {
        const res = await fetch(`${API_BASE}/complaint/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                citizen_phone: appState.currentUser.phone,
                citizen_name: appState.currentUser.name,
                citizen_home_address: appState.currentUser.home_address,
                complaint_text: analysis.original_text,
                complaint_language: appState.selectedLanguage.name,
                departments: analysis.departments,
                incident_location: incidentLoc,
                latitude: analysis.latitude || (28.5 + Math.random() * 0.3),
                longitude: analysis.longitude || (77.1 + Math.random() * 0.3),
                urgency_tier: analysis.urgency_tier,
                urgency_reason: analysis.urgency_reason,
                summary_regional: analysis.summary_regional,
                summary_english: analysis.summary_english,
                sla_hours: analysis.sla_hours
            })
        });
        const data = await res.json();
        showLoading(false);

        appState.lastReceiptData = data.receipt_data;
        document.getElementById('success-gid-label').innerText = data.all_grievance_ids ? data.all_grievance_ids.join(", ") : data.grievance_id;
        document.getElementById('success-sms-text').innerText = data.regional_sms;
        
        document.getElementById('success-summary-reg').innerText = analysis.summary_regional;
        document.getElementById('success-summary-eng').innerText = analysis.summary_english;

        document.getElementById('comp-analysis-phase').classList.add('hidden');
        document.getElementById('comp-success-phase').classList.remove('hidden');
    } catch (e) {
        showLoading(false);
        alert("Failed to submit grievance.");
    }
}

// ----------------- 7. Bilingual PDF Receipt Generator -----------------
function downloadBilingualReceiptPDF() {
    if (!appState.lastReceiptData) return alert("No receipt data found");
    triggerPDFDownloadFromRecord(appState.lastReceiptData);
}

function triggerPDFDownloadFromRecord(r) {
    const t = document.getElementById('pdf-receipt-template');
    document.getElementById('pdf-gid').innerText = r.grievance_id;
    document.getElementById('pdf-name').innerText = r.citizen_name;
    document.getElementById('pdf-phone').innerText = r.citizen_phone;
    document.getElementById('pdf-home').innerText = r.citizen_home_address;
    document.getElementById('pdf-date').innerText = r.created_at || r.date || new Date().toLocaleString();
    document.getElementById('pdf-dept').innerText = r.department_name || r.department || r.department_code || "Unknown Department";
    document.getElementById('pdf-urgency').innerText = r.urgency_tier ? `Tier ${r.urgency_tier}` : (r.urgency || 'Normal');
    document.getElementById('pdf-spot').innerText = r.incident_location;
    document.getElementById('pdf-summary-reg').innerText = r.summary_regional || r.complaint_text;
    document.getElementById('pdf-summary-eng').innerText = r.summary_english || r.complaint_text;

    t.classList.remove('hidden');
    html2canvas(t).then(canvas => {
        t.classList.add('hidden');
        const imgData = canvas.toDataURL('image/png');
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');
        const imgProps = pdf.getImageProperties(imgData);
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
        pdf.addImage(imgData, 'PNG', 0, 10, pdfWidth, pdfHeight);
        pdf.save(`Grievance_Receipt_${r.grievance_id}.pdf`);
    });
}

// ----------------- 8. Direct Grievance ID Tracking -----------------
async function handleDirectTrack() {
    const gid = document.getElementById('direct-track-input').value.trim().toUpperCase();
    if (!gid) return alert("Please enter Grievance ID");

    showLoading(true, "Tracking Grievance...");
    try {
        const res = await fetch(`${API_BASE}/complaint/track/${gid}`);
        if (!res.ok) throw new Error("Not found");
        const c = await res.json();
        showLoading(false);

        alert(`Grievance Status: ${c.status}\nDepartment: ${c.department_name}\nSLA Deadline: ${c.sla_deadline}\nSummary: ${c.summary_regional}`);
    } catch (e) {
        showLoading(false);
        alert("Grievance ID not found.");
    }
}

// ----------------- 9. Officer Dashboard with Leaflet India Map -----------------
async function loadOfficerDashboard() {
    navigateTo('view-officer-dashboard');
    document.getElementById('off-email-label').innerText = appState.currentUser.email;
    document.getElementById('off-dept-badge').innerText = `Dept: ${appState.currentUser.department_code}`;

    showLoading(true, "Loading department complaints feed...");
    try {
        const res = await fetch(`${API_BASE}/officer/complaints?department_code=${appState.currentUser.department_code}`);
        const complaints = await res.json();
        showLoading(false);

        // Update counts
        document.getElementById('stat-total').innerText = complaints.length;
        document.getElementById('stat-critical').innerText = complaints.filter(c => c.urgency_tier === 1).length;
        document.getElementById('stat-reopened').innerText = complaints.filter(c => c.status === 'Re-Opened').length;
        document.getElementById('stat-resolved').innerText = complaints.filter(c => c.status === 'Resolved').length;

        // Render List
        const list = document.getElementById('officer-complaints-list');
        list.innerHTML = '';

        complaints.forEach(c => {
            const hasDuplicates = c.duplicate_count && c.duplicate_count > 0;
            const duplicateBadge = hasDuplicates 
                ? `<span class="bg-purple-100 text-purple-800 text-[10px] font-extrabold px-2 py-0.5 rounded ml-2 border border-purple-300">
                    <i class="fas fa-layer-group"></i> +${c.duplicate_count} Linked Duplicate(s)
                   </span>` 
                : '';
                
            let childInfo = '';
            if (hasDuplicates) {
                const childNames = c.children.map(child => `${child.citizen_name} (${child.citizen_phone})`).join(', ');
                childInfo = `<p class="mt-2 text-xs text-purple-800 bg-purple-50 p-2 rounded border border-purple-100">
                    <strong>Also Reported By:</strong> ${childNames}
                </p>`;
            }

            list.innerHTML += `
                <div class="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-3 ${c.urgency_tier === 1 ? 'border-l-4 border-l-red-600 bg-red-50/10' : (hasDuplicates ? 'border-l-4 border-l-purple-500' : '')}">
                    <div class="flex flex-wrap justify-between items-center gap-2">
                        <div class="flex items-center gap-2">
                            <span class="font-mono font-black text-blue-950">${c.grievance_id}</span>
                            <span class="bg-blue-100 text-blue-800 text-xs font-bold px-2 py-0.5 rounded">${c.citizen_name} (${c.citizen_phone})</span>
                            ${c.urgency_tier === 1 ? '<span class="bg-red-600 text-white text-[10px] font-extrabold px-2 py-0.5 rounded animate-pulse">EMERGENCY TIER 1</span>' : ''}
                            ${duplicateBadge}
                        </div>
                        <span class="text-xs font-bold px-2.5 py-1 rounded-full ${c.status === 'Resolved' ? 'bg-green-100 text-green-800' : (c.status === 'Re-Opened' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800')}">
                            ${c.status}
                        </span>
                    </div>

                    <div class="text-xs text-slate-700 space-y-1">
                        <p><strong>Citizen Home:</strong> ${c.citizen_home_address}</p>
                        <p><strong>Incident Spot:</strong> ${c.incident_location}</p>
                        <p class="italic text-slate-800 bg-slate-50 p-2 rounded">"${c.complaint_text}"</p>
                        ${childInfo}
                    </div>

                    <div class="flex justify-end gap-2 pt-2 border-t text-xs">
                        <button class="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg" onclick="updateComplaintStatus('${c.grievance_id}', 'In Progress')">
                            Mark In Progress
                        </button>
                        <button class="bg-green-600 hover:bg-green-700 text-white font-bold px-3 py-1.5 rounded-lg" onclick="updateComplaintStatus('${c.grievance_id}', 'Resolved')">
                            Mark Resolved
                        </button>
                    </div>
                </div>
            `;
        });

        // Initialize Map
        renderOfficerLeafletMap(complaints);
    } catch (e) {
        showLoading(false);
        alert("Error loading officer data");
    }
}

function switchOfficerView(tab) {
    const listTab = document.getElementById('btn-tab-list');
    const mapTab = document.getElementById('btn-tab-map');
    const listContainer = document.getElementById('officer-list-container');
    const mapContainer = document.getElementById('officer-map-container');

    if (tab === 'list') {
        listTab.className = "px-4 py-2 rounded-lg text-xs font-bold bg-white text-blue-900 shadow-sm";
        mapTab.className = "px-4 py-2 rounded-lg text-xs font-bold text-slate-600 hover:text-slate-900";
        listContainer.classList.remove('hidden');
        mapContainer.classList.add('hidden');
    } else {
        mapTab.className = "px-4 py-2 rounded-lg text-xs font-bold bg-white text-blue-900 shadow-sm";
        listTab.className = "px-4 py-2 rounded-lg text-xs font-bold text-slate-600 hover:text-slate-900";
        listContainer.classList.add('hidden');
        mapContainer.classList.remove('hidden');
        if (appState.leafletMap) appState.leafletMap.invalidateSize();
    }
}

async function updateComplaintStatus(gid, status) {
    if (!confirm(`Are you sure you want to mark ${gid} as ${status}? (This will also update any duplicate tickets linked to this)`)) return;
    
    showLoading(true, "Updating Status...");
    try {
        const res = await fetch(`${API_BASE}/officer/update_status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ grievance_id: gid, status: status })
        });
        const data = await res.json();
        showLoading(false);
        
        if(data.status === 'success') {
            alert(data.message || `Status successfully updated to ${status}`);
            loadOfficerDashboard(); // Refresh the UI
        } else {
            alert("Failed to update status.");
        }
    } catch (e) {
        showLoading(false);
        alert("Error updating status.");
    }
}

function renderOfficerLeafletMap(complaints) {
    if (!appState.leafletMap) {
        appState.leafletMap = L.map('map-container').setView([28.6139, 77.2090], 11);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(appState.leafletMap);
    }

    // Clear old markers
    appState.mapMarkers.forEach(m => appState.leafletMap.removeLayer(m));
    appState.mapMarkers = [];

    complaints.forEach(c => {
        const color = c.urgency_tier === 1 ? '#dc2626' : (c.urgency_tier === 2 ? '#f59e0b' : '#2563eb');
        const marker = L.circleMarker([c.latitude || 28.6139, c.longitude || 77.2090], {
            radius: c.urgency_tier === 1 ? 10 : 7,
            fillColor: color,
            color: '#ffffff',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.9
        }).addTo(appState.leafletMap);

        marker.bindPopup(`
            <div class="text-xs space-y-1">
                <p class="font-bold text-blue-900">${c.grievance_id} (${c.department_code})</p>
                <p><strong>Citizen:</strong> ${c.citizen_name}</p>
                <p><strong>Spot:</strong> ${c.incident_location}</p>
                <p><strong>Status:</strong> ${c.status}</p>
                <p class="italic text-slate-600">"${c.summary_english || c.complaint_text}"</p>
            </div>
        `);
        appState.mapMarkers.push(marker);
    });
}

async function updateComplaintStatus(gid, newStatus) {
    showLoading(true, `Updating Grievance ${gid}...`);
    try {
        await fetch(`${API_BASE}/officer/update_status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ grievance_id: gid, status: newStatus })
        });
        showLoading(false);
        loadOfficerDashboard();
    } catch (e) {
        showLoading(false);
        alert("Error updating status");
    }
}

// ----------------- 10. Citizen Feedback & Re-Opening Loop -----------------
function openFeedbackModal(gid) {
    appState.activeFeedbackGid = gid;
    document.getElementById('feedback-gid-label').innerText = gid;
    document.getElementById('modal-feedback').classList.remove('hidden');
    selectFeedbackResolution(true);
}

function closeFeedbackModal() {
    document.getElementById('modal-feedback').classList.add('hidden');
}

function selectFeedbackResolution(isResolved) {
    appState.feedbackIsResolved = isResolved;
    const btnYes = document.getElementById('btn-fb-yes');
    const btnNo = document.getElementById('btn-fb-no');
    const ratingBox = document.getElementById('feedback-rating-box');

    if (isResolved) {
        btnYes.className = "border-2 border-green-500 bg-green-50 text-green-800 p-4 rounded-xl font-bold text-center flex flex-col items-center gap-1";
        btnNo.className = "border-2 border-slate-200 text-slate-700 p-4 rounded-xl font-bold text-center flex flex-col items-center gap-1 hover:border-red-500 hover:bg-red-50";
        ratingBox.classList.remove('hidden');
    } else {
        btnNo.className = "border-2 border-red-500 bg-red-50 text-red-800 p-4 rounded-xl font-bold text-center flex flex-col items-center gap-1";
        btnYes.className = "border-2 border-slate-200 text-slate-700 p-4 rounded-xl font-bold text-center flex flex-col items-center gap-1 hover:border-green-500 hover:bg-green-50";
        ratingBox.classList.add('hidden');
    }
}

function setStarRating(rating) {
    appState.selectedFeedbackRating = rating;
    const stars = document.getElementById('star-rating-container').children;
    for (let i = 0; i < stars.length; i++) {
        if (i < rating) stars[i].className = "fas fa-star cursor-pointer text-amber-400";
        else stars[i].className = "far fa-star cursor-pointer text-slate-300";
    }
}

async function submitCitizenFeedback() {
    const remarks = document.getElementById('feedback-remarks-input').value.trim();
    showLoading(true, "Submitting citizen resolution verification...");

    try {
        const res = await fetch(`${API_BASE}/complaint/feedback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                grievance_id: appState.activeFeedbackGid,
                is_resolved: appState.feedbackIsResolved,
                rating: appState.selectedFeedbackRating,
                remarks
            })
        });
        const data = await res.json();
        showLoading(false);
        closeFeedbackModal();
        alert(data.message);
        loadCitizenDashboard();
    } catch (e) {
        showLoading(false);
        alert("Failed to submit feedback");
    }
}
