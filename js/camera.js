/* ============================================
   CAMERA MODULE - Optimized for Vibration Analysis
   High frame rate, resolution, and fixed exposure
   for capturing micro-movements, tremors, and
   subtle facial energy patterns
   ============================================ */

class CameraManager {
    constructor(videoElement) {
        this.video = videoElement;
        this.stream = null;
        this.facingMode = 'user'; // 'user' = front, 'environment' = back
        this.isActive = false;
        this.actualFrameRate = 0;
        this.captureMode = 'vibration'; // 'vibration' = optimized for micro-movement capture
    }

    async start() {
        try {
            await this.stop();

            // Optimized constraints for vibration/micro-movement capture:
            // - High frame rate (60fps ideal) to detect micro-tremors (4-12 Hz)
            // - 720p resolution for precise landmark tracking
            // - Constrained exposure to reduce motion blur on micro-movements
            const constraints = {
                video: {
                    facingMode: this.facingMode,
                    width: { ideal: 1280, min: 640 },
                    height: { ideal: 720, min: 480 },
                    frameRate: { ideal: 60, min: 30 }
                },
                audio: false
            };

            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.video.srcObject = this.stream;
            this.isActive = true;

            // Apply advanced track constraints for vibration capture
            await this._applyAdvancedConstraints();

            return new Promise((resolve) => {
                this.video.onloadedmetadata = () => {
                    this.video.play();
                    this._logCaptureSettings();
                    resolve(true);
                };
            });
        } catch (err) {
            console.error('Camera error:', err);
            this.isActive = false;
            throw err;
        }
    }

    /**
     * Apply advanced constraints to optimize for micro-movement detection.
     * Disables auto-adjustments that can introduce noise into landmark tracking.
     */
    async _applyAdvancedConstraints() {
        if (!this.stream) return;

        const track = this.stream.getVideoTracks()[0];
        if (!track) return;

        const capabilities = track.getCapabilities ? track.getCapabilities() : {};
        const advancedConstraints = {};

        // Lock exposure mode to prevent auto-brightness shifts that mask micro-movements
        if (capabilities.exposureMode && capabilities.exposureMode.includes('manual')) {
            advancedConstraints.exposureMode = 'manual';
        } else if (capabilities.exposureMode && capabilities.exposureMode.includes('continuous')) {
            advancedConstraints.exposureMode = 'continuous';
        }

        // Lock white balance to prevent color shifts during analysis
        if (capabilities.whiteBalanceMode && capabilities.whiteBalanceMode.includes('manual')) {
            advancedConstraints.whiteBalanceMode = 'manual';
        }

        // Lock focus to prevent hunting that introduces apparent motion artifacts
        if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
            advancedConstraints.focusMode = 'continuous';
        }

        // Short exposure time for sharp micro-movement capture (reduce motion blur)
        if (capabilities.exposureTime && capabilities.exposureTime.min) {
            const targetExposure = Math.max(capabilities.exposureTime.min, 2500); // ~1/400s
            advancedConstraints.exposureTime = Math.min(targetExposure, capabilities.exposureTime.max || 10000);
        }

        if (Object.keys(advancedConstraints).length > 0) {
            try {
                await track.applyConstraints({ advanced: [advancedConstraints] });
            } catch (e) {
                // Advanced constraints not supported on this device — continue with defaults
            }
        }
    }

    _logCaptureSettings() {
        if (!this.stream) return;
        const track = this.stream.getVideoTracks()[0];
        if (!track) return;

        const settings = track.getSettings ? track.getSettings() : {};
        this.actualFrameRate = settings.frameRate || 30;

        console.log('[CameraManager] Capture settings:', {
            resolution: `${settings.width}x${settings.height}`,
            frameRate: `${settings.frameRate} fps`,
            facingMode: settings.facingMode || this.facingMode,
            exposureMode: settings.exposureMode || 'auto',
            focusMode: settings.focusMode || 'auto'
        });
    }

    async stop() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        this.video.srcObject = null;
        this.isActive = false;
    }

    async flip() {
        this.facingMode = this.facingMode === 'user' ? 'environment' : 'user';
        if (this.isActive) {
            await this.start();
        }
        return this.facingMode;
    }

    getFacingMode() {
        return this.facingMode;
    }

    getActualFrameRate() {
        return this.actualFrameRate;
    }

    getVideoElement() {
        return this.video;
    }

    getDimensions() {
        return {
            width: this.video.videoWidth,
            height: this.video.videoHeight,
            displayWidth: this.video.clientWidth,
            displayHeight: this.video.clientHeight
        };
    }

    getCaptureInfo() {
        if (!this.stream) return null;
        const track = this.stream.getVideoTracks()[0];
        const settings = track ? (track.getSettings ? track.getSettings() : {}) : {};
        return {
            width: settings.width || 0,
            height: settings.height || 0,
            frameRate: settings.frameRate || 0,
            facingMode: settings.facingMode || this.facingMode,
            exposureMode: settings.exposureMode || 'unknown',
            focusMode: settings.focusMode || 'unknown'
        };
    }
}

window.CameraManager = CameraManager;
