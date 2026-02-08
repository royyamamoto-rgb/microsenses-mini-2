/* ============================================
   THREAT ENGINE - Behavioral Vibration Analysis
   Analyzes facial expressions, micro-movements,
   and behavioral patterns to assess threat levels
   ============================================ */

class ThreatEngine {
    constructor() {
        this.frameHistory = new Map(); // personId -> array of frame data
        this.maxHistoryFrames = 90;    // ~3 seconds at 30fps
        this.sensitivity = 7;
        this.thresholds = { caution: 35, elevated: 55, critical: 75 };
    }

    setSensitivity(val) {
        this.sensitivity = val;
    }

    setThresholds(caution, elevated, critical) {
        this.thresholds = { caution, elevated, critical };
    }

    setMode(mode) {
        if (mode === 'detection') {
            this.maxHistoryFrames = 150;  // 5 seconds for detection (fast turnover)
        } else {
            this.maxHistoryFrames = 900;  // 30 seconds for deception (longer history)
        }
    }

    /**
     * Process a single detection frame for a person
     * @param {string} personId - Unique ID for this tracked person
     * @param {object} detection - face-api.js detection with expressions and landmarks
     * @returns {object} Real-time assessment
     */
    processFrame(personId, detection) {
        if (!this.frameHistory.has(personId)) {
            this.frameHistory.set(personId, []);
        }

        const history = this.frameHistory.get(personId);
        const frameData = this._extractFrameData(detection);
        history.push(frameData);

        if (history.length > this.maxHistoryFrames) {
            history.shift();
        }

        return this._quickAssess(personId);
    }

    /**
     * Perform full analysis after scan period completes
     * @param {string} personId
     * @returns {object} Complete threat assessment
     */
    fullAnalysis(personId) {
        const history = this.frameHistory.get(personId);
        if (!history || history.length < 5) {
            return this._defaultAssessment();
        }

        const expressions = this._aggregateExpressions(history);
        const microMovements = this._analyzeMicroMovements(history);
        const expressionStability = this._analyzeExpressionStability(history);
        const behavioralPatterns = this._analyzeBehavioralPatterns(history);

        // Core metrics
        const aggression = this._calculateAggression(expressions, microMovements, behavioralPatterns);
        const stress = this._calculateStress(expressions, microMovements, expressionStability);
        const deception = this._calculateDeception(expressions, expressionStability, behavioralPatterns);
        const tension = this._calculateTension(expressions, microMovements);
        const badIntent = this._calculateBadIntent(aggression, deception, behavioralPatterns);
        const stability = this._calculateStability(expressionStability, microMovements);

        // Overall threat score (weighted composite)
        const threatScore = Math.round(
            aggression * 0.25 +
            stress * 0.10 +
            deception * 0.25 +
            tension * 0.10 +
            badIntent * 0.25 +
            (100 - stability) * 0.05
        );

        // Determine threat level
        const threatLevel = this._getThreatLevel(threatScore);

        // Generate behavioral indicators
        const indicators = this._generateIndicators(
            aggression, stress, deception, tension, badIntent, stability, expressions, behavioralPatterns
        );

        return {
            personId,
            threatScore: Math.min(100, Math.max(0, threatScore)),
            threatLevel,
            metrics: {
                aggression: Math.round(aggression),
                stress: Math.round(stress),
                deception: Math.round(deception),
                tension: Math.round(tension),
                badIntent: Math.round(badIntent),
                stability: Math.round(stability)
            },
            indicators,
            dominantExpression: expressions.dominant,
            framesAnalyzed: history.length,
            confidence: Math.min(100, Math.round((history.length / 60) * 100))
        };
    }

    /**
     * Clear tracking data for a person
     */
    clearPerson(personId) {
        this.frameHistory.delete(personId);
    }

    /**
     * Clear all tracking data
     */
    clearAll() {
        this.frameHistory.clear();
    }

    // ── Private Methods ──

    _extractFrameData(detection) {
        const expr = detection.expressions || {};
        const box = detection.detection ? detection.detection.box : detection.box || {};
        const landmarks = detection.landmarks;

        // Extract landmark positions for micro-movement analysis
        let landmarkPositions = null;
        if (landmarks) {
            const positions = landmarks.positions || landmarks._positions || [];
            landmarkPositions = positions.map(p => ({ x: p.x || p._x, y: p.y || p._y }));
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
            landmarks: landmarkPositions
        };
    }

