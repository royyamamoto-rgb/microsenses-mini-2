/* ============================================
   DECEPTION ENGINE - Interview Deception Analysis
   Real-time and post-scan deception detection
   based on facial micro-expressions, blink patterns,
   cognitive load estimation, and facial asymmetry.

   References:
   - Paul Ekman FACS / micro-expression research
   - Cognitive Load Theory (Vrij et al.)
   - AlphaEye VER Theory (Dr. Aken Yu)
   - EAR blink detection (Soukupová & Čech)

   DISCLAIMER: Screening indicators only - not diagnostic.
   ============================================ */

class DeceptionEngine {
    constructor() {
        this.frameHistory = new Map();          // personId -> frame data array
        this.blinkState = new Map();            // personId -> blink tracking state
        this.microExpressionLog = new Map();    // personId -> timestamped micro-expression events
        this.baselineFrames = 90;               // first 3 seconds = truthful baseline
        this.maxHistoryFrames = 1800;           // 60 seconds at 30fps

        // Eye landmark indices (face-api.js 68-point model)
        this.LEFT_EYE = [36, 37, 38, 39, 40, 41];
        this.RIGHT_EYE = [42, 43, 44, 45, 46, 47];
        // Nose bridge for asymmetry midline
        this.NOSE_BRIDGE = [27, 28, 29, 30];
        // Left face landmarks, right face landmarks (mirrored pairs)
        this.LEFT_FACE = [0, 1, 2, 3, 4, 5, 6, 7, 36, 37, 38, 39, 40, 41, 17, 18, 19, 20, 21, 48, 49, 50, 58, 59, 60, 61];
        this.RIGHT_FACE = [16, 15, 14, 13, 12, 11, 10, 9, 45, 44, 43, 42, 47, 46, 26, 25, 24, 23, 22, 54, 53, 52, 56, 55, 64, 63];
    }

    /**
     * Process a single frame for deception analysis
     */
    processFrame(personId, detection) {
        if (!this.frameHistory.has(personId)) {
            this.frameHistory.set(personId, []);
            this.blinkState.set(personId, { inBlink: false, blinkStart: 0, blinks: [], lastBlinkEnd: 0, suppressionStart: 0, absoluteFrame: 0 });
            this.microExpressionLog.set(personId, []);
        }

        const history = this.frameHistory.get(personId);
        const frameData = this._extractFrameData(detection);
        history.push(frameData);

        if (history.length > this.maxHistoryFrames) {
            history.shift();
        }

        // Real-time blink tracking (use absolute frame counter for consistent indexing)
        const blinkData = this.blinkState.get(personId);
        blinkData.absoluteFrame++;
        this._trackBlinks(personId, frameData, blinkData.absoluteFrame);

        // Real-time micro-expression detection
        this._detectMicroExpressions(personId, history);

        return this._quickDeceptionAssess(personId);
    }

