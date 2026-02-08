/* ============================================
   APP.JS - Microsenses MINI 2
   Behavioral Vibration & Threat Analysis
   Matches MINI 1 UI with multi-person detection,
   neuro-psych analysis, camera flip, video upload
   ============================================ */

// ── DOM Elements ──
const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');
const realtimeChart = document.getElementById('realtimeChart');
const rtCtx = realtimeChart.getContext('2d');

const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');
const btnUpload = document.getElementById('btnUpload');
const btnFlip = document.getElementById('btn-flip');
const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('dropZone');
const dropText = document.getElementById('dropText');
const statusBar = document.getElementById('statusBar');
const timerSection = document.getElementById('timerSection');
const timerValue = document.getElementById('timerValue');
const progressFill = document.getElementById('progressFill');
const resultsPanel = document.getElementById('resultsPanel');
const durationModal = document.getElementById('durationModal');
const durationBtns = document.querySelectorAll('.duration-btn');
const personsDetectedEl = document.getElementById('personsDetected');
const personChipsEl = document.getElementById('personChips');

// ── State ──
let running = false;
let stream = null;
let modelLoaded = false;
let scanDuration = 30; // 0 = continuous
let scanStartTime = null;
let facingMode = 'user';
let scanType = 'Live';
let frameCount = 0;

// Vibration metrics state
let lastLandmarks = null;
let peakCount = 0;
let lastPeakTime = 0;
let lastVibration = 0;
let vibrationHistory = [];
let vibrationData = [];
const ENERGY_CONSTANT = 0.001;

// Threat & Neuro engines
const threatEngine = new ThreatEngine();
const neuroAnalyzer = new NeuroAnalyzer();

// Person tracking
let personTracker = new Map();
let nextPersonId = 1;

// ── Utility ──
function setStatus(msg, type) {
    statusBar.textContent = msg;
    statusBar.className = 'status-bar ' + type;
}

function formatTimer(ms) {
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
}

// ── Model Loading ──
async function loadModels() {
    setStatus('Loading face detection models...', 'loading');
    try {
        const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
        await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
        await faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL);
        await faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL);
        modelLoaded = true;
        btnStart.disabled = false;
        btnUpload.disabled = false;
        setStatus('Ready. Click Live Scan or Upload Video.', 'ready');
    } catch (err) {
        setStatus('Model load error: ' + err.message, 'error');
        console.error(err);
    }
}

