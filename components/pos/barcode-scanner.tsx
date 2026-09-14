"use client";

import { useEffect, useRef, useState } from "react";

import { IconAlert, IconCamera, IconClose } from "./icons";

/**
 * Reading a barcode with the tablet's own camera.
 *
 * A USB scanner needs no code at all — it is a keyboard that types digits and
 * presses Enter, which is why the barcode field handles that case itself. This
 * is the other half: the shop with no scanner yet, or the owner adding stock
 * from the storeroom with the tablet in one hand.
 *
 * It uses the platform's `BarcodeDetector`, which is free, native, and present
 * on the Android Chrome these tablets run. There is no library fallback here
 * on purpose: when the API is missing, saying so and letting someone type
 * thirteen digits is better than shipping 300 KB of WASM decoder to a Rs 25,000
 * device for a screen used a few dozen times during setup.
 *
 * Two failures are worth naming separately rather than collapsing into "camera
 * not available", because the fix differs: a non-HTTPS origin (the API is
 * simply absent) and a refused permission (the owner taps Block once and then
 * assumes the feature is broken forever).
 */

type DetectedBarcode = { rawValue: string };

type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>;
};

declare global {
  interface Window {
    BarcodeDetector?: new (options?: {
      formats?: string[];
    }) => BarcodeDetectorLike;
  }
}

type Status = "starting" | "live" | "denied" | "unsupported" | "insecure" | "failed";

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"];

const MESSAGES: Record<Exclude<Status, "starting" | "live">, string> = {
  unsupported:
    "This browser cannot read barcodes with the camera. Chrome on Android and Edge on Windows can; Firefox and iOS Safari cannot. A USB scanner works everywhere — plug it in and scan straight into the field.",
  insecure:
    "The camera only opens on a secure connection. On the counter tablet that means https, not a plain http address on the shop's Wi-Fi.",
  denied:
    "The camera is blocked for this site. Tap the padlock in the address bar, allow the camera, and try again.",
  failed:
    "The camera did not start. Another app may be holding it — close the other camera app and try again.",
};

export function BarcodeScanner({
  onRead,
  onClose,
}: {
  onRead: (code: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<Status>("starting");

  // The callback is read out of a ref inside the polling loop, so a parent that
  // re-renders on every keystroke does not tear the camera down mid-scan.
  const onReadRef = useRef(onRead);
  useEffect(() => {
    onReadRef.current = onRead;
  });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let stopped = false;

    const stop = () => {
      stopped = true;
      window.clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };

    const start = async () => {
      if (!window.isSecureContext) return setStatus("insecure");
      if (!window.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) {
        return setStatus("unsupported");
      }

      const detector = new window.BarcodeDetector({ formats: FORMATS });

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // The back camera, on a device that has two. `ideal` rather than
          // `exact` so a laptop with one webcam still opens.
          video: { facingMode: { ideal: "environment" } },
        });
      } catch (error) {
        const name = error instanceof DOMException ? error.name : "";
        return setStatus(
          name === "NotAllowedError" || name === "SecurityError" ? "denied" : "failed",
        );
      }

      if (stopped) return stream.getTracks().forEach((track) => track.stop());

      const video = videoRef.current;
      if (!video) return;

      video.srcObject = stream;
      await video.play().catch(() => undefined);
      setStatus("live");

      // Four looks a second. Faster burns battery on a tablet that is also
      // running the register, and a hand holding a bottle steady for 250 ms is
      // not a demanding ask.
      timer = window.setInterval(async () => {
        if (video.readyState < 2) return;

        try {
          const [hit] = await detector.detect(video);
          if (!hit?.rawValue) return;
          stop();
          onReadRef.current(hit.rawValue);
        } catch {
          // A frame the decoder choked on. The next one is 250 ms away.
        }
      }, 250);
    };

    void start();
    return stop;
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const problem = status !== "starting" && status !== "live" ? MESSAGES[status] : null;

  return (
    <div className="rounded-2xl border border-azure-100 bg-azure-50/60 p-3">
      <div className="flex items-center gap-2">
        <IconCamera className="h-4 w-4 flex-none text-azure-700" />
        <p className="flex-1 font-display text-[0.8125rem] font-semibold text-graphite-900">
          {status === "live" ? "Hold the barcode in the frame" : "Camera"}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="pos-icon-btn h-8 w-8"
          aria-label="Close the camera"
        >
          <IconClose className="h-4 w-4" />
        </button>
      </div>

      {problem ? (
        <p className="mt-2.5 flex gap-2 text-[0.8125rem] leading-relaxed text-graphite-700">
          <IconAlert className="mt-0.5 h-4 w-4 flex-none text-signal-warn" />
          {problem}
        </p>
      ) : (
        <div className="relative mt-2.5 overflow-hidden rounded-xl bg-graphite-900">
          <video
            ref={videoRef}
            muted
            playsInline
            className="block h-44 w-full object-cover sm:h-52"
          />

          {/* The window the decoder is actually looking through is the whole
              frame; this is only a target for the hand holding the bottle. */}
          <span className="pointer-events-none absolute inset-x-[12%] inset-y-[26%] rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(23,27,38,0.42)]" />

          {status === "starting" ? (
            <p className="absolute inset-0 grid place-items-center text-[0.8125rem] font-medium text-white">
              Opening the camera…
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
