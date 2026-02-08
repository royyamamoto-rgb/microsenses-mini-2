/* ============================================
   NEURO-ANALYZER - Psychology & Neurological Analysis
   Post-scan deep analysis of facial biomarkers
   for psychological and neurological indicators.

   Based on published research:
   - Hypomimia detection (Parkinson's)
   - Blunted affect (Depression, Schizophrenia)
   - Expression volatility (Bipolar, Anxiety)
   - Micro-tremor patterns (Parkinson's, Essential Tremor)
   - Deception/shallow affect (Antisocial traits)
   - Hypervigilance (PTSD, Anxiety)

   DISCLAIMER: Screening indicators only - not diagnostic.
   ============================================ */

class NeuroAnalyzer {
    constructor() {
        // Eye landmark indices for face-api.js 68-point model
        // Left eye: 36-41, Right eye: 42-47
        this.LEFT_EYE = [36, 37, 38, 39, 40, 41];
        this.RIGHT_EYE = [42, 43, 44, 45, 46, 47];
        // Jaw: 0-16, Nose: 27-35, Mouth: 48-67
        this.JAW = Array.from({ length: 17 }, (_, i) => i);
        this.MOUTH = Array.from({ length: 20 }, (_, i) => i + 48);
        this.BROW_LEFT = [17, 18, 19, 20, 21];
        this.BROW_RIGHT = [22, 23, 24, 25, 26];
    }

    /**
     * Perform full neuro-psychological analysis on frame history
     * @param {Array} frameHistory - Array of frame data from ThreatEngine
     * @param {number} actualFps - Actual camera frame rate
     * @returns {object} Complete neuro analysis results
     */
    analyze(frameHistory, actualFps = 30) {
        if (!frameHistory || frameHistory.length < 10) {
            return this._insufficientData();
        }

        const fps = actualFps || 30;
        const durationSec = frameHistory.length / fps;

        // Core biometric extractions
        const blinkAnalysis = this._analyzeBlinkPatterns(frameHistory, fps);
        const expressionRange = this._analyzeExpressionRange(frameHistory);
        const microTremors = this._analyzeMicroTremors(frameHistory, fps);
        const expressionDynamics = this._analyzeExpressionDynamics(frameHistory);
        const gazePatterns = this._analyzeGazePatterns(frameHistory);
        const affectCongruence = this._analyzeAffectCongruence(frameHistory);
        const psychomotorSpeed = this._analyzePsychomotorSpeed(frameHistory, fps);

        // Condition screening
        const conditions = [];

        conditions.push(this._screenParkinsons(blinkAnalysis, expressionRange, microTremors, psychomotorSpeed));
        conditions.push(this._screenDepression(expressionRange, expressionDynamics, psychomotorSpeed, blinkAnalysis));
        conditions.push(this._screenAnxiety(expressionDynamics, blinkAnalysis, microTremors, gazePatterns));
        conditions.push(this._screenPTSD(gazePatterns, expressionDynamics, expressionRange));
        conditions.push(this._screenBipolar(expressionDynamics, expressionRange));
        conditions.push(this._screenAntisocial(affectCongruence, expressionRange, expressionDynamics));

        // Sort by likelihood descending
        conditions.sort((a, b) => b.likelihood - a.likelihood);

        return {
            scanDuration: durationSec,
            framesAnalyzed: frameHistory.length,
            fps,
            biometrics: {
                blinkRate: blinkAnalysis.blinksPerMinute,
                blinkRegularity: blinkAnalysis.regularity,
                expressionRange: expressionRange.overallRange,
                microTremorScore: microTremors.tremorScore,
                tremorFreqEstimate: microTremors.dominantFrequency,
                expressionVolatility: expressionDynamics.volatility,
                psychomotorIndex: psychomotorSpeed.index,
                gazeStability: gazePatterns.stability,
                affectCongruence: affectCongruence.score
            },
            conditions,
            disclaimer: 'SCREENING INDICATORS ONLY — NOT A MEDICAL DIAGNOSIS. Consult a qualified healthcare professional for evaluation.'
        };
    }