// ── Camera ──
async function startCamera() {
    // Stop any existing stream first
    if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
        video.srcObject = null;
    }

    // Progressive fallback constraints - try best settings first, then simpler ones
    const constraintsList = [
        { // Attempt 1: Optimized for vibration capture
            video: { facingMode: facingMode, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
            audio: false
        },
        { // Attempt 2: Standard HD
            video: { facingMode: facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
        },
        { // Attempt 3: Basic with facing mode
            video: { facingMode: facingMode },
            audio: false
        },
        { // Attempt 4: Any camera (fallback for devices that reject facingMode)
            video: true,
            audio: false
        }
    ];

    let lastErr = null;
    for (const constraints of constraintsList) {
        try {
            stream = await navigator.mediaDevices.getUserMedia(constraints);
            break;
        } catch (err) {
            lastErr = err;
            console.warn('Camera attempt failed:', constraints, err.name);
        }
    }

    if (!stream) {
        const errName = lastErr ? lastErr.name : 'Unknown';
        if (errName === 'NotAllowedError') {
            setStatus('Camera permission denied. Please allow camera access.', 'error');
        } else if (errName === 'NotFoundError') {
            setStatus('No camera found on this device.', 'error');
        } else {
            setStatus('Camera error: ' + (lastErr ? lastErr.message : 'unknown'), 'error');
        }
        return false;
    }

    video.srcObject = stream;

    // Wait for video metadata so dimensions are available
    await new Promise((resolve) => {
        if (video.readyState >= 1) {
            resolve();
        } else {
            video.onloadedmetadata = () => resolve();
        }
    });

    try {
        await video.play();
    } catch (playErr) {
        console.warn('video.play() failed, retrying...', playErr);
        // Some mobile browsers need a short delay
        await new Promise(r => setTimeout(r, 300));
        try { await video.play(); } catch (e) {
            setStatus('Could not start video playback.', 'error');
            return false;
        }
    }

    overlay.width = video.videoWidth || 640;
    overlay.height = video.videoHeight || 480;

    // Apply advanced constraints for better vibration capture (best-effort)
    try {
        const track = stream.getVideoTracks()[0];
        if (track && track.getCapabilities) {
            const caps = track.getCapabilities();
            const adv = {};
            if (caps.exposureMode && caps.exposureMode.includes('continuous'))
                adv.exposureMode = 'continuous';
            if (caps.focusMode && caps.focusMode.includes('continuous'))
                adv.focusMode = 'continuous';
            if (caps.whiteBalanceMode && caps.whiteBalanceMode.includes('manual'))
                adv.whiteBalanceMode = 'manual';
            if (Object.keys(adv).length > 0)
                await track.applyConstraints({ advanced: [adv] });
        }
    } catch (e) { /* advanced constraints not supported, continue */ }

    const settings = stream.getVideoTracks()[0]?.getSettings?.() || {};
    console.log('[Camera] Active:', `${settings.width}x${settings.height}@${settings.frameRate}fps`, settings.facingMode || facingMode);

    return true;
}

// ── Vibration Metrics (same as MINI 1) ──
function computeVibrationMetrics(landmarks, now) {
    if (!lastLandmarks || !landmarks) {
        lastLandmarks = landmarks;
        return { vibration: 0, frequency: 0, energy: 0 };
    }

    const curr = landmarks.positions || landmarks._positions || [];
    const prev = lastLandmarks.positions || lastLandmarks._positions || [];

    if (curr.length === 0 || prev.length === 0 || curr.length !== prev.length) {
        lastLandmarks = landmarks;
        return { vibration: 0, frequency: 0, energy: 0 };
    }

    let totalDisplacement = 0;
    for (let i = 0; i < curr.length; i++) {
        const dx = (curr[i].x || curr[i]._x) - (prev[i].x || prev[i]._x);
        const dy = (curr[i].y || curr[i]._y) - (prev[i].y || prev[i]._y);
        totalDisplacement += Math.sqrt(dx * dx + dy * dy);
    }
    const vibration = totalDisplacement / curr.length;

    vibrationHistory.push({ t: now, v: vibration });
    while (vibrationHistory.length > 0 && vibrationHistory[0].t < now - 2000) {
        vibrationHistory.shift();
    }

    const threshold = 0.3;
    if (lastVibration < threshold && vibration >= threshold) {
        if (now - lastPeakTime > 100) {
            peakCount++;
            lastPeakTime = now;
        }
    }
    lastVibration = vibration;

    const frequency = scanStartTime ? (peakCount / ((now - scanStartTime) / 1000)) : 0;
    const energy = vibration * vibration * Math.max(frequency, 0.1) * ENERGY_CONSTANT * 1000000;

    lastLandmarks = landmarks;
    return { vibration, frequency: Math.min(frequency, 30), energy };
}

// ── Person Tracking ──
function trackPersons(detections) {
    const unmatched = [...detections];

    personTracker.forEach((data, personId) => {
        let bestMatch = null;
        let bestDist = Infinity;

        unmatched.forEach((det, idx) => {
            const box = det.detection.box;
            const cx = box.x + box.width / 2;
            const cy = box.y + box.height / 2;
            const pcx = data.lastBox.x + data.lastBox.width / 2;
            const pcy = data.lastBox.y + data.lastBox.height / 2;
            const dist = Math.sqrt((cx - pcx) ** 2 + (cy - pcy) ** 2);

            if (dist < bestDist && dist < 100) {
                bestDist = dist;
                bestMatch = idx;
            }
        });

        if (bestMatch !== null) {
            const det = unmatched.splice(bestMatch, 1)[0];
            data.lastBox = det.detection.box;
            data.lastSeen = Date.now();
            threatEngine.processFrame(personId, det);
        }
    });

    unmatched.forEach(det => {
        const personId = `P${nextPersonId++}`;
        personTracker.set(personId, {
            lastBox: det.detection.box,
            lastSeen: Date.now()
        });
        threatEngine.processFrame(personId, det);
    });

    // Remove stale
    const now = Date.now();
    personTracker.forEach((data, personId) => {
        if (now - data.lastSeen > 3000) {
            personTracker.delete(personId);
        }
    });
}

// ── Drawing ──
function drawDetections(detections) {
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    detections.forEach((det) => {
        const box = det.detection.box;
        const x = box.x, y = box.y, w = box.width, h = box.height;

        let color = '#4caf50';
        let personId = null;

        personTracker.forEach((data, pid) => {
            const pcx = data.lastBox.x + data.lastBox.width / 2;
            const pcy = data.lastBox.y + data.lastBox.height / 2;
            const dcx = x + w / 2;
            const dcy = y + h / 2;
            if (Math.sqrt((pcx - dcx) ** 2 + (pcy - dcy) ** 2) < 80) {
                personId = pid;
            }
        });

        if (personId) {
            const assessment = threatEngine._quickAssess(personId);
            if (assessment.level === 'critical') color = '#f44336';
            else if (assessment.level === 'elevated') color = '#ff9800';
            else if (assessment.level === 'caution') color = '#ffc107';
        }

        // Corner brackets
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        const cl = Math.min(w, h) * 0.2;

        ctx.beginPath(); ctx.moveTo(x, y + cl); ctx.lineTo(x, y); ctx.lineTo(x + cl, y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + w - cl, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cl); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, y + h - cl); ctx.lineTo(x, y + h); ctx.lineTo(x + cl, y + h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + w - cl, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - cl); ctx.stroke();

        if (personId) {
            ctx.fillStyle = color;
            ctx.font = 'bold 12px system-ui';
            ctx.fillText(personId, x + 4, y - 6);
        }

        // Draw landmarks
        if (det.landmarks) {
            const pts = det.landmarks.positions || det.landmarks._positions || [];
            ctx.fillStyle = 'rgba(74, 158, 255, 0.5)';
            pts.forEach(pt => {
                ctx.beginPath();
                ctx.arc(pt.x || pt._x, pt.y || pt._y, 1.5, 0, Math.PI * 2);
                ctx.fill();
            });
        }
    });
}

