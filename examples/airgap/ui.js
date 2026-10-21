// Browser UI shared by hot.html and cold.html: drawing a UR encoder's frames
// (one static QR code, or an animation for multi-part payloads), reading UR
// frames back from a camera, image files or pasted text, and small DOM
// helpers. Pure DOM + the qr package: no network access.
import encodeQR from 'qr';
import decodeQR from 'qr/decode.js';
import { frameLoop, QRCanvas, rearCamera } from 'qr/dom.js';
import { URDecoder } from './ur.js';

// ~4 frames per second: phone cameras keep up, and a 10-part payload loops
// in under three seconds
const FRAME_MS = 250;

function drawMatrix(canvas, modules) {
  const n = modules.length;
  // one canvas pixel per module; CSS scales it up with pixelated rendering
  canvas.width = canvas.height = n;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, n, n);
  ctx.fillStyle = '#000';
  modules.forEach((row, y) => row.forEach((on, x) => on && ctx.fillRect(x, y, 1, 1)));
}

/**
 * Shows a UREncoder on `canvas`: a static QR code for single-part payloads,
 * otherwise an endless animation (pure parts, then fountain-mixed ones, so a
 * camera that missed frames still completes). Returns a stop function.
 */
export function showQR(canvas, encoder) {
  const draw = () =>
    // uppercase: UR text fits QR alphanumeric mode, ~30% denser than bytes
    drawMatrix(
      canvas,
      encodeQR(encoder.nextPart().toUpperCase(), 'raw', { ecc: 'low', border: 2 })
    );
  draw();
  if (encoder.isSinglePart) return () => {};
  const timer = setInterval(draw, FRAME_MS);
  return () => clearInterval(timer);
}

async function decodeImage(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  // photos and screenshots: spend whatever effort it takes
  return decodeQR(ctx.getImageData(0, 0, canvas.width, canvas.height), {
    effort: Infinity,
    timeLimit: Infinity,
  });
}

/**
 * Collects UR frames of the given `types` from any mix of inputs until one
 * message is complete, then calls `onComplete({ type, payload })`. Progress
 * and problems go to `onStatus(text, isError)`; a foreign or broken frame is
 * reported but does not end a camera scan.
 */
export function createURReader(types, { onStatus, onComplete }) {
  let decoder = new URDecoder(types);
  let camera; // { stop, video } while scanning

  function stopCamera() {
    if (!camera) return;
    camera.stop();
    camera.video.hidden = true;
    camera = undefined;
  }
  function reset() {
    stopCamera();
    decoder = new URDecoder(types);
  }
  // true once the message is complete
  function feed(text) {
    let news;
    try {
      news = decoder.receive(text);
    } catch (error) {
      onStatus(error.message, true);
      return false;
    }
    if (decoder.isComplete) {
      const result = { type: decoder.type, payload: decoder.payload };
      reset();
      onComplete(result);
      return true;
    }
    if (news) {
      const { received, expected } = decoder.progress;
      onStatus(`Scanned ${received} of ${expected} parts… keep going.`, false);
    }
    return false;
  }

  return {
    reset,
    stopCamera,
    get scanning() {
      return !!camera;
    },
    /** Pasted UR text: one or more parts separated by whitespace. */
    feedText(text) {
      const parts = text.split(/\s+/).filter(Boolean);
      if (!parts.length) return onStatus('Nothing to read: paste ur:… text.', true);
      for (const part of parts) if (feed(part)) return;
    },
    /** Image files (screenshots or photos), one QR code each. */
    async scanFiles(files) {
      for (const file of files) {
        let text;
        try {
          text = await decodeImage(file);
        } catch {
          onStatus(`No QR code found in ${file.name}.`, true);
          continue;
        }
        if (feed(text)) return;
      }
    },
    /** Live camera scan into `video` until complete or stopCamera(). */
    async startCamera(video) {
      stopCamera();
      let cam;
      try {
        cam = await rearCamera(video);
      } catch (error) {
        // needs a secure context: https:, localhost or a file opened locally
        return onStatus(`Camera unavailable: ${error.message}`, true);
      }
      const canvas = new QRCanvas();
      let reading = false;
      const cancel = frameLoop(async () => {
        if (reading) return;
        reading = true;
        try {
          const result = await cam.readFrame(canvas);
          if (typeof result === 'string') feed(result);
        } catch {
          // a frame without a readable QR code: try the next one
        } finally {
          reading = false;
        }
      }, video);
      camera = {
        video,
        stop() {
          cancel();
          cam.stop();
        },
      };
      video.hidden = false;
      onStatus('Point the camera at the QR code…', false);
    },
  };
}

/**
 * Wires a scanner block (elements marked data-scan="video|camera|image|file|
 * text|read|status" inside `root`) to a UR reader for `types`. `onComplete`
 * may throw or reject: its error lands in the block's status line.
 */
export function bindScanner(root, types, onComplete) {
  const $ = (name) => root.querySelector(`[data-scan="${name}"]`);
  const status = $('status');
  const setStatus = (text, isError) => {
    status.textContent = text;
    status.className = isError ? 'error' : 'muted';
  };
  const cameraLabel = () =>
    ($('camera').textContent = reader.scanning ? 'Stop camera' : 'Scan with camera');
  const reader = createURReader(types, {
    onStatus: setStatus,
    onComplete(result) {
      setStatus('', false);
      cameraLabel();
      $('text').value = '';
      Promise.resolve()
        .then(() => onComplete(result))
        .catch((error) => setStatus(error.message, true));
    },
  });
  $('camera').onclick = async () => {
    if (reader.scanning) {
      reader.stopCamera();
      setStatus('', false);
    } else await reader.startCamera($('video'));
    cameraLabel();
  };
  $('image').onclick = () => $('file').click();
  $('file').onchange = async () => {
    const files = [...$('file').files];
    $('file').value = '';
    await reader.scanFiles(files);
  };
  $('read').onclick = () => reader.feedText($('text').value);
  return {
    reset() {
      reader.reset();
      cameraLabel();
      setStatus('', false);
      $('text').value = '';
    },
  };
}

/** Fills a <dl> with [label, value] pairs; `muted` ones render dimmed. */
export function renderFields(list, normal, muted = []) {
  list.textContent = '';
  for (const [kind, pairs] of [
    ['', normal],
    ['muted', muted],
  ])
    for (const [label, value] of pairs) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      dd.className = kind;
      list.append(dt, dd);
    }
}

/**
 * Copies `source`'s text (a textarea or any element). The async clipboard
 * needs a secure context; elsewhere the text is selected for a manual copy.
 */
export async function copyText(button, source) {
  const label = button.textContent;
  const text = 'value' in source ? source.value : source.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
  } catch {
    if ('select' in source) source.select();
    else getSelection().selectAllChildren(source);
    button.textContent = 'Selected: copy manually';
  }
  setTimeout(() => (button.textContent = label), 1500);
}