    // ── Blink Pattern Analysis ──
    // Normal: 15-24 blinks/min. PD: 3-12. Depression: prolonged blinks.
    _analyzeBlinkPatterns(frames, fps) {
        const eyeAspectRatios = [];
        let blinks = 0;
        let inBlink = false;
        let blinkDurations = [];
        let blinkStart = 0;
        const blinkIntervals = [];
        let lastBlinkFrame = 0;

        frames.forEach((frame, i) => {
            if (!frame.landmarks || frame.landmarks.length < 48) {
                eyeAspectRatios.push(null);
                return;
            }

            const ear = this._computeEAR(frame.landmarks);
            eyeAspectRatios.push(ear);

            // Blink detection: EAR drops below threshold
            const threshold = 0.21;
            if (ear < threshold && !inBlink) {
                inBlink = true;
                blinkStart = i;
            } else if (ear >= threshold && inBlink) {
                inBlink = false;
                blinks++;
                blinkDurations.push((i - blinkStart) / fps * 1000); // ms
                if (lastBlinkFrame > 0) {
                    blinkIntervals.push((i - lastBlinkFrame) / fps);
                }
                lastBlinkFrame = i;
            }
        });

        const durationSec = frames.length / fps;
        const blinksPerMinute = durationSec > 0 ? (blinks / durationSec) * 60 : 0;
        const avgBlinkDuration = blinkDurations.length > 0
            ? blinkDurations.reduce((a, b) => a + b, 0) / blinkDurations.length : 0;

        // Blink regularity: lower variance in intervals = more regular
        let regularity = 100;
        if (blinkIntervals.length > 2) {
            const avgInterval = blinkIntervals.reduce((a, b) => a + b, 0) / blinkIntervals.length;
            const variance = blinkIntervals.reduce((s, v) => s + Math.pow(v - avgInterval, 2), 0) / blinkIntervals.length;
            regularity = Math.max(0, Math.min(100, 100 - Math.sqrt(variance) * 30));
        }

        return {
            blinksPerMinute: Math.round(blinksPerMinute * 10) / 10,
            totalBlinks: blinks,
            avgBlinkDuration: Math.round(avgBlinkDuration),
            regularity: Math.round(regularity),
            intervals: blinkIntervals
        };
    }

    _computeEAR(landmarks) {
        // Eye Aspect Ratio for both eyes, averaged
        const leftEAR = this._singleEAR(landmarks, this.LEFT_EYE);
        const rightEAR = this._singleEAR(landmarks, this.RIGHT_EYE);
        return (leftEAR + rightEAR) / 2;
    }

    _singleEAR(landmarks, eyeIndices) {
        // EAR = (|p2-p6| + |p3-p5|) / (2 * |p1-p4|)
        const p = eyeIndices.map(i => landmarks[i]);
        if (!p[0] || !p[1] || !p[2] || !p[3] || !p[4] || !p[5]) return 0.3;

        const v1 = Math.sqrt(Math.pow(p[1].x - p[5].x, 2) + Math.pow(p[1].y - p[5].y, 2));
        const v2 = Math.sqrt(Math.pow(p[2].x - p[4].x, 2) + Math.pow(p[2].y - p[4].y, 2));
        const h = Math.sqrt(Math.pow(p[0].x - p[3].x, 2) + Math.pow(p[0].y - p[3].y, 2));

        return h > 0 ? (v1 + v2) / (2 * h) : 0.3;
    }

    // ── Expression Range Analysis ──
    // Low range = hypomimia (PD), blunted affect (depression/schizophrenia)
    _analyzeExpressionRange(frames) {
        const expressionKeys = ['angry', 'disgusted', 'fearful', 'happy', 'neutral', 'sad', 'surprised'];
        const peaks = {};
        const mins = {};
        const sums = {};

        expressionKeys.forEach(key => {
            peaks[key] = 0;
            mins[key] = 1;
            sums[key] = 0;
        });

        frames.forEach(frame => {
            expressionKeys.forEach(key => {
                const v = frame.expressions[key] || 0;
                peaks[key] = Math.max(peaks[key], v);
                mins[key] = Math.min(mins[key], v);
                sums[key] += v;
            });
        });

        const ranges = {};
        const averages = {};
        expressionKeys.forEach(key => {
            ranges[key] = peaks[key] - mins[key];
            averages[key] = sums[key] / frames.length;
        });

        // Overall range: sum of all expression ranges (max ~7 if all expressions go 0→1)
        const totalRange = Object.values(ranges).reduce((a, b) => a + b, 0);
        const overallRange = Math.round((totalRange / 7) * 100); // 0-100 scale

        // Positive expression range (happy)
        const positiveRange = Math.round(ranges.happy * 100);

        // Negative expression range (angry + disgusted + sad + fearful)
        const negativeRange = Math.round(((ranges.angry + ranges.disgusted + ranges.sad + ranges.fearful) / 4) * 100);

        // Neutral dominance: how much time spent in neutral
        const neutralDominance = Math.round(averages.neutral * 100);

        return {
            overallRange,
            positiveRange,
            negativeRange,
            neutralDominance,
            ranges,
            peaks,
            averages
        };
    }

