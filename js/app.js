/* ============================================
   APP.JS - Microsenses MINI 2
   Behavioral Vibration & Threat Analysis
   Dual-mode: DETECTION (multi-person) and
   DECEPTION INTERVIEW (single-person)
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
const modeModal = document.getElementById('modeModal');
const durationModal = document.getElementById('durationModal');
const durationBtns = document.querySelectorAll('.duration-btn');
const personsDetectedEl = document.getElementById('personsDetected');
const personChipsEl = document.getElementById('personChips');
const modeBadge = document.getElementById('modeBadge');

// ── State ──
let running = false;
let stream = null;
let modelLoaded = false;
let currentMode = null; // 'detection' or 'deception'
let scanDuration = 60;
let scanStartTime = null;
let facingMode = 'user';
let scanType = 'Live';
let frameCount = 0;
let pendingUpload = false; // true when upload is waiting for mode selection
let pendingUploadDeception = false; // true when deception upload needs duration then file picker

// Vibration metrics state
let lastLandmarks = null;
let peakCount = 0;
let lastPeakTime = 0;
let lastVibration = 0;
let vibrationHistory = [];
let vibrationData = [];
const ENERGY_CONSTANT = 0.001;

// Engines
const threatEngine = new ThreatEngine();
const neuroAnalyzer = new NeuroAnalyzer();
const deceptionEngine = new DeceptionEngine();

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
    if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
        video.srcObject = null;
    }

    const constraintsList = [
        { video: { facingMode: facingMode, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } }, audio: false },
        { video: { facingMode: facingMode, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
        { video: { facingMode: facingMode }, audio: false },
        { video: true, audio: false }
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
        if (errName === 'NotAllowedError') setStatus('Camera permission denied.', 'error');
        else if (errName === 'NotFoundError') setStatus('No camera found.', 'error');
        else setStatus('Camera error: ' + (lastErr ? lastErr.message : 'unknown'), 'error');
        return false;
    }

    video.srcObject = stream;
    await new Promise((resolve) => {
        if (video.readyState >= 1) resolve();
        else video.onloadedmetadata = () => resolve();
    });

    try { await video.play(); } catch (playErr) {
        console.warn('video.play() failed, retrying...', playErr);
        await new Promise(r => setTimeout(r, 300));
        try { await video.play(); } catch (e) {
            setStatus('Could not start video playback.', 'error');
            return false;
        }
    }

    overlay.width = video.videoWidth || 640;
    overlay.height = video.videoHeight || 480;

    try {
        const track = stream.getVideoTracks()[0];
        if (track && track.getCapabilities) {
            const caps = track.getCapabilities();
            const adv = {};
            if (caps.exposureMode && caps.exposureMode.includes('continuous')) adv.exposureMode = 'continuous';
            if (caps.focusMode && caps.focusMode.includes('continuous')) adv.focusMode = 'continuous';
            if (Object.keys(adv).length > 0) await track.applyConstraints({ advanced: [adv] });
        }
    } catch (e) { /* advanced constraints not supported */ }

    const track = stream.getVideoTracks()[0];
    if (track) {
        track.onended = () => {
            if (running) {
                setStatus('Camera disconnected. Stopping scan.', 'error');
                running = false;
                stream = null;
                timerSection.style.display = 'none';
                btnStart.disabled = false;
                btnUpload.disabled = false;
                btnStop.disabled = true;
            }
        };
    }

    return true;
}

// ── Vibration Metrics ──
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
    while (vibrationHistory.length > 0 && vibrationHistory[0].t < now - 2000) vibrationHistory.shift();

    if (lastVibration < 0.3 && vibration >= 0.3 && now - lastPeakTime > 100) {
        peakCount++;
        lastPeakTime = now;
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
        personTracker.set(personId, { lastBox: det.detection.box, lastSeen: Date.now() });
        threatEngine.processFrame(personId, det);
    });

    const now = Date.now();
    personTracker.forEach((data, personId) => {
        if (now - data.lastSeen > 3000) personTracker.delete(personId);
    });
}

// ── Aura Color (AlphaEye-inspired) ──
function getAuraColor(threatScore) {
    if (threatScore >= 75) return { color: '#f44336', label: 'HOSTILE', glow: 'rgba(244,67,54,0.15)' };
    if (threatScore >= 55) return { color: '#ff9800', label: 'ELEVATED', glow: 'rgba(255,152,0,0.12)' };
    if (threatScore >= 35) return { color: '#ffc107', label: 'STRESSED', glow: 'rgba(255,193,7,0.10)' };
    if (threatScore >= 15) return { color: '#4caf50', label: 'NORMAL', glow: 'rgba(76,175,80,0.08)' };
    return { color: '#42a5f5', label: 'CALM', glow: 'rgba(66,165,245,0.08)' };
}

