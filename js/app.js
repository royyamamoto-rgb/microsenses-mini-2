/* ============================================
   APP.JS - Main Application Controller
   Microsenses MINI 2 - Behavioral Vibration Analysis
   ============================================ */

(async function () {
    'use strict';

    // ── DOM Elements ──
    const $ = id => document.getElementById(id);
    const loadingScreen = $('loading-screen');
    const app = $('app');
    const loaderFill = $('loader-fill');
    const loaderStatus = $('loader-status');

    // Camera view
    const cameraView = $('camera-view');
    const cameraFeed = $('camera-feed');
    const overlayCanvas = $('overlay-canvas');
    const scanProgress = $('scan-progress');
    const progressFill = $('progress-fill');
    const progressText = $('progress-text');
    const scanResultsOverlay = $('scan-results');
    const btnFlip = $('btn-flip');
    const btnScan = $('btn-scan');
    const btnVideoUpload = $('btn-video-upload');
    const videoInput = $('video-input');

    // Video view
    const videoView = $('video-view');
    const videoPlayer = $('video-player');
    const videoOverlayCanvas = $('video-overlay-canvas');
    const videoScanResults = $('video-scan-results');
    const btnVideoBack = $('btn-video-back');
    const btnVideoPlay = $('btn-video-play');
    const btnVideoScan = $('btn-video-scan');
    const videoScrubber = $('video-scrubber');
    const videoTime = $('video-time');
    const videoDuration = $('video-duration');

    // Results panel
    const resultsPanel = $('results-panel');
    const panelBody = $('panel-body');
    const scanTimestamp = $('scan-timestamp');
    const btnClosePanel = $('btn-close-panel');

    // Settings
    const settingsModal = $('settings-modal');
    const btnSettings = $('btn-settings');
    const btnCloseSettings = $('btn-close-settings');
    const btnModeToggle = $('btn-mode-toggle');
    const scanDurationInput = $('scan-duration');
    const scanDurationLabel = $('scan-duration-label');
    const sensitivityInput = $('sensitivity');
    const sensitivityLabel = $('sensitivity-label');
    const showScoresInput = $('show-scores');
    const showLandmarksInput = $('show-landmarks');
    const vibrationInput = $('vibration-feedback');
    const audioInput = $('audio-alerts');
    const thresholdCaution = $('threshold-caution');
    const thresholdElevated = $('threshold-elevated');
    const thresholdCritical = $('threshold-critical');

    // Neuro panel
    const neuroPanel = $('neuro-panel');
    const neuroBody = $('neuro-body');
    const neuroBiometrics = $('neuro-biometrics');
    const neuroConditions = $('neuro-conditions');
    const neuroDisclaimer = $('neuro-disclaimer');
    const neuroTimestamp = $('neuro-timestamp');
    const btnCloseNeuro = $('btn-close-neuro');

    // ── Initialize Modules ──
    const threatEngine = new ThreatEngine();
    const camera = new CameraManager(cameraFeed);
    const scanner = new Scanner(cameraFeed, overlayCanvas, threatEngine);
    const videoAnalyzer = new VideoAnalyzer(videoPlayer, videoOverlayCanvas, threatEngine);
    const neuroAnalyzer = new NeuroAnalyzer();

    const circumference = 2 * Math.PI * 54; // progress ring circumference

    // ── Load Models ──
    async function loadModels() {
        const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';

        const steps = [
            { label: 'Loading face detector...', weight: 25, fn: () => faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL) },
            { label: 'Loading landmark model...', weight: 25, fn: () => faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL) },
            { label: 'Loading expression model...', weight: 25, fn: () => faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL) },
            { label: 'Starting camera...', weight: 25, fn: () => camera.start() }
        ];

        let progress = 0;
        for (const step of steps) {
            loaderStatus.textContent = step.label;
            try {
                await step.fn();
            } catch (err) {
                console.error(`Failed: ${step.label}`, err);
                loaderStatus.textContent = `Error: ${step.label} - ${err.message}`;
                // Continue anyway for models, but camera failure needs notice
                if (step.label.includes('camera')) {
                    loaderStatus.textContent = 'Camera access denied. Please allow camera access and reload.';
                    return false;
                }
            }
            progress += step.weight;
            loaderFill.style.width = `${progress}%`;
        }

        return true;
    }

    // ── App Init ──
    const loaded = await loadModels();

    if (loaded) {
        setTimeout(() => {
            loadingScreen.classList.add('hidden');
            app.classList.remove('hidden');
            scanner.startDetection();
        }, 500);
    }

    // ── Camera Controls ──
    btnFlip.addEventListener('click', async () => {
        scanner.stopDetection();
        await camera.flip();
        scanner.startDetection();
        vibrate(30);
    });

    // ── Scan Button ──
    let scanning = false;

    btnScan.addEventListener('click', () => {
        if (scanning) {
            // Force stop scan
            scanner.stopScan();
            endScanUI();
            return;
        }

        scanning = true;
        btnScan.classList.add('scanning');
        scanProgress.classList.remove('hidden');
        scanResultsOverlay.classList.add('hidden');
        resultsPanel.classList.add('hidden');
        vibrate(50);

        scanner.startScan();
    });

    scanner.onScanProgress = (progress) => {
        const offset = circumference - (progress * circumference);
        progressFill.style.strokeDashoffset = offset;
        progressText.textContent = `${Math.round(progress * 100)}%`;
    };

    scanner.onScanComplete = (results) => {
        endScanUI();
        vibrate([100, 50, 100]);
        displayResults(results);
        // Trigger neuro-psych analysis for each detected person
        runNeuroAnalysis(results);
    };

    function endScanUI() {
        scanning = false;
        btnScan.classList.remove('scanning');
        scanProgress.classList.add('hidden');
        progressFill.style.strokeDashoffset = circumference;
        progressText.textContent = '0%';
    }

    // ── Display Results ──
    function displayResults(results) {
        if (results.length === 0) {
            scanResultsOverlay.innerHTML = '<div class="result-summary"><div class="person-chip safe"><div class="chip-label">NO FACES</div><div class="chip-threat">N/A</div><div class="chip-detail">No persons detected in frame</div></div></div>';
            scanResultsOverlay.classList.remove('hidden');
            return;
        }

        // Sort by threat score descending
        results.sort((a, b) => b.threatScore - a.threatScore);

        // Overlay summary chips
        let chipsHtml = '<div class="result-summary">';
        results.forEach(r => {
            chipsHtml += `
                <div class="person-chip ${r.threatLevel}" data-person="${r.personId}">
                    <div class="chip-label">${r.personId}</div>
                    <div class="chip-threat">${r.threatScore}%</div>
                    <div class="chip-detail">${r.threatLevel.toUpperCase()} | ${r.dominantExpression}</div>
                </div>`;
        });
        chipsHtml += '</div>';
        scanResultsOverlay.innerHTML = chipsHtml;
        scanResultsOverlay.classList.remove('hidden');

        // Full results panel
        const now = new Date();
        scanTimestamp.textContent = `${now.toLocaleTimeString()}`;

        let panelHtml = '';
        results.forEach(r => {
            panelHtml += buildPersonCard(r);
        });
        panelBody.innerHTML = panelHtml;
        resultsPanel.classList.remove('hidden');

        // Chip click -> scroll to card
        document.querySelectorAll('.person-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const personId = chip.dataset.person;
                const card = document.querySelector(`.person-card[data-person="${personId}"]`);
                if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
        });
    }

    function buildPersonCard(r) {
        const m = r.metrics;
        let indicatorsHtml = r.indicators.map(ind =>
            `<span class="indicator-tag ${ind.color}">${ind.label}</span>`
        ).join('');

        return `
        <div class="person-card ${r.threatLevel}" data-person="${r.personId}">
            <div class="person-card-header">
                <span class="person-id">${r.personId} | ${r.dominantExpression}</span>
                <span class="threat-badge ${r.threatLevel}">${r.threatLevel.toUpperCase()} ${r.threatScore}%</span>
            </div>
            <div class="metrics-grid">
                <div class="metric">
                    <div class="metric-label">AGGRESSION</div>
                    <div class="metric-bar"><div class="metric-bar-fill aggression" style="width:${m.aggression}%"></div></div>
                    <div class="metric-value">${m.aggression}%</div>
                </div>
                <div class="metric">
                    <div class="metric-label">STRESS</div>
                    <div class="metric-bar"><div class="metric-bar-fill stress" style="width:${m.stress}%"></div></div>
                    <div class="metric-value">${m.stress}%</div>
                </div>
                <div class="metric">
                    <div class="metric-label">DECEPTION</div>
                    <div class="metric-bar"><div class="metric-bar-fill deception" style="width:${m.deception}%"></div></div>
                    <div class="metric-value">${m.deception}%</div>
                </div>
                <div class="metric">
                    <div class="metric-label">TENSION</div>
                    <div class="metric-bar"><div class="metric-bar-fill tension" style="width:${m.tension}%"></div></div>
                    <div class="metric-value">${m.tension}%</div>
                </div>
                <div class="metric">
                    <div class="metric-label">BAD INTENT</div>
                    <div class="metric-bar"><div class="metric-bar-fill intent" style="width:${m.badIntent}%"></div></div>
                    <div class="metric-value">${m.badIntent}%</div>
                </div>
                <div class="metric">
                    <div class="metric-label">STABILITY</div>
                    <div class="metric-bar"><div class="metric-bar-fill stability" style="width:${m.stability}%"></div></div>
                    <div class="metric-value">${m.stability}%</div>
                </div>
            </div>
            <div class="indicators-row">${indicatorsHtml}</div>
            <div style="margin-top:0.5rem;font-size:0.55rem;color:#555;letter-spacing:1px;">
                ${r.framesAnalyzed} FRAMES | ${r.confidence}% CONFIDENCE
            </div>
        </div>`;
    }

    // ── Neuro-Psych Analysis ──
    function runNeuroAnalysis(scanResults) {
        if (!scanResults || scanResults.length === 0) return;

        const fps = camera.getActualFrameRate() || 30;
        const allNeuroResults = [];

        scanResults.forEach(r => {
            const history = threatEngine.frameHistory.get(r.personId);
            if (history && history.length >= 10) {
                const neuroResult = neuroAnalyzer.analyze(history, fps);
                neuroResult.personId = r.personId;
                neuroResult.threatLevel = r.threatLevel;
                allNeuroResults.push(neuroResult);
            }
        });

        if (allNeuroResults.length > 0) {
            displayNeuroResults(allNeuroResults);
        }
    }

    function displayNeuroResults(neuroResults) {
        neuroTimestamp.textContent = new Date().toLocaleTimeString();

        let html = '';
        neuroResults.forEach(nr => {
            html += buildNeuroSection(nr);
        });

        neuroBody.innerHTML = html;
        neuroPanel.classList.remove('hidden');
    }

    function buildNeuroSection(nr) {
        const bio = nr.biometrics;

        // Biometrics grid
        const bioItems = [
            { label: 'BLINK RATE', value: bio.blinkRate, unit: 'blinks/min', status: bio.blinkRate < 13 ? (bio.blinkRate < 8 ? 'critical' : 'warning') : (bio.blinkRate > 28 ? 'warning' : 'normal') },
            { label: 'EXPR RANGE', value: bio.expressionRange, unit: '% range', status: bio.expressionRange < 20 ? 'alert' : (bio.expressionRange < 35 ? 'warning' : 'normal') },
            { label: 'TREMOR', value: bio.microTremorScore, unit: 'score', status: bio.microTremorScore > 30 ? 'critical' : (bio.microTremorScore > 15 ? 'warning' : 'normal') },
            { label: 'TREMOR FREQ', value: bio.tremorFreqEstimate, unit: 'Hz', status: (bio.tremorFreqEstimate >= 3.5 && bio.tremorFreqEstimate <= 6.5 && bio.microTremorScore > 10) ? 'alert' : 'normal' },
            { label: 'VOLATILITY', value: bio.expressionVolatility, unit: '%', status: bio.expressionVolatility > 55 ? 'alert' : (bio.expressionVolatility > 35 ? 'warning' : 'normal') },
            { label: 'PSYCHOMOTOR', value: bio.psychomotorIndex, unit: 'index', status: bio.psychomotorIndex < 30 ? 'alert' : (bio.psychomotorIndex > 70 ? 'warning' : 'normal') },
            { label: 'GAZE STBL', value: bio.gazeStability, unit: '%', status: bio.gazeStability < 40 ? 'alert' : (bio.gazeStability < 60 ? 'warning' : 'normal') },
            { label: 'AFFECT CONG', value: bio.affectCongruence, unit: '%', status: bio.affectCongruence < 50 ? 'alert' : (bio.affectCongruence < 70 ? 'warning' : 'normal') },
            { label: 'BLINK REG', value: bio.blinkRegularity, unit: '%', status: bio.blinkRegularity < 40 ? 'warning' : 'normal' }
        ];

        let bioHtml = `<div class="neuro-section-header" style="font-size:0.7rem;font-weight:700;letter-spacing:2px;color:var(--accent);margin-bottom:0.75rem;text-transform:uppercase;">${nr.personId} — NEURO-PSYCH ANALYSIS</div>`;
        bioHtml += '<div class="neuro-biometrics">';
        bioItems.forEach(item => {
            bioHtml += `
                <div class="bio-stat">
                    <div class="bio-stat-label">${item.label}</div>
                    <div class="bio-stat-value ${item.status}">${item.value}</div>
                    <div class="bio-stat-unit">${item.unit}</div>
                </div>`;
        });
        bioHtml += '</div>';

        // Condition cards
        let condHtml = '<div class="neuro-conditions">';
        nr.conditions.forEach(cond => {
            if (cond.indicators.length === 0 && cond.likelihood < 10) return;

            let indicatorsHtml = '';
            cond.indicators.forEach(ind => {
                indicatorsHtml += `
                    <div class="condition-indicator">
                        <span class="indicator-marker">${ind.marker}</span>
                        <span class="indicator-value ${ind.severity}">${ind.value}</span>
                    </div>`;
            });

            condHtml += `
                <div class="condition-card ${cond.level}">
                    <div class="condition-category">${cond.category}</div>
                    <div class="condition-header">
                        <span class="condition-name">${cond.condition}</span>
                        <span class="condition-badge ${cond.level}">${cond.level} ${cond.likelihood}%</span>
                    </div>
                    <div class="condition-likelihood-bar">
                        <div class="condition-likelihood-fill ${cond.level}" style="width:${cond.likelihood}%"></div>
                    </div>
                    <div class="condition-indicators">${indicatorsHtml}</div>
                    <div class="condition-note">${cond.note}</div>
                </div>`;
        });
        condHtml += '</div>';

        // Disclaimer
        const disclaimerHtml = `<div class="neuro-disclaimer">${nr.disclaimer}</div>`;

        // Scan info
        const infoHtml = `<div style="margin-top:0.5rem;font-size:0.55rem;color:#555;letter-spacing:1px;text-align:center;">${nr.framesAnalyzed} FRAMES ANALYZED | ${nr.fps} FPS | ${nr.scanDuration.toFixed(1)}s DURATION</div>`;

        return bioHtml + condHtml + disclaimerHtml + infoHtml + '<div style="height:1rem;border-bottom:1px solid var(--border);margin-bottom:1rem;"></div>';
    }

    function runNeuroAnalysisForVideo(videoResults) {
        if (!videoResults || videoResults.length === 0) return;

        const fps = 30; // video analysis uses requestAnimationFrame
        const allNeuroResults = [];

        videoResults.forEach(r => {
            const history = threatEngine.frameHistory.get(r.personId);
            if (history && history.length >= 10) {
                const neuroResult = neuroAnalyzer.analyze(history, fps);
                neuroResult.personId = r.personId;
                neuroResult.threatLevel = r.threatLevel;
                allNeuroResults.push(neuroResult);
            }
        });

        if (allNeuroResults.length > 0) {
            displayNeuroResults(allNeuroResults);
        }
    }

    btnCloseNeuro.addEventListener('click', () => {
        neuroPanel.classList.add('hidden');
    });

    // ── Video Upload ──
    btnVideoUpload.addEventListener('click', () => {
        videoInput.click();
    });

    videoInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        scanner.stopDetection();

        try {
            const info = await videoAnalyzer.loadVideo(file);
            videoDuration.textContent = formatTime(info.duration);
            videoTime.textContent = '0:00';
            videoScrubber.value = 0;

            // Switch to video view
            cameraView.classList.remove('active');
            videoView.classList.add('active');
        } catch (err) {
            alert('Failed to load video: ' + err.message);
        }

        videoInput.value = '';
    });

    // ── Video Controls ──
    btnVideoBack.addEventListener('click', () => {
        videoAnalyzer.stopAnalysis();
        videoView.classList.remove('active');
        cameraView.classList.add('active');
        videoScanResults.classList.add('hidden');
        resultsPanel.classList.add('hidden');
        scanner.startDetection();
    });

    btnVideoPlay.addEventListener('click', async () => {
        videoScanResults.classList.add('hidden');
        resultsPanel.classList.add('hidden');
        await videoAnalyzer.startAnalysis();
    });

    videoAnalyzer.onAnalysisUpdate = (results, currentTime) => {
        if (videoPlayer.duration) {
            videoScrubber.value = (currentTime / videoPlayer.duration) * 100;
            videoTime.textContent = formatTime(currentTime);
        }
    };

    videoAnalyzer.onAnalysisComplete = (results) => {
        displayVideoResults(results);
        runNeuroAnalysisForVideo(results);
    };

    btnVideoScan.addEventListener('click', async () => {
        videoPlayer.pause();
        const results = await videoAnalyzer.analyzeCurrentFrame();
        displayVideoResults(results);
        runNeuroAnalysisForVideo(results);
    });

    videoScrubber.addEventListener('input', () => {
        const time = (videoScrubber.value / 100) * videoPlayer.duration;
        videoAnalyzer.seek(time);
        videoTime.textContent = formatTime(time);
    });

    videoPlayer.addEventListener('timeupdate', () => {
        if (!videoPlayer.paused && videoPlayer.duration) {
            videoScrubber.value = (videoPlayer.currentTime / videoPlayer.duration) * 100;
            videoTime.textContent = formatTime(videoPlayer.currentTime);
        }
    });

    function displayVideoResults(results) {
        if (results.length === 0) {
            videoScanResults.innerHTML = '<div class="result-summary"><div class="person-chip safe"><div class="chip-label">NO FACES</div><div class="chip-threat">N/A</div></div></div>';
            videoScanResults.classList.remove('hidden');
            return;
        }

        results.sort((a, b) => b.threatScore - a.threatScore);

        let chipsHtml = '<div class="result-summary">';
        results.forEach(r => {
            chipsHtml += `
                <div class="person-chip ${r.threatLevel}" data-person="${r.personId}">
                    <div class="chip-label">${r.personId}</div>
                    <div class="chip-threat">${r.threatScore}%</div>
                    <div class="chip-detail">${r.threatLevel.toUpperCase()}</div>
                </div>`;
        });
        chipsHtml += '</div>';
        videoScanResults.innerHTML = chipsHtml;
        videoScanResults.classList.remove('hidden');

        const now = new Date();
        scanTimestamp.textContent = `${now.toLocaleTimeString()}`;
        let panelHtml = '';
        results.forEach(r => { panelHtml += buildPersonCard(r); });
        panelBody.innerHTML = panelHtml;
        resultsPanel.classList.remove('hidden');
    }

    // ── Results Panel ──
    btnClosePanel.addEventListener('click', () => {
        resultsPanel.classList.add('hidden');
    });

    // ── Settings ──
    btnSettings.addEventListener('click', () => {
        settingsModal.classList.remove('hidden');
    });

    btnCloseSettings.addEventListener('click', () => {
        settingsModal.classList.add('hidden');
    });

    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) settingsModal.classList.add('hidden');
    });

    scanDurationInput.addEventListener('input', () => {
        const val = scanDurationInput.value;
        scanDurationLabel.textContent = `${val}s`;
        scanner.setOptions({ scanDuration: parseInt(val) });
    });

    sensitivityInput.addEventListener('input', () => {
        const val = sensitivityInput.value;
        sensitivityLabel.textContent = val;
        threatEngine.setSensitivity(parseInt(val));
    });

    showScoresInput.addEventListener('change', () => {
        scanner.setOptions({ showScores: showScoresInput.checked });
    });

    showLandmarksInput.addEventListener('change', () => {
        scanner.setOptions({ showLandmarks: showLandmarksInput.checked });
    });

    [thresholdCaution, thresholdElevated, thresholdCritical].forEach(input => {
        input.addEventListener('change', () => {
            threatEngine.setThresholds(
                parseInt(thresholdCaution.value),
                parseInt(thresholdElevated.value),
                parseInt(thresholdCritical.value)
            );
        });
    });

    // Mode toggle (placeholder for future multi-mode)
    btnModeToggle.addEventListener('click', () => {
        vibrate(20);
    });

    // ── Utility ──
    function vibrate(pattern) {
        if (vibrationInput.checked && navigator.vibrate) {
            navigator.vibrate(pattern);
        }
    }

    function formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

})();