    // ── Micro-Tremor Analysis ──
    // PD: 4-6 Hz chin/jaw tremor. ET: 5-8 Hz, action-based.
    _analyzeMicroTremors(frames, fps) {
        if (frames.length < 20 || !frames[0].landmarks) {
            return { tremorScore: 0, dominantFrequency: 0, jawTremor: 0, chinTremor: 0 };
        }

        // Analyze jaw landmark jitter (chin point = landmark 8)
        const chinDisplacements = [];
        const jawDisplacements = [];

        for (let i = 1; i < frames.length; i++) {
            if (!frames[i].landmarks || !frames[i - 1].landmarks) continue;
            if (frames[i].landmarks.length < 17 || frames[i - 1].landmarks.length < 17) continue;

            // Chin point displacement
            const chin = frames[i].landmarks[8];
            const prevChin = frames[i - 1].landmarks[8];
            if (chin && prevChin) {
                chinDisplacements.push(chin.y - prevChin.y);
            }

            // Jaw contour average displacement
            let jawSum = 0;
            let jawCount = 0;
            for (let j = 5; j <= 11; j++) {
                if (frames[i].landmarks[j] && frames[i - 1].landmarks[j]) {
                    jawSum += Math.abs(frames[i].landmarks[j].y - frames[i - 1].landmarks[j].y);
                    jawCount++;
                }
            }
            if (jawCount > 0) jawDisplacements.push(jawSum / jawCount);
        }

        // Estimate tremor frequency using zero-crossing method
        const dominantFrequency = this._estimateFrequency(chinDisplacements, fps);

        // Tremor amplitude (RMS of chin displacements)
        const rms = chinDisplacements.length > 0
            ? Math.sqrt(chinDisplacements.reduce((s, v) => s + v * v, 0) / chinDisplacements.length) : 0;

        // Jaw tremor amplitude
        const jawRms = jawDisplacements.length > 0
            ? Math.sqrt(jawDisplacements.reduce((s, v) => s + v * v, 0) / jawDisplacements.length) : 0;

        // Tremor score: normalized 0-100
        const tremorScore = Math.min(100, Math.round(rms * 50 + jawRms * 30));

        return {
            tremorScore,
            dominantFrequency: Math.round(dominantFrequency * 10) / 10,
            chinAmplitude: Math.round(rms * 100) / 100,
            jawAmplitude: Math.round(jawRms * 100) / 100,
            isPDRange: dominantFrequency >= 3.5 && dominantFrequency <= 6.5,
            isETRange: dominantFrequency >= 5 && dominantFrequency <= 9
        };
    }

    _estimateFrequency(signal, fps) {
        if (signal.length < 10) return 0;

        // Zero-crossing frequency estimation
        let crossings = 0;
        const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
        for (let i = 1; i < signal.length; i++) {
            if ((signal[i - 1] - mean) * (signal[i] - mean) < 0) {
                crossings++;
            }
        }

        // Frequency = crossings / (2 * duration_in_seconds)
        const durationSec = signal.length / fps;
        return durationSec > 0 ? crossings / (2 * durationSec) : 0;
    }

    // ── Expression Dynamics Analysis ──
    // High volatility = bipolar/anxiety. Low dynamics = depression/PD.
    _analyzeExpressionDynamics(frames) {
        if (frames.length < 5) return { volatility: 0, changeRate: 0, cyclingSpeed: 0 };

        const deltas = [];
        let rapidChanges = 0;
        const expressionKeys = ['angry', 'disgusted', 'fearful', 'happy', 'neutral', 'sad', 'surprised'];

        for (let i = 1; i < frames.length; i++) {
            let totalDelta = 0;
            expressionKeys.forEach(key => {
                totalDelta += Math.abs((frames[i].expressions[key] || 0) - (frames[i - 1].expressions[key] || 0));
            });
            deltas.push(totalDelta);
            if (totalDelta > 0.4) rapidChanges++;
        }

        const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
        const volatility = Math.min(100, Math.round(avgDelta * 150));

        // Expression cycling: how many times the dominant expression changes
        let dominantChanges = 0;
        let prevDominant = null;
        frames.forEach(frame => {
            let maxVal = 0;
            let dominant = 'neutral';
            expressionKeys.forEach(key => {
                if ((frame.expressions[key] || 0) > maxVal) {
                    maxVal = frame.expressions[key];
                    dominant = key;
                }
            });
            if (prevDominant && dominant !== prevDominant) dominantChanges++;
            prevDominant = dominant;
        });

        const cyclingSpeed = Math.round((dominantChanges / frames.length) * 100);

        // Peak intensity (highest single expression value across all frames)
        let peakIntensity = 0;
        frames.forEach(frame => {
            expressionKeys.forEach(key => {
                if (key !== 'neutral') peakIntensity = Math.max(peakIntensity, frame.expressions[key] || 0);
            });
        });

        return {
            volatility,
            changeRate: Math.round((rapidChanges / frames.length) * 100),
            cyclingSpeed,
            peakIntensity: Math.round(peakIntensity * 100),
            avgDelta
        };
    }

