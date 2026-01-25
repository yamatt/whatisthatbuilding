export class Camera {
    CONSTRAINTS = {
        video: { facingMode: 'environment' }
    }

    constructor(el_id) {
        this.el_id = el_id
    }

    get el() {
        return document.getElementById(this.el_id);
    }

    async start() {
        const stream = await navigator.mediaDevices.getUserMedia(this.CONSTRAINTS);
        this.el.srcObject = stream;
        this.el.play();
    }
}
