/* ============================================
   SCANNER MODULE - Real-time face detection
   and behavioral scanning with overlay rendering
   ============================================ */

class Scanner {
    constructor(videoElement, canvas, threatEngine) {
        this.video = videoElement;
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.threatEngine = threatEngine;
        this.isDetecting = false;
        this.isScanning = false;
        this.scanStartTime = null;
        this.scanDuration = 3000; // ms
        this.detectionInterval = null;
        this.personTracker = new Map(); // track persons across frames
        this.nextPersonId = 1;
        this.scanResults = [];
        this.showScores = true;
        this.showLandmarks = false;
        this.onScanProgress = null;
        this.onScanComplete = null;
        this.onDetection = null;
    }

    setOptions(opts) {
        if (opts.scanDuration !== undefined) this.scanDuration = opts.scanDuration * 1000;
        if (opts.showScores !== undefined) this.showScores = opts.showScores;
        if (opts.showLandmarks !== undefined) this.showLandmarks = opts.showLandmarks;
    }

    /**
     * Start continuous face detection (passive - no scan)
     */
    startDetection() {
        if (this.isDetecting) return;
        this.isDetecting = true;
        this._detectLoop();
    }

    stopDetection() {
        this.isDetecting = false;
        if (this.detectionInterval) {
            cancelAnimationFrame(this.detectionInterval);
            this.detectionInterval = null;
        }
        this._clearCanvas();
    }

    /**
     * Start a timed behavioral scan (3-5 seconds)
     */
    startScan() {
        if (this.isScanning) return;

        this.isScanning = true;
        this.scanStartTime = Date.now();
        this.threatEngine.clearAll();
        this.personTracker.clear();
        this.nextPersonId = 1;
        this.scanResults = [];

        // Ensure detection is running
        if (!this.isDetecting) {
            this.startDetection();
        }
    }

    stopScan() {
        if (!this.isScanning) return;

        this.isScanning = false;

        // Generate final results for all tracked persons
        const results = [];
        this.personTracker.forEach((data, id) => {
            const analysis = this.threatEngine.fullAnalysis(id);
            if (analysis.framesAnalyzed >= 5) {
                analysis.box = data.lastBox;
                results.push(analysis);
            }
        });

        this.scanResults = results;

        if (this.onScanComplete) {
            this.onScanComplete(results);
        }

        return results;
    }