    // ── Gaze Pattern Analysis ──
    // Rapid scanning = hypervigilance (PTSD/anxiety). Drift = avoidance.
    _analyzeGazePatterns(frames) {
        if (frames.length < 10) return { stability: 100, scanRate: 0, driftScore: 0 };

        const headPositions = frames.map(f => ({ x: f.box.x + f.box.width / 2, y: f.box.y + f.box.height / 2 }));
        const movements = [];

        for (let i = 1; i < headPositions.length; i++) {
            const dx = headPositions[i].x - headPositions[i - 1].x;
            const dy = headPositions[i].y - headPositions[i - 1].y;
            movements.push(Math.sqrt(dx * dx + dy * dy));
        }

        const avgMovement = movements.reduce((a, b) => a + b, 0) / movements.length;

        // Direction reversals (scanning behavior)
        let reversals = 0;
        for (let i = 2; i < headPositions.length; i++) {
            const dx1 = headPositions[i - 1].x - headPositions[i - 2].x;
            const dx2 = headPositions[i].x - headPositions[i - 1].x;
            if ((dx1 > 1.5 && dx2 < -1.5) || (dx1 < -1.5 && dx2 > 1.5)) {
                reversals++;
            }
        }

        const scanRate = Math.round((reversals / frames.length) * 100);
        const stability = Math.max(0, Math.min(100, Math.round(100 - avgMovement * 5 - scanRate)));

        // Lateral drift: overall head position trend
        const firstQuarter = headPositions.slice(0, Math.floor(headPositions.length / 4));
        const lastQuarter = headPositions.slice(-Math.floor(headPositions.length / 4));
        const avgFirst = firstQuarter.reduce((s, p) => s + p.x, 0) / firstQuarter.length;
        const avgLast = lastQuarter.reduce((s, p) => s + p.x, 0) / lastQuarter.length;
        const driftScore = Math.min(100, Math.round(Math.abs(avgLast - avgFirst)));

        return { stability, scanRate, driftScore, avgMovement };
    }

    // ── Affect Congruence Analysis ──
    // Incongruent affect = antisocial/psychopathy indicators
    _analyzeAffectCongruence(frames) {
        if (frames.length < 10) return { score: 100, incongruences: 0 };

        let incongruences = 0;
        const expressionKeys = ['angry', 'disgusted', 'fearful', 'happy', 'neutral', 'sad', 'surprised'];

        // Detect simultaneous conflicting high expressions (e.g., happy + angry)
        frames.forEach(frame => {
            const expr = frame.expressions;
            // Incongruent: high happy with high angry/disgusted
            if ((expr.happy || 0) > 0.3 && ((expr.angry || 0) > 0.2 || (expr.disgusted || 0) > 0.2)) {
                incongruences++;
            }
            // Incongruent: neutral face but with micro-signals of negative emotion
            if ((expr.neutral || 0) > 0.7 && ((expr.angry || 0) > 0.1 && (expr.disgusted || 0) > 0.1)) {
                incongruences += 0.5;
            }
        });

        // Expression mimicry deficit: low variability in response to own expression changes
        let stableNeutralWithMicroLeaks = 0;
        for (let i = 5; i < frames.length; i++) {
            const window = frames.slice(i - 5, i);
            const avgNeutral = window.reduce((s, f) => s + (f.expressions.neutral || 0), 0) / 5;
            const maxNonNeutral = window.reduce((max, f) => {
                return Math.max(max,
                    (f.expressions.angry || 0),
                    (f.expressions.disgusted || 0),
                    (f.expressions.happy || 0) * 0.5
                );
            }, 0);

            if (avgNeutral > 0.6 && maxNonNeutral > 0.15) {
                stableNeutralWithMicroLeaks++;
            }
        }

        const incongruenceRate = incongruences / frames.length;
        const score = Math.max(0, Math.round(100 - incongruenceRate * 200 - (stableNeutralWithMicroLeaks / frames.length) * 50));

        return {
            score,
            incongruences: Math.round(incongruences),
            microLeakRate: Math.round((stableNeutralWithMicroLeaks / frames.length) * 100)
        };
    }