function drawRealtimeChart() {
    const w = realtimeChart.width = realtimeChart.clientWidth * 2;
    const h = realtimeChart.height = 160;
    rtCtx.clearRect(0, 0, w, h);

    if (vibrationData.length < 2) return;

    const recent = vibrationData.slice(-100);
    const max = Math.max(...recent.map(d => d.vibration), 1);

    const gradient = rtCtx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, 'rgba(78, 205, 196, 0.4)');
    gradient.addColorStop(1, 'rgba(78, 205, 196, 0)');

    rtCtx.fillStyle = gradient;
    rtCtx.beginPath();
    rtCtx.moveTo(0, h);
    for (let i = 0; i < recent.length; i++) {
        const x = (i / (recent.length - 1)) * w;
        const y = h - (recent[i].vibration / max) * (h - 20);
        rtCtx.lineTo(x, y);
    }
    rtCtx.lineTo(w, h);
    rtCtx.closePath();
    rtCtx.fill();

    rtCtx.strokeStyle = '#4ecdc4';
    rtCtx.lineWidth = 2;
    rtCtx.beginPath();
    for (let i = 0; i < recent.length; i++) {
        const x = (i / (recent.length - 1)) * w;
        const y = h - (recent[i].vibration / max) * (h - 20);
        if (i === 0) rtCtx.moveTo(x, y); else rtCtx.lineTo(x, y);
    }
    rtCtx.stroke();
}

function updatePersonChips() {
    if (personTracker.size === 0) {
        personsDetectedEl.style.display = 'none';
        return;
    }
    personsDetectedEl.style.display = 'block';
    let html = '';
    personTracker.forEach((data, pid) => {
        const a = threatEngine._quickAssess(pid);
        html += `<span class="p-chip ${a.level}">${pid} ${a.score}%</span>`;
    });
    personChipsEl.innerHTML = html;
}

// ── Scan Processing ──
async function processFrame() {
    if (!running) return;

    const now = performance.now();

    // Timer
    if (scanDuration > 0) {
        const elapsed = now - scanStartTime;
        const remaining = (scanDuration * 1000) - elapsed;
        timerValue.textContent = formatTimer(remaining);
        progressFill.style.width = `${(elapsed / (scanDuration * 1000)) * 100}%`;
        if (remaining <= 0) {
            completeScan();
            return;
        }
    } else {
        // Continuous mode
        const elapsed = now - scanStartTime;
        timerValue.textContent = formatTimer(elapsed);
    }

    frameCount++;

    try {
        // Guard: ensure video is playing and has dimensions
        if (video.readyState < 2 || video.videoWidth === 0) {
            if (running) requestAnimationFrame(processFrame);
            return;
        }

        // Sync overlay size if video dimensions changed
        if (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) {
            overlay.width = video.videoWidth;
            overlay.height = video.videoHeight;
        }

        const detections = await faceapi
            .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.4 }))
            .withFaceLandmarks(true)
            .withFaceExpressions();

        if (detections.length > 0) {
            trackPersons(detections);
            drawDetections(detections);

            // Vibration metrics from first detected face
            const metrics = computeVibrationMetrics(detections[0].landmarks, now);
            document.getElementById('rtEnergy').textContent = metrics.energy.toFixed(1);
            document.getElementById('rtVibration').textContent = metrics.vibration.toFixed(2);
            document.getElementById('rtFrequency').textContent = metrics.frequency.toFixed(1);

            vibrationData.push({ vibration: metrics.vibration, frequency: metrics.frequency, energy: metrics.energy });
        } else {
            ctx.clearRect(0, 0, overlay.width, overlay.height);
            lastLandmarks = null;
        }

        updatePersonChips();
        drawRealtimeChart();

    } catch (err) {
        console.warn('Frame processing error:', err.message);
        // Continue scanning despite frame errors
    }

    if (running) {
        requestAnimationFrame(processFrame);
    }
}

