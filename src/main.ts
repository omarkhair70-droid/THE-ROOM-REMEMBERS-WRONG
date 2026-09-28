import "./style.css";

const video = document.querySelector<HTMLVideoElement>("#camera")!;
const canvas = document.querySelector<HTMLCanvasElement>("#memory")!;
const ctx = canvas.getContext("2d", { alpha: false })!;
const enter = document.querySelector<HTMLButtonElement>("#enter")!;
const permission = document.querySelector<HTMLDivElement>("#permission")!;
const status = document.querySelector<HTMLDivElement>("#status")!;

const SAMPLE_W = 160;
const SAMPLE_H = 90;
const sample = document.createElement("canvas");
sample.width = SAMPLE_W;
sample.height = SAMPLE_H;
const sctx = sample.getContext("2d", { willReadFrequently: true })!;

const memoryLayer = document.createElement("canvas");
const mctx = memoryLayer.getContext("2d")!;

let previous: ImageData | null = null;
let running = false;
let lastPresence = 0;
let memoryAge = 0;
let driftClock = 0;

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
  memoryLayer.width = canvas.width;
  memoryLayer.height = canvas.height;
}

addEventListener("resize", resize);
resize();

function getMotionMask(): { mask: Uint8ClampedArray; energy: number } {
  sctx.save();
  sctx.scale(-1, 1);
  sctx.drawImage(video, -SAMPLE_W, 0, SAMPLE_W, SAMPLE_H);
  sctx.restore();

  const frame = sctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H);
  const mask = new Uint8ClampedArray(SAMPLE_W * SAMPLE_H);

  if (!previous) {
    previous = frame;
    return { mask, energy: 0 };
  }

  let moving = 0;
  for (let i = 0, p = 0; i < frame.data.length; i += 4, p++) {
    const dr = Math.abs(frame.data[i] - previous.data[i]);
    const dg = Math.abs(frame.data[i + 1] - previous.data[i + 1]);
    const db = Math.abs(frame.data[i + 2] - previous.data[i + 2]);
    const d = (dr + dg + db) / 3;

    if (d > 18) {
      const value = Math.min(255, (d - 18) * 5);
      mask[p] = value;
      moving++;
    }
  }

  previous = frame;
  return { mask, energy: moving / mask.length };
}

function paintTrace(mask: Uint8ClampedArray, energy: number, now: number) {
  const trace = document.createElement("canvas");
  trace.width = SAMPLE_W;
  trace.height = SAMPLE_H;
  const tctx = trace.getContext("2d")!;
  const img = tctx.createImageData(SAMPLE_W, SAMPLE_H);

  for (let i = 0; i < mask.length; i++) {
    const a = mask[i];
    const o = i * 4;
    img.data[o] = 220;
    img.data[o + 1] = 228;
    img.data[o + 2] = 232;
    img.data[o + 3] = a;
  }
  tctx.putImageData(img, 0, 0);

  const active = energy > 0.012;
  if (active) {
    lastPresence = now;
    memoryAge = 0;
  } else {
    memoryAge += 1;
  }

  // The room never copies the present exactly.
  // Every trace arrives slightly late, displaced and incomplete.
  const xDrift = Math.sin(now * 0.00037) * canvas.width * 0.018;
  const yDrift = Math.cos(now * 0.00029) * canvas.height * 0.012;
  const scaleError = 1 + Math.sin(now * 0.00021) * 0.015;

  mctx.save();
  mctx.translate(canvas.width / 2 + xDrift, canvas.height / 2 + yDrift);
  mctx.scale(scaleError, scaleError);
  mctx.translate(-canvas.width / 2, -canvas.height / 2);
  mctx.globalCompositeOperation = "screen";
  mctx.globalAlpha = active ? 0.115 : 0.018;
  mctx.filter = active ? "blur(1.5px)" : "blur(5px)";
  mctx.drawImage(trace, 0, 0, canvas.width, canvas.height);
  mctx.restore();

  // Forgetting: the memory is continuously erased, never archived.
  const sincePresence = now - lastPresence;
  const forgetting = sincePresence > 900 ? 0.022 : 0.008;
  mctx.save();
  mctx.globalCompositeOperation = "destination-out";
  mctx.fillStyle = `rgba(0,0,0,${forgetting})`;
  mctx.fillRect(0, 0, memoryLayer.width, memoryLayer.height);
  mctx.restore();

  // Misremembering: periodically shift a faint copy of memory sideways.
  if (now - driftClock > 1500) {
    driftClock = now;
    const amount = (Math.random() - 0.5) * canvas.width * 0.055;
    mctx.save();
    mctx.globalAlpha = 0.05;
    mctx.globalCompositeOperation = "screen";
    mctx.drawImage(memoryLayer, amount, 0);
    mctx.restore();
  }

  return active;
}

function draw(now: number) {
  if (!running) return;

  const { mask, energy } = getMotionMask();
  const active = paintTrace(mask, energy, now);

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.96;
  ctx.drawImage(memoryLayer, 0, 0);
  ctx.restore();

  // A barely-present current body: enough to establish relation,
  // never enough to become a mirror.
  if (active) {
    ctx.save();
    ctx.globalAlpha = Math.min(0.16, energy * 3.2);
    ctx.filter = "blur(9px)";
    ctx.drawImage(memoryLayer, 0, 0);
    ctx.restore();
  }

  requestAnimationFrame(draw);
}

async function start() {
  status.textContent = "requesting camera";

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });

    video.srcObject = stream;
    await video.play();

    previous = null;
    lastPresence = performance.now();
    running = true;
    permission.classList.add("hidden");
    status.textContent = "memory active / local only";
    requestAnimationFrame(draw);
  } catch (error) {
    console.error(error);
    status.textContent = "camera permission required";
  }
}

enter.addEventListener("click", start);
