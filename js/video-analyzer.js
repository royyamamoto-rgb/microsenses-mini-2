/* ============================================
   VIDEO ANALYZER - Upload and analyze video files
   Processes each frame through the threat engine
   ============================================ */

class VideoAnalyzer {
    constructor(videoElement, canvas, threatEngine) {
        this.video = videoElement;
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.threatEngine = threatEngine;
        this.isAnalyzing = false;
        this.scanner = null; // set externally
        this.analysisInterval = null;
        this.personTracker = new Map();
        this.nextPersonId = 1;
        this.allResults = [];
        this.onAnalysisUpdate = null;
        this.onAnalysisComplete = null;
    }

    loadVideo(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            this.video.src = url;
            this.video.onloadedmetadata = () => {
                this.video.currentTime = 0;
                resolve({
                    duration: this.video.duration,
                    width: this.video.videoWidth,
                    height: this.video.videoHeight
                });
            };
            this.video.onerror = reject;
        });
    }

    /**
     * Analyze the video by playing and scanning frames
     */
    async startAnalysis() {
        if (this.isAnalyzing) return;

        this.isAnalyzing = true;
        this.threatEngine.clearAll();
        this.personTracker.clear();
        this.nextPersonId = 1;
        this.allResults = [];

        this.video.currentTime = 0;
        await this.video.play();

        this._analyzeLoop();
    }

    stopAnalysis() {
        this.isAnalyzing = false;
        this.video.pause();

        if (this.analysisInterval) {
            cancelAnimationFrame(this.analysisInterval);
            this.analysisInterval = null;
        }

        // Generate final results
        const results = [];
        this.personTracker.forEach((data, id) => {
            const analysis = this.threatEngine.fullAnalysis(id);
            if (analysis.framesAnalyzed >= 3) {
                analysis.box = data.lastBox;
                results.push(analysis);
            }
        });

        if (this.onAnalysisComplete) {
            this.onAnalysisComplete(results);
        }

        return results;
    }

    /**
     * Analyze a single paused frame
     */
    async analyzeCurrentFrame() {
        this._syncCanvasSize();

        try {
            const detections = await faceapi
                .detectAllFaces(this.video, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.4 }))
                .withFaceLandmarks()
                .withFaceExpressions();

            this._drawDetections(detections);

            // Quick analysis of this single frame
            const frameResults = detections.map((det, i) => {
                const personId = `VF${i + 1}`;
                this.threatEngine.clearPerson(personId);

                // Process same frame multiple times to get some signal
                for (let j = 0; j < 5; j++) {
                    this.threatEngine.processFrame(personId, det);
                }

                const analysis = this.threatEngine.fullAnalysis(personId);
                analysis.box = det.detection.box;
                return analysis;
            });

            return frameResults;
        } catch (err) {
            console.error('Frame analysis error:', err);
            return [];
        }
    }

    getTime() {
        return this.video.currentTime;
    }

    getDuration() {
        return this.video.duration;
    }

    seek(time) {
        this.video.currentTime = time;
    }

    togglePlay() {
        if (this.video.paused) {
            this.video.play();
        } else {
            this.video.pause();
        }
        return !this.video.paused;
    }

    // ── Private Methods ──

    async _analyzeLoop() {
        if (!this.isAnalyzing) return;

        if (this.video.ended || this.video.paused) {
            this.stopAnalysis();
            return;
        }

        this._syncCanvasSize();

        try {
            const detections = await faceapi
                .detectAllFaces(this.video, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.4 }))
                .withFaceLandmarks()
                .withFaceExpressions();

            this._trackAndProcess(detections);
            this._drawDetections(detections);

            if (this.onAnalysisUpdate) {
                const currentResults = [];
                this.personTracker.forEach((data, id) => {
                    const quick = this.threatEngine._quickAssess(id);
                    currentResults.push({ personId: id, ...quick, box: data.lastBox });
                });
                this.onAnalysisUpdate(currentResults, this.video.currentTime);
            }

        } catch (err) {
            // Continue analysis despite errors
        }

        if (this.isAnalyzing) {
            this.analysisInterval = requestAnimationFrame(() => this._analyzeLoop());
        }
    }

    _trackAndProcess(detections) {
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

                if (dist < bestDist && dist < 120) {
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

        unmatched.forEach(det => {
            const personId = `VP${this.nextPersonId++}`;
            this.personTracker.set(personId, {
                lastBox: det.detection.box,
                lastSeen: Date.now()
            });
            this.threatEngine.processFrame(personId, det);
        });
    }

    _drawDetections(detections) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        const scaleX = this.canvas.width / (this.video.videoWidth || 1);
        const scaleY = this.canvas.height / (this.video.videoHeight || 1);

        detections.forEach((det, idx) => {
            const box = det.detection.box;
            const x = box.x * scaleX;
            const y = box.y * scaleY;
            const w = box.width * scaleX;
            const h = box.height * scaleY;

            let color = '#00e676';
            let personId = null;

            this.personTracker.forEach((data, pid) => {
                const pcx = data.lastBox.x * scaleX + (data.lastBox.width * scaleX) / 2;
                const pcy = data.lastBox.y * scaleY + (data.lastBox.height * scaleY) / 2;
                const dcx = x + w / 2;
                const dcy = y + h / 2;
                if (Math.sqrt((pcx - dcx) ** 2 + (pcy - dcy) ** 2) < 60) {
                    personId = pid;
                }
            });

            if (personId) {
                const assessment = this.threatEngine._quickAssess(personId);
                if (assessment.level === 'critical') color = '#ff1744';
                else if (assessment.level === 'elevated') color = '#ff9100';
                else if (assessment.level === 'caution') color = '#ffc107';
            }

            // Corner brackets
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = 2;
            const cornerLen = Math.min(w, h) * 0.2;

            this.ctx.beginPath();
            this.ctx.moveTo(x, y + cornerLen); this.ctx.lineTo(x, y); this.ctx.lineTo(x + cornerLen, y);
            this.ctx.stroke();
            this.ctx.beginPath();
            this.ctx.moveTo(x + w - cornerLen, y); this.ctx.lineTo(x + w, y); this.ctx.lineTo(x + w, y + cornerLen);
            this.ctx.stroke();
            this.ctx.beginPath();
            this.ctx.moveTo(x, y + h - cornerLen); this.ctx.lineTo(x, y + h); this.ctx.lineTo(x + cornerLen, y + h);
            this.ctx.stroke();
            this.ctx.beginPath();
            this.ctx.moveTo(x + w - cornerLen, y + h); this.ctx.lineTo(x + w, y + h); this.ctx.lineTo(x + w, y + h - cornerLen);
            this.ctx.stroke();

            if (personId) {
                this.ctx.fillStyle = color;
                this.ctx.font = 'bold 11px -apple-system, sans-serif';
                this.ctx.fillText(personId, x + 4, y - 6);
            }
        });
    }

    _syncCanvasSize() {
        const w = this.video.clientWidth || this.video.videoWidth;
        const h = this.video.clientHeight || this.video.videoHeight;
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w;
            this.canvas.height = h;
        }
    }
}

window.VideoAnalyzer = VideoAnalyzer;