// ── Duration Modal ──
function showDurationModal() {
    durationModal.classList.add('show');
}
function hideDurationModal() {
    durationModal.classList.remove('show');
}

durationBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        durationBtns.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        scanDuration = parseInt(btn.dataset.duration);
    });
});

document.getElementById('confirmStart').addEventListener('click', () => {
    startScan();
});

// ── Start Scan ──
async function startScan() {
    hideDurationModal();
    setStatus('Starting camera...', 'loading');
    scanType = 'Live';

    const ok = await startCamera();
    if (!ok) return;

    running = true;
    frameCount = 0;
    vibrationData = [];
    lastLandmarks = null;
    peakCount = 0;
    lastPeakTime = 0;
    lastVibration = 0;
    vibrationHistory = [];
    scanStartTime = performance.now();
    threatEngine.clearAll();
    personTracker.clear();
    nextPersonId = 1;

    timerSection.style.display = 'block';
    if (scanDuration > 0) {
        timerValue.textContent = formatTimer(scanDuration * 1000);
    } else {
        timerValue.textContent = '0:00';
    }
    progressFill.style.width = '0%';

    btnStart.disabled = true;
    btnUpload.disabled = true;
    btnStop.disabled = false;
    resultsPanel.classList.remove('active');

    const label = scanDuration > 0 ? `Scanning for ${scanDuration} seconds...` : 'Continuous scan running...';
    setStatus(label, 'scanning');
    processFrame();
}

// ── Stop Scan ──
function stopScan() {
    if (!running) return;
    completeScan();
}

// ── Complete Scan ──
function completeScan() {
    running = false;

    if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
    }
    video.srcObject = null;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    lastLandmarks = null;

    timerSection.style.display = 'none';
    btnStart.disabled = false;
    btnUpload.disabled = false;
    btnStop.disabled = true;

    // Generate threat results for all tracked persons
    const threatResults = [];
    personTracker.forEach((data, personId) => {
        const analysis = threatEngine.fullAnalysis(personId);
        if (analysis.framesAnalyzed >= 3) {
            analysis.box = data.lastBox;
            threatResults.push(analysis);
        }
    });

    if (threatResults.length === 0 && frameCount < 10) {
        setStatus('Not enough data. Try again with face visible.', 'error');
        return;
    }

    // Generate neuro-psych results
    const fps = 30;
    const neuroResults = [];
    threatResults.forEach(r => {
        const history = threatEngine.frameHistory.get(r.personId);
        if (history && history.length >= 10) {
            const nr = neuroAnalyzer.analyze(history, fps);
            nr.personId = r.personId;
            neuroResults.push(nr);
        }
    });

    // Render results
    renderResults(threatResults, neuroResults);
    resultsPanel.classList.add('active');

    const elapsed = (performance.now() - scanStartTime) / 1000;
    document.getElementById('scanDurationDisplay').textContent = `${elapsed.toFixed(0)}s`;
    document.getElementById('scanFrames').textContent = frameCount;
    document.getElementById('scanPersons').textContent = threatResults.length;
    document.getElementById('scanType').textContent = scanType;

    setStatus('Analysis complete!', 'ready');
}

// ── Render Results ──
function renderResults(threatResults, neuroResults) {
    let html = '';

    if (threatResults.length === 0) {
        html = '<div style="text-align:center;padding:20px;color:#888;">No persons detected during scan.</div>';
    } else {
        threatResults.sort((a, b) => b.threatScore - a.threatScore);
        threatResults.forEach(r => {
            html += buildThreatCard(r);
        });
    }

    document.getElementById('threatResultsSection').innerHTML = html;

    // Neuro section
    let neuroHtml = '';
    if (neuroResults.length > 0) {
        neuroResults.forEach(nr => {
            neuroHtml += buildNeuroSection(nr);
        });
    }
    document.getElementById('neuroSection').innerHTML = neuroHtml;
}