// ── Drawing: Detection Mode (with aura) ──
function drawDetectionsWithAuras(detections) {
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    detections.forEach((det) => {
        const box = det.detection.box;
        const x = box.x, y = box.y, w = box.width, h = box.height;

        let color = '#4caf50';
        let auraLabel = 'NORMAL';
        let personId = null;

        personTracker.forEach((data, pid) => {
            const pcx = data.lastBox.x + data.lastBox.width / 2;
            const pcy = data.lastBox.y + data.lastBox.height / 2;
            const dcx = x + w / 2;
            const dcy = y + h / 2;
            if (Math.sqrt((pcx - dcx) ** 2 + (pcy - dcy) ** 2) < 80) personId = pid;
        });

        if (personId) {
            const assessment = threatEngine._quickAssess(personId);
            const aura = getAuraColor(assessment.score);
            color = aura.color;
            auraLabel = aura.label;

            // Draw aura glow
            const gradient = ctx.createRadialGradient(x + w / 2, y + h / 2, Math.min(w, h) * 0.3, x + w / 2, y + h / 2, Math.max(w, h) * 0.7);
            gradient.addColorStop(0, aura.glow);
            gradient.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(x - 20, y - 20, w + 40, h + 40);
        }

        // Corner brackets
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        const cl = Math.min(w, h) * 0.2;
        ctx.beginPath(); ctx.moveTo(x, y + cl); ctx.lineTo(x, y); ctx.lineTo(x + cl, y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + w - cl, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cl); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, y + h - cl); ctx.lineTo(x, y + h); ctx.lineTo(x + cl, y + h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + w - cl, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - cl); ctx.stroke();

        // Label
        if (personId) {
            ctx.fillStyle = color;
            ctx.font = 'bold 12px system-ui';
            ctx.fillText(`${personId} [${auraLabel}]`, x + 4, y - 6);
        }

        // Landmarks
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

// ── Drawing: Deception Mode (single subject) ──
function drawDeceptionOverlay(subject) {
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const box = subject.detection.box;
    const x = box.x, y = box.y, w = box.width, h = box.height;

    const assess = deceptionEngine._quickDeceptionAssess('SUBJECT');
    let color = '#4caf50';
    if (assess.deceptionProbability >= 70) color = '#f44336';
    else if (assess.deceptionProbability >= 50) color = '#ff9800';
    else if (assess.deceptionProbability >= 30) color = '#ffc107';

    // Full bounding box
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    // All 68 landmarks
    if (subject.landmarks) {
        const pts = subject.landmarks.positions || subject.landmarks._positions || [];
        ctx.fillStyle = 'rgba(74, 158, 255, 0.6)';
        pts.forEach(pt => {
            ctx.beginPath();
            ctx.arc(pt.x || pt._x, pt.y || pt._y, 2, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    // Labels
    ctx.fillStyle = color;
    ctx.font = 'bold 14px system-ui';
    ctx.fillText('SUBJECT', x + 4, y - 8);

    const scoreText = `Deception: ${assess.deceptionProbability}%`;
    ctx.font = 'bold 12px system-ui';
    const tw = ctx.measureText(scoreText).width;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(x + w - tw - 16, y + h + 4, tw + 12, 22);
    ctx.fillStyle = color;
    ctx.fillText(scoreText, x + w - tw - 10, y + h + 19);
}

// ── Drawing: Chart ──
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
        const px = (i / (recent.length - 1)) * w;
        const py = h - (recent[i].vibration / max) * (h - 20);
        rtCtx.lineTo(px, py);
    }
    rtCtx.lineTo(w, h);
    rtCtx.closePath();
    rtCtx.fill();

    rtCtx.strokeStyle = currentMode === 'deception' ? '#e040fb' : '#4ecdc4';
    rtCtx.lineWidth = 2;
    rtCtx.beginPath();
    for (let i = 0; i < recent.length; i++) {
        const px = (i / (recent.length - 1)) * w;
        const py = h - (recent[i].vibration / max) * (h - 20);
        if (i === 0) rtCtx.moveTo(px, py); else rtCtx.lineTo(px, py);
    }
    rtCtx.stroke();
}

// ── Person Chips (Detection mode) ──
function updatePersonChips() {
    if (personTracker.size === 0) {
        personsDetectedEl.style.display = 'none';
        return;
    }
    personsDetectedEl.style.display = 'block';
    let html = '';
    personTracker.forEach((data, pid) => {
        const a = threatEngine._quickAssess(pid);
        const aura = getAuraColor(a.score);
        html += `<span class="p-chip ${a.level}">${pid} [${aura.label}] ${a.score}%</span>`;
    });
    personChipsEl.innerHTML = html;
}

// ── Live Deception Indicators ──
function updateDeceptionIndicators(assess) {
    const el = document.getElementById('liveIndicatorChips');
    let html = '';

    if (assess.microExpressionDetected) html += '<span class="ind-chip flash">MICRO-EXPRESSION</span>';
    if (assess.blinkAnomaly) html += '<span class="ind-chip warn">BLINK ANOMALY</span>';
    if (assess.gazeAversion) html += '<span class="ind-chip warn">GAZE AVERSION</span>';
    if (assess.asymmetryHigh) html += '<span class="ind-chip alert">FACIAL ASYMMETRY</span>';
    if (assess.expressionIncongruence) html += '<span class="ind-chip alert">INCONGRUENT EXPRESSION</span>';
    if (assess.cognitiveLoad > 70) html += '<span class="ind-chip alert">HIGH COGNITIVE LOAD</span>';
    if (assess.deceptionProbability < 20 && !assess.microExpressionDetected) html += '<span class="ind-chip ok">TRUTHFUL BASELINE</span>';
    if (html === '') html = '<span class="ind-chip neutral">MONITORING...</span>';

    el.innerHTML = html;
}

// ── Detection Alert System ──
function checkDetectionAlerts() {
    personTracker.forEach((data, pid) => {
        const assess = threatEngine._quickAssess(pid);
        if (assess.score >= 65 && !data.alerted) {
            data.alerted = true;
            const aura = getAuraColor(assess.score);
            statusBar.textContent = `ALERT: ${pid} — ${aura.label} THREAT DETECTED`;
            statusBar.className = 'status-bar error';
            setTimeout(() => {
                if (running) setStatus('Continuous detection scan running...', 'scanning');
            }, 3000);
        }
        if (assess.score < 55) data.alerted = false;
    });
}

// ── Mode-specific frame processing ──

function processDetectionFrame(detections, now) {
    if (detections.length > 0) {
        trackPersons(detections);
        drawDetectionsWithAuras(detections);

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
    checkDetectionAlerts();
}

function selectInterviewSubject(detections) {
    let largest = detections[0];
    let maxArea = 0;
    detections.forEach(det => {
        const area = det.detection.box.width * det.detection.box.height;
        if (area > maxArea) { maxArea = area; largest = det; }
    });
    return largest;
}

function processDeceptionFrame(detections, now) {
    if (detections.length === 0) {
        ctx.clearRect(0, 0, overlay.width, overlay.height);
        lastLandmarks = null;
        return;
    }

    const subject = selectInterviewSubject(detections);
    const personId = 'SUBJECT';

    if (!personTracker.has(personId)) {
        personTracker.set(personId, { lastBox: subject.detection.box, lastSeen: Date.now() });
    } else {
        const data = personTracker.get(personId);
        data.lastBox = subject.detection.box;
        data.lastSeen = Date.now();
    }

    threatEngine.processFrame(personId, subject);
    deceptionEngine.processFrame(personId, subject);

    drawDeceptionOverlay(subject);

    const metrics = computeVibrationMetrics(subject.landmarks, now);
    vibrationData.push({ vibration: metrics.vibration, frequency: metrics.frequency, energy: metrics.energy });

    const assess = deceptionEngine._quickDeceptionAssess(personId);
    document.getElementById('rtDeception').textContent = assess.deceptionProbability + '%';
    document.getElementById('rtConcealment').textContent = assess.concealmentScore + '%';
    document.getElementById('rtCogLoad').textContent = assess.cognitiveLoad + '%';
    document.getElementById('rtTruthfulness').textContent = assess.truthfulness + '%';

    updateDeceptionIndicators(assess);
}

// ── Scan Processing ──
async function processFrame() {
    if (!running) return;

    const now = performance.now();

    if (scanDuration > 0) {
        const elapsed = now - scanStartTime;
        const remaining = (scanDuration * 1000) - elapsed;
        timerValue.textContent = formatTimer(remaining);
        progressFill.style.width = `${(elapsed / (scanDuration * 1000)) * 100}%`;
        if (remaining <= 0) { completeScan(); return; }
    } else {
        timerValue.textContent = formatTimer(now - scanStartTime);
    }

    frameCount++;

    try {
        if (video.readyState < 2 || video.videoWidth === 0) {
            if (running) requestAnimationFrame(processFrame);
            return;
        }

        if (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) {
            overlay.width = video.videoWidth;
            overlay.height = video.videoHeight;
        }

        const detections = await faceapi
            .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.4 }))
            .withFaceLandmarks(true)
            .withFaceExpressions();

        if (currentMode === 'detection') {
            processDetectionFrame(detections, now);
        } else {
            processDeceptionFrame(detections, now);
        }

        drawRealtimeChart();
    } catch (err) {
        console.warn('Frame processing error:', err.message);
    }

    if (running) requestAnimationFrame(processFrame);
}

// ── Mode Selection ──
function showModeModal() {
    modeModal.classList.add('show');
}
function hideModeModal() {
    modeModal.classList.remove('show');
}
function showDurationModal() {
    const selectedBtn = document.querySelector('.duration-btn.selected');
    if (selectedBtn) scanDuration = parseInt(selectedBtn.dataset.duration);
    durationModal.classList.add('show');
}
function hideDurationModal() {
    durationModal.classList.remove('show');
}

document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        currentMode = btn.dataset.mode;
        hideModeModal();

        // If upload is pending, open file picker instead of starting live scan
        if (pendingUpload) {
            pendingUpload = false;
            threatEngine.setMode(currentMode);
            if (currentMode === 'detection') {
                scanDuration = 0;
                fileInput.click();
            } else {
                pendingUploadDeception = true;
                showDurationModal();
            }
            return;
        }

        if (currentMode === 'detection') {
            scanDuration = 0; // Always continuous
            threatEngine.setMode('detection');
            startScan();
        } else {
            threatEngine.setMode('deception');
            showDurationModal();
        }
    });
});

