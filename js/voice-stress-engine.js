/**
 * VoiceStressEngine — Real-time Voice Stress Analysis
 * Analyzes micro-tremors (8-12 Hz Lippold tremor), F0/pitch variation,
 * jitter, shimmer, and spectral features for deception detection.
 *
 * Based on: Lippold micro-tremor theory, F0 stress research (Kirchhübel 2013),
 * jitter/shimmer voice quality metrics, spectral centroid analysis.
 */

class VoiceStressEngine {
    constructor() {
        // Audio nodes
        this.audioContext = null;
        this.analyserNode = null;
        this.sourceNode = null;
        this.muteGain = null;
        this.scriptProcessor = null;

        // Buffers
        this.fftSize = 2048;
        this.timeDomainBuffer = null;
        this.frequencyBuffer = null;

        // Ring buffer for tremor analysis (2 seconds at 48kHz)
        this.ringBuffer = null;
        this.ringBufferSize = 96000;
        this.ringBufferWritePos = 0;
        this.ringBufferFilled = false;

        // State
        this.isActive = false;
        this.sampleRate = 48000;

        // Voice activity detection
        this.isSpeechActive = false;
        this.speechFrameCount = 0;
        this.silenceFrameCount = 0;
        this.totalFrameCount = 0;
        this.silencePauses = 0;
        this.inSilencePause = false;
        this.pauseDurations = [];
        this.currentPauseStart = 0;

        // F0 tracking
        this.f0History = [];
        this.f0Baseline = null;
        this.baselineF0Values = [];
        this.baselineEstablished = false;
        this.BASELINE_SPEECH_FRAMES = 150; // ~5 seconds of speech at 30fps

        // Jitter/shimmer
        this.pitchPeriods = [];
        this.cycleAmplitudes = [];

        // Spectral tracking
        this.spectralHistory = [];
        this.spectralBaseline = null;

        // Tremor tracking
        this.tremorHistory = [];

        // Timeline for report
        this.vsaTimeline = [];
        this.timelineWindowFrames = 30; // 1-second windows

        // Configuration
        this.F0_MIN = 75;
        this.F0_MAX = 400;
        this.VAD_THRESHOLD = 0.015;
        this.TREMOR_BAND_LOW = 8;
        this.TREMOR_BAND_HIGH = 12;
    }

    // ── Setup / Teardown ──