function buildThreatCard(r) {
    const m = r.metrics;
    const indicators = r.indicators.map(ind =>
        `<span class="ind-tag ${ind.color}">${ind.label}</span>`
    ).join('');

    return `
    <div class="threat-card ${r.threatLevel}">
        <div class="threat-card-header">
            <span class="person-label">${r.personId} | ${r.dominantExpression.toUpperCase()}</span>
            <span class="threat-badge ${r.threatLevel}">${r.threatLevel.toUpperCase()} ${r.threatScore}%</span>
        </div>
        <div class="metrics-grid">
            <div class="m-item"><div class="m-label">Aggression</div><div class="m-bar"><div class="m-bar-fill aggression" style="width:${m.aggression}%"></div></div><div class="m-value">${m.aggression}%</div></div>
            <div class="m-item"><div class="m-label">Stress</div><div class="m-bar"><div class="m-bar-fill stress" style="width:${m.stress}%"></div></div><div class="m-value">${m.stress}%</div></div>
            <div class="m-item"><div class="m-label">Deception</div><div class="m-bar"><div class="m-bar-fill deception" style="width:${m.deception}%"></div></div><div class="m-value">${m.deception}%</div></div>
            <div class="m-item"><div class="m-label">Tension</div><div class="m-bar"><div class="m-bar-fill tension" style="width:${m.tension}%"></div></div><div class="m-value">${m.tension}%</div></div>
            <div class="m-item"><div class="m-label">Bad Intent</div><div class="m-bar"><div class="m-bar-fill intent" style="width:${m.badIntent}%"></div></div><div class="m-value">${m.badIntent}%</div></div>
            <div class="m-item"><div class="m-label">Stability</div><div class="m-bar"><div class="m-bar-fill stability" style="width:${m.stability}%"></div></div><div class="m-value">${m.stability}%</div></div>
        </div>
        <div class="indicators-row">${indicators}</div>
        <div style="margin-top:8px;font-size:11px;color:#666;">${r.framesAnalyzed} frames | ${r.confidence}% confidence</div>
    </div>`;
}

function buildNeuroSection(nr) {
    const bio = nr.biometrics;

    const bioItems = [
        { label: 'Blink Rate', value: bio.blinkRate, unit: '/min', status: bio.blinkRate < 8 ? 'alert' : (bio.blinkRate < 13 ? 'warn' : (bio.blinkRate > 28 ? 'warn' : 'ok')) },
        { label: 'Expr Range', value: bio.expressionRange, unit: '%', status: bio.expressionRange < 20 ? 'alert' : (bio.expressionRange < 35 ? 'warn' : 'ok') },
        { label: 'Tremor', value: bio.microTremorScore, unit: 'score', status: bio.microTremorScore > 30 ? 'alert' : (bio.microTremorScore > 15 ? 'warn' : 'ok') },
        { label: 'Tremor Hz', value: bio.tremorFreqEstimate, unit: 'Hz', status: (bio.tremorFreqEstimate >= 3.5 && bio.tremorFreqEstimate <= 6.5 && bio.microTremorScore > 10) ? 'alert' : 'ok' },
        { label: 'Volatility', value: bio.expressionVolatility, unit: '%', status: bio.expressionVolatility > 55 ? 'alert' : (bio.expressionVolatility > 35 ? 'warn' : 'ok') },
        { label: 'Psychomotor', value: bio.psychomotorIndex, unit: 'idx', status: bio.psychomotorIndex < 30 ? 'alert' : (bio.psychomotorIndex > 70 ? 'warn' : 'ok') },
        { label: 'Gaze Stbl', value: bio.gazeStability, unit: '%', status: bio.gazeStability < 40 ? 'alert' : (bio.gazeStability < 60 ? 'warn' : 'ok') },
        { label: 'Affect Cong', value: bio.affectCongruence, unit: '%', status: bio.affectCongruence < 50 ? 'alert' : (bio.affectCongruence < 70 ? 'warn' : 'ok') },
        { label: 'Blink Reg', value: bio.blinkRegularity, unit: '%', status: bio.blinkRegularity < 40 ? 'warn' : 'ok' }
    ];

    let bioHtml = `<div class="neuro-section-title">${nr.personId} — Neuro-Psych Analysis</div>`;
    bioHtml += '<div class="bio-grid">';
    bioItems.forEach(item => {
        bioHtml += `<div class="bio-item"><div class="bio-label">${item.label}</div><div class="bio-val ${item.status}">${item.value}</div><div class="bio-unit">${item.unit}</div></div>`;
    });
    bioHtml += '</div>';

    let condHtml = '';
    nr.conditions.forEach(cond => {
        if (cond.indicators.length === 0 && cond.likelihood < 10) return;

        let inds = '';
        cond.indicators.forEach(ind => {
            inds += `<div class="cond-ind"><span class="ci-marker">${ind.marker}</span><span class="ci-val ${ind.severity}">${ind.value}</span></div>`;
        });

        condHtml += `
        <div class="cond-card ${cond.level}">
            <div class="cond-cat">${cond.category}</div>
            <div class="cond-header">
                <span class="cond-name">${cond.condition}</span>
                <span class="cond-badge ${cond.level}">${cond.level} ${cond.likelihood}%</span>
            </div>
            <div class="cond-bar"><div class="cond-bar-fill ${cond.level}" style="width:${cond.likelihood}%"></div></div>
            <div class="cond-indicators">${inds}</div>
            <div class="cond-note">${cond.note}</div>
        </div>`;
    });

    return bioHtml + condHtml;
}