    _aggregateExpressions(history) {
        const sums = { angry: 0, disgusted: 0, fearful: 0, happy: 0, neutral: 0, sad: 0, surprised: 0 };
        const peaks = { ...sums };

        history.forEach(frame => {
            Object.keys(sums).forEach(key => {
                sums[key] += frame.expressions[key];
                peaks[key] = Math.max(peaks[key], frame.expressions[key]);
            });
        });

        const count = history.length;
        const averages = {};
        Object.keys(sums).forEach(key => {
            averages[key] = sums[key] / count;
        });

        // Find dominant expression
        let dominant = 'neutral';
        let maxAvg = 0;
        Object.keys(averages).forEach(key => {
            if (averages[key] > maxAvg) {
                maxAvg = averages[key];
                dominant = key;
            }
        });

        return { averages, peaks, dominant };
    }

    _analyzeMicroMovements(history) {
        if (history.length < 2) return { avgMovement: 0, maxMovement: 0, jitter: 0 };

        const movements = [];
        const landmarkJitters = [];

        for (let i = 1; i < history.length; i++) {
            const prev = history[i - 1];
            const curr = history[i];

            // Box position movement (head movement)
            const dx = curr.box.x - prev.box.x;
            const dy = curr.box.y - prev.box.y;
            const movement = Math.sqrt(dx * dx + dy * dy);
            movements.push(movement);

            // Landmark jitter (micro-tremors in facial features)
            if (curr.landmarks && prev.landmarks && curr.landmarks.length === prev.landmarks.length) {
                let totalJitter = 0;
                const landmarkCount = Math.min(curr.landmarks.length, 68);
                for (let j = 0; j < landmarkCount; j++) {
                    if (curr.landmarks[j] && prev.landmarks[j]) {
                        const ldx = curr.landmarks[j].x - prev.landmarks[j].x;
                        const ldy = curr.landmarks[j].y - prev.landmarks[j].y;
                        totalJitter += Math.sqrt(ldx * ldx + ldy * ldy);
                    }
                }
                landmarkJitters.push(totalJitter / landmarkCount);
            }
        }

        const avgMovement = movements.reduce((a, b) => a + b, 0) / movements.length;
        const maxMovement = Math.max(...movements);

        // Jitter = rapid small involuntary movements (indicator of stress/nervousness)
        const avgJitter = landmarkJitters.length > 0
            ? landmarkJitters.reduce((a, b) => a + b, 0) / landmarkJitters.length
            : 0;

        // Movement variance (erratic movement indicator)
        const movementVariance = movements.reduce((sum, m) => sum + Math.pow(m - avgMovement, 2), 0) / movements.length;

        return {
            avgMovement,
            maxMovement,
            jitter: avgJitter,
            variance: movementVariance,
            erratic: movementVariance > avgMovement * 2
        };
    }

    _analyzeExpressionStability(history) {
        if (history.length < 3) return { stability: 100, rapidChanges: 0 };

        let rapidChanges = 0;
        const expressionDeltas = [];

        for (let i = 1; i < history.length; i++) {
            const prev = history[i - 1].expressions;
            const curr = history[i].expressions;

            let totalDelta = 0;
            Object.keys(curr).forEach(key => {
                totalDelta += Math.abs(curr[key] - prev[key]);
            });

            expressionDeltas.push(totalDelta);

            // Rapid change = big expression shift between frames
            if (totalDelta > 0.5) {
                rapidChanges++;
            }
        }

        const avgDelta = expressionDeltas.reduce((a, b) => a + b, 0) / expressionDeltas.length;
        const stability = Math.max(0, 100 - avgDelta * 200);

        return {
            stability,
            rapidChanges,
            avgDelta,
            changeRate: rapidChanges / history.length
        };
    }