    // ── Psychomotor Speed Analysis ──
    // Slow = depression/PD. Fast/erratic = mania/anxiety.
    _analyzePsychomotorSpeed(frames, fps) {
        if (frames.length < 10) return { index: 50, speed: 'normal' };

        // Measure expression transition speed
        const transitionSpeeds = [];
        const expressionKeys = ['angry', 'disgusted', 'fearful', 'happy', 'sad', 'surprised'];

        for (let i = 1; i < frames.length; i++) {
            let maxDelta = 0;
            expressionKeys.forEach(key => {
                maxDelta = Math.max(maxDelta, Math.abs((frames[i].expressions[key] || 0) - (frames[i - 1].expressions[key] || 0)));
            });
            if (maxDelta > 0.05) transitionSpeeds.push(maxDelta * fps);
        }

        // Head movement speed
        const headSpeeds = [];
        for (let i = 1; i < frames.length; i++) {
            const dx = frames[i].box.x - frames[i - 1].box.x;
            const dy = frames[i].box.y - frames[i - 1].box.y;
            headSpeeds.push(Math.sqrt(dx * dx + dy * dy) * fps);
        }

        const avgTransitionSpeed = transitionSpeeds.length > 0
            ? transitionSpeeds.reduce((a, b) => a + b, 0) / transitionSpeeds.length : 0;
        const avgHeadSpeed = headSpeeds.length > 0
            ? headSpeeds.reduce((a, b) => a + b, 0) / headSpeeds.length : 0;

        // Psychomotor index: 0-100 where 50 = normal, <30 = retarded, >70 = agitated
        const index = Math.min(100, Math.max(0, Math.round(30 + avgTransitionSpeed * 2 + avgHeadSpeed * 0.3)));

        let speed = 'normal';
        if (index < 25) speed = 'very slow';
        else if (index < 40) speed = 'slow';
        else if (index > 75) speed = 'agitated';
        else if (index > 60) speed = 'elevated';

        return { index, speed, avgTransitionSpeed, avgHeadSpeed };
    }

    // ── Condition Screening Functions ──

    _screenParkinsons(blink, exprRange, tremors, psychomotor) {
        let score = 0;
        const indicators = [];

        // Reduced blink rate (PD: 3-12 blinks/min vs normal 15-24)
        if (blink.blinksPerMinute < 8) {
            score += 30;
            indicators.push({ marker: 'Very low blink rate', value: `${blink.blinksPerMinute}/min`, severity: 'high' });
        } else if (blink.blinksPerMinute < 13) {
            score += 15;
            indicators.push({ marker: 'Reduced blink rate', value: `${blink.blinksPerMinute}/min`, severity: 'moderate' });
        }

        // Hypomimia (reduced expression range)
        if (exprRange.overallRange < 15) {
            score += 25;
            indicators.push({ marker: 'Facial masking (hypomimia)', value: `${exprRange.overallRange}% range`, severity: 'high' });
        } else if (exprRange.overallRange < 30) {
            score += 12;
            indicators.push({ marker: 'Reduced facial expressivity', value: `${exprRange.overallRange}% range`, severity: 'moderate' });
        }

        // Micro-tremor in PD frequency range (4-6 Hz)
        if (tremors.tremorScore > 20 && tremors.isPDRange) {
            score += 25;
            indicators.push({ marker: 'Jaw/chin tremor (4-6 Hz)', value: `${tremors.dominantFrequency} Hz`, severity: 'high' });
        } else if (tremors.tremorScore > 10) {
            score += 8;
            indicators.push({ marker: 'Mild facial tremor detected', value: `${tremors.dominantFrequency} Hz`, severity: 'low' });
        }

        // Psychomotor slowing
        if (psychomotor.index < 30) {
            score += 15;
            indicators.push({ marker: 'Psychomotor bradykinesia', value: psychomotor.speed, severity: 'moderate' });
        }

        // High neutral dominance with tremor
        if (exprRange.neutralDominance > 80 && tremors.tremorScore > 15) {
            score += 10;
            indicators.push({ marker: 'Masked face + tremor pattern', value: `${exprRange.neutralDominance}% neutral`, severity: 'moderate' });
        }

        return {
            condition: "Parkinson's Disease Indicators",
            category: 'neurological',
            likelihood: Math.min(100, score),
            level: this._getLevel(score),
            indicators,
            note: 'Screening for hypomimia, reduced blink rate, and resting tremor patterns characteristic of PD.'
        };
    }

