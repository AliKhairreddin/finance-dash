import { useEffect, useRef, useState } from "react";
import { validCorners, type ScanCorners, type ScanPoint } from "./scanGeometry";

const labels = ["Top left", "Top right", "Bottom right", "Bottom left"];
export function ScanCrop({ photo, width, height, corners, onChange, disabled }: {
  photo: Blob; width: number; height: number; corners: ScanCorners; onChange: (corners: ScanCorners) => void; disabled: boolean;
}) {
  const container = useRef<HTMLDivElement>(null), [url, setUrl] = useState("");
  const [rect, setRect] = useState({ left: 0, top: 0, width: 1, height: 1 });
  useEffect(() => { const value = URL.createObjectURL(photo); setUrl(value); return () => URL.revokeObjectURL(value); }, [photo]);
  useEffect(() => {
    const element = container.current!;
    const observer = new ResizeObserver(() => {
      // Inset the photo so a 44px touch target remains reachable at every edge.
      const scale = Math.min(Math.max(1, element.clientWidth - 48) / width, Math.max(1, element.clientHeight - 48) / height);
      setRect({ left: (element.clientWidth - width * scale) / 2, top: (element.clientHeight - height * scale) / 2, width: width * scale, height: height * scale });
    });
    observer.observe(element); return () => observer.disconnect();
  }, [width, height]);
  function move(index: number, point: ScanPoint) {
    const next = corners.map((p, i) => i === index ? { x: Math.max(0, Math.min(1, point.x)), y: Math.max(0, Math.min(1, point.y)) } : p) as ScanCorners;
    if (validCorners(next)) onChange(next);
  }
  return <div className="scan-crop" ref={container} aria-label="Adjust receipt corners">
    <svg style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {url && <image href={url} width={width} height={height} />}
      <path d={`M0 0H${width}V${height}H0Z M${corners.map(p => `${p.x * width} ${p.y * height}`).join("L")}Z`} fillRule="evenodd" fill="#09090b99" />
      <polygon points={corners.map(p => `${p.x * width},${p.y * height}`).join(" ")} fill="none" stroke="#4ade80" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
    {corners.map((point, index) => <button key={index} className="scan-corner" type="button" disabled={disabled}
      aria-label={`${labels[index]} corner. Drag or use arrow keys to adjust.`} style={{ left: rect.left + point.x * rect.width, top: rect.top + point.y * rect.height }}
      onPointerDown={event => { event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const bounds = container.current!.getBoundingClientRect();
        move(index, { x: (event.clientX - bounds.left - rect.left) / rect.width, y: (event.clientY - bounds.top - rect.top) / rect.height });
      }}
      onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onKeyDown={event => {
        const step = event.shiftKey ? 0.02 : 0.005;
        const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
        if (delta) { event.preventDefault(); move(index, { x: point.x + delta[0], y: point.y + delta[1] }); }
      }}><span /></button>)}
  </div>;
}