    /**
     * Scan a single frame (for video analysis)
     */
    async scanFrame(source) {
        const video = source || this.video;
        this._syncCanvasSize(video);

        try {
            const detections = await faceapi
                .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.4 }))
                .withFaceLandmarks()
                .withFaceExpressions();

            this._drawDetections(detections, video);
            return detections;
        } catch (err) {
            console.error('Frame scan error:', err);
            return [];
        }
    }

    // ── Private Methods ──

    async _detectLoop() {
        if (!this.isDetecting) return;

        try {
            this._syncCanvasSize(this.video);

            const detections = await faceapi
                .detectAllFaces(this.video, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.4 }))
                .withFaceLandmarks()
                .withFaceExpressions();

            if (this.onDetection) {
                this.onDetection(detections);
            }

            // Track persons and process through threat engine
            if (this.isScanning && detections.length > 0) {
                this._trackPersons(detections);
                this._updateScanProgress();
            }

            this._drawDetections(detections, this.video);

        } catch (err) {
            // Silently handle detection errors during continuous loop
        }

        if (this.isDetecting) {
            this.detectionInterval = requestAnimationFrame(() => this._detectLoop());
        }
    }

    _syncCanvasSize(source) {
        const displayWidth = source.clientWidth || source.videoWidth;
        const displayHeight = source.clientHeight || source.videoHeight;

        if (this.canvas.width !== displayWidth || this.canvas.height !== displayHeight) {
            this.canvas.width = displayWidth;
            this.canvas.height = displayHeight;
        }
    }

    _trackPersons(detections) {
        // Simple tracking: match detections to known persons by proximity
        const unmatched = [...detections];

        this.personTracker.forEach((data, personId) => {
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
                this.threatEngine.processFrame(personId, det);
            }
        });

        // Create new person entries for unmatched detections
        unmatched.forEach(det => {
            const personId = `P${this.nextPersonId++}`;
            this.personTracker.set(personId, {
                lastBox: det.detection.box,
                lastSeen: Date.now()
            });
            this.threatEngine.processFrame(personId, det);
        });

        // Remove stale persons (not seen for 2 seconds)
        const now = Date.now();
        this.personTracker.forEach((data, personId) => {
            if (now - data.lastSeen > 2000) {
                this.personTracker.delete(personId);
                this.threatEngine.clearPerson(personId);
            }
        });
    }

    _updateScanProgress() {
        if (!this.isScanning || !this.scanStartTime) return;

        const elapsed = Date.now() - this.scanStartTime;
        const progress = Math.min(1, elapsed / this.scanDuration);

        if (this.onScanProgress) {
            this.onScanProgress(progress);
        }

        if (progress >= 1) {
            this.stopScan();
        }
    }

    _drawDetections(detections, source) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        const scaleX = this.canvas.width / (source.videoWidth || source.width);
        const scaleY = this.canvas.height / (source.videoHeight || source.height);

        detections.forEach((det, idx) => {
            const box = det.detection.box;
            const x = box.x * scaleX;
            const y = box.y * scaleY;
            const w = box.width * scaleX;
            const h = box.height * scaleY;

            // Determine color based on threat assessment
            let color = '#00e676'; // safe green
            let personId = null;
            let quickScore = 0;

            // Find tracked person for this detection
            this.personTracker.forEach((data, pid) => {
                const pcx = data.lastBox.x * scaleX + (data.lastBox.width * scaleX) / 2;
                const pcy = data.lastBox.y * scaleY + (data.lastBox.height * scaleY) / 2;
                const dcx = x + w / 2;
                const dcy = y + h / 2;
                const dist = Math.sqrt((pcx - dcx) ** 2 + (pcy - dcy) ** 2);
                if (dist < 50) {
                    personId = pid;
                }
            });

            if (personId && this.isScanning) {
                const assessment = this.threatEngine._quickAssess(personId);
                quickScore = assessment.score;
                if (assessment.level === 'critical') color = '#ff1744';
                else if (assessment.level === 'elevated') color = '#ff9100';
                else if (assessment.level === 'caution') color = '#ffc107';
            }

            // Draw bounding box with corner brackets
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = 2;
            const cornerLen = Math.min(w, h) * 0.2;

            // Top-left
            this.ctx.beginPath();
            this.ctx.moveTo(x, y + cornerLen);
            this.ctx.lineTo(x, y);
            this.ctx.lineTo(x + cornerLen, y);
            this.ctx.stroke();

            // Top-right
            this.ctx.beginPath();
            this.ctx.moveTo(x + w - cornerLen, y);
            this.ctx.lineTo(x + w, y);
            this.ctx.lineTo(x + w, y + cornerLen);
            this.ctx.stroke();

            // Bottom-left
            this.ctx.beginPath();
            this.ctx.moveTo(x, y + h - cornerLen);
            this.ctx.lineTo(x, y + h);
            this.ctx.lineTo(x + cornerLen, y + h);
            this.ctx.stroke();

            // Bottom-right
            this.ctx.beginPath();
            this.ctx.moveTo(x + w - cornerLen, y + h);
            this.ctx.lineTo(x + w, y + h);
            this.ctx.lineTo(x + w, y + h - cornerLen);
            this.ctx.stroke();

            // Person label
            if (personId) {
                this.ctx.fillStyle = color;
                this.ctx.font = 'bold 11px -apple-system, sans-serif';
                this.ctx.fillText(personId, x + 4, y - 6);

                if (this.showScores && this.isScanning && quickScore > 0) {
                    const scoreText = `${quickScore}%`;
                    this.ctx.fillStyle = 'rgba(0,0,0,0.6)';
                    const textWidth = this.ctx.measureText(scoreText).width;
                    this.ctx.fillRect(x + w - textWidth - 10, y - 20, textWidth + 8, 18);
                    this.ctx.fillStyle = color;
                    this.ctx.fillText(scoreText, x + w - textWidth - 6, y - 6);
                }
            }

            // Draw landmarks if enabled
            if (this.showLandmarks && det.landmarks) {
                const positions = det.landmarks.positions || det.landmarks._positions || [];
                this.ctx.fillStyle = `${color}88`;
                positions.forEach(pt => {
                    const px = (pt.x || pt._x) * scaleX;
                    const py = (pt.y || pt._y) * scaleY;
                    this.ctx.beginPath();
                    this.ctx.arc(px, py, 1.5, 0, Math.PI * 2);
                    this.ctx.fill();
                });
            }

            // Scan line effect during scanning
            if (this.isScanning) {
                const elapsed = Date.now() - this.scanStartTime;
                const scanLineY = y + (h * ((elapsed / 600) % 1));
                this.ctx.strokeStyle = `${color}44`;
                this.ctx.lineWidth = 1;
                this.ctx.beginPath();
                this.ctx.moveTo(x, scanLineY);
                this.ctx.lineTo(x + w, scanLineY);
                this.ctx.stroke();
            }
        });
    }

    _clearCanvas() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
}

window.Scanner = Scanner;