    _screenDepression(exprRange, dynamics, psychomotor, blink) {
        let score = 0;
        const indicators = [];

        // Flat affect / reduced expression range
        if (exprRange.overallRange < 20) {
            score += 20;
            indicators.push({ marker: 'Flat affect', value: `${exprRange.overallRange}% range`, severity: 'high' });
        } else if (exprRange.overallRange < 35) {
            score += 10;
            indicators.push({ marker: 'Reduced expressivity', value: `${exprRange.overallRange}% range`, severity: 'moderate' });
        }

        // Reduced positive expression (happy)
        if (exprRange.positiveRange < 10) {
            score += 20;
            indicators.push({ marker: 'Absent positive affect', value: `${exprRange.positiveRange}% happy range`, severity: 'high' });
        } else if (exprRange.positiveRange < 25) {
            score += 10;
            indicators.push({ marker: 'Diminished positive affect', value: `${exprRange.positiveRange}% happy range`, severity: 'moderate' });
        }

        // Psychomotor retardation
        if (psychomotor.index < 30) {
            score += 20;
            indicators.push({ marker: 'Psychomotor retardation', value: psychomotor.speed, severity: 'high' });
        } else if (psychomotor.index < 40) {
            score += 10;
            indicators.push({ marker: 'Slowed psychomotor activity', value: psychomotor.speed, severity: 'moderate' });
        }

        // High neutral dominance
        if (exprRange.neutralDominance > 75) {
            score += 12;
            indicators.push({ marker: 'Predominant neutral expression', value: `${exprRange.neutralDominance}%`, severity: 'moderate' });
        }

        // Elevated sadness
        if (exprRange.averages.sad > 0.15) {
            score += 15;
            indicators.push({ marker: 'Elevated sadness baseline', value: `${Math.round(exprRange.averages.sad * 100)}%`, severity: 'moderate' });
        }

        // Low expression dynamics
        if (dynamics.volatility < 15) {
            score += 8;
            indicators.push({ marker: 'Low expression dynamism', value: `${dynamics.volatility}%`, severity: 'low' });
        }

        // Prolonged blink duration
        if (blink.avgBlinkDuration > 200) {
            score += 8;
            indicators.push({ marker: 'Prolonged blink duration', value: `${blink.avgBlinkDuration}ms`, severity: 'low' });
        }

        return {
            condition: 'Depression Indicators (MDD)',
            category: 'psychological',
            likelihood: Math.min(100, score),
            level: this._getLevel(score),
            indicators,
            note: 'Screening for flat affect, psychomotor retardation, and reduced positive expressivity associated with Major Depressive Disorder.'
        };
    }

    _screenAnxiety(dynamics, blink, tremors, gaze) {
        let score = 0;
        const indicators = [];

        // High expression volatility
        if (dynamics.volatility > 60) {
            score += 20;
            indicators.push({ marker: 'High expression instability', value: `${dynamics.volatility}%`, severity: 'high' });
        } else if (dynamics.volatility > 40) {
            score += 10;
            indicators.push({ marker: 'Elevated expression variability', value: `${dynamics.volatility}%`, severity: 'moderate' });
        }

        // Irregular blink pattern
        if (blink.regularity < 40) {
            score += 15;
            indicators.push({ marker: 'Irregular blink pattern', value: `${blink.regularity}% regularity`, severity: 'moderate' });
        }

        // Elevated blink rate
        if (blink.blinksPerMinute > 28) {
            score += 12;
            indicators.push({ marker: 'Elevated blink rate', value: `${blink.blinksPerMinute}/min`, severity: 'moderate' });
        }

        // Micro-movement / fidgeting
        if (tremors.tremorScore > 15) {
            score += 12;
            indicators.push({ marker: 'Facial micro-movement activity', value: `${tremors.tremorScore}%`, severity: 'moderate' });
        }

        // Gaze instability / scanning
        if (gaze.scanRate > 30) {
            score += 15;
            indicators.push({ marker: 'Rapid gaze scanning', value: `${gaze.scanRate}%`, severity: 'moderate' });
        }
        if (gaze.stability < 40) {
            score += 10;
            indicators.push({ marker: 'Gaze instability', value: `${gaze.stability}% stable`, severity: 'moderate' });
        }

        // High change rate
        if (dynamics.changeRate > 30) {
            score += 10;
            indicators.push({ marker: 'Rapid expression shifts', value: `${dynamics.changeRate}%`, severity: 'low' });
        }

        return {
            condition: 'Anxiety Indicators (GAD)',
            category: 'psychological',
            likelihood: Math.min(100, score),
            level: this._getLevel(score),
            indicators,
            note: 'Screening for expression instability, heightened vigilance, and stress markers associated with Generalized Anxiety Disorder.'
        };
    }

