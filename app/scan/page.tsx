'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Camera, ImagePlus, LoaderCircle, ScanLine, ShieldCheck, SwitchCamera, Zap, ZapOff } from 'lucide-react';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { SecureBadge } from '@/components/app-shell';
import { QuadOverlay } from '@/components/camera/quad-overlay';
import { PlacementGuide } from '@/components/camera/placement-guide';
import { CaptureTray } from '@/components/camera/capture-tray';
import { CAPTURE_GUIDES } from '@/lib/camera-guide';
import { BlobImage } from '@/components/editor/blob-image';
import { useImport } from '@/components/use-import';
import { useSession } from '@/stores/session';
import { useSettings } from '@/stores/settings';
import { DEFAULT_RECIPE, MODE_LABELS, type DetectionResult, type Quad, type ScanMode } from '@/lib/types';
const modes: ScanMode[] = ['document', 'id', 'passport', 'book', 'batch'];
export default function ScanPage() {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const captureInput = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraGeneration = useRef(0);
  const sessionGeneration = useRef(0);
  const capturing = useRef(false);
  const previous = useRef<Quad | null>(null);
  const stableSince = useRef(0);
  const [mode, setMode] = useState<ScanMode>('document');
  const modeRef = useRef(mode);
  const [cameraState, setCameraState] = useState<'starting'|'ready'|'denied'|'unavailable'|'paused'>('starting');
  const [cameraError, setCameraError] = useState('');
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [progress, setProgress] = useState(0);
  const [engineReady, setEngineReady] = useState(false);
  const [engineError, setEngineError] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [stacking, setStacking] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torch, setTorch] = useState(false);
  const [facing, setFacing] = useState<'environment'|'user'>('environment');
  const autoCapture = useSettings((s) => s.autoCapture);
  const setAutoCapture = useSettings((s) => s.setAutoCapture);
  const idCount = useSession((s) => s.pages.filter((page) => page.type === 'id').length);
  const { importing, importFiles } = useImport();
  const stopCamera = useCallback(() => { cameraGeneration.current++; streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; if (video.current) video.current.srcObject = null; }, []);
  const startCamera = useCallback(async () => {
    stopCamera(); setCameraState('starting'); setCameraError(''); setTorch(false); setTorchAvailable(false);
    const generation = cameraGeneration.current;
    if (!navigator.mediaDevices?.getUserMedia) { setCameraState('unavailable'); setCameraError('Live camera needs HTTPS and a supported browser. Use your camera app or import an image below.'); return; }
    try {
      let stream: MediaStream;
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false }); }
      catch (e) { if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw e; stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }); }
      if (document.hidden || !video.current || generation !== cameraGeneration.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream; video.current.srcObject = stream;
      await video.current.play();
      if (generation !== cameraGeneration.current) return;
      const capabilities = stream.getVideoTracks()[0].getCapabilities() as MediaTrackCapabilities & { torch?: boolean };
      setTorchAvailable(Boolean(capabilities.torch)); setCameraState('ready');
    } catch (error) { if (generation !== cameraGeneration.current) return; stopCamera(); const denied = error instanceof DOMException && error.name === 'NotAllowedError'; setCameraState(denied ? 'denied' : 'unavailable'); setCameraError(denied ? 'Allow camera access in your browser to scan live, or use the camera and gallery options below.' : 'A live camera is not available. You can still take a photo or import your images.'); }
  }, [facing, stopCamera]);
  useEffect(() => { const requested = new URLSearchParams(window.location.search).get('mode'); if (modes.includes(requested as ScanMode)) setMode(requested as ScanMode); }, []);
  useEffect(() => { modeRef.current = mode; previous.current = null; stableSince.current = 0; setProgress(0); setDetection(null); }, [mode]);
  useEffect(() => { const lifecycle = sessionGeneration; let active = true; void startCamera(); void import('@/lib/cv/client').then(({ warmCV }) => warmCV()).then(() => { if (active) setEngineReady(true); }).catch((error) => { if (active) setEngineError(error instanceof Error ? error.message : 'The offline scanner could not start.'); }); const onVisibility = () => { if (document.hidden) { stopCamera(); setCameraState('paused'); } }; document.addEventListener('visibilitychange', onVisibility); return () => { active = false; lifecycle.current++; stopCamera(); document.removeEventListener('visibilitychange', onVisibility); }; }, [startCamera, stopCamera]);
  const capture = useCallback(async () => {
    if (capturing.current || importing || !video.current?.videoWidth || cameraState !== 'ready') return;
    capturing.current = true; setBusy(true); setProgress(0); stableSince.current = 0;
    const generation = sessionGeneration.current;
    const epoch = useSession.getState().epoch;
    const captureMode = modeRef.current;
    const canvas = document.createElement('canvas');
    try {
      const source = video.current; canvas.width = source.videoWidth; canvas.height = source.videoHeight;
      const context = canvas.getContext('2d'); if (!context) throw new Error('The camera image could not be captured.');
      context.drawImage(source, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Please try capturing again.')), 'image/jpeg', 0.98));
      setStacking(false); setCapturedBlob(blob);
      const { detectBlob } = await import('@/lib/cv/client'); const result = await detectBlob(blob, captureMode);
      if (generation !== sessionGeneration.current || epoch !== useSession.getState().epoch) return;
      const scan = { id: crypto.randomUUID(), type: captureMode, createdAt: Date.now(), original: blob, width: result.width, height: result.height, corners: result.corners, recipe: { ...DEFAULT_RECIPE }, redactions: [] };
      useSession.getState().addPages([scan]); setFlash(true); window.setTimeout(() => setFlash(false), 70); navigator.vibrate?.(20);
      if (result.quality.blur || result.quality.glare || result.quality.lowLight) toast('Page captured', { description: result.quality.blur ? 'Some blur detected. You can adjust the scan or retake it.' : result.quality.glare ? 'Some glare detected. Check the preview before export.' : 'This shot is a little dark. Try Auto enhancement.' });
      if (captureMode === 'book' || captureMode === 'batch' || captureMode === 'id' && useSession.getState().pages.filter((p) => p.type === 'id').length % 2 === 1) { setStacking(true); window.setTimeout(() => { setCapturedBlob(null); setStacking(false); }, 350); toast.success(captureMode === 'id' ? 'Front captured. Flip the card for the back.' : `Page ${useSession.getState().pages.length} captured`, { description: 'Review your pages below, or keep scanning.' }); stableSince.current = performance.now() + 1200; previous.current = null; }
      else {
        const transitionDocument = document as Document & { startViewTransition?: (callback: () => Promise<void>) => unknown };
        if (transitionDocument.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
          transitionDocument.startViewTransition(() => new Promise<void>((resolve) => { const observer = new MutationObserver(() => { if (document.querySelector('.crop-coordinate-plane img')) { observer.disconnect(); resolve(); } }); observer.observe(document.body, { childList: true, subtree: true }); router.push('/edit/'); window.setTimeout(() => { observer.disconnect(); resolve(); }, 700); }));
        } else router.push('/edit/');
      }
    } catch (error) { setCapturedBlob(null); if (generation === sessionGeneration.current) toast.error(error instanceof Error ? error.message : 'Capture failed. Please try again.'); }
    finally { canvas.width = 0; canvas.height = 0; setBusy(false); capturing.current = false; }
  }, [cameraState, importing, router]);
  useEffect(() => {
    if (cameraState !== 'ready' || !engineReady || importing) return;
    let cancelled = false, working = false;
    const timer = window.setInterval(async () => {
      const source = video.current;
      if (cancelled || working || capturing.current || document.hidden || !source || source.readyState < 2) return;
      working = true;
      const frameMode = modeRef.current;
      try {
        const ratio = Math.min(1, 640 / Math.max(source.videoWidth, source.videoHeight));
        const bitmap = await createImageBitmap(source, { resizeWidth: Math.round(source.videoWidth * ratio), resizeHeight: Math.round(source.videoHeight * ratio) });
        const { detectFrame } = await import('@/lib/cv/client'); const result = await detectFrame(bitmap, frameMode);
        if (cancelled || frameMode !== modeRef.current) return;
        setDetection(result);
        const now = performance.now();
        const qualityOkay = !result.quality.blur && !result.quality.glare && !result.quality.lowLight;
        const maxDrift = previous.current ? Math.max(...result.corners.map((point, index) => Math.hypot(point.x - previous.current![index].x, point.y - previous.current![index].y))) : Infinity;
        if (!result.fallback && qualityOkay && maxDrift < 7 && autoCapture) { if (!stableSince.current) stableSince.current = now; const value = Math.max(0, Math.min(1, (now - stableSince.current) / 700)); setProgress(value); if (value === 1) { stableSince.current = 0; void capture(); } }
        else { if (stableSince.current <= now) stableSince.current = 0; setProgress(0); }
        previous.current = result.corners;
      } catch { if (!cancelled) setProgress(0); }
      finally { working = false; }
    }, 100);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [cameraState, engineReady, importing, autoCapture, capture]);
  async function toggleTorch() { const track = streamRef.current?.getVideoTracks()[0]; if (!track) return; try { await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] }); setTorch(!torch); } catch { setTorchAvailable(false); toast('Torch is not available on this camera.'); } }
  let hint = CAPTURE_GUIDES[mode].instruction;
  if (!engineReady) hint = engineError || 'Preparing the offline scanner…';
  else if (detection?.quality.lowLight) hint = 'Move into a little more light';
  else if (detection?.quality.glare) hint = 'Tilt slightly to reduce glare';
  else if (detection?.quality.blur) hint = 'Hold steady for a clearer scan';
  else if (progress > 0) hint = 'Hold still. Capturing…';
  else if (detection && !detection.fallback) hint = 'Edges found. Hold steady';
  if (mode === 'id' && idCount % 2 === 1 && engineReady) hint = 'Front captured. Flip your card and fit the back inside the outline';
  return <div className="camera-screen">
    <header className="camera-header">
      <Link href="/" className="camera-back" aria-label="Back to workspace"><ArrowLeft size={20} /></Link>
      <Link href="/" className="camera-brand"><ScanLine size={21} /><span>vaultscan.</span></Link>
      <SecureBadge />
    </header>
    <main id="main-content" className="camera-main">
      <div ref={stage} className="camera-view">
        <video ref={video} autoPlay muted playsInline aria-label="Live camera view" />
        <BlobImage blob={capturedBlob} className={`camera-snapshot ${stacking ? 'is-stacking' : ''}`} alt="Captured document" />
        {cameraState === 'ready' && <PlacementGuide stage={stage} video={video} mode={mode} backOfCard={idCount % 2 === 1} />}
        {detection && !detection.fallback && cameraState === 'ready' && <QuadOverlay detection={detection} />}
        <div className={`capture-flash ${flash ? 'visible' : ''}`} />
        {cameraState !== 'ready' && <div className="camera-empty">
          {cameraState === 'starting' ? <><LoaderCircle size={36} className="spin" /><h1>Opening your camera</h1><p>Your camera feed stays on this device.</p></> : <>
            <span className="camera-empty-icon"><Camera size={36} strokeWidth={1.4} /></span>
            <h1>{cameraState === 'paused' ? 'Camera paused' : cameraState === 'denied' ? 'Your camera, your choice.' : 'Ready for your next scan.'}</h1>
            <p>{cameraState === 'paused' ? 'The camera stops when you leave the app. Resume when you are ready.' : cameraError}</p>
            <div className="camera-fallback-actions">
              <Button onClick={() => cameraState === 'paused' || cameraState === 'denied' ? void startCamera() : captureInput.current?.click()}><Camera size={17} />{cameraState === 'paused' ? 'Resume camera' : cameraState === 'denied' ? 'Try camera again' : 'Take a photo'}</Button>
              <Button variant="secondary" onClick={() => fileInput.current?.click()}><ImagePlus size={17} />Import images</Button>
            </div>
          </>}
        </div>}
        <div className="camera-stage-label"><span className="camera-live-dot" />{cameraState === 'ready' ? 'LIVE VIEW' : 'ON-DEVICE CAMERA'}<span>AUTO EDGE DETECTION</span></div>
      </div>
      <div className="camera-bottom">
        <CaptureTray disabled={busy || importing} />
        <p className="capture-hint" role="status">{cameraState === 'ready' ? hint : 'No uploads. Your photos stay yours.'}</p>
        <div className="mode-pills" aria-label="Capture mode">{modes.map((item) => <button key={item} disabled={busy || importing} aria-pressed={mode === item} onClick={() => setMode(item)}>{MODE_LABELS[item]}</button>)}</div>
        <div className="camera-controls">
          <button className="camera-control gallery-control" aria-label="Import images from device" disabled={importing || busy} onClick={() => fileInput.current?.click()}><ImagePlus size={23} /><span>Import</span></button>
          <button className="shutter" aria-label="Capture document" disabled={busy || importing || !engineReady || cameraState !== 'ready'} onClick={() => void capture()}>
            <svg viewBox="0 0 90 90" aria-hidden="true"><circle className="shutter-ring" cx="45" cy="45" r="41" /><circle className="shutter-progress" cx="45" cy="45" r="41" strokeDasharray="257.6" strokeDashoffset={257.6 * (1 - progress)} /></svg>
            <span>{busy ? <LoaderCircle className="spin" size={25} /> : <ScanLine size={26} />}</span>
          </button>
          <div className="camera-right-controls">{torchAvailable ? <button className="camera-control" disabled={busy || importing} aria-label={torch ? 'Turn torch off' : 'Turn torch on'} aria-pressed={torch} onClick={() => void toggleTorch()}>{torch ? <Zap size={22} /> : <ZapOff size={22} />}<span>Torch</span></button> : <button className="camera-control" disabled={busy || importing} aria-label="Switch camera" onClick={() => setFacing(facing === 'environment' ? 'user' : 'environment')}><SwitchCamera size={22} /><span>Switch</span></button>}</div>
        </div>
        <div className="camera-meta">
          <button className="auto-toggle" aria-pressed={autoCapture} onClick={() => setAutoCapture(!autoCapture)}><span className={`toggle-track ${autoCapture ? 'on' : ''}`} />Auto-capture</button>
          <span><ShieldCheck size={13} />Private by design</span>
        </div>
      </div>
    </main>
    <input ref={fileInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => { if (e.target.files) void importFiles(e.target.files, mode); e.target.value = ''; }} aria-label="Choose images" />
    <input ref={captureInput} className="sr-only" type="file" accept="image/*" capture="environment" onChange={(e) => { if (e.target.files) void importFiles(e.target.files, mode); e.target.value = ''; }} aria-label="Take a photo with your camera app" />
  </div>;
}