    /**
     * Quick real-time deception assessment (last 30 frames)
     */
    _quickDeceptionAssess(personId, vsaQuick = null) {
        const history = this.frameHistory.get(personId);
        if (!history || history.length < 5) {
            return {
                deceptionProbability: 0, concealmentScore: 0, cognitiveLoad: 0,
                truthfulness: 100, microExpressionDetected: false, blinkAnomaly: false,
                gazeAversion: false, asymmetryHigh: false, expressionIncongruence: false
            };
        }

        const recent = history.slice(-30);
        const isBaseline = history.length <= this.baselineFrames;

        // --- Expression instability ---
        let instability = 0;
        for (let i = 1; i < recent.length; i++) {
            let delta = 0;
            const keys = ['angry', 'disgusted', 'fearful', 'happy', 'sad', 'surprised'];
            keys.forEach(k => { delta += Math.abs(recent[i].expressions[k] - recent[i - 1].expressions[k]); });
            if (delta > 0.4) instability++;
        }
        const instabilityRate = instability / recent.length;

        // --- Gaze aversion (head position drift) ---
        let gazeDrifts = 0;
        for (let i = 5; i < recent.length; i++) {
            const window = recent.slice(i - 5, i);
            const xs = window.map(f => f.box.x);
            const range = Math.max(...xs) - Math.min(...xs);
            if (range > 12) gazeDrifts++;
        }
        const gazeAversionRate = recent.length > 5 ? gazeDrifts / (recent.length - 5) : 0;

        // --- Facial asymmetry ---
        const asymmetries = recent.filter(f => f.asymmetry !== null).map(f => f.asymmetry);
        const avgAsymmetry = asymmetries.length > 0 ? asymmetries.reduce((a, b) => a + b, 0) / asymmetries.length : 0;

        // --- Blink anomaly detection ---
        const blinkData = this.blinkState.get(personId);
        const absFrame = blinkData.absoluteFrame;
        const recentBlinks = blinkData.blinks.filter(b => b.endFrame > absFrame - 90);
        const blinkWindow = Math.min(90, absFrame);
        const blinkRate = blinkWindow > 0 ? recentBlinks.length * (30 / blinkWindow) * 60 : 0;
        const blinkAnomaly = absFrame > 30 && (blinkRate > 30 || blinkRate < 5);

        // --- Micro-expression check ---
        const microLog = this.microExpressionLog.get(personId);
        const recentMicro = microLog.filter(m => m.frameIndex > history.length - 30);
        const microExpressionDetected = recentMicro.length > 0;

        // --- Neutral dominance with hidden signals (concealment) ---
        const avgNeutral = recent.reduce((s, f) => s + f.expressions.neutral, 0) / recent.length;
        const maxNegative = Math.max(
            ...recent.map(f => Math.max(f.expressions.angry, f.expressions.fearful, f.expressions.disgusted))
        );
        const concealmentSignal = avgNeutral > 0.6 && maxNegative > 0.1;

        // --- Cognitive load composite ---
        const cognitiveLoad = Math.min(100, Math.round(
            instabilityRate * 120 +
            avgAsymmetry * 0.8 +
            gazeAversionRate * 80 +
            (microExpressionDetected ? 20 : 0) +
            (blinkAnomaly ? 15 : 0)
        ));

        // --- Deception probability ---
        let deceptionProbability = Math.min(100, Math.round(
            instabilityRate * 80 +
            gazeAversionRate * 60 +
            avgAsymmetry * 0.6 +
            (microExpressionDetected ? 25 : 0) +
            (concealmentSignal ? 15 : 0) +
            (blinkAnomaly ? 10 : 0)
        ));

        // Reduce scores during baseline period
        if (isBaseline) {
            deceptionProbability = Math.round(deceptionProbability * 0.3);
        }

        // Blend VSA if available (20% voice, 80% facial)
        if (vsaQuick && vsaQuick.isSpeaking && vsaQuick.hasBaseline) {
            deceptionProbability = Math.min(100, Math.round(
                deceptionProbability * 0.80 + vsaQuick.voiceStress * 0.20
            ));
            cognitiveLoad = Math.min(100, Math.round(cognitiveLoad + vsaQuick.voiceStress * 0.15));
        }

        const concealmentScore = Math.min(100, Math.round(
            (concealmentSignal ? 40 : 0) +
            avgAsymmetry * 0.4 +
            (microExpressionDetected ? 20 : 0) +
            instabilityRate * 30
        ));

        // --- Expression incongruence ---
        let incongruent = false;
        const last = recent[recent.length - 1];
        if (last.expressions.happy > 0.3 && (last.expressions.angry > 0.15 || last.expressions.fearful > 0.15)) {
            incongruent = true;
        }

        return {
            deceptionProbability,
            concealmentScore: Math.min(100, concealmentScore),
            cognitiveLoad,
            truthfulness: Math.max(0, 100 - deceptionProbability),
            microExpressionDetected,
            blinkAnomaly,
            gazeAversion: gazeAversionRate > 0.3,
            asymmetryHigh: avgAsymmetry > 35,
            expressionIncongruence: incongruent
        };
    }