// ── Video Upload ──
btnUpload.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    scanType = 'Upload';
    setStatus('Loading video...', 'loading');

    const url = URL.createObjectURL(file);
    video.src = url;
    video.muted = true;

    video.onloadedmetadata = async () => {
        overlay.width = video.videoWidth || 640;
        overlay.height = video.videoHeight || 480;

        // Reset state
        running = true;
        frameCount = 0;
        vibrationData = [];
        lastLandmarks = null;
        peakCount = 0;
        lastPeakTime = 0;
        lastVibration = 0;
        vibrationHistory = [];
        scanStartTime = performance.now();
        threatEngine.clearAll();
        personTracker.clear();
        nextPersonId = 1;
        scanDuration = 0; // continuous for video

        timerSection.style.display = 'block';
        btnStart.disabled = true;
        btnUpload.disabled = true;
        btnStop.disabled = false;
        resultsPanel.classList.remove('active');

        setStatus('Analyzing video...', 'scanning');
        await video.play();
        processVideoFrame();
    };

    fileInput.value = '';
});

async function processVideoFrame() {
    if (!running) return;

    if (video.ended || video.paused) {
        completeScan();
        return;
    }

    const now = performance.now();
    const elapsed = now - scanStartTime;
    timerValue.textContent = formatTimer(elapsed);
    frameCount++;

    try {
        const detections = await faceapi
            .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.4 }))
            .withFaceLandmarks(true)
            .withFaceExpressions();

        if (detections.length > 0) {
            trackPersons(detections);
            drawDetections(detections);
            const metrics = computeVibrationMetrics(detections[0].landmarks, now);
            document.getElementById('rtEnergy').textContent = metrics.energy.toFixed(1);
            document.getElementById('rtVibration').textContent = metrics.vibration.toFixed(2);
            document.getElementById('rtFrequency').textContent = metrics.frequency.toFixed(1);
            vibrationData.push({ vibration: metrics.vibration, frequency: metrics.frequency, energy: metrics.energy });
        }

        updatePersonChips();
        drawRealtimeChart();
    } catch (err) { /* continue */ }

    if (running) {
        requestAnimationFrame(processVideoFrame);
    }
}

// ── Drag & Drop ──
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drop-zone');
    dropText.style.display = 'block';
});
dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drop-zone');
    dropText.style.display = 'none';
});
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drop-zone');
    dropText.style.display = 'none';
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('video/')) {
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change'));
    }
});

// ── Camera Flip ──
btnFlip.addEventListener('click', async () => {
    facingMode = facingMode === 'user' ? 'environment' : 'user';
    if (running && stream) {
        const ok = await startCamera();
        if (!ok) {
            // Flip back if the other camera failed
            facingMode = facingMode === 'user' ? 'environment' : 'user';
            await startCamera();
        }
    }
});

// ── Event Listeners ──
btnStart.addEventListener('click', showDurationModal);
btnStop.addEventListener('click', stopScan);
document.getElementById('btnNewScan').addEventListener('click', () => {
    resultsPanel.classList.remove('active');
    showDurationModal();
});

// ── Init ──
loadModels();
