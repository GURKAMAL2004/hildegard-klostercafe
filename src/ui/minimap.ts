import * as THREE from 'three';

/**
 * Top-down orthographic minimap rendered to a small canvas.
 * Refreshed at ~6 Hz, not every frame - a second full scene render per frame is
 * exactly the kind of thing that halves fps on an integrated GPU.
 */
export class Minimap {
  private cam: THREE.OrthographicCamera;
  private rt: THREE.WebGLRenderTarget;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private buf: Uint8Array;
  private acc = 0;
  private size = 150;
  enabled = true;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene) {
    const span = 130;
    this.cam = new THREE.OrthographicCamera(-span, span, span, -span, 1, 600);
    this.cam.up.set(0, 0, -1);
    this.rt = new THREE.WebGLRenderTarget(this.size, this.size, {
      depthBuffer: true,
      type: THREE.UnsignedByteType,
    });
    this.buf = new Uint8Array(this.size * this.size * 4);

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = this.size;
    this.canvas.style.cssText = `position:fixed;right:12px;bottom:12px;width:150px;height:150px;
      border:1px solid rgba(232,213,168,.3);border-radius:50%;z-index:20;
      background:#11151a;box-shadow:0 4px 18px rgba(0,0,0,.5);pointer-events:none`;
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  setEnabled(v: boolean) {
    this.enabled = v;
    this.canvas.style.display = v ? 'block' : 'none';
  }

  update(dt: number, playerPos: THREE.Vector3, yaw: number) {
    if (!this.enabled) return;
    this.acc += dt;
    if (this.acc < 1 / 6) return;
    this.acc = 0;

    this.cam.position.set(playerPos.x, playerPos.y + 220, playerPos.z);
    this.cam.lookAt(playerPos.x, playerPos.y, playerPos.z);
    this.cam.updateProjectionMatrix();

    const prevTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, this.cam);
    this.renderer.readRenderTargetPixels(this.rt, 0, 0, this.size, this.size, this.buf);
    this.renderer.setRenderTarget(prevTarget);

    // WebGL origin is bottom-left; flip rows into the 2D canvas.
    const img = this.ctx.createImageData(this.size, this.size);
    const S = this.size;
    for (let y = 0; y < S; y++) {
      const src = (S - 1 - y) * S * 4;
      img.data.set(this.buf.subarray(src, src + S * 4), y * S * 4);
    }
    this.ctx.putImageData(img, 0, 0);

    // Player arrow.
    const c = S / 2;
    this.ctx.save();
    this.ctx.translate(c, c);
    this.ctx.rotate(-yaw + Math.PI);
    this.ctx.fillStyle = '#e8d5a8';
    this.ctx.strokeStyle = '#2a1d12';
    this.ctx.lineWidth = 1.2;
    this.ctx.beginPath();
    this.ctx.moveTo(0, -7);
    this.ctx.lineTo(5, 6);
    this.ctx.lineTo(0, 3);
    this.ctx.lineTo(-5, 6);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();
    this.ctx.restore();
  }

  dispose() {
    this.rt.dispose();
    this.canvas.remove();
  }
}