    /**
     * Full post-scan deception analysis
     */
    fullAnalysis(personId, vsaReport = null) {
        const history = this.frameHistory.get(personId);
        if (!history || history.length < 15) return this._defaultResult(personId);

        const fps = 30;
        const durationSec = history.length / fps;
        const baseline = history.slice(0, Math.min(this.baselineFrames, Math.floor(history.length * 0.2)));
        const analysisFrames = history.slice(Math.min(this.baselineFrames, Math.floor(history.length * 0.2)));

        // --- Core analyses ---
        const blinkAnalysis = this._analyzeBlinkPatterns(personId, history, fps);
        const asymmetryAnalysis = this._analyzeAsymmetry(history);
        const microExpressions = this.microExpressionLog.get(personId) || [];
        const expressionAnalysis = this._analyzeExpressionPatterns(history);
        const gazeAnalysis = this._analyzeGazePatterns(history);
        const incongruenceAnalysis = this._analyzeIncongruence(history);

        // --- Baseline comparison ---
        const baselineProfile = this._buildBaseline(baseline);
        const deviations = this._computeDeviations(analysisFrames, baselineProfile);

        // --- Cognitive load ---
        let cognitiveLoadAvg = Math.min(100, Math.round(
            expressionAnalysis.instabilityRate * 100 +
            asymmetryAnalysis.avgAsymmetry * 0.6 +
            gazeAnalysis.aversionRate * 60 +
            (blinkAnalysis.anomalyScore * 0.3) +
            deviations.overallDeviation * 20
        ));
        const cognitiveLoadPeak = Math.min(100, Math.round(cognitiveLoadAvg * 1.4));

        // --- Deception type scoring ---
        const falsification = this._scoreFalsification(expressionAnalysis, asymmetryAnalysis, microExpressions, blinkAnalysis, deviations);
        const concealment = this._scoreConcealment(expressionAnalysis, blinkAnalysis, microExpressions, incongruenceAnalysis);
        const equivocation = this._scoreEquivocation(gazeAnalysis, expressionAnalysis, asymmetryAnalysis);

        // --- Overall deception probability ---
        const typeMax = Math.max(falsification.score, concealment.score, equivocation.score);
        let deceptionProbability = Math.min(100, Math.round(
            typeMax * 0.5 +
            cognitiveLoadAvg * 0.2 +
            (microExpressions.length / durationSec) * 8 +
            asymmetryAnalysis.avgAsymmetry * 0.3 +
            blinkAnalysis.anomalyScore * 0.15 +
            incongruenceAnalysis.incongruenceRate * 40
        ));

        // Blend VSA into final scores (20% voice, 80% facial)
        if (vsaReport && vsaReport.baselineEstablished) {
            deceptionProbability = Math.min(100, Math.round(
                deceptionProbability * 0.80 + vsaReport.voiceStressScore * 0.20
            ));
            cognitiveLoadAvg = Math.min(100, Math.round(
                cognitiveLoadAvg + vsaReport.voiceStressScore * 0.15
            ));
        }

        const truthfulnessIndex = Math.max(0, 100 - deceptionProbability);
        const confidenceLevel = Math.min(100, Math.round((history.length / 120) * 100));

        // --- Deception timeline ---
        const deceptionTimeline = this._buildDeceptionTimeline(personId, history, fps);

        // --- Indicators ---
        const indicators = this._generateIndicators(
            deceptionProbability, falsification, concealment, equivocation,
            blinkAnalysis, asymmetryAnalysis, microExpressions, gazeAnalysis, incongruenceAnalysis, cognitiveLoadAvg
        );

        // --- Overall assessment ---
        let overallAssessment;
        if (deceptionProbability >= 70) overallAssessment = 'Strong deception indicators';
        else if (deceptionProbability >= 50) overallAssessment = 'High deception probability';
        else if (deceptionProbability >= 30) overallAssessment = 'Moderate deception indicators';
        else overallAssessment = 'Low deception probability';

        return {
            personId,
            deceptionProbability,
            confidenceLevel,
            truthfulnessIndex,
            concealmentScore: concealment.score,
            cognitiveLoadAvg,
            cognitiveLoadPeak,
            deceptionTypes: { falsification, concealment, equivocation },
            facialAsymmetry: asymmetryAnalysis,
            blinkAnalysis,
            microExpressions,
            deceptionTimeline,
            gazeAversion: gazeAnalysis,
            expressionIncongruence: incongruenceAnalysis,
            indicators,
            overallAssessment,
            voiceStressAnalysis: vsaReport || null,
            framesAnalyzed: history.length,
            scanDuration: durationSec,
            baselineEstablished: baseline.length >= 30
        };
    }

    // ── Frame Data Extraction ──

    _extractFrameData(detection) {
        const expr = detection.expressions || {};
        const box = detection.detection ? detection.detection.box : detection.box || {};
        const landmarks = detection.landmarks;

        let landmarkPositions = null;
        let asymmetry = null;

        if (landmarks) {
            const positions = landmarks.positions || landmarks._positions || [];
            landmarkPositions = positions.map(p => ({ x: p.x || p._x, y: p.y || p._y }));
            if (landmarkPositions.length >= 48) {
                asymmetry = this._computeFrameAsymmetry(landmarkPositions);
            }
        }

        return {
            timestamp: Date.now(),
            expressions: {
                angry: expr.angry || 0,
                disgusted: expr.disgusted || 0,
                fearful: expr.fearful || 0,
                happy: expr.happy || 0,
                neutral: expr.neutral || 0,
                sad: expr.sad || 0,
                surprised: expr.surprised || 0
            },
            box: {
                x: box.x || box._x || 0,
                y: box.y || box._y || 0,
                width: box.width || box._width || 0,
                height: box.height || box._height || 0
            },
            landmarks: landmarkPositions,
            asymmetry
        };
    }

    // ── Facial Asymmetry ──

    _computeFrameAsymmetry(landmarks) {
        if (landmarks.length < 68) return 0;

        // Nose bridge as midline
        const noseX = this.NOSE_BRIDGE.reduce((s, i) => s + (landmarks[i] ? landmarks[i].x : 0), 0) / this.NOSE_BRIDGE.length;

        let totalAsym = 0;
        let pairs = 0;
        const pairCount = Math.min(this.LEFT_FACE.length, this.RIGHT_FACE.length);

        for (let i = 0; i < pairCount; i++) {
            const li = this.LEFT_FACE[i];
            const ri = this.RIGHT_FACE[i];
            if (landmarks[li] && landmarks[ri]) {
                const leftDist = Math.abs(landmarks[li].x - noseX);
                const rightDist = Math.abs(landmarks[ri].x - noseX);
                const leftY = landmarks[li].y;
                const rightY = landmarks[ri].y;

                const xDiff = Math.abs(leftDist - rightDist);
                const yDiff = Math.abs(leftY - rightY);
                totalAsym += xDiff + yDiff * 0.5;
                pairs++;
            }
        }

        return pairs > 0 ? Math.min(100, (totalAsym / pairs) * 8) : 0;
    }