    _analyzeBehavioralPatterns(history) {
        if (history.length < 10) return { gazeDrift: 0, headShake: 0, tensionBuild: false };

        // Analyze gaze drift (looking away frequently = potential deception)
        let gazeDrifts = 0;
        const windowSize = 5;

        for (let i = windowSize; i < history.length; i++) {
            const window = history.slice(i - windowSize, i);
            const xPositions = window.map(f => f.box.x);
            const range = Math.max(...xPositions) - Math.min(...xPositions);
            if (range > 15) gazeDrifts++;
        }

        // Analyze head shaking / nodding patterns
        let headShakes = 0;
        for (let i = 2; i < history.length; i++) {
            const dx1 = history[i - 1].box.x - history[i - 2].box.x;
            const dx2 = history[i].box.x - history[i - 1].box.x;
            if ((dx1 > 2 && dx2 < -2) || (dx1 < -2 && dx2 > 2)) {
                headShakes++;
            }
        }

        // Tension build: increasing angry/disgusted expression over time
        const firstHalf = history.slice(0, Math.floor(history.length / 2));
        const secondHalf = history.slice(Math.floor(history.length / 2));

        const firstTension = firstHalf.reduce((s, f) => s + f.expressions.angry + f.expressions.disgusted, 0) / firstHalf.length;
        const secondTension = secondHalf.reduce((s, f) => s + f.expressions.angry + f.expressions.disgusted, 0) / secondHalf.length;

        const tensionBuild = secondTension > firstTension + 0.05;

        // Suppression detection: neutral face with high jaw/brow tension (via landmarks)
        let suppressionScore = 0;
        const lastFrames = history.slice(-10);
        lastFrames.forEach(frame => {
            if (frame.expressions.neutral > 0.6 && frame.landmarks) {
                // Check for micro-tension even in "neutral" face
                suppressionScore += (frame.expressions.angry * 0.5 + frame.expressions.disgusted * 0.3);
            }
        });

        return {
            gazeDrift: gazeDrifts / history.length,
            headShake: headShakes / history.length,
            tensionBuild,
            suppressionScore: suppressionScore / lastFrames.length,
            patterns: {
                avoidance: gazeDrifts > history.length * 0.3,
                agitation: headShakes > history.length * 0.2,
                escalating: tensionBuild,
                suppressing: suppressionScore > 0.1
            }
        };
    }

    _calculateAggression(expressions, movements, patterns) {
        const base = (
            expressions.averages.angry * 100 * 1.8 +
            expressions.averages.disgusted * 100 * 0.6 +
            expressions.peaks.angry * 100 * 0.8
        );

        const movementFactor = movements.erratic ? 15 : 0;
        const tensionFactor = patterns.tensionBuild ? 12 : 0;
        const sensitivityMultiplier = this.sensitivity / 7;

        return Math.min(100, (base + movementFactor + tensionFactor) * sensitivityMultiplier);
    }

    _calculateStress(expressions, movements, stability) {
        const base = (
            expressions.averages.fearful * 100 * 1.2 +
            expressions.averages.surprised * 100 * 0.4 +
            expressions.averages.sad * 100 * 0.5
        );

        const jitterFactor = Math.min(30, movements.jitter * 10);
        const instabilityFactor = (100 - stability.stability) * 0.3;
        const sensitivityMultiplier = this.sensitivity / 7;

        return Math.min(100, (base + jitterFactor + instabilityFactor) * sensitivityMultiplier);
    }

    _calculateDeception(expressions, stability, patterns) {
        // Deception indicators: expression instability, gaze aversion, suppression
        const instability = stability.rapidChanges * 3;
        const gazeAversion = patterns.gazeDrift * 100;
        const suppression = patterns.suppressionScore * 200;

        // Micro-expression flashes (brief non-neutral expressions during neutral face)
        const microExprFlash = stability.changeRate * 80;

        const base = instability + gazeAversion + suppression + microExprFlash;
        const sensitivityMultiplier = this.sensitivity / 7;

        return Math.min(100, base * sensitivityMultiplier);
    }

    _calculateTension(expressions, movements) {
        const base = (
            expressions.averages.angry * 100 * 0.8 +
            expressions.averages.disgusted * 100 * 0.6 +
            expressions.averages.fearful * 100 * 0.5 +
            (100 - expressions.averages.happy * 100) * 0.1
        );

        const movementTension = movements.jitter * 15;
        const sensitivityMultiplier = this.sensitivity / 7;

        return Math.min(100, (base + movementTension) * sensitivityMultiplier);
    }

    _calculateBadIntent(aggression, deception, patterns) {
        // Bad intent = combination of aggression + deception + escalation
        const base = aggression * 0.4 + deception * 0.3;
        const escalation = patterns.tensionBuild ? 15 : 0;
        const agitation = patterns.patterns.agitation ? 10 : 0;
        const suppression = patterns.patterns.suppressing ? 12 : 0;

        return Math.min(100, base + escalation + agitation + suppression);
    }