    _screenPTSD(gaze, dynamics, exprRange) {
        let score = 0;
        const indicators = [];

        // Hypervigilance (rapid scanning, high gaze instability)
        if (gaze.scanRate > 40) {
            score += 20;
            indicators.push({ marker: 'Hypervigilant scanning', value: `${gaze.scanRate}%`, severity: 'high' });
        } else if (gaze.scanRate > 25) {
            score += 10;
            indicators.push({ marker: 'Elevated scanning behavior', value: `${gaze.scanRate}%`, severity: 'moderate' });
        }

        // Emotional numbing (reduced positive with flat baseline)
        if (exprRange.positiveRange < 15 && exprRange.neutralDominance > 65) {
            score += 18;
            indicators.push({ marker: 'Emotional numbing pattern', value: `${exprRange.positiveRange}% positive range`, severity: 'high' });
        }

        // Alternating flat/intense (numbing + startle pattern)
        if (dynamics.peakIntensity > 60 && exprRange.neutralDominance > 55) {
            score += 15;
            indicators.push({ marker: 'Numbing-reactivity pattern', value: `${dynamics.peakIntensity}% peak intensity`, severity: 'moderate' });
        }

        // High gaze drift (avoidance behavior)
        if (gaze.driftScore > 30) {
            score += 12;
            indicators.push({ marker: 'Gaze avoidance drift', value: `${gaze.driftScore}%`, severity: 'moderate' });
        }

        // Expression volatility with fear component
        if (dynamics.volatility > 35 && exprRange.averages.fearful > 0.08) {
            score += 12;
            indicators.push({ marker: 'Fear-linked expression volatility', value: `${Math.round(exprRange.averages.fearful * 100)}% fear`, severity: 'moderate' });
        }

        return {
            condition: 'PTSD Indicators',
            category: 'psychological',
            likelihood: Math.min(100, score),
            level: this._getLevel(score),
            indicators,
            note: 'Screening for hypervigilance, emotional numbing, and startle response patterns associated with Post-Traumatic Stress Disorder.'
        };
    }

    _screenBipolar(dynamics, exprRange) {
        let score = 0;
        const indicators = [];

        // High expression volatility with high peak intensity
        if (dynamics.volatility > 55 && dynamics.peakIntensity > 50) {
            score += 25;
            indicators.push({ marker: 'High-amplitude expression cycling', value: `${dynamics.volatility}% volatility`, severity: 'high' });
        } else if (dynamics.volatility > 40) {
            score += 12;
            indicators.push({ marker: 'Elevated expression cycling', value: `${dynamics.volatility}%`, severity: 'moderate' });
        }

        // Rapid expression switching
        if (dynamics.cyclingSpeed > 30) {
            score += 20;
            indicators.push({ marker: 'Rapid affect cycling', value: `${dynamics.cyclingSpeed}% rate`, severity: 'high' });
        } else if (dynamics.cyclingSpeed > 18) {
            score += 10;
            indicators.push({ marker: 'Moderate affect cycling', value: `${dynamics.cyclingSpeed}%`, severity: 'moderate' });
        }

        // Wide expression range (both positive and negative used intensely)
        if (exprRange.overallRange > 60 && exprRange.positiveRange > 35 && exprRange.negativeRange > 25) {
            score += 18;
            indicators.push({ marker: 'Full-spectrum expression range', value: `${exprRange.overallRange}%`, severity: 'moderate' });
        }

        // High peak intensity
        if (dynamics.peakIntensity > 70) {
            score += 12;
            indicators.push({ marker: 'Extreme expression peaks', value: `${dynamics.peakIntensity}%`, severity: 'moderate' });
        }

        return {
            condition: 'Bipolar Indicators',
            category: 'psychological',
            likelihood: Math.min(100, score),
            level: this._getLevel(score),
            indicators,
            note: 'Screening for expression volatility, rapid affect cycling, and extreme peaks associated with Bipolar Disorder.'
        };
    }