    _analyzeAsymmetry(history) {
        const values = history.filter(f => f.asymmetry !== null).map(f => f.asymmetry);
        if (values.length < 5) return { avgAsymmetry: 0, peakAsymmetry: 0, timeline: [] };

        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const peak = Math.max(...values);

        // Sample timeline every ~30 frames (1 sec)
        const timeline = [];
        for (let i = 0; i < values.length; i += 30) {
            const chunk = values.slice(i, i + 30);
            timeline.push(Math.round(chunk.reduce((a, b) => a + b, 0) / chunk.length));
        }

        return {
            avgAsymmetry: Math.round(avg),
            peakAsymmetry: Math.round(peak),
            timeline
        };
    }

    // ── Blink Detection & Analysis ──

    _trackBlinks(personId, frameData, frameIndex) {
        if (!frameData.landmarks || frameData.landmarks.length < 48) return;

        const state = this.blinkState.get(personId);
        const ear = this._computeEAR(frameData.landmarks);
        const threshold = 0.21;

        if (ear < threshold && !state.inBlink) {
            state.inBlink = true;
            state.blinkStart = frameIndex;
        } else if (ear >= threshold && state.inBlink) {
            state.inBlink = false;
            const duration = frameIndex - state.blinkStart;
            state.blinks.push({
                startFrame: state.blinkStart,
                endFrame: frameIndex,
                duration,
                durationMs: (duration / 30) * 1000
            });
            state.lastBlinkEnd = frameIndex;
        }
    }

    _computeEAR(landmarks) {
        const leftEAR = this._singleEAR(landmarks, this.LEFT_EYE);
        const rightEAR = this._singleEAR(landmarks, this.RIGHT_EYE);
        return (leftEAR + rightEAR) / 2;
    }

    _singleEAR(landmarks, eyeIndices) {
        const p = eyeIndices.map(i => landmarks[i]);
        if (!p[0] || !p[1] || !p[2] || !p[3] || !p[4] || !p[5]) return 0.3;
        const v1 = Math.sqrt(Math.pow(p[1].x - p[5].x, 2) + Math.pow(p[1].y - p[5].y, 2));
        const v2 = Math.sqrt(Math.pow(p[2].x - p[4].x, 2) + Math.pow(p[2].y - p[4].y, 2));
        const h = Math.sqrt(Math.pow(p[0].x - p[3].x, 2) + Math.pow(p[0].y - p[3].y, 2));
        return h > 0 ? (v1 + v2) / (2 * h) : 0.3;
    }

    _analyzeBlinkPatterns(personId, history, fps) {
        const state = this.blinkState.get(personId);
        if (!state) return { rate: 0, anomalyScore: 0, suppressionEvents: 0, burstEvents: 0, regularity: 100 };

        const blinks = state.blinks;
        const durationSec = history.length / fps;
        const rate = durationSec > 0 ? (blinks.length / durationSec) * 60 : 0;

        // Blink intervals
        const intervals = [];
        for (let i = 1; i < blinks.length; i++) {
            intervals.push((blinks[i].startFrame - blinks[i - 1].endFrame) / fps);
        }

        // Regularity
        let regularity = 100;
        if (intervals.length > 2) {
            const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
            const variance = intervals.reduce((s, v) => s + Math.pow(v - avgInterval, 2), 0) / intervals.length;
            regularity = Math.max(0, Math.min(100, 100 - Math.sqrt(variance) * 30));
        }

        // Suppression events: gaps > 5 seconds with no blinks
        let suppressionEvents = 0;
        for (const interval of intervals) {
            if (interval > 5) suppressionEvents++;
        }

        // Burst events: 3+ blinks within 2 seconds
        let burstEvents = 0;
        for (let i = 2; i < blinks.length; i++) {
            const span = (blinks[i].endFrame - blinks[i - 2].startFrame) / fps;
            if (span < 2) burstEvents++;
        }

        // Suppress-then-burst pattern (key deception indicator)
        let suppressBurstPattern = 0;
        for (let i = 1; i < intervals.length - 1; i++) {
            if (intervals[i - 1] > 4 && intervals[i] < 0.8) {
                suppressBurstPattern++;
            }
        }

        // Anomaly score
        const anomalyScore = Math.min(100, Math.round(
            (rate > 28 ? 20 : 0) +
            (rate < 8 ? 25 : 0) +
            suppressionEvents * 15 +
            burstEvents * 8 +
            suppressBurstPattern * 25 +
            (100 - regularity) * 0.3
        ));

        return {
            rate: Math.round(rate * 10) / 10,
            totalBlinks: blinks.length,
            regularity: Math.round(regularity),
            suppressionEvents,
            burstEvents,
            suppressBurstPattern,
            anomalyScore,
            avgDurationMs: blinks.length > 0 ? Math.round(blinks.reduce((s, b) => s + b.durationMs, 0) / blinks.length) : 0
        };
    }