document.getElementById('backToMode').addEventListener('click', () => {
    hideDurationModal();
    showModeModal();
});

durationBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        durationBtns.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        scanDuration = parseInt(btn.dataset.duration);
    });
});

document.getElementById('confirmStart').addEventListener('click', () => {
    hideDurationModal();
    if (pendingUploadDeception) {
        pendingUploadDeception = false;
        fileInput.click();
    } else {
        startScan();
    }
});

// ── UI Setup per mode ──
function setupDetectionUI() {
    document.getElementById('detectionMetrics').style.display = 'grid';
    document.getElementById('deceptionMetrics').style.display = 'none';
    document.getElementById('deceptionIndicators').style.display = 'none';
    document.getElementById('formulaBox').style.display = 'block';
    modeBadge.style.display = 'inline-block';
    modeBadge.textContent = 'DETECTION';
    modeBadge.className = 'mode-badge detection';
}

function setupDeceptionUI() {
    document.getElementById('detectionMetrics').style.display = 'none';
    document.getElementById('deceptionMetrics').style.display = 'grid';
    document.getElementById('deceptionIndicators').style.display = 'block';
    document.getElementById('formulaBox').style.display = 'none';
    modeBadge.style.display = 'inline-block';
    modeBadge.textContent = 'DECEPTION INTERVIEW';
    modeBadge.className = 'mode-badge deception';
}

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
    deceptionEngine.clearAll();
    personTracker.clear();
    nextPersonId = 1;

    if (currentMode === 'detection') setupDetectionUI();
    else setupDeceptionUI();

    timerSection.style.display = 'block';
    if (scanDuration > 0) timerValue.textContent = formatTimer(scanDuration * 1000);
    else timerValue.textContent = '0:00';
    progressFill.style.width = '0%';

    btnStart.disabled = true;
    btnUpload.disabled = true;
    btnStop.disabled = false;
    resultsPanel.classList.remove('active');

    const label = currentMode === 'detection'
        ? 'Continuous detection scan running...'
        : (scanDuration > 0 ? `Deception interview: ${scanDuration}s...` : 'Continuous deception interview...');
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

    if (!video.paused) video.pause();
    if (video.src && video.src.startsWith('blob:')) {
        URL.revokeObjectURL(video.src);
        video.removeAttribute('src');
        video.load();
    }

    ctx.clearRect(0, 0, overlay.width, overlay.height);
    lastLandmarks = null;

    timerSection.style.display = 'none';
    btnStart.disabled = false;
    btnUpload.disabled = false;
    btnStop.disabled = true;

    let hasResults = true;
    if (currentMode === 'detection') {
        hasResults = completeDetectionScan();
    } else {
        completeDeceptionScan();
    }

    if (hasResults) {
        const elapsed = (performance.now() - scanStartTime) / 1000;
        document.getElementById('scanDurationDisplay').textContent = `${elapsed.toFixed(0)}s`;
        document.getElementById('scanFrames').textContent = frameCount;
        document.getElementById('scanType').textContent = currentMode === 'detection' ? 'Detection' : 'Deception Interview';

        resultsPanel.classList.add('active');
        setStatus('Analysis complete!', 'ready');
    }
}

