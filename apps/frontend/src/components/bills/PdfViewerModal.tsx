import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.js?url';
import {
  X,
  Download,
  Printer,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  FileText,
  RefreshCw,
  AlertCircle,
  Layers
} from 'lucide-react';
import type { BillDto } from '@bills-master/shared-types';
import { formatCurrency, formatFullDate } from '../../lib/utils.js';

// Configure PDF.js worker
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    pdfjsWorker || `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version || '3.11.174'}/pdf.worker.min.js`;
}

interface PdfViewerModalProps {
  bill: BillDto | null;
  onClose: () => void;
}

interface PageMeta {
  pageNumber: number;
  width: number;
  height: number;
}

export const PdfViewerModal: React.FC<PdfViewerModalProps> = ({ bill, onClose }) => {
  if (!bill) return null;

  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pagesMeta, setPagesMeta] = useState<PageMeta[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);

  // Refs for DOM nodes and hardware-accelerated transform without React re-renders
  const containerRef = useRef<HTMLDivElement>(null);
  const contentWrapperRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const renderTasksRef = useRef<Map<number, any>>(new Map());

  // Dimensions of the unscaled document layout
  const docDimensionsRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });

  // Current transform values maintained in ref for 60-120fps gesture performance
  const transformRef = useRef<{ scale: number; x: number; y: number }>({
    scale: 1,
    x: 0,
    y: 0,
  });

  // Touch gesture tracking
  const gestureRef = useRef<{
    isPinching: boolean;
    isPanning: boolean;
    initialDist: number;
    initialScale: number;
    initialPanX: number;
    initialPanY: number;
    touchStartX: number;
    touchStartY: number;
    pinchCenterX: number;
    pinchCenterY: number;
    lastTapTime: number;
    lastTapX: number;
    lastTapY: number;
    touchStartTime: number;
    hasMoved: boolean;
  }>({
    isPinching: false,
    isPanning: false,
    initialDist: 0,
    initialScale: 1,
    initialPanX: 0,
    initialPanY: 0,
    touchStartX: 0,
    touchStartY: 0,
    pinchCenterX: 0,
    pinchCenterY: 0,
    lastTapTime: 0,
    lastTapX: 0,
    lastTapY: 0,
    touchStartTime: 0,
    hasMoved: false,
  });

  // Mouse dragging
  const mouseDragRef = useRef<{
    isDown: boolean;
    startX: number;
    startY: number;
    initialPanX: number;
    initialPanY: number;
  }>({
    isDown: false,
    startX: 0,
    startY: 0,
    initialPanX: 0,
    initialPanY: 0,
  });

  const invoiceFileName = `Faktura_${(bill.invoiceNumber || 'dokument').replace(/[\/\\:]/g, '_')}.pdf`;

  // Apply clamped transform directly to DOM for maximum 120fps performance
  const applyTransform = useCallback(() => {
    const container = containerRef.current;
    const wrapper = contentWrapperRef.current;
    if (!container || !wrapper) return;

    const vWidth = container.clientWidth;
    const vHeight = container.clientHeight;
    const docWidth = wrapper.offsetWidth || docDimensionsRef.current.width;
    const docHeight = Math.max(wrapper.scrollHeight, wrapper.offsetHeight, docDimensionsRef.current.height);

    if (docWidth <= 0 || docHeight <= 0) return;

    const current = transformRef.current;
    const s = current.scale;
    const scaledWidth = docWidth * s;
    const scaledHeight = docHeight * s;
    const topPadding = 20;
    const bottomPadding = 64; // Generous bottom breathing room so page 2 bottom is 100% visible

    // Strict Boundary Clamping: It is IMPOSSIBLE to move outside the document area!
    let clampedX = current.x;
    if (scaledWidth <= vWidth) {
      // Document fits horizontally -> locked to center
      clampedX = (vWidth - scaledWidth) / 2;
    } else {
      // Document overflows horizontally -> cannot show empty void on left or right
      const minX = vWidth - scaledWidth;
      const maxX = 0;
      clampedX = Math.max(minX, Math.min(maxX, clampedX));
    }

    let clampedY = current.y;
    if (scaledHeight + topPadding + bottomPadding <= vHeight) {
      // Document fits vertically -> centered
      clampedY = (vHeight - scaledHeight) / 2;
    } else {
      // Document overflows vertically -> scrollable from top of page 1 to very bottom of last page
      const maxY = topPadding;
      const minY = vHeight - scaledHeight - bottomPadding;
      clampedY = Math.max(minY, Math.min(maxY, clampedY));
    }

    // Save clamped values
    current.x = clampedX;
    current.y = clampedY;

    // Hardware accelerated 3D transform
    wrapper.style.transform = `translate3d(${Math.round(clampedX)}px, ${Math.round(clampedY)}px, 0px) scale(${s})`;
  }, []);

  // Reset view to default (Fit to screen width, centered, at top)
  const handleResetView = useCallback(() => {
    const container = containerRef.current;
    const wrapper = contentWrapperRef.current;
    if (!container) return;

    const vWidth = container.clientWidth;
    const docWidth = wrapper?.offsetWidth || docDimensionsRef.current.width;
    const padding = vWidth < 640 ? 16 : 40;

    let targetScale = 1.0;
    if (docWidth > 0 && vWidth > 0) {
      targetScale = Math.min(1.0, (vWidth - padding) / docWidth);
    }

    transformRef.current = {
      scale: targetScale,
      x: (vWidth - docWidth * targetScale) / 2,
      y: 20,
    };

    applyTransform();
  }, [applyTransform]);

  // Senior Accessibility: Zoom in button (+25% scale, centered on viewport)
  const handleZoomIn = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const vWidth = container.clientWidth;
    const vHeight = container.clientHeight;
    const centerX = vWidth / 2;
    const centerY = vHeight / 2;

    const currentScale = transformRef.current.scale;
    const newScale = Math.min(currentScale * 1.25, 4.0);
    if (newScale === currentScale) return;

    const ratio = newScale / currentScale;
    transformRef.current.scale = newScale;
    transformRef.current.x = centerX - (centerX - transformRef.current.x) * ratio;
    transformRef.current.y = centerY - (centerY - transformRef.current.y) * ratio;
    applyTransform();
  }, [applyTransform]);

  // Senior Accessibility: Zoom out button (-20% scale, centered on viewport)
  const handleZoomOut = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const vWidth = container.clientWidth;
    const vHeight = container.clientHeight;
    const centerX = vWidth / 2;
    const centerY = vHeight / 2;

    const currentScale = transformRef.current.scale;
    const newScale = Math.max(currentScale / 1.25, 0.6);
    if (newScale === currentScale) return;

    const ratio = newScale / currentScale;
    transformRef.current.scale = newScale;
    transformRef.current.x = centerX - (centerX - transformRef.current.x) * ratio;
    transformRef.current.y = centerY - (centerY - transformRef.current.y) * ratio;
    applyTransform();
  }, [applyTransform]);

  // Load PDF and measure all pages
  useEffect(() => {
    let isCancelled = false;

    const loadPdfDoc = async () => {
      setIsLoading(true);
      setErrorMessage(null);
      setPdfDoc(null);
      setPagesMeta([]);

      try {
        const url = `/api/bills/${bill.id}/pdf`;
        const response = await fetch(url, {
          method: 'GET',
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error(
            response.status === 404
              ? 'Plik faktury nie został jeszcze pobrany z portalu dostawcy.'
              : `Błąd serwera (${response.status}): nie udało się pobrać pliku PDF`
          );
        }

        const blob = await response.blob();
        if (isCancelled) return;
        setPdfBlob(blob);

        const arrayBuffer = await blob.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({
          data: new Uint8Array(arrayBuffer),
          cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjsLib.version || '3.11.174'}/cmaps/`,
          cMapPacked: true,
        });

        const doc = await loadingTask.promise;
        if (isCancelled) return;
        setPdfDoc(doc);

        // Fetch meta of ALL pages
        const metas: PageMeta[] = [];
        const containerWidth = containerRef.current?.clientWidth || 800;
        const targetPageWidth = Math.min(containerWidth - (containerWidth < 640 ? 20 : 48), 840);

        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const unscaledVp = page.getViewport({ scale: 1.0 });
          const aspect = unscaledVp.height / unscaledVp.width;
          const displayWidth = targetPageWidth;
          const displayHeight = Math.round(displayWidth * aspect);

          metas.push({
            pageNumber: i,
            width: displayWidth,
            height: displayHeight,
          });
        }

        if (isCancelled) return;
        setPagesMeta(metas);

        // Compute total unscaled document size
        const totalHeight = metas.reduce((acc, m) => acc + m.height, 0) + (metas.length - 1) * 24;
        docDimensionsRef.current = {
          width: targetPageWidth,
          height: totalHeight,
        };

        setIsLoading(false);
      } catch (err: any) {
        if (isCancelled) return;
        console.error('[PdfViewerModal] Error loading PDF:', err);
        setErrorMessage(err.message || 'Wystąpił błąd podczas wczytywania dokumentu PDF.');
        setIsLoading(false);
      }
    };

    loadPdfDoc();

    return () => {
      isCancelled = true;
      // Cancel any running renders
      renderTasksRef.current.forEach((task) => {
        try {
          task.cancel();
        } catch {}
      });
      renderTasksRef.current.clear();
    };
  }, [bill.id]);

  // Render all pages onto their respective canvases once pagesMeta is ready
  useEffect(() => {
    if (!pdfDoc || pagesMeta.length === 0) return;

    let isMounted = true;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.0);

    pagesMeta.forEach(async (meta) => {
      const canvas = canvasRefs.current.get(meta.pageNumber);
      if (!canvas) return;

      try {
        const page = await pdfDoc.getPage(meta.pageNumber);
        if (!isMounted) return;

        // Cancel previous render on this page if any
        if (renderTasksRef.current.has(meta.pageNumber)) {
          try {
            renderTasksRef.current.get(meta.pageNumber).cancel();
          } catch {}
        }

        const unscaledVp = page.getViewport({ scale: 1.0 });
        const scale = meta.width / unscaledVp.width;
        const viewport = page.getViewport({ scale: scale * dpr });

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${meta.width}px`;
        canvas.style.height = `${meta.height}px`;

        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        const renderContext = {
          canvasContext: ctx,
          viewport,
        };

        const task = page.render(renderContext);
        renderTasksRef.current.set(meta.pageNumber, task);
        await task.promise;
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException') {
          console.error(`[PdfViewerModal] Page ${meta.pageNumber} render error:`, err);
        }
      }
    });

    // Once layout is placed, initialize position
    handleResetView();

    const timer = setTimeout(() => {
      if (contentWrapperRef.current) {
        docDimensionsRef.current = {
          width: contentWrapperRef.current.offsetWidth,
          height: Math.max(contentWrapperRef.current.scrollHeight, contentWrapperRef.current.offsetHeight),
        };
        applyTransform();
      }
    }, 120);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [pdfDoc, pagesMeta, handleResetView, applyTransform]);

  // Touch gesture listeners: Pinch to zoom & pan with 120fps hardware response
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onTouchStart = (e: TouchEvent) => {
      const g = gestureRef.current;
      const rect = container.getBoundingClientRect();

      if (e.touches.length === 2) {
        // Two fingers: Pinch to zoom
        e.preventDefault();
        g.isPinching = true;
        g.isPanning = false;
        g.hasMoved = true;
        g.lastTapTime = 0;

        const t1 = e.touches[0];
        const t2 = e.touches[1];

        g.initialDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        g.initialScale = transformRef.current.scale;
        g.initialPanX = transformRef.current.x;
        g.initialPanY = transformRef.current.y;

        g.pinchCenterX = (t1.clientX + t2.clientX) / 2 - rect.left;
        g.pinchCenterY = (t1.clientY + t2.clientY) / 2 - rect.top;
      } else if (e.touches.length === 1) {
        // Single finger: start panning
        const t = e.touches[0];
        g.isPanning = true;
        g.isPinching = false;
        g.touchStartX = t.clientX;
        g.touchStartY = t.clientY;
        g.initialPanX = transformRef.current.x;
        g.initialPanY = transformRef.current.y;
        g.touchStartTime = Date.now();
        g.hasMoved = false;
      } else {
        g.isPanning = false;
        g.isPinching = false;
        g.lastTapTime = 0;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      const g = gestureRef.current;
      const rect = container.getBoundingClientRect();

      if (g.isPinching && e.touches.length === 2) {
        e.preventDefault();
        g.hasMoved = true;
        g.lastTapTime = 0;

        const t1 = e.touches[0];
        const t2 = e.touches[1];

        const currentDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        if (g.initialDist > 0) {
          const factor = currentDist / g.initialDist;
          const newScale = Math.min(Math.max(g.initialScale * factor, 0.75), 4.0);

          const midX = (t1.clientX + t2.clientX) / 2 - rect.left;
          const midY = (t1.clientY + t2.clientY) / 2 - rect.top;

          // Scale focused on pinch center point + pan offset
          const ratio = newScale / g.initialScale;
          transformRef.current.scale = newScale;
          transformRef.current.x = midX - (g.pinchCenterX - g.initialPanX) * ratio;
          transformRef.current.y = midY - (g.pinchCenterY - g.initialPanY) * ratio;

          applyTransform();
        }
      } else if (g.isPanning && e.touches.length === 1) {
        // Drag panning
        e.preventDefault();
        const t = e.touches[0];
        const dx = t.clientX - g.touchStartX;
        const dy = t.clientY - g.touchStartY;

        // If moved more than 6 pixels, it is definitely a scroll/drag action, not a stationary tap
        if (Math.hypot(dx, dy) > 6) {
          g.hasMoved = true;
          g.lastTapTime = 0;
        }

        transformRef.current.x = g.initialPanX + dx;
        transformRef.current.y = g.initialPanY + dy;

        applyTransform();
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      const g = gestureRef.current;
      const rect = container.getBoundingClientRect();

      if (g.isPinching) {
        e.preventDefault();
        g.isPinching = false;
        g.lastTapTime = 0;
        // Snap scale if below 1.0
        if (transformRef.current.scale < 1.0) {
          handleResetView();
        } else {
          applyTransform();
        }
      }

      if (e.touches.length === 0) {
        g.isPanning = false;
        applyTransform();

        // Evaluate double tap ONLY if finger stayed stationary (< 6px) and duration was short (< 250ms)
        const touchDuration = Date.now() - g.touchStartTime;
        const isCleanTap = !g.hasMoved && touchDuration < 250;

        if (isCleanTap) {
          const changedTouch = e.changedTouches[0];
          if (changedTouch) {
            const tapX = changedTouch.clientX - rect.left;
            const tapY = changedTouch.clientY - rect.top;
            const now = Date.now();
            const timeSinceLastTap = now - g.lastTapTime;
            const distFromLastTap = Math.hypot(tapX - g.lastTapX, tapY - g.lastTapY);

            // Double tap requires two consecutive stationary taps within 60ms-280ms and close together (< 30px)
            if (timeSinceLastTap >= 60 && timeSinceLastTap <= 280 && distFromLastTap < 30) {
              e.preventDefault();
              const currentScale = transformRef.current.scale;
              const targetScale = currentScale > 1.25 ? 1.0 : 2.2;

              if (targetScale === 1.0) {
                handleResetView();
              } else {
                const ratio = targetScale / currentScale;
                transformRef.current.scale = targetScale;
                transformRef.current.x = tapX - (tapX - transformRef.current.x) * ratio;
                transformRef.current.y = tapY - (tapY - transformRef.current.y) * ratio;
                applyTransform();
              }

              // Consumed double tap
              g.lastTapTime = 0;
              return;
            } else {
              // First clean tap
              g.lastTapTime = now;
              g.lastTapX = tapX;
              g.lastTapY = tapY;
            }
          }
        } else {
          // Scrolled, moved, or held down too long -> cancel any pending tap
          g.lastTapTime = 0;
        }
      }
    };

    // Wheel zoom & scroll
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      if (e.ctrlKey || e.metaKey) {
        // Zoom on Ctrl + Wheel or trackpad pinch
        const zoomFactor = e.deltaY < 0 ? 1.15 : 0.88;
        const oldScale = transformRef.current.scale;
        const newScale = Math.min(Math.max(oldScale * zoomFactor, 0.75), 4.0);

        const ratio = newScale / oldScale;
        transformRef.current.scale = newScale;
        transformRef.current.x = mouseX - (mouseX - transformRef.current.x) * ratio;
        transformRef.current.y = mouseY - (mouseY - transformRef.current.y) * ratio;

        applyTransform();
      } else {
        // Smooth scroll vertically / horizontally
        transformRef.current.x -= e.deltaX || 0;
        transformRef.current.y -= e.deltaY;
        applyTransform();
      }
    };

    container.addEventListener('touchstart', onTouchStart, { passive: false });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd, { passive: false });
    container.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('wheel', onWheel);
    };
  }, [applyTransform, handleResetView]);

  // Window resize handler: re-adjust bounds
  useEffect(() => {
    const onResize = () => {
      handleResetView();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [handleResetView]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === '0' || e.key === 'Home') {
        handleResetView();
      } else if (e.key === '+' || e.key === '=') {
        handleZoomIn();
      } else if (e.key === '-' || e.key === '_') {
        handleZoomOut();
      } else if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        transformRef.current.y -= 120;
        applyTransform();
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        transformRef.current.y += 120;
        applyTransform();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, handleResetView, handleZoomIn, handleZoomOut, applyTransform]);

  // Mouse Drag handlers for Desktop
  const handleMouseDown = (e: React.MouseEvent) => {
    mouseDragRef.current = {
      isDown: true,
      startX: e.clientX,
      startY: e.clientY,
      initialPanX: transformRef.current.x,
      initialPanY: transformRef.current.y,
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!mouseDragRef.current.isDown) return;
    const dx = e.clientX - mouseDragRef.current.startX;
    const dy = e.clientY - mouseDragRef.current.startY;

    transformRef.current.x = mouseDragRef.current.initialPanX + dx;
    transformRef.current.y = mouseDragRef.current.initialPanY + dy;
    applyTransform();
  };

  const handleMouseUp = () => {
    mouseDragRef.current.isDown = false;
  };

  // Double-click zoom handler for desktop mouse users
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const currentScale = transformRef.current.scale;
      const targetScale = currentScale > 1.25 ? 1.0 : 2.2;

      if (targetScale === 1.0) {
        handleResetView();
      } else {
        const ratio = targetScale / currentScale;
        transformRef.current.scale = targetScale;
        transformRef.current.x = mouseX - (mouseX - transformRef.current.x) * ratio;
        transformRef.current.y = mouseY - (mouseY - transformRef.current.y) * ratio;
        applyTransform();
      }
    },
    [applyTransform, handleResetView]
  );

  // Direct In-Viewer Download
  const handleDownload = () => {
    if (!pdfBlob) return;
    const blobUrl = window.URL.createObjectURL(pdfBlob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = invoiceFileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => window.URL.revokeObjectURL(blobUrl), 1000);
  };

  // Print Document directly
  const handlePrint = () => {
    if (!pdfBlob) return;
    const blobUrl = window.URL.createObjectURL(pdfBlob);
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.src = blobUrl;

    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch {
        window.open(blobUrl, '_blank');
      }
      setTimeout(() => {
        iframe.remove();
        window.URL.revokeObjectURL(blobUrl);
      }, 3000);
    };

    document.body.appendChild(iframe);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-3 md:p-5 overflow-hidden bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full h-full sm:h-[96vh] sm:max-w-5xl md:max-w-6xl rounded-none sm:rounded-3xl bg-slate-900 border-2 border-slate-700/90 shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Top Bar: Senior-Friendly, High Contrast, Large Targets */}
        <div className="p-3.5 sm:p-4 bg-slate-950/95 border-b-2 border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0 z-10 shadow-md select-none">
          {/* Document Title & Information */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-rose-500/25 to-red-600/25 text-rose-300 border-2 border-rose-500/40 flex items-center justify-center shrink-0 shadow-md">
              <FileText className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h2 className="text-base sm:text-xl font-black text-white truncate max-w-[210px] sm:max-w-xs md:max-w-md">
                  {bill.invoiceNumber}
                </h2>
                {bill.paymentStatus === 'PAID' ? (
                  <span className="inline-block px-3 py-1 rounded-xl text-xs font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                    Opłacona
                  </span>
                ) : (
                  <span className="inline-block px-3 py-1 rounded-xl text-xs font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/40">
                    Do zapłaty
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm text-slate-300 truncate mt-0.5 font-medium">
                <span className="font-bold text-white">{bill.portal?.name || bill.portal?.providerName || 'Dostawca'}</span>
                <span className="mx-2 text-slate-500 font-bold">•</span>
                <span className="text-emerald-400 font-black text-sm sm:text-base">
                  {formatCurrency(bill.amountDue, bill.currency)}
                </span>
                <span className="hidden md:inline">
                  <span className="mx-2 text-slate-500 font-bold">•</span>
                  <span>Termin: <strong className="text-slate-200">{formatFullDate(bill.dueDate)}</strong></span>
                </span>
              </p>
            </div>
          </div>

          {/* Action Buttons: Zoom Out, Zoom In, Reset View, Download, Print, Close */}
          <div className="flex items-center gap-2 sm:gap-2.5">
            {/* Pages count indicator */}
            {pagesMeta.length > 1 && (
              <div className="hidden sm:flex items-center gap-1.5 px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs font-bold text-slate-300">
                <Layers className="w-4 h-4 text-blue-400" />
                <span>Strony: {pagesMeta.length}</span>
              </div>
            )}

            {/* ZOOM OUT BUTTON */}
            <button
              onClick={handleZoomOut}
              disabled={isLoading}
              className="py-2.5 sm:py-3 px-3 sm:px-3.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-100 hover:text-white font-bold text-xs sm:text-sm rounded-2xl border-2 border-slate-600 hover:border-slate-500 transition-all flex items-center justify-center gap-1.5 shadow-md active:scale-95 disabled:opacity-50"
              title="Pomniejsz widok dokumentu (Klawisz -)"
              aria-label="Pomniejsz widok dokumentu"
            >
              <ZoomOut className="w-4 h-4 sm:w-5 sm:h-5 text-sky-400 shrink-0" />
              <span className="hidden md:inline">Pomniejsz</span>
            </button>

            {/* ZOOM IN BUTTON */}
            <button
              onClick={handleZoomIn}
              disabled={isLoading}
              className="py-2.5 sm:py-3 px-3 sm:px-3.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-100 hover:text-white font-bold text-xs sm:text-sm rounded-2xl border-2 border-slate-600 hover:border-slate-500 transition-all flex items-center justify-center gap-1.5 shadow-md active:scale-95 disabled:opacity-50"
              title="Powiększ widok dokumentu (Klawisz +)"
              aria-label="Powiększ widok dokumentu"
            >
              <ZoomIn className="w-4 h-4 sm:w-5 sm:h-5 text-sky-400 shrink-0" />
              <span className="hidden md:inline">Powiększ</span>
            </button>

            {/* RESET VIEW BUTTON */}
            <button
              onClick={handleResetView}
              disabled={isLoading}
              className="py-2.5 sm:py-3 px-3.5 sm:px-4 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-100 hover:text-white font-bold text-xs sm:text-sm rounded-2xl border-2 border-slate-600 hover:border-slate-500 transition-all flex items-center justify-center gap-2 shadow-md active:scale-95 disabled:opacity-50"
              title="Przywróć domyślny rozmiar i położenie dokumentu (Klawisz 0)"
            >
              <RotateCcw className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400 shrink-0" />
              <span>Resetuj<span className="hidden sm:inline"> widok</span></span>
            </button>

            {/* DOWNLOAD BUTTON */}
            <button
              onClick={handleDownload}
              disabled={isLoading || !pdfBlob}
              className="py-2.5 sm:py-3 px-3.5 sm:px-5 bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-500 hover:to-indigo-500 active:from-blue-700 active:to-indigo-700 disabled:opacity-50 text-white font-bold text-xs sm:text-sm rounded-2xl shadow-lg shadow-blue-600/30 border-2 border-blue-400/30 transition-all flex items-center justify-center gap-2 active:scale-95"
              title="Pobierz fakturę PDF na komputer lub telefon"
            >
              <Download className="w-4 h-4 sm:w-5 sm:h-5 text-white shrink-0" />
              <span>Pobierz<span className="hidden sm:inline"> PDF</span></span>
            </button>

            {/* PRINT BUTTON (Desktop) */}
            <button
              onClick={handlePrint}
              disabled={isLoading || !pdfBlob}
              className="py-2.5 sm:py-3 px-3.5 sm:px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border-2 border-slate-700 rounded-2xl font-bold text-xs sm:text-sm hidden lg:flex items-center justify-center gap-2 transition-colors disabled:opacity-40"
              title="Drukuj dokument na drukarce"
            >
              <Printer className="w-4 h-4 sm:w-5 sm:h-5 text-slate-300 shrink-0" />
              <span>Drukuj</span>
            </button>

            {/* CLOSE BUTTON */}
            <button
              onClick={onClose}
              className="py-2.5 sm:py-3 px-3.5 sm:px-4 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-200 hover:text-white font-bold text-xs sm:text-sm rounded-2xl border-2 border-slate-700 transition-colors flex items-center justify-center gap-2 ml-0.5"
              title="Zamknij podgląd faktury (Klawisz Esc)"
            >
              <X className="w-5 h-5 text-slate-300 shrink-0" />
              <span className="hidden sm:inline">Zamknij</span>
            </button>
          </div>
        </div>

        {/* Viewport Container: Touch-none, zero scrollbars, bounds-clamped */}
        <div
          ref={containerRef}
          className="relative flex-1 bg-slate-950 overflow-hidden select-none touch-none cursor-grab active:cursor-grabbing"
          onMouseDown={handleMouseDown}
          onDoubleClick={handleDoubleClick}
        >
          {/* Hardware Accelerated Transformed Content Wrapper */}
          <div
            ref={contentWrapperRef}
            className="absolute top-0 left-0 flex flex-col items-center gap-6 will-change-transform origin-top-left pb-16"
            style={{
              width: `${docDimensionsRef.current.width}px`,
            }}
          >
            {/* ALL Pages Rendered Vertically */}
            {pagesMeta.map((meta) => (
              <div
                key={meta.pageNumber}
                className="relative flex flex-col items-center group"
                style={{
                  width: `${meta.width}px`,
                }}
              >
                {/* Page Canvas Container with clean paper drop shadow */}
                <div className="bg-white rounded-lg shadow-2xl overflow-hidden border border-slate-700/60 ring-1 ring-black/10">
                  <canvas
                    ref={(el) => {
                      if (el) canvasRefs.current.set(meta.pageNumber, el);
                      else canvasRefs.current.delete(meta.pageNumber);
                    }}
                    className="block"
                  />
                </div>

                {/* Page number badge if multi-page */}
                {pagesMeta.length > 1 && (
                  <div className="mt-2 py-1 px-3 bg-slate-900/80 border border-slate-800 rounded-full text-[11px] font-bold text-slate-400 shadow-sm">
                    Strona {meta.pageNumber} z {pagesMeta.length}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Loading Overlay */}
          {isLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 z-20">
              <div className="w-16 h-16 rounded-3xl bg-blue-600/15 border-2 border-blue-500/30 flex items-center justify-center">
                <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
              </div>
              <p className="mt-4 text-base sm:text-lg font-bold text-white">Wczytywanie faktury PDF...</p>
              <p className="text-xs sm:text-sm text-slate-400 mt-1">Renderowanie wszystkich stron dokumentu</p>
            </div>
          )}

          {/* Error Message */}
          {errorMessage && !isLoading && (
            <div className="absolute inset-0 flex items-center justify-center p-4 bg-slate-950/90 z-20">
              <div className="max-w-md w-full p-6 sm:p-8 bg-slate-900 border-2 border-rose-700/80 rounded-3xl text-center space-y-4 shadow-2xl">
                <div className="w-14 h-14 rounded-2xl bg-rose-600/20 text-rose-400 flex items-center justify-center mx-auto border-2 border-rose-500/30">
                  <AlertCircle className="w-7 h-7" />
                </div>
                <div>
                  <h4 className="text-lg font-bold text-white">Nie udało się wyświetlić faktury</h4>
                  <p className="text-sm text-slate-300 mt-2 leading-relaxed">{errorMessage}</p>
                </div>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-3">
                  <button
                    onClick={onClose}
                    className="w-full sm:w-auto px-5 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-2xl text-sm font-bold transition-colors"
                  >
                    Zamknij
                  </button>
                  <button
                    onClick={handleDownload}
                    disabled={!pdfBlob}
                    className="w-full sm:w-auto px-5 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl text-sm font-bold transition-colors flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20"
                  >
                    <Download className="w-4 h-4" />
                    <span>Pobierz plik</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