    // ── Micro-Expression Detection ──

    _detectMicroExpressions(personId, history) {
        if (history.length < 4) return;

        const log = this.microExpressionLog.get(personId);
        const idx = history.length - 1;
        const current = history[idx];
        const expressionKeys = ['angry', 'disgusted', 'fearful', 'happy', 'surprised'];

        // Look for expression spikes: sharp onset (>0.15 jump from baseline) lasting 1-6 frames
        // Check if any non-neutral expression spiked and then dropped
        if (idx < 3) return;

        for (const key of expressionKeys) {
            const val = current.expressions[key];
            const prev3 = history.slice(Math.max(0, idx - 3), idx);
            const prevAvg = prev3.reduce((s, f) => s + f.expressions[key], 0) / prev3.length;

            // Spike detection: current value much higher than recent average
            if (val > prevAvg + 0.15 && val > 0.12) {
                // Check if this spike is brief (look back to see if a previous spike just ended)
                // We log the spike start; we'll check duration when it ends
                const existingSpike = log.find(m => m.key === key && m.endFrame === null && idx - m.frameIndex < 8);

                if (!existingSpike) {
                    log.push({
                        frameIndex: idx,
                        endFrame: null,
                        key,
                        intensity: val,
                        type: this._classifyMicroExpression(key, current.expressions),
                        timestamp: current.timestamp,
                        durationFrames: 0
                    });
                }
            }
        }

        // Close open spikes that have ended (iterate in reverse to safely splice)
        for (let li = log.length - 1; li >= 0; li--) {
            const entry = log[li];
            if (entry.endFrame !== null) continue;
            const val = current.expressions[entry.key];
            const elapsed = idx - entry.frameIndex;

            if (elapsed > 0 && val < entry.intensity * 0.5) {
                // Spike ended
                entry.endFrame = idx;
                entry.durationFrames = elapsed;

                // Only keep if it lasted 1-6 frames (micro-expression range: ~33-200ms at 30fps)
                if (elapsed > 6) {
                    // Too long — not a micro-expression, remove
                    log.splice(li, 1);
                }
            } else if (elapsed > 8) {
                // Stuck open — close and remove
                log.splice(li, 1);
            }
        }
    }

    _classifyMicroExpression(key, expressions) {
        if (key === 'fearful' || (key === 'surprised' && expressions.fearful > 0.05)) return 'fear-cluster';
        if (key === 'happy' && expressions.neutral > 0.4) return 'duping-delight';
        if (key === 'disgusted') return 'disgust-leak';
        if (key === 'angry') return 'anger-leak';
        if (key === 'surprised') return 'surprise-flash';
        return 'emotional-leak';
    }

    // ── Expression Pattern Analysis ──

    _analyzeExpressionPatterns(history) {
        const expressionKeys = ['angry', 'disgusted', 'fearful', 'happy', 'sad', 'surprised'];
        let instabilityCount = 0;
        const deltas = [];

        for (let i = 1; i < history.length; i++) {
            let totalDelta = 0;
            expressionKeys.forEach(k => {
                totalDelta += Math.abs(history[i].expressions[k] - history[i - 1].expressions[k]);
            });
            deltas.push(totalDelta);
            if (totalDelta > 0.4) instabilityCount++;
        }

        const avgDelta = deltas.length > 0 ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
        const neutralDominance = history.reduce((s, f) => s + f.expressions.neutral, 0) / history.length;

        return {
            instabilityRate: instabilityCount / Math.max(1, history.length),
            avgDelta,
            neutralDominance,
            volatility: Math.min(100, Math.round(avgDelta * 150))
        };
    }

    // ── Gaze Pattern Analysis ──

