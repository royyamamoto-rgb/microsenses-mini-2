/* ============================================
   CAMERA MODULE - Camera access, flip, and management
   Handles front/back camera switching on mobile
   ============================================ */

class CameraManager {
    constructor(videoElement) {
        this.video = videoElement;
        this.stream = null;
        this.facingMode = 'user'; // 'user' = front, 'environment' = back
        this.isActive = false;
    }

    async start() {
        try {
            await this.stop();

            const constraints = {
                video: {
                    facingMode: this.facingMode,
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    frameRate: { ideal: 30 }
                },
                audio: false
            };

            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.video.srcObject = this.stream;
            this.isActive = true;

            return new Promise((resolve) => {
                this.video.onloadedmetadata = () => {
                    this.video.play();
                    resolve(true);
                };
            });
        } catch (err) {
            console.error('Camera error:', err);
            this.isActive = false;
            throw err;
        }
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
}

window.CameraManager = CameraManager;
