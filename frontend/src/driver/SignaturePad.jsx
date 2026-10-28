import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

/**
 * Where the receiver signs, with a finger or a stylus.
 *
 * Pointer events, so mouse, touch and pen are one code path, and the pointer
 * is captured so a stroke that slides off the edge is not cut short. The
 * canvas is drawn at the screen's pixel density, or a signature on a
 * high-density phone comes out blurred.
 *
 * Always dark ink on white, in dark mode too: it is a signature on paper, and
 * the PNG it becomes has to read the same in the office whatever their theme.
 * The white is painted into the image, so it is never transparent.
 *
 * `onChange(signed)` says whether there is anything on it. The parent asks for
 * the drawing with ref.toBlob(), and can clear it with ref.clear().
 */
const INK = "#0b1b3a";
const HEIGHT = 170;

const SignaturePad = forwardRef(function SignaturePad({ onChange, label = "Signature" }, ref) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef(null);
  const [signed, setSigned] = useState(false);
  // for the resize listener, which is set up once
  const signedRef = useRef(false);
  signedRef.current = signed;

  const ctx = () => canvasRef.current?.getContext?.("2d") || null;

  const paintBlank = useCallback(() => {
    const canvas = canvasRef.current;
    const c = ctx();
    if (!canvas || !c) return;
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.restore();
  }, []);

  // size the canvas to its box at the screen's density
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let fitted = null; // { width, height, dpr } of the last fit
    const fit = () => {
      const c = ctx();
      if (!c) return;
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const width = canvas.clientWidth || 300;
      const w = Math.round(width * dpr);
      const h = Math.round(HEIGHT * dpr);
      // The keyboard opening (for the note, say) resizes the window but not
      // the pad. Resetting a canvas wipes it, so leave it alone.
      if (fitted && fitted.width === w && fitted.height === h) return;
      // A real change (a rotation): keep the signature, scaled down if the pad got narrower.
      let copy = null;
      if (fitted && signedRef.current) {
        copy = document.createElement("canvas");
        copy.width = canvas.width;
        copy.height = canvas.height;
        copy.getContext("2d")?.drawImage(canvas, 0, 0);
      }
      canvas.width = w;
      canvas.height = h;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.lineCap = "round";
      c.lineJoin = "round";
      c.lineWidth = 2.4;
      c.strokeStyle = INK;
      paintBlank();
      if (copy) {
        const oldW = copy.width / fitted.dpr;
        const oldH = copy.height / fitted.dpr;
        const scale = Math.min(1, width / oldW);
        c.drawImage(copy, 0, 0, oldW * scale, oldH * scale);
      }
      fitted = { width: w, height: h, dpr };
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paintBlank]);

  const point = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const down = (e) => {
    const c = ctx();
    if (!c) return;
    e.preventDefault();
    canvasRef.current.setPointerCapture?.(e.pointerId);
    drawing.current = true;
    last.current = point(e);
    // a tap is a dot
    c.beginPath();
    c.arc(last.current.x, last.current.y, 1.2, 0, Math.PI * 2);
    c.fillStyle = INK;
    c.fill();
  };
  const move = (e) => {
    if (!drawing.current) return;
    const c = ctx();
    if (!c) return;
    e.preventDefault();
    const p = point(e);
    c.beginPath();
    c.moveTo(last.current.x, last.current.y);
    c.lineTo(p.x, p.y);
    c.stroke();
    last.current = p;
    if (!signed) {
      setSigned(true);
      onChange?.(true);
    }
  };
  const up = () => { drawing.current = false; };

  useImperativeHandle(ref, () => ({
    isEmpty: () => !signed,
    clear: () => {
      paintBlank();
      setSigned(false);
      onChange?.(false);
    },
    /** The drawing as a PNG, or null when there is none (or no canvas to draw on). */
    toBlob: () => new Promise((resolve) => {
      const canvas = canvasRef.current;
      if (!signed || !canvas?.toBlob) return resolve(null);
      canvas.toBlob((blob) => resolve(blob || null), "image/png");
    }),
  }), [signed, paintBlank, onChange]);

  return (
    <canvas
      ref={canvasRef}
      className="dr-sigpad"
      role="img"
      aria-label={label}
      style={{ height: HEIGHT, touchAction: "none" }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onPointerLeave={up}
    />
  );
});

export default SignaturePad;