    _analyzeGazePatterns(history) {
        if (history.length < 10) return { aversionRate: 0, stability: 100, driftScore: 0 };

        let drifts = 0;
        for (let i = 5; i < history.length; i++) {
            const window = history.slice(i - 5, i);
            const xs = window.map(f => f.box.x);
            if (Math.max(...xs) - Math.min(...xs) > 12) drifts++;
        }

        const headPositions = history.map(f => ({ x: f.box.x + f.box.width / 2 }));
        let reversals = 0;
        for (let i = 2; i < headPositions.length; i++) {
            const dx1 = headPositions[i - 1].x - headPositions[i - 2].x;
            const dx2 = headPositions[i].x - headPositions[i - 1].x;
            if ((dx1 > 1.5 && dx2 < -1.5) || (dx1 < -1.5 && dx2 > 1.5)) reversals++;
        }

        const aversionRate = drifts / Math.max(1, history.length - 5);
        const stability = Math.max(0, 100 - aversionRate * 100 - (reversals / history.length) * 50);

        // Drift: compare first quarter vs last quarter head position
        const q1 = history.slice(0, Math.floor(history.length / 4));
        const q4 = history.slice(-Math.floor(history.length / 4));
        const avgFirst = q1.reduce((s, f) => s + f.box.x, 0) / q1.length;
        const avgLast = q4.reduce((s, f) => s + f.box.x, 0) / q4.length;
        const driftScore = Math.min(100, Math.round(Math.abs(avgLast - avgFirst)));

        return {
            aversionRate: Math.round(aversionRate * 100) / 100,
            stability: Math.round(stability),
            driftScore,
            reversals,
            score: Math.min(100, Math.round(aversionRate * 80 + driftScore * 0.3))
        };
    }

    // ── Incongruence Analysis ──

    _analyzeIncongruence(history) {
        let incongruences = 0;
        let microLeaks = 0;

        history.forEach(frame => {
            const e = frame.expressions;
            // Happy + angry/fearful simultaneously
            if (e.happy > 0.3 && (e.angry > 0.15 || e.fearful > 0.15 || e.disgusted > 0.15)) {
                incongruences++;
            }
            // Neutral with hidden negative signals
            if (e.neutral > 0.65 && (e.angry > 0.08 || e.disgusted > 0.08)) {
                microLeaks++;
            }
        });

        return {
            incongruenceRate: incongruences / Math.max(1, history.length),
            microLeakRate: microLeaks / Math.max(1, history.length),
            score: Math.min(100, Math.round(
                (incongruences / Math.max(1, history.length)) * 150 +
                (microLeaks / Math.max(1, history.length)) * 80
            ))
        };
    }

    // ── Baseline & Deviations ──

    _buildBaseline(baselineFrames) {
        if (baselineFrames.length < 5) return null;

        const keys = ['angry', 'disgusted', 'fearful', 'happy', 'neutral', 'sad', 'surprised'];
        const avgExpr = {};
        keys.forEach(k => {
            avgExpr[k] = baselineFrames.reduce((s, f) => s + f.expressions[k], 0) / baselineFrames.length;
        });

        const asymmetries = baselineFrames.filter(f => f.asymmetry !== null).map(f => f.asymmetry);
        const avgAsymmetry = asymmetries.length > 0 ? asymmetries.reduce((a, b) => a + b, 0) / asymmetries.length : 0;

        return { avgExpr, avgAsymmetry };
    }

    _computeDeviations(analysisFrames, baseline) {
        if (!baseline || analysisFrames.length < 5) return { overallDeviation: 0 };

        const keys = ['angry', 'disgusted', 'fearful', 'happy', 'sad', 'surprised'];
        let totalDeviation = 0;

        analysisFrames.forEach(frame => {
            keys.forEach(k => {
                totalDeviation += Math.abs(frame.expressions[k] - baseline.avgExpr[k]);
            });
        });

        return {
            overallDeviation: totalDeviation / (analysisFrames.length * keys.length)
        };
    }

    // ── Deception Type Scoring ──

    _scoreFalsification(exprAnalysis, asymmetry, microExprs, blinkAnalysis, deviations) {
        // Falsification: high cognitive load, high asymmetry, many micro-expressions, active expression changes
        let score = 0;
        const indicators = [];

        if (exprAnalysis.instabilityRate > 0.2) {
            score += 25;
            indicators.push({ marker: 'High expression instability', severity: 'high' });
        } else if (exprAnalysis.instabilityRate > 0.1) {
            score += 12;
            indicators.push({ marker: 'Moderate expression instability', severity: 'moderate' });
        }

        if (asymmetry.avgAsymmetry > 30) {
            score += 20;
            indicators.push({ marker: 'Significant facial asymmetry', severity: 'high' });
        } else if (asymmetry.avgAsymmetry > 18) {
            score += 10;
            indicators.push({ marker: 'Elevated facial asymmetry', severity: 'moderate' });
        }

        if (microExprs.length > 5) {
            score += 25;
            indicators.push({ marker: `${microExprs.length} micro-expressions detected`, severity: 'high' });
        } else if (microExprs.length > 2) {
            score += 12;
            indicators.push({ marker: `${microExprs.length} micro-expressions detected`, severity: 'moderate' });
        }

        if (blinkAnalysis.suppressBurstPattern > 1) {
            score += 15;
            indicators.push({ marker: 'Blink suppress-then-burst pattern', severity: 'high' });
        }

        if (deviations.overallDeviation > 0.15) {
            score += 15;
            indicators.push({ marker: 'Significant baseline deviation', severity: 'moderate' });
        }

        return { score: Math.min(100, score), indicators };
    }