    _screenAntisocial(congruence, exprRange, dynamics) {
        let score = 0;
        const indicators = [];

        // Low affect congruence (incongruent expressions)
        if (congruence.score < 40) {
            score += 25;
            indicators.push({ marker: 'Incongruent affect patterns', value: `${congruence.score}% congruence`, severity: 'high' });
        } else if (congruence.score < 65) {
            score += 12;
            indicators.push({ marker: 'Mild affect incongruence', value: `${congruence.score}%`, severity: 'moderate' });
        }

        // Shallow affect (low expression range with high neutral)
        if (exprRange.overallRange < 25 && exprRange.neutralDominance > 70) {
            score += 20;
            indicators.push({ marker: 'Shallow affect presentation', value: `${exprRange.overallRange}% range`, severity: 'high' });
        }

        // Micro-expression leaks (duping delight pattern)
        if (congruence.microLeakRate > 20) {
            score += 18;
            indicators.push({ marker: 'Micro-expression leakage', value: `${congruence.microLeakRate}% rate`, severity: 'high' });
        } else if (congruence.microLeakRate > 10) {
            score += 8;
            indicators.push({ marker: 'Occasional micro-leaks', value: `${congruence.microLeakRate}%`, severity: 'low' });
        }

        // Low expression dynamics (controlled/calculated)
        if (dynamics.volatility < 15 && dynamics.changeRate < 10) {
            score += 12;
            indicators.push({ marker: 'Controlled flat presentation', value: `${dynamics.volatility}% volatility`, severity: 'moderate' });
        }

        return {
            condition: 'Antisocial Trait Indicators',
            category: 'psychological',
            likelihood: Math.min(100, score),
            level: this._getLevel(score),
            indicators,
            note: 'Screening for shallow affect, expression incongruence, and micro-expression patterns associated with antisocial personality traits.'
        };
    }

    // ── Utility ──

    _getLevel(score) {
        if (score >= 60) return 'high';
        if (score >= 35) return 'moderate';
        if (score >= 15) return 'low';
        return 'minimal';
    }

    _insufficientData() {
        return {
            scanDuration: 0,
            framesAnalyzed: 0,
            fps: 0,
            biometrics: {
                blinkRate: 0, blinkRegularity: 0, expressionRange: 0,
                microTremorScore: 0, tremorFreqEstimate: 0, expressionVolatility: 0,
                psychomotorIndex: 50, gazeStability: 0, affectCongruence: 0
            },
            conditions: [],
            disclaimer: 'INSUFFICIENT DATA — Longer scan required for neuro-psychological analysis.'
        };
    }

    /**
     * Deception-focused analysis returning only deception-relevant biometrics
     */
    analyzeForDeception(frameHistory, fps = 30) {
        if (!frameHistory || frameHistory.length < 10) return {
            blinkRate: 0, blinkRegularity: 0, blinkIntervals: [],
            avgBlinkDuration: 0, expressionVolatility: 0, expressionChangeRate: 0,
            affectCongruence: 0, microLeakRate: 0, gazeStability: 0,
            gazeDrift: 0, scanRate: 0, psychomotorIndex: 50, psychomotorSpeed: 'normal'
        };

        const blinkAnalysis = this._analyzeBlinkPatterns(frameHistory, fps);
        const expressionDynamics = this._analyzeExpressionDynamics(frameHistory);
        const affectCongruence = this._analyzeAffectCongruence(frameHistory);
        const gazePatterns = this._analyzeGazePatterns(frameHistory);
        const psychomotor = this._analyzePsychomotorSpeed(frameHistory, fps);

        return {
            blinkRate: blinkAnalysis.blinksPerMinute,
            blinkRegularity: blinkAnalysis.regularity,
            blinkIntervals: blinkAnalysis.intervals,
            avgBlinkDuration: blinkAnalysis.avgBlinkDuration,
            expressionVolatility: expressionDynamics.volatility,
            expressionChangeRate: expressionDynamics.changeRate,
            affectCongruence: affectCongruence.score,
            microLeakRate: affectCongruence.microLeakRate,
            gazeStability: gazePatterns.stability,
            gazeDrift: gazePatterns.driftScore,
            scanRate: gazePatterns.scanRate,
            psychomotorIndex: psychomotor.index,
            psychomotorSpeed: psychomotor.speed
        };
    }
}

window.NeuroAnalyzer = NeuroAnalyzer;
