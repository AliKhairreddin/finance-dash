import { useEffect, useRef, useState, type RefObject } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CameraPinch, fitCameraFrame, maxCameraZoom, minCameraZoom } from "./zoom";
import type { ScanCorners } from "./scanGeometry";

export function CameraPreview({ video, visible, ready, interactive, zoom, onZoom, onPlaying, edges }: {
  video: RefObject<HTMLVideoElement | null>; visible: boolean; ready: boolean; interactive: boolean;
  zoom: number; onZoom: (zoom: number) => void; onPlaying: () => void;
  edges: { corners: ScanCorners; width: number; height: number } | null;
}) {
  const container = useRef<HTMLDivElement>(null);
  const current = useRef({ zoom, onZoom, interactive }); current.current = { zoom, onZoom, interactive };
  const pinch = useRef(new CameraPinch());
  const [frame, setFrame] = useState({ left: 0, top: 0, width: 0, height: 0 });
  useEffect(() => {
    const element = container.current!, stream = video.current!;
    const measure = () => setFrame(fitCameraFrame(stream.videoWidth, stream.videoHeight, element.clientWidth, element.clientHeight));
    const observer = new ResizeObserver(measure); observer.observe(element);
    stream.addEventListener("loadedmetadata", measure); stream.addEventListener("resize", measure);
    measure();
    return () => { observer.disconnect(); stream.removeEventListener("loadedmetadata", measure); stream.removeEventListener("resize", measure); };
  }, [video]);
  useEffect(() => {
    const element = container.current!;
    const touch = (event: TouchEvent) => {
      if (!current.current.interactive) { pinch.current.reset(); return; }
      if (event.touches.length >= 2 && event.cancelable) event.preventDefault();
      const next = pinch.current.update(Array.from(event.touches), current.current.zoom);
      if (next !== current.current.zoom) { current.current.zoom = next; current.current.onZoom(next); }
    };
    const cancel = () => pinch.current.reset();
    // iOS also emits native gesture events. Scope suppression to this camera
    // surface; help, connection forms and the rest of the page stay zoomable.
    const gesture = (event: Event) => { if (current.current.interactive && event.cancelable) event.preventDefault(); };
    for (const name of ["touchstart", "touchmove", "touchend"] as const) element.addEventListener(name, touch, { passive: false });
    element.addEventListener("touchcancel", cancel);
    for (const name of ["gesturestart", "gesturechange", "gestureend"]) element.addEventListener(name, gesture, { passive: false });
    return () => {
      for (const name of ["touchstart", "touchmove", "touchend"] as const) element.removeEventListener(name, touch);
      element.removeEventListener("touchcancel", cancel);
      for (const name of ["gesturestart", "gesturechange", "gestureend"]) element.removeEventListener(name, gesture);
    };
  }, []);
  useEffect(() => { if (!interactive) pinch.current.reset(); }, [interactive]);
  return <div className="capture-camera" ref={container} hidden={!visible}>
    <div className="capture-camera-frame" style={frame}>
      <video ref={video} autoPlay muted playsInline onPlaying={onPlaying} style={{ transform: `scale(${zoom})` }} />
      {ready && (edges ? <svg className="scan-live-edges" viewBox={`0 0 ${edges.width} ${edges.height}`} aria-hidden="true"><polygon points={edges.corners.map(p => `${p.x * edges.width},${p.y * edges.height}`).join(" ")} /></svg> : <div className="capture-guides" aria-hidden="true"><i /><i /><i /><i /></div>)}
    </div>
    {ready && <div className="capture-zoom" role="group" aria-label="Camera zoom">
      <Button variant="ghost" size="icon" disabled={!interactive || zoom <= minCameraZoom} aria-label="Zoom camera out" onClick={() => onZoom(zoom - .25)}><Minus /></Button>
      <Button variant="ghost" className="capture-zoom-value" disabled={!interactive} aria-label={`Reset camera zoom to 1×, currently ${zoom}×`} onClick={() => onZoom(1)}>{zoom}×</Button>
      <Button variant="ghost" size="icon" disabled={!interactive || zoom >= maxCameraZoom} aria-label="Zoom camera in" onClick={() => onZoom(zoom + .25)}><Plus /></Button>
    </div>}
  </div>;
}