    _scoreConcealment(exprAnalysis, blinkAnalysis, microExprs, incongruence) {
        // Concealment: high neutral dominance, blink suppression, micro-expression leaks
        let score = 0;
        const indicators = [];

        if (exprAnalysis.neutralDominance > 0.75) {
            score += 25;
            indicators.push({ marker: 'High neutral dominance (masking)', severity: 'high' });
        } else if (exprAnalysis.neutralDominance > 0.6) {
            score += 12;
            indicators.push({ marker: 'Elevated neutral expression', severity: 'moderate' });
        }

        if (blinkAnalysis.suppressionEvents > 2) {
            score += 20;
            indicators.push({ marker: 'Blink suppression events detected', severity: 'high' });
        } else if (blinkAnalysis.suppressionEvents > 0) {
            score += 10;
            indicators.push({ marker: 'Blink suppression noted', severity: 'moderate' });
        }

        if (incongruence.microLeakRate > 0.15) {
            score += 25;
            indicators.push({ marker: 'Frequent micro-expression leakage', severity: 'high' });
        } else if (incongruence.microLeakRate > 0.05) {
            score += 12;
            indicators.push({ marker: 'Occasional micro-expression leaks', severity: 'moderate' });
        }

        const fearMicros = microExprs.filter(m => m.type === 'fear-cluster').length;
        if (fearMicros > 2) {
            score += 15;
            indicators.push({ marker: 'Fear cluster micro-expressions (fear of detection)', severity: 'high' });
        }

        if (exprAnalysis.volatility < 12 && exprAnalysis.neutralDominance > 0.6) {
            score += 10;
            indicators.push({ marker: 'Controlled flat presentation', severity: 'moderate' });
        }

        return { score: Math.min(100, score), indicators };
    }

    _scoreEquivocation(gazeAnalysis, exprAnalysis, asymmetry) {
        // Equivocation: gaze aversion, inconsistent patterns, moderate asymmetry
        let score = 0;
        const indicators = [];

        if (gazeAnalysis.aversionRate > 0.3) {
            score += 25;
            indicators.push({ marker: 'Frequent gaze aversion', severity: 'high' });
        } else if (gazeAnalysis.aversionRate > 0.15) {
            score += 12;
            indicators.push({ marker: 'Moderate gaze aversion', severity: 'moderate' });
        }

        if (gazeAnalysis.driftScore > 30) {
            score += 15;
            indicators.push({ marker: 'Significant head position drift', severity: 'moderate' });
        }

        if (exprAnalysis.instabilityRate > 0.1 && exprAnalysis.instabilityRate < 0.25) {
            score += 15;
            indicators.push({ marker: 'Intermittent expression shifts', severity: 'moderate' });
        }

        if (asymmetry.avgAsymmetry > 15 && asymmetry.avgAsymmetry < 30) {
            score += 12;
            indicators.push({ marker: 'Moderate facial asymmetry', severity: 'moderate' });
        }

        if (gazeAnalysis.reversals > 10) {
            score += 10;
            indicators.push({ marker: 'Frequent gaze direction changes', severity: 'low' });
        }

        return { score: Math.min(100, score), indicators };
    }

    // ── Deception Timeline ──

    _buildDeceptionTimeline(personId, history, fps) {
        const timeline = [];
        const windowSize = 30; // 1 second chunks

        for (let i = 0; i < history.length; i += windowSize) {
            const chunk = history.slice(i, i + windowSize);
            if (chunk.length < 5) continue;

            // Compute mini deception score for this window
            let instability = 0;
            for (let j = 1; j < chunk.length; j++) {
                let delta = 0;
                ['angry', 'disgusted', 'fearful', 'happy', 'sad', 'surprised'].forEach(k => {
                    delta += Math.abs(chunk[j].expressions[k] - chunk[j - 1].expressions[k]);
                });
                if (delta > 0.4) instability++;
            }

            const avgAsym = chunk.filter(f => f.asymmetry !== null).map(f => f.asymmetry);
            const chunkAsym = avgAsym.length > 0 ? avgAsym.reduce((a, b) => a + b, 0) / avgAsym.length : 0;

            const microLog = this.microExpressionLog.get(personId);
            const chunkMicros = microLog ? microLog.filter(m => m.frameIndex >= i && m.frameIndex < i + windowSize).length : 0;

            const score = Math.min(100, Math.round(
                (instability / chunk.length) * 100 +
                chunkAsym * 0.5 +
                chunkMicros * 15
            ));

            timeline.push({
                timeSeconds: Math.round(i / fps),
                score,
                microExpressions: chunkMicros
            });
        }

        return timeline;
    }

    // ── Indicator Generation ──