function completeDetectionScan() {
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
        return false;
    }

    document.getElementById('scanPersons').textContent = threatResults.length;

    const neuroResults = [];
    threatResults.forEach(r => {
        const history = threatEngine.frameHistory.get(r.personId);
        if (history && history.length >= 10) {
            const nr = neuroAnalyzer.analyze(history, 30);
            nr.personId = r.personId;
            neuroResults.push(nr);
        }
    });

    document.getElementById('reportTitle').textContent = 'Detection & Threat Analysis Report';
    document.getElementById('reportSubtitle').textContent = 'Multi-Person Behavioral Screening Assessment';
    document.getElementById('threatResultsSection').style.display = 'block';
    document.getElementById('neuroSection').style.display = 'block';
    document.getElementById('deceptionResultsSection').style.display = 'none';

    renderDetectionResults(threatResults, neuroResults);
    return true;
}

function completeDeceptionScan() {
    const personId = 'SUBJECT';
    const deceptionResult = deceptionEngine.fullAnalysis(personId);
    const threatResult = threatEngine.fullAnalysis(personId);

    let neuroResult = null;
    const history = threatEngine.frameHistory.get(personId);
    if (history && history.length >= 10) {
        neuroResult = neuroAnalyzer.analyze(history, 30);
    }

    document.getElementById('scanPersons').textContent = '1';
    document.getElementById('reportTitle').textContent = 'Deception Interview Analysis Report';
    document.getElementById('reportSubtitle').textContent = 'Single-Subject Behavioral Deception Assessment';
    document.getElementById('threatResultsSection').style.display = 'none';
    document.getElementById('neuroSection').style.display = 'none';
    document.getElementById('deceptionResultsSection').style.display = 'block';

    renderDeceptionReport(deceptionResult, threatResult, neuroResult);
}