    async initAudioContext(stream) {
        this.destroy();

        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.sampleRate = this.audioContext.sampleRate;

            this.analyserNode = this.audioContext.createAnalyser();
            this.analyserNode.fftSize = this.fftSize;
            this.analyserNode.smoothingTimeConstant = 0.3;

            this.sourceNode = this.audioContext.createMediaStreamSource(stream);

            // Mute output to prevent feedback (GainNode with gain 0)
            this.muteGain = this.audioContext.createGain();
            this.muteGain.gain.value = 0;

            // ScriptProcessor for ring buffer accumulation
            this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
            this.scriptProcessor.onaudioprocess = (e) => {
                const input = e.inputBuffer.getChannelData(0);
                this._fillRingBuffer(input);
            };

            // Connect: source → analyser → scriptProcessor → muteGain → destination
            this.sourceNode.connect(this.analyserNode);
            this.analyserNode.connect(this.scriptProcessor);
            this.scriptProcessor.connect(this.muteGain);
            this.muteGain.connect(this.audioContext.destination);

            this._allocateBuffers();
            this.isActive = true;
        } catch (err) {
            console.error('VSA initAudioContext failed:', err);
            this.destroy();
            throw err;
        }
    }

    async initFromMediaElement(videoElement) {
        this.destroy();

        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.sampleRate = this.audioContext.sampleRate;

            this.analyserNode = this.audioContext.createAnalyser();
            this.analyserNode.fftSize = this.fftSize;
            this.analyserNode.smoothingTimeConstant = 0.3;

            this.sourceNode = this.audioContext.createMediaElementSource(videoElement);

            // Mute output so user doesn't hear audio playback
            this.muteGain = this.audioContext.createGain();
            this.muteGain.gain.value = 0;

            this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
            this.scriptProcessor.onaudioprocess = (e) => {
                const input = e.inputBuffer.getChannelData(0);
                this._fillRingBuffer(input);
            };

            this.sourceNode.connect(this.analyserNode);
            this.analyserNode.connect(this.scriptProcessor);
            this.scriptProcessor.connect(this.muteGain);
            this.muteGain.connect(this.audioContext.destination);

            this._allocateBuffers();
            this.isActive = true;
        } catch (err) {
            console.error('VSA initFromMediaElement failed:', err);
            this.destroy();
            throw err;
        }
    }

    _allocateBuffers() {
        this.timeDomainBuffer = new Float32Array(this.fftSize);
        this.frequencyBuffer = new Float32Array(this.analyserNode.frequencyBinCount);
        this.ringBuffer = new Float32Array(this.ringBufferSize);
        this.ringBufferWritePos = 0;
        this.ringBufferFilled = false;
    }

    _fillRingBuffer(samples) {
        for (let i = 0; i < samples.length; i++) {
            this.ringBuffer[this.ringBufferWritePos] = samples[i];
            this.ringBufferWritePos++;
            if (this.ringBufferWritePos >= this.ringBufferSize) {
                this.ringBufferWritePos = 0;
                this.ringBufferFilled = true;
            }
        }
    }

    destroy() {
        if (this.scriptProcessor) {
            this.scriptProcessor.onaudioprocess = null;
            try { this.scriptProcessor.disconnect(); } catch (e) {}
        }
        if (this.sourceNode) {
            try { this.sourceNode.disconnect(); } catch (e) {}
        }
        if (this.analyserNode) {
            try { this.analyserNode.disconnect(); } catch (e) {}
        }
        if (this.muteGain) {
            try { this.muteGain.disconnect(); } catch (e) {}
        }
        if (this.audioContext && this.audioContext.state !== 'closed') {
            try { this.audioContext.close(); } catch (e) {}
        }

        this.audioContext = null;
        this.analyserNode = null;
        this.sourceNode = null;
        this.muteGain = null;
        this.scriptProcessor = null;
        this.isActive = false;
    }

    clearAll() {
        this.f0History = [];
        this.f0Baseline = null;
        this.baselineF0Values = [];
        this.baselineEstablished = false;
        this.pitchPeriods = [];
        this.cycleAmplitudes = [];
        this.spectralHistory = [];
        this.spectralBaseline = null;
        this.tremorHistory = [];
        this.vsaTimeline = [];
        this.speechFrameCount = 0;
        this.silenceFrameCount = 0;
        this.totalFrameCount = 0;
        this.silencePauses = 0;
        this.inSilencePause = false;
        this.pauseDurations = [];
        this.currentPauseStart = 0;
        this.isSpeechActive = false;
        if (this.ringBuffer) this.ringBuffer.fill(0);
        this.ringBufferWritePos = 0;
        this.ringBufferFilled = false;
    }

    // ── Real-time Processing ──

    processAudioFrame() {
        if (!this.isActive || !this.analyserNode) return;

        this.totalFrameCount++;

        // Get audio data
        this.analyserNode.getFloatTimeDomainData(this.timeDomainBuffer);
        this.analyserNode.getFloatFrequencyData(this.frequencyBuffer);

        // Voice activity detection
        this.isSpeechActive = this._detectVoiceActivity();

        if (this.isSpeechActive) {
            this.speechFrameCount++;

            // Track silence pauses
            if (this.inSilencePause) {
                this.inSilencePause = false;
                this.pauseDurations.push(this.totalFrameCount - this.currentPauseStart);
            }

            // F0 tracking
            const f0 = this._trackFundamentalFrequency();
            if (f0 > 0) {
                this.f0History.push({ time: this.totalFrameCount, f0, amplitude: this._computeRMS(this.timeDomainBuffer) });

                // Baseline establishment
                if (!this.baselineEstablished) {
                    this.baselineF0Values.push(f0);
                    if (this.baselineF0Values.length >= this.BASELINE_SPEECH_FRAMES) {
                        this._establishBaseline();
                    }
                }

                // Jitter: track consecutive pitch periods
                const period = this.sampleRate / f0;
                this.pitchPeriods.push(period);
                if (this.pitchPeriods.length > 300) this.pitchPeriods.shift();

                // Shimmer: track amplitudes
                this.cycleAmplitudes.push(this._computeRMS(this.timeDomainBuffer));
                if (this.cycleAmplitudes.length > 300) this.cycleAmplitudes.shift();
            }

            // Spectral features
            const spectral = this._analyzeSpectralFeatures();
            this.spectralHistory.push(spectral);
            if (this.spectralHistory.length > 900) this.spectralHistory.shift();

            // Establish spectral baseline
            if (!this.spectralBaseline && this.spectralHistory.length >= this.BASELINE_SPEECH_FRAMES) {
                const baseSamples = this.spectralHistory.slice(0, this.BASELINE_SPEECH_FRAMES);
                this.spectralBaseline = {
                    centroid: baseSamples.reduce((s, sp) => s + sp.centroid, 0) / baseSamples.length,
                    hammarberg: baseSamples.reduce((s, sp) => s + sp.hammarberg, 0) / baseSamples.length
                };
            }
        } else {
            // Track silence
            this.silenceFrameCount++;
            if (!this.inSilencePause && this.speechFrameCount > 0) {
                this.inSilencePause = true;
                this.currentPauseStart = this.totalFrameCount;
                this.silencePauses++;
            }
        }

        // Micro-tremor analysis (runs regardless of VAD, needs continuous buffer)
        if (this.ringBufferFilled || this.ringBufferWritePos > this.sampleRate) {
            const tremor = this._analyzeMicroTremor();
            if (tremor) {
                this.tremorHistory.push({ time: this.totalFrameCount, ...tremor });
                if (this.tremorHistory.length > 300) this.tremorHistory.shift();
            }
        }

        // Build timeline entry every ~1 second
        if (this.totalFrameCount % this.timelineWindowFrames === 0) {
            const assess = this._quickAssess();
            this.vsaTimeline.push({
                timeSeconds: Math.round(this.totalFrameCount / 30),
                voiceStress: assess.voiceStress,
                f0: assess.currentF0,
                isSpeaking: assess.isSpeaking
            });
        }
    }

    // ── Quick Real-time Assessment ──

    _quickAssess() {
        if (this.totalFrameCount < 5) {
            return this._defaultQuickResult();
        }

        // F0 deviation score
        let f0DeviationScore = 0;
        let f0DeviationPercent = 0;
        let currentF0 = 0;
        if (this.f0History.length > 0) {
            const recentF0 = this.f0History.slice(-30).map(h => h.f0);
            currentF0 = recentF0[recentF0.length - 1] || 0;

            if (this.baselineEstablished && this.f0Baseline) {
                const recentMean = recentF0.reduce((a, b) => a + b, 0) / recentF0.length;
                f0DeviationPercent = Math.abs((recentMean - this.f0Baseline.meanF0) / this.f0Baseline.meanF0 * 100);
                // Score: 0% deviation = 0 score, 5% = 25, 10% = 50, 20% = 100
                f0DeviationScore = Math.min(100, f0DeviationPercent * 5);
            }
        }

        // Tremor score
        let tremorScore = 0;
        if (this.tremorHistory.length > 0) {
            const recentTremor = this.tremorHistory.slice(-10);
            const avgEnergy = recentTremor.reduce((s, t) => s + t.energyRatio, 0) / recentTremor.length;
            const avgPeakFreq = recentTremor.reduce((s, t) => s + t.peakFreq, 0) / recentTremor.length;

            // Higher energy in 8-12 Hz = more stress. Peak freq > 9.5 Hz = elevated stress
            tremorScore = Math.min(100, Math.round(
                avgEnergy * 200 +
                (avgPeakFreq > 9.5 ? (avgPeakFreq - 9.5) * 30 : 0)
            ));
        }

        // Jitter score
        let jitterPercent = 0;
        let jitterScore = 0;
        if (this.pitchPeriods.length > 10) {
            const jitter = this._computeJitter();
            jitterPercent = jitter.relativeJitter;
            // Normal < 1.04%, abnormal > 1.5%. Under stress: jitter often decreases (muscles tense)
            // We score deviation from normal range in either direction
            const deviation = Math.abs(jitterPercent - 1.0);
            jitterScore = Math.min(100, deviation * 80);
        }

        // Spectral shift score
        let spectralShiftScore = 0;
        if (this.spectralBaseline && this.spectralHistory.length > 10) {
            const recentSpectral = this.spectralHistory.slice(-30);
            const recentCentroid = recentSpectral.reduce((s, sp) => s + sp.centroid, 0) / recentSpectral.length;
            const centroidShift = Math.abs(recentCentroid - this.spectralBaseline.centroid);
            spectralShiftScore = Math.min(100, centroidShift / 10);
        }

        // Shimmer score
        let shimmerScore = 0;
        if (this.cycleAmplitudes.length > 10) {
            const shimmer = this._computeShimmer();
            // Normal < 3.81%. Deviation from normal = stress indicator
            const deviation = Math.abs(shimmer.relativeShimmer - 3.0);
            shimmerScore = Math.min(100, deviation * 15);
        }

        // Composite voice stress (weighted)
        const voiceStress = Math.min(100, Math.round(
            f0DeviationScore * 0.30 +
            tremorScore * 0.25 +
            jitterScore * 0.20 +
            spectralShiftScore * 0.15 +
            shimmerScore * 0.10
        ));

        return {
            voiceStress,
            f0Deviation: Math.round(f0DeviationPercent * 10) / 10,
            tremorScore,
            jitter: Math.round(jitterPercent * 100) / 100,
            spectralShift: spectralShiftScore,
            isSpeaking: this.isSpeechActive,
            hasBaseline: this.baselineEstablished,
            currentF0: Math.round(currentF0)
        };
    }

    _defaultQuickResult() {
        return {
            voiceStress: 0,
            f0Deviation: 0,
            tremorScore: 0,
            jitter: 0,
            spectralShift: 0,
            isSpeaking: false,
            hasBaseline: false,
            currentF0: 0
        };
    }

    // ── Core Analysis Methods ──

    _detectVoiceActivity() {
        const rms = this._computeRMS(this.timeDomainBuffer);
        if (rms < this.VAD_THRESHOLD) return false;

        // Secondary: zero-crossing rate (speech typically 0.05-0.3)
        let zcr = 0;
        for (let i = 1; i < this.timeDomainBuffer.length; i++) {
            if ((this.timeDomainBuffer[i] >= 0) !== (this.timeDomainBuffer[i - 1] >= 0)) zcr++;
        }
        const zcrRate = zcr / this.timeDomainBuffer.length;

        // Speech: moderate RMS + ZCR in speech range
        return rms >= this.VAD_THRESHOLD && zcrRate > 0.02 && zcrRate < 0.5;
    }

    _trackFundamentalFrequency() {
        // Apply Hann window
        const windowed = this._hannWindow(this.timeDomainBuffer);

        // Autocorrelation
        const size = windowed.length;
        const minLag = Math.floor(this.sampleRate / this.F0_MAX);
        const maxLag = Math.ceil(this.sampleRate / this.F0_MIN);

        // Compute energy for normalization
        let energy = 0;
        for (let i = 0; i < size; i++) energy += windowed[i] * windowed[i];
        if (energy < 0.001) return -1;

        // Autocorrelation for candidate lags
        let bestLag = -1;
        let bestVal = -1;

        for (let lag = minLag; lag <= maxLag && lag < size; lag++) {
            let correlation = 0;
            let energy1 = 0;
            let energy2 = 0;
            for (let j = 0; j < size - lag; j++) {
                correlation += windowed[j] * windowed[j + lag];
                energy1 += windowed[j] * windowed[j];
                energy2 += windowed[j + lag] * windowed[j + lag];
            }

            // Normalized autocorrelation
            const denom = Math.sqrt(energy1 * energy2);
            if (denom < 0.001) continue;
            const norm = correlation / denom;

            if (norm > bestVal && norm > 0.4) {
                bestVal = norm;
                bestLag = lag;
            }
        }

        if (bestLag <= 0) return -1;

        // Parabolic interpolation for sub-sample accuracy
        if (bestLag > minLag && bestLag < maxLag - 1) {
            const y1 = this._normalizedCorrelation(windowed, bestLag - 1);
            const y2 = this._normalizedCorrelation(windowed, bestLag);
            const y3 = this._normalizedCorrelation(windowed, bestLag + 1);
            const a = (y1 + y3 - 2 * y2) / 2;
            if (a !== 0) {
                const offset = -(y3 - y1) / (2 * a * 2);
                bestLag += offset;
            }
        }

        const f0 = this.sampleRate / bestLag;
        return (f0 >= this.F0_MIN && f0 <= this.F0_MAX) ? f0 : -1;
    }

    _normalizedCorrelation(buffer, lag) {
        const size = buffer.length;
        let correlation = 0, e1 = 0, e2 = 0;
        for (let j = 0; j < size - lag; j++) {
            correlation += buffer[j] * buffer[j + lag];
            e1 += buffer[j] * buffer[j];
            e2 += buffer[j + lag] * buffer[j + lag];
        }
        const denom = Math.sqrt(e1 * e2);
        return denom > 0 ? correlation / denom : 0;
    }

    _computeJitter() {
        const periods = this.pitchPeriods;
        if (periods.length < 2) return { absoluteJitter: 0, relativeJitter: 0 };

        const N = periods.length;
        let sumAbsDiff = 0;
        for (let i = 1; i < N; i++) {
            sumAbsDiff += Math.abs(periods[i] - periods[i - 1]);
        }
        const absoluteJitter = sumAbsDiff / (N - 1);
        const meanPeriod = periods.reduce((a, b) => a + b, 0) / N;
        const relativeJitter = meanPeriod > 0 ? (absoluteJitter / meanPeriod) * 100 : 0;

        return { absoluteJitter, relativeJitter };
    }

    _computeShimmer() {
        const amps = this.cycleAmplitudes;
        if (amps.length < 2) return { shimmerDB: 0, relativeShimmer: 0 };

        const N = amps.length;
        let sumAbsDiff = 0;
        let sumAbsLogDiff = 0;
        for (let i = 1; i < N; i++) {
            sumAbsDiff += Math.abs(amps[i] - amps[i - 1]);
            if (amps[i] > 0 && amps[i - 1] > 0) {
                sumAbsLogDiff += Math.abs(20 * Math.log10(amps[i] / amps[i - 1]));
            }
        }
        const meanAmp = amps.reduce((a, b) => a + b, 0) / N;
        const relativeShimmer = meanAmp > 0 ? (sumAbsDiff / (N - 1)) / meanAmp * 100 : 0;
        const shimmerDB = sumAbsLogDiff / (N - 1);

        return { shimmerDB, relativeShimmer };
    }

    _analyzeSpectralFeatures() {
        const binWidth = this.sampleRate / this.fftSize;
        const numBins = this.frequencyBuffer.length;

        // Convert dB to linear magnitude
        let weightedSum = 0;
        let totalMag = 0;
        let lowEnergy = 0;  // 0-500 Hz
        let midEnergy = 0;  // 500-2000 Hz
        let highEnergy = 0; // 2000-8000 Hz
        let below2k = 0;
        let above2k = 0;

        for (let i = 0; i < numBins; i++) {
            const freq = i * binWidth;
            const mag = Math.pow(10, this.frequencyBuffer[i] / 20);
            const magSq = mag * mag;

            weightedSum += freq * mag;
            totalMag += mag;

            if (freq <= 500) lowEnergy += magSq;
            else if (freq <= 2000) midEnergy += magSq;
            else if (freq <= 8000) highEnergy += magSq;

            if (freq <= 2000) below2k += magSq;
            else if (freq <= 5000) above2k += magSq;
        }

        const centroid = totalMag > 0 ? weightedSum / totalMag : 0;
        const totalEnergy = lowEnergy + midEnergy + highEnergy;
        const hammarberg = above2k > 0 ? 10 * Math.log10(below2k / above2k) : 0;

        return {
            centroid,
            lowRatio: totalEnergy > 0 ? lowEnergy / totalEnergy : 0,
            midRatio: totalEnergy > 0 ? midEnergy / totalEnergy : 0,
            highRatio: totalEnergy > 0 ? highEnergy / totalEnergy : 0,
            hammarberg
        };
    }

    _analyzeMicroTremor() {
        // Need at least 1 second of data
        const availableSamples = this.ringBufferFilled ? this.ringBufferSize : this.ringBufferWritePos;
        const analysisLength = Math.min(availableSamples, this.sampleRate * 2); // Use up to 2 seconds
        if (analysisLength < this.sampleRate) return null;

        // Extract the most recent data from ring buffer
        const data = new Float32Array(analysisLength);
        let readPos = this.ringBufferFilled ?
            (this.ringBufferWritePos - analysisLength + this.ringBufferSize) % this.ringBufferSize :
            0;
        for (let i = 0; i < analysisLength; i++) {
            data[i] = this.ringBuffer[readPos % this.ringBufferSize];
            readPos++;
        }

        // Extract amplitude envelope: rectify + smooth
        const smoothWindow = Math.floor(this.sampleRate / 200); // ~5ms window
        const envelope = new Float32Array(analysisLength);
        for (let i = 0; i < analysisLength; i++) {
            let sum = 0;
            let count = 0;
            const start = Math.max(0, i - smoothWindow);
            const end = Math.min(analysisLength, i + smoothWindow + 1);
            for (let j = start; j < end; j++) {
                sum += Math.abs(data[j]);
                count++;
            }
            envelope[i] = sum / count;
        }

        // Remove DC offset
        const envMean = envelope.reduce((a, b) => a + b, 0) / envelope.length;
        for (let i = 0; i < envelope.length; i++) envelope[i] -= envMean;

        // Downsample envelope to ~200 Hz for efficient FFT of low frequencies
        const targetRate = 200;
        const decimation = Math.floor(this.sampleRate / targetRate);
        const dsLen = Math.floor(envelope.length / decimation);
        const downsampled = new Float32Array(dsLen);
        for (let i = 0; i < dsLen; i++) {
            downsampled[i] = envelope[i * decimation];
        }

        // FFT of downsampled envelope
        const fftLen = this._nextPowerOf2(dsLen);
        const padded = new Float32Array(fftLen);
        for (let i = 0; i < dsLen; i++) padded[i] = downsampled[i];

        const spectrum = this._fftMagnitude(padded);
        const binRes = targetRate / fftLen;

        // Analyze 8-12 Hz band
        const lowBin = Math.floor(this.TREMOR_BAND_LOW / binRes);
        const highBin = Math.ceil(this.TREMOR_BAND_HIGH / binRes);
        const totalBin = Math.floor(20 / binRes); // 0-20 Hz total for comparison

        let bandEnergy = 0;
        let totalEnergy = 0;
        let peakVal = 0;
        let peakBin = lowBin;

        for (let i = 1; i < Math.min(totalBin, spectrum.length); i++) {
            totalEnergy += spectrum[i] * spectrum[i];
            if (i >= lowBin && i <= highBin) {
                bandEnergy += spectrum[i] * spectrum[i];
                if (spectrum[i] > peakVal) {
                    peakVal = spectrum[i];
                    peakBin = i;
                }
            }
        }

        return {
            energyRatio: totalEnergy > 0 ? bandEnergy / totalEnergy : 0,
            peakFreq: peakBin * binRes,
            bandEnergy,
            totalEnergy
        };
    }

    _establishBaseline() {
        const vals = this.baselineF0Values;
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const variance = vals.reduce((s, v) => s + (v - mean) * (v - mean), 0) / vals.length;
        this.f0Baseline = {
            meanF0: mean,
            sdF0: Math.sqrt(variance)
        };
        this.baselineEstablished = true;
    }

    // ── Full Post-Scan Analysis ──

    fullAnalysis() {
        const speechRatio = this.totalFrameCount > 0
            ? Math.round((this.speechFrameCount / this.totalFrameCount) * 100) : 0;

        if (this.speechFrameCount < 10) {
            return this._defaultFullResult(speechRatio);
        }

        const fps = 30;
        const totalDuration = this.totalFrameCount / fps;
        const speechDuration = this.speechFrameCount / fps;

        // F0 analysis
        const allF0 = this.f0History.map(h => h.f0);
        const f0Mean = allF0.length > 0 ? allF0.reduce((a, b) => a + b, 0) / allF0.length : 0;
        const f0SD = allF0.length > 1 ? Math.sqrt(allF0.reduce((s, v) => s + (v - f0Mean) * (v - f0Mean), 0) / allF0.length) : 0;
        const f0Range = allF0.length > 0 ? Math.max(...allF0) - Math.min(...allF0) : 0;

        let f0DeviationPercent = 0;
        if (this.baselineEstablished && this.f0Baseline) {
            // Analysis mean = mean of post-baseline F0 values
            const postBaseline = this.f0History.slice(this.BASELINE_SPEECH_FRAMES);
            if (postBaseline.length > 0) {
                const analysisMean = postBaseline.reduce((s, h) => s + h.f0, 0) / postBaseline.length;
                f0DeviationPercent = Math.abs((analysisMean - this.f0Baseline.meanF0) / this.f0Baseline.meanF0 * 100);
            }
        }

        const f0Assessment = f0DeviationPercent > 15 ? 'High Stress'
            : f0DeviationPercent > 5 ? 'Elevated'
            : 'Normal';

        // Tremor analysis
        let tremorAvgEnergy = 0;
        let tremorPeakEnergy = 0;
        let tremorAvgFreq = 0;
        let tremorScore = 0;
        if (this.tremorHistory.length > 0) {
            tremorAvgEnergy = this.tremorHistory.reduce((s, t) => s + t.energyRatio, 0) / this.tremorHistory.length;
            tremorPeakEnergy = Math.max(...this.tremorHistory.map(t => t.energyRatio));
            tremorAvgFreq = this.tremorHistory.reduce((s, t) => s + t.peakFreq, 0) / this.tremorHistory.length;
            tremorScore = Math.min(100, Math.round(
                tremorAvgEnergy * 200 +
                (tremorAvgFreq > 9.5 ? (tremorAvgFreq - 9.5) * 30 : 0)
            ));
        }

        const tremorAssessment = tremorScore > 60 ? 'High — vocal tremor pattern consistent with elevated stress'
            : tremorScore > 30 ? 'Moderate — some tremor variation detected'
            : 'Normal — tremor patterns within expected range';

        // Jitter/shimmer
        const jitter = this._computeJitter();
        const shimmer = this._computeShimmer();

        const jitterAssessment = jitter.relativeJitter > 1.5 ? 'Elevated pitch perturbation'
            : jitter.relativeJitter < 0.5 ? 'Low jitter — possible muscle tension'
            : 'Normal range';

        const shimmerAssessment = shimmer.relativeShimmer > 5 ? 'Elevated amplitude variation'
            : 'Normal range';

        // Spectral
        let centroidShift = 0;
        let hammarbergShift = 0;
        let spectralAssessment = 'Insufficient data';
        if (this.spectralBaseline && this.spectralHistory.length > this.BASELINE_SPEECH_FRAMES) {
            const postBaseline = this.spectralHistory.slice(this.BASELINE_SPEECH_FRAMES);
            const analysisCentroid = postBaseline.reduce((s, sp) => s + sp.centroid, 0) / postBaseline.length;
            const analysisHammarberg = postBaseline.reduce((s, sp) => s + sp.hammarberg, 0) / postBaseline.length;
            centroidShift = Math.round(analysisCentroid - this.spectralBaseline.centroid);
            hammarbergShift = Math.round((analysisHammarberg - this.spectralBaseline.hammarberg) * 10) / 10;
            spectralAssessment = Math.abs(centroidShift) > 100 ? 'Significant spectral shift detected'
                : 'Spectral distribution within normal variation';
        }

        // Speech metrics
        const avgPauseDuration = this.pauseDurations.length > 0
            ? Math.round(this.pauseDurations.reduce((a, b) => a + b, 0) / this.pauseDurations.length / fps * 100) / 100
            : 0;

        // Composite voice stress score
        const f0Score = Math.min(100, f0DeviationPercent * 5);
        const spectralScore = this.spectralBaseline ? Math.min(100, Math.abs(centroidShift) / 10) : 0;
        const jitterScore = Math.min(100, Math.abs(jitter.relativeJitter - 1.0) * 80);
        const shimmerScoreVal = Math.min(100, Math.abs(shimmer.relativeShimmer - 3.0) * 15);

        const voiceStressScore = Math.min(100, Math.round(
            f0Score * 0.30 +
            tremorScore * 0.25 +
            jitterScore * 0.20 +
            spectralScore * 0.15 +
            shimmerScoreVal * 0.10
        ));

        const confidenceLevel = Math.min(100, Math.round(
            (this.speechFrameCount / 300) * 50 +
            (this.baselineEstablished ? 40 : 0) +
            (this.tremorHistory.length > 10 ? 10 : 0)
        ));

        // Indicators
        const indicators = this._generateIndicators(voiceStressScore, f0DeviationPercent, tremorScore, jitter.relativeJitter);

        // Overall assessment
        const overallAssessment = this._generateAssessment(voiceStressScore, f0Assessment, tremorAssessment, speechRatio);

        return {
            voiceStressScore,
            confidenceLevel,
            baselineEstablished: this.baselineEstablished,

            fundamentalFrequency: {
                baselineMean: this.f0Baseline ? Math.round(this.f0Baseline.meanF0) : null,
                baselineSD: this.f0Baseline ? Math.round(this.f0Baseline.sdF0 * 10) / 10 : null,
                analysisMean: Math.round(f0Mean),
                analysisSD: Math.round(f0SD * 10) / 10,
                deviationPercent: Math.round(f0DeviationPercent * 10) / 10,
                range: Math.round(f0Range),
                assessment: f0Assessment
            },

            microTremor: {
                avgEnergy: Math.round(tremorAvgEnergy * 1000) / 1000,
                peakEnergy: Math.round(tremorPeakEnergy * 1000) / 1000,
                avgPeakFreq: Math.round(tremorAvgFreq * 10) / 10,
                tremorScore,
                assessment: tremorAssessment
            },

            voiceQuality: {
                jitter: Math.round(jitter.relativeJitter * 100) / 100,
                shimmer: Math.round(shimmer.relativeShimmer * 100) / 100,
                shimmerDB: Math.round(shimmer.shimmerDB * 100) / 100,
                jitterAssessment,
                shimmerAssessment
            },

            spectralAnalysis: {
                baselineCentroid: this.spectralBaseline ? Math.round(this.spectralBaseline.centroid) : null,
                centroidShift,
                hammarbergShift,
                assessment: spectralAssessment
            },

            speechMetrics: {
                speechRatio,
                totalSpeechDuration: Math.round(speechDuration * 10) / 10,
                totalDuration: Math.round(totalDuration * 10) / 10,
                silencePauses: this.silencePauses,
                avgPauseDuration
            },

            vsaTimeline: this.vsaTimeline,
            indicators,
            overallAssessment
        };
    }

    _defaultFullResult(speechRatio) {
        return {
            voiceStressScore: 0,
            confidenceLevel: 0,
            baselineEstablished: false,
            fundamentalFrequency: { baselineMean: null, baselineSD: null, analysisMean: 0, analysisSD: 0, deviationPercent: 0, range: 0, assessment: 'Insufficient speech data' },
            microTremor: { avgEnergy: 0, peakEnergy: 0, avgPeakFreq: 0, tremorScore: 0, assessment: 'Insufficient data' },
            voiceQuality: { jitter: 0, shimmer: 0, shimmerDB: 0, jitterAssessment: 'No data', shimmerAssessment: 'No data' },
            spectralAnalysis: { baselineCentroid: null, centroidShift: 0, hammarbergShift: 0, assessment: 'Insufficient data' },
            speechMetrics: { speechRatio, totalSpeechDuration: 0, totalDuration: this.totalFrameCount / 30, silencePauses: 0, avgPauseDuration: 0 },
            vsaTimeline: [],
            indicators: [{ label: 'INSUFFICIENT SPEECH', color: 'yellow' }],
            overallAssessment: 'Insufficient speech detected for voice stress analysis. Ensure the subject speaks clearly into the microphone.'
        };
    }

    _generateIndicators(voiceStress, f0Dev, tremor, jitter) {
        const indicators = [];

        if (voiceStress >= 70) indicators.push({ label: 'HIGH VOICE STRESS', color: 'red' });
        else if (voiceStress >= 40) indicators.push({ label: 'ELEVATED VOICE STRESS', color: 'orange' });

        if (f0Dev > 15) indicators.push({ label: 'SIGNIFICANT PITCH SHIFT', color: 'red' });
        else if (f0Dev > 8) indicators.push({ label: 'PITCH DEVIATION', color: 'orange' });

        if (tremor >= 60) indicators.push({ label: 'VOCAL TREMOR DETECTED', color: 'red' });
        else if (tremor >= 30) indicators.push({ label: 'MILD TREMOR', color: 'yellow' });

        if (jitter < 0.5) indicators.push({ label: 'VOCAL TENSION', color: 'orange' });
        else if (jitter > 2.0) indicators.push({ label: 'VOICE INSTABILITY', color: 'orange' });

        if (!this.baselineEstablished) indicators.push({ label: 'NO BASELINE', color: 'yellow' });

        if (indicators.length === 0) indicators.push({ label: 'VOICE NORMAL', color: 'green' });

        return indicators;
    }

    _generateAssessment(voiceStress, f0Assessment, tremorAssessment, speechRatio) {
        if (speechRatio < 10) {
            return 'Minimal speech detected during the interview. Voice stress analysis is unreliable. Recommend repeating with verbal responses from the subject.';
        }

        if (!this.baselineEstablished) {
            return 'Voice baseline could not be established due to insufficient sustained speech. The voice stress score is based on absolute metrics only and has reduced reliability.';
        }

        if (voiceStress >= 70) {
            return `Voice analysis indicates high stress levels (${voiceStress}%). ${f0Assessment === 'High Stress' ? 'Fundamental frequency deviated significantly from baseline.' : ''} ${tremorAssessment.includes('High') ? 'Vocal micro-tremor patterns are consistent with psychophysiological stress response.' : ''} These voice patterns, combined with facial analysis, suggest elevated likelihood of deceptive behavior.`;
        }

        if (voiceStress >= 40) {
            return `Voice analysis indicates moderate stress levels (${voiceStress}%). Some deviation from baseline vocal patterns was detected. This may indicate cognitive load associated with deception, or normal interview anxiety. Consider in conjunction with facial behavioral indicators.`;
        }

        return `Voice analysis indicates low stress levels (${voiceStress}%). Vocal patterns remain close to baseline with normal tremor and pitch variation. Voice biometrics are consistent with truthful baseline behavior.`;
    }

    // ── Utility Methods ──

    _computeRMS(buffer) {
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
            sum += buffer[i] * buffer[i];
        }
        return Math.sqrt(sum / buffer.length);
    }

    _hannWindow(buffer) {
        const windowed = new Float32Array(buffer.length);
        for (let i = 0; i < buffer.length; i++) {
            windowed[i] = buffer[i] * 0.5 * (1 - Math.cos(2 * Math.PI * i / (buffer.length - 1)));
        }
        return windowed;
    }

    _nextPowerOf2(n) {
        let p = 1;
        while (p < n) p <<= 1;
        return p;
    }

    _fftMagnitude(buffer) {
        // Cooley-Tukey radix-2 FFT, returns magnitude spectrum
        const N = buffer.length;
        const real = new Float32Array(N);
        const imag = new Float32Array(N);

        // Bit-reversal permutation
        for (let i = 0; i < N; i++) {
            let j = 0;
            let x = i;
            for (let k = 0; k < Math.log2(N); k++) {
                j = (j << 1) | (x & 1);
                x >>= 1;
            }
            real[j] = buffer[i];
        }

        // FFT butterfly
        for (let size = 2; size <= N; size *= 2) {
            const halfSize = size / 2;
            const angle = -2 * Math.PI / size;
            for (let i = 0; i < N; i += size) {
                for (let j = 0; j < halfSize; j++) {
                    const cos = Math.cos(angle * j);
                    const sin = Math.sin(angle * j);
                    const tReal = real[i + j + halfSize] * cos - imag[i + j + halfSize] * sin;
                    const tImag = real[i + j + halfSize] * sin + imag[i + j + halfSize] * cos;
                    real[i + j + halfSize] = real[i + j] - tReal;
                    imag[i + j + halfSize] = imag[i + j] - tImag;
                    real[i + j] += tReal;
                    imag[i + j] += tImag;
                }
            }
        }

        // Magnitude spectrum (first half)
        const mag = new Float32Array(N / 2);
        for (let i = 0; i < N / 2; i++) {
            mag[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
        }
        return mag;
    }
}

window.VoiceStressEngine = VoiceStressEngine;