    _generateIndicators(deceptionProb, falsification, concealment, equivocation,
                         blinkAnalysis, asymmetry, microExprs, gaze, incongruence, cogLoad) {
        const indicators = [];

        // Deception probability
        if (deceptionProb >= 70) indicators.push({ label: 'HIGH DECEPTION PROBABILITY', color: 'red', confidence: 'high' });
        else if (deceptionProb >= 50) indicators.push({ label: 'ELEVATED DECEPTION SIGNALS', color: 'orange', confidence: 'moderate' });
        else if (deceptionProb >= 30) indicators.push({ label: 'MODERATE DECEPTION INDICATORS', color: 'yellow', confidence: 'moderate' });

        // Dominant deception type
        const types = [
            { name: 'FALSIFICATION DETECTED', score: falsification.score },
            { name: 'CONCEALMENT DETECTED', score: concealment.score },
            { name: 'EQUIVOCATION DETECTED', score: equivocation.score }
        ].sort((a, b) => b.score - a.score);

        if (types[0].score >= 50) {
            indicators.push({ label: types[0].name, color: 'purple', confidence: 'high' });
        }

        // Specific behavioral indicators
        if (microExprs.length > 3) indicators.push({ label: `${microExprs.length} MICRO-EXPRESSIONS`, color: 'purple', confidence: 'high' });
        if (blinkAnalysis.suppressBurstPattern > 0) indicators.push({ label: 'BLINK SUPPRESS-BURST', color: 'orange', confidence: 'high' });
        if (blinkAnalysis.rate > 28) indicators.push({ label: 'ELEVATED BLINK RATE', color: 'yellow', confidence: 'moderate' });
        if (blinkAnalysis.rate < 8) indicators.push({ label: 'SUPPRESSED BLINKING', color: 'orange', confidence: 'moderate' });
        if (asymmetry.avgAsymmetry > 25) indicators.push({ label: 'FACIAL ASYMMETRY', color: 'orange', confidence: 'moderate' });
        if (gaze.aversionRate > 0.25) indicators.push({ label: 'GAZE AVERSION', color: 'yellow', confidence: 'moderate' });
        if (incongruence.incongruenceRate > 0.1) indicators.push({ label: 'EXPRESSION INCONGRUENCE', color: 'red', confidence: 'high' });
        if (cogLoad >= 70) indicators.push({ label: 'HIGH COGNITIVE LOAD', color: 'orange', confidence: 'moderate' });

        // Duping delight
        const dupingDelight = microExprs.filter(m => m.type === 'duping-delight').length;
        if (dupingDelight > 1) indicators.push({ label: 'DUPING DELIGHT', color: 'purple', confidence: 'high' });

        // Fear cluster
        const fearCluster = microExprs.filter(m => m.type === 'fear-cluster').length;
        if (fearCluster > 2) indicators.push({ label: 'FEAR OF DETECTION', color: 'red', confidence: 'high' });

        // Low deception
        if (deceptionProb < 20) indicators.push({ label: 'TRUTHFUL PRESENTATION', color: 'green', confidence: 'moderate' });
        if (indicators.length === 0) indicators.push({ label: 'MONITORING', color: 'green', confidence: 'low' });

        return indicators;
    }

    // ── Utilities ──

    _defaultResult(personId) {
        return {
            personId,
            deceptionProbability: 0, confidenceLevel: 0, truthfulnessIndex: 100,
            concealmentScore: 0, cognitiveLoadAvg: 0, cognitiveLoadPeak: 0,
            deceptionTypes: {
                falsification: { score: 0, indicators: [] },
                concealment: { score: 0, indicators: [] },
                equivocation: { score: 0, indicators: [] }
            },
            facialAsymmetry: { avgAsymmetry: 0, peakAsymmetry: 0, timeline: [] },
            blinkAnalysis: { rate: 0, anomalyScore: 0, suppressionEvents: 0, burstEvents: 0, regularity: 100, totalBlinks: 0, avgDurationMs: 0 },
            microExpressions: [],
            deceptionTimeline: [],
            gazeAversion: { aversionRate: 0, stability: 100, driftScore: 0, score: 0 },
            expressionIncongruence: { incongruenceRate: 0, microLeakRate: 0, score: 0 },
            indicators: [{ label: 'INSUFFICIENT DATA', color: 'yellow', confidence: 'low' }],
            overallAssessment: 'Insufficient data for analysis',
            framesAnalyzed: 0, scanDuration: 0, baselineEstablished: false
        };
    }

    clearPerson(personId) {
        this.frameHistory.delete(personId);
        this.blinkState.delete(personId);
        this.microExpressionLog.delete(personId);
    }

    clearAll() {
        this.frameHistory.clear();
        this.blinkState.clear();
        this.microExpressionLog.clear();
    }
}

window.DeceptionEngine = DeceptionEngine;