    _calculateStability(expressionStability, movements) {
        const exprStability = expressionStability.stability;
        const movementStability = Math.max(0, 100 - movements.avgMovement * 5 - movements.jitter * 20);

        return (exprStability * 0.6 + movementStability * 0.4);
    }

    _getThreatLevel(score) {
        if (score >= this.thresholds.critical) return 'critical';
        if (score >= this.thresholds.elevated) return 'elevated';
        if (score >= this.thresholds.caution) return 'caution';
        return 'safe';
    }

    _generateIndicators(aggression, stress, deception, tension, badIntent, stability, expressions, patterns) {
        const indicators = [];

        if (aggression > 60) indicators.push({ label: 'HIGH AGGRESSION', color: 'red' });
        else if (aggression > 35) indicators.push({ label: 'MODERATE AGGRESSION', color: 'orange' });

        if (stress > 60) indicators.push({ label: 'HIGH STRESS', color: 'orange' });
        else if (stress > 35) indicators.push({ label: 'ELEVATED STRESS', color: 'yellow' });

        if (deception > 60) indicators.push({ label: 'DECEPTIVE SIGNALS', color: 'purple' });
        else if (deception > 35) indicators.push({ label: 'EVASIVE BEHAVIOR', color: 'purple' });

        if (tension > 60) indicators.push({ label: 'HIGH TENSION', color: 'orange' });

        if (badIntent > 70) indicators.push({ label: 'HOSTILE INTENT', color: 'red' });
        else if (badIntent > 50) indicators.push({ label: 'SUSPICIOUS INTENT', color: 'red' });

        if (patterns.patterns.escalating) indicators.push({ label: 'ESCALATING', color: 'red' });
        if (patterns.patterns.suppressing) indicators.push({ label: 'CONCEALING', color: 'purple' });
        if (patterns.patterns.avoidance) indicators.push({ label: 'GAZE AVOIDANCE', color: 'yellow' });
        if (patterns.patterns.agitation) indicators.push({ label: 'AGITATED', color: 'orange' });

        if (expressions.peaks.angry > 0.7) indicators.push({ label: 'ANGER SPIKE', color: 'red' });
        if (expressions.peaks.fearful > 0.6) indicators.push({ label: 'FEAR RESPONSE', color: 'yellow' });

        // Detection-mode specific indicators
        if (aggression > 70 && badIntent > 60) indicators.push({ label: 'VIOLENT TENDENCY', color: 'red' });
        if (stability < 25 && stress > 50) indicators.push({ label: 'MENTALLY UNSTABLE', color: 'red' });
        else if (stability < 30) indicators.push({ label: 'UNSTABLE', color: 'orange' });
        if (badIntent <= 70 && aggression > 50 && patterns.patterns.escalating) indicators.push({ label: 'HOSTILE INTENT', color: 'red' });
        if (stability > 85 && aggression < 20 && deception < 20) indicators.push({ label: 'COMPOSED', color: 'green' });

        if (indicators.length === 0) indicators.push({ label: 'CLEAR', color: 'green' });

        return indicators;
    }

    _quickAssess(personId) {
        const history = this.frameHistory.get(personId);
        if (!history || history.length < 2) return { level: 'safe', score: 0 };

        const recent = history.slice(-10);
        const avgAngry = recent.reduce((s, f) => s + f.expressions.angry, 0) / recent.length;
        const avgDisgusted = recent.reduce((s, f) => s + f.expressions.disgusted, 0) / recent.length;
        const avgFearful = recent.reduce((s, f) => s + f.expressions.fearful, 0) / recent.length;

        const quickScore = Math.round((avgAngry * 180 + avgDisgusted * 60 + avgFearful * 40) * (this.sensitivity / 7));
        const level = this._getThreatLevel(Math.min(100, quickScore));

        return { level, score: Math.min(100, quickScore) };
    }

    _defaultAssessment() {
        return {
            personId: 'unknown',
            threatScore: 0,
            threatLevel: 'safe',
            metrics: { aggression: 0, stress: 0, deception: 0, tension: 0, badIntent: 0, stability: 100 },
            indicators: [{ label: 'INSUFFICIENT DATA', color: 'yellow' }],
            dominantExpression: 'neutral',
            framesAnalyzed: 0,
            confidence: 0
        };
    }
}

window.ThreatEngine = ThreatEngine;