// ── Render Detection Results ──
function renderDetectionResults(threatResults, neuroResults) {
    let html = '';
    if (threatResults.length === 0) {
        html = '<div style="text-align:center;padding:20px;color:#888;">No persons detected during scan.</div>';
    } else {
        threatResults.sort((a, b) => b.threatScore - a.threatScore);
        threatResults.forEach(r => { html += buildThreatCard(r); });
    }
    document.getElementById('threatResultsSection').innerHTML = html;

    let neuroHtml = '';
    neuroResults.forEach(nr => { neuroHtml += buildNeuroSection(nr); });
    document.getElementById('neuroSection').innerHTML = neuroHtml;
}

function buildThreatCard(r) {
    const m = r.metrics;
    const indicators = r.indicators.map(ind => `<span class="ind-tag ${ind.color}">${ind.label}</span>`).join('');
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
        { label: 'Volatility', value: bio.expressionVolatility, unit: '%', status: bio.expressionVolatility > 55 ? 'alert' : (bio.expressionVolatility > 35 ? 'warn' : 'ok') },
        { label: 'Psychomotor', value: bio.psychomotorIndex, unit: 'idx', status: bio.psychomotorIndex < 30 ? 'alert' : (bio.psychomotorIndex > 70 ? 'warn' : 'ok') },
        { label: 'Gaze Stbl', value: bio.gazeStability, unit: '%', status: bio.gazeStability < 40 ? 'alert' : (bio.gazeStability < 60 ? 'warn' : 'ok') },
        { label: 'Affect Cong', value: bio.affectCongruence, unit: '%', status: bio.affectCongruence < 50 ? 'alert' : (bio.affectCongruence < 70 ? 'warn' : 'ok') },
        { label: 'Blink Reg', value: bio.blinkRegularity, unit: '%', status: bio.blinkRegularity < 40 ? 'warn' : 'ok' }
    ];

    let bioHtml = `<div class="neuro-section-title">${nr.personId} — Neuro-Psych Analysis</div><div class="bio-grid">`;
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
            <div class="cond-header"><span class="cond-name">${cond.condition}</span><span class="cond-badge ${cond.level}">${cond.level} ${cond.likelihood}%</span></div>
            <div class="cond-bar"><div class="cond-bar-fill ${cond.level}" style="width:${cond.likelihood}%"></div></div>
            <div class="cond-indicators">${inds}</div>
            <div class="cond-note">${cond.note}</div>
        </div>`;
    });

    return bioHtml + condHtml;
}

// ── Render Deception Report ──
function renderDeceptionReport(deception, threat, neuro) {
    const level = deception.deceptionProbability >= 70 ? 'high' : (deception.deceptionProbability >= 40 ? 'moderate' : 'low');

    let html = `
    <div class="deception-summary-card ${level}">
        <div class="deception-header">
            <div class="deception-title">SUBJECT — DECEPTION ASSESSMENT</div>
            <div class="deception-badge ${level}">${deception.overallAssessment}</div>
        </div>
        <div class="deception-score-display">
            <div class="score-ring"><div class="score-value">${deception.deceptionProbability}%</div><div class="score-label">Deception</div></div>
            <div class="score-ring"><div class="score-value">${deception.truthfulnessIndex}%</div><div class="score-label">Truthfulness</div></div>
            <div class="score-ring"><div class="score-value">${deception.cognitiveLoadAvg}%</div><div class="score-label">Cognitive Load</div></div>
            <div class="score-ring"><div class="score-value">${deception.confidenceLevel}%</div><div class="score-label">Confidence</div></div>
        </div>
    </div>`;

    // Deception Types
    html += '<div class="section-title">DECEPTION TYPE ANALYSIS</div>';
    html += buildDeceptionTypeCard('Falsification', deception.deceptionTypes.falsification, 'Creating untrue statements — constructing false narratives');
    html += buildDeceptionTypeCard('Concealment', deception.deceptionTypes.concealment, 'Hiding truth — withholding information deliberately');
    html += buildDeceptionTypeCard('Equivocation', deception.deceptionTypes.equivocation, 'Ambiguous/vague responses — avoiding direct answers');

    // Timeline
    if (deception.deceptionTimeline.length > 0) {
        html += '<div class="section-title">DECEPTION TIMELINE</div>';
        html += '<canvas id="deceptionTimelineChart" style="width:100%;height:120px;background:#1e2a3f;border-radius:8px;"></canvas>';
    }

    // Micro-Expression Log
    if (deception.microExpressions.length > 0) {
        html += '<div class="section-title">MICRO-EXPRESSION LOG</div><div class="micro-log">';
        deception.microExpressions.slice(-20).forEach(m => {
            const timeSec = m.frameIndex ? (m.frameIndex / 30).toFixed(1) : '?';
            html += `<div class="micro-item"><span class="micro-type">${m.type}</span><span class="micro-time">${timeSec}s</span><span class="micro-intensity" style="color:${m.intensity > 0.3 ? '#f44336' : '#ffc107'}">${Math.round(m.intensity * 100)}%</span></div>`;
        });
        html += '</div>';
    }

    // Blink Analysis
    const bl = deception.blinkAnalysis;
    html += `<div class="section-title">BLINK ANALYSIS</div>
    <div class="blink-card"><div class="blink-grid">
        <div class="blink-item"><div class="b-label">Rate</div><div class="b-val">${bl.rate}/min</div></div>
        <div class="blink-item"><div class="b-label">Total</div><div class="b-val">${bl.totalBlinks}</div></div>
        <div class="blink-item"><div class="b-label">Regularity</div><div class="b-val">${bl.regularity}%</div></div>
        <div class="blink-item"><div class="b-label">Suppression</div><div class="b-val" style="color:${bl.suppressionEvents > 0 ? '#f44336' : '#4caf50'}">${bl.suppressionEvents}</div></div>
        <div class="blink-item"><div class="b-label">Bursts</div><div class="b-val" style="color:${bl.burstEvents > 0 ? '#ff9800' : '#4caf50'}">${bl.burstEvents}</div></div>
        <div class="blink-item"><div class="b-label">Anomaly</div><div class="b-val" style="color:${bl.anomalyScore > 30 ? '#f44336' : '#4caf50'}">${bl.anomalyScore}%</div></div>
    </div></div>`;

    // Asymmetry
    const asym = deception.facialAsymmetry;
    html += `<div class="section-title">FACIAL ASYMMETRY</div>
    <div class="asymmetry-card"><div class="asym-grid">
        <div class="asym-item"><div class="a-label">Average</div><div class="a-val" style="color:${asym.avgAsymmetry > 25 ? '#f44336' : '#4caf50'}">${asym.avgAsymmetry}%</div></div>
        <div class="asym-item"><div class="a-label">Peak</div><div class="a-val" style="color:${asym.peakAsymmetry > 40 ? '#f44336' : '#ffc107'}">${asym.peakAsymmetry}%</div></div>
    </div></div>`;

    // Indicators
    if (deception.indicators.length > 0) {
        html += '<div class="section-title">BEHAVIORAL INDICATORS</div><div class="indicators-row">';
        deception.indicators.forEach(ind => {
            html += `<span class="ind-tag ${ind.color}">${ind.label}</span>`;
        });
        html += '</div>';
    }

    // Threat context
    if (threat && threat.framesAnalyzed > 3) {
        html += '<div class="section-title">THREAT CONTEXT</div>';
        html += buildThreatCard(threat);
    }

    // Neuro profile
    if (neuro) {
        html += '<div class="section-title">PSYCHOLOGICAL PROFILE</div>';
        html += buildNeuroSection(neuro);
    }

    document.getElementById('deceptionResultsSection').innerHTML = html;

    // Draw timeline chart after DOM insertion
    if (deception.deceptionTimeline.length > 0) {
        requestAnimationFrame(() => drawDeceptionTimelineChart(deception.deceptionTimeline));
    }
}

function buildDeceptionTypeCard(name, data, desc) {
    const active = data.score >= 30;
    let inds = '';
    data.indicators.forEach(ind => {
        inds += `<div class="dtype-ind"><span>${ind.marker}</span><span class="severity ${ind.severity}">${ind.severity.toUpperCase()}</span></div>`;
    });
    return `
    <div class="dtype-card ${active ? 'active' : ''}">
        <div class="dtype-header"><span class="dtype-name">${name}</span><span class="dtype-score">${data.score}%</span></div>
        <div class="dtype-desc">${desc}</div>
        <div class="m-bar"><div class="m-bar-fill deception" style="width:${data.score}%"></div></div>
        ${inds ? '<div class="dtype-indicators">' + inds + '</div>' : ''}
    </div>`;
}

function drawDeceptionTimelineChart(timeline) {
    const canvas = document.getElementById('deceptionTimelineChart');
    if (!canvas) return;
    const c = canvas.getContext('2d');
    const w = canvas.width = canvas.clientWidth * 2;
    const h = canvas.height = 240;
    c.clearRect(0, 0, w, h);

    if (timeline.length < 2) return;

    const maxScore = Math.max(...timeline.map(t => t.score), 50);

    // Threshold lines
    [30, 50, 70].forEach(threshold => {
        const y = h - (threshold / maxScore) * (h - 30) - 15;
        c.strokeStyle = 'rgba(255,255,255,0.1)';
        c.setLineDash([4, 4]);
        c.beginPath(); c.moveTo(40, y); c.lineTo(w - 10, y); c.stroke();
        c.setLineDash([]);
        c.fillStyle = '#555';
        c.font = '10px system-ui';
        c.fillText(threshold + '%', 4, y + 3);
    });

    // Fill gradient
    const gradient = c.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, 'rgba(224, 64, 251, 0.3)');
    gradient.addColorStop(1, 'rgba(224, 64, 251, 0)');
    c.fillStyle = gradient;
    c.beginPath();
    c.moveTo(40, h - 15);
    timeline.forEach((t, i) => {
        const x = 40 + (i / (timeline.length - 1)) * (w - 50);
        const y = h - (t.score / maxScore) * (h - 30) - 15;
        c.lineTo(x, y);
    });
    c.lineTo(w - 10, h - 15);
    c.closePath();
    c.fill();

    // Line
    c.strokeStyle = '#e040fb';
    c.lineWidth = 2;
    c.beginPath();
    timeline.forEach((t, i) => {
        const x = 40 + (i / (timeline.length - 1)) * (w - 50);
        const y = h - (t.score / maxScore) * (h - 30) - 15;
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    });
    c.stroke();

    // Points with micro-expression markers
    timeline.forEach((t, i) => {
        const x = 40 + (i / (timeline.length - 1)) * (w - 50);
        const y = h - (t.score / maxScore) * (h - 30) - 15;
        c.fillStyle = t.score >= 70 ? '#f44336' : (t.score >= 50 ? '#ff9800' : (t.score >= 30 ? '#ffc107' : '#e040fb'));
        c.beginPath(); c.arc(x, y, 3, 0, Math.PI * 2); c.fill();

        if (t.microExpressions > 0) {
            c.fillStyle = '#e040fb';
            c.beginPath(); c.arc(x, y - 10, 4, 0, Math.PI * 2); c.fill();
            c.fillStyle = '#fff';
            c.font = 'bold 6px system-ui';
            c.fillText('M', x - 3, y - 8);
        }
    });

    // X-axis time labels
    c.fillStyle = '#666';
    c.font = '10px system-ui';
    timeline.forEach((t, i) => {
        if (i % Math.max(1, Math.floor(timeline.length / 6)) === 0) {
            const x = 40 + (i / (timeline.length - 1)) * (w - 50);
            c.fillText(t.timeSeconds + 's', x - 6, h - 2);
        }
    });
}

// ── Video Upload ──
btnUpload.addEventListener('click', () => {
    if (!currentMode) {
        pendingUpload = true;
        showModeModal();
    } else {
        fileInput.click();
    }
});

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
    }
    video.srcObject = null;

    scanType = 'Upload';
    setStatus('Loading video...', 'loading');

    // If no mode selected yet, show mode modal and wait
    if (!currentMode) {
        fileInput.value = '';
        showModeModal();
        return;
    }

    const url = URL.createObjectURL(file);
    video.src = url;
    video.muted = true;

    video.onloadedmetadata = async () => {
        overlay.width = video.videoWidth || 640;
        overlay.height = video.videoHeight || 480;

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
        deceptionEngine.clearAll();
        personTracker.clear();
        nextPersonId = 1;

        if (currentMode === 'detection') setupDetectionUI();
        else setupDeceptionUI();

        timerSection.style.display = 'block';
        btnStart.disabled = true;
        btnUpload.disabled = true;
        btnStop.disabled = false;
        resultsPanel.classList.remove('active');

        setStatus(`Analyzing video (${currentMode})...`, 'scanning');
        try { await video.play(); } catch (playErr) {
            console.warn('Video play failed:', playErr);
            await new Promise(r => setTimeout(r, 300));
            try { await video.play(); } catch (e) {
                setStatus('Could not play video file.', 'error');
                running = false;
                btnStart.disabled = false;
                btnUpload.disabled = false;
                btnStop.disabled = true;
                return;
            }
        }
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

    // Auto-stop for deception mode with a set duration
    if (scanDuration > 0 && elapsed >= scanDuration * 1000) {
        completeScan();
        return;
    }

    if (scanDuration > 0) {
        const remaining = scanDuration - elapsed / 1000;
        timerValue.textContent = formatTimer(remaining * 1000);
        progressFill.style.width = ((elapsed / 1000) / scanDuration * 100) + '%';
    } else {
        timerValue.textContent = formatTimer(elapsed);
    }
    frameCount++;

    try {
        if (video.readyState < 2 || video.videoWidth === 0) {
            if (running) requestAnimationFrame(processVideoFrame);
            return;
        }

        if (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) {
            overlay.width = video.videoWidth;
            overlay.height = video.videoHeight;
        }

        const detections = await faceapi
            .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.4 }))
            .withFaceLandmarks(true)
            .withFaceExpressions();

        if (currentMode === 'detection') {
            processDetectionFrame(detections, now);
        } else {
            processDeceptionFrame(detections, now);
        }

        drawRealtimeChart();
    } catch (err) {
        console.warn('Video frame error:', err.message);
    }

    if (running) requestAnimationFrame(processVideoFrame);
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
    if (file && (file.type.startsWith('video/') || file.type.startsWith('image/'))) {
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
            facingMode = facingMode === 'user' ? 'environment' : 'user';
            await startCamera();
        }
    }
});

// ── Event Listeners ──
btnStart.addEventListener('click', showModeModal);
btnStop.addEventListener('click', stopScan);
document.getElementById('btnNewScan').addEventListener('click', () => {
    resultsPanel.classList.remove('active');
    // Reset mode-specific UI
    document.getElementById('deceptionMetrics').style.display = 'none';
    document.getElementById('deceptionIndicators').style.display = 'none';
    document.getElementById('detectionMetrics').style.display = 'grid';
    document.getElementById('formulaBox').style.display = 'block';
    modeBadge.style.display = 'none';
    personsDetectedEl.style.display = 'none';
    currentMode = null;
    showModeModal();
});

// ── Init ──
loadModels();
