'use client';

import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';

type ManagerPdfCanvasPreviewProps = {
  pdf: Blob | null;
};

export function ManagerPdfCanvasPreview({ pdf }: ManagerPdfCanvasPreviewProps) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageResult, setPageResult] = useState<{ pageNumber: number; page: PDFPageProxy } | null>(null);
  const [scale, setScale] = useState(1);
  const [isLoading, setIsLoading] = useState(Boolean(pdf));
  const [error, setError] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    if (!pdf) {
      return undefined;
    }

    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url
        ).toString();
        loadingTask = pdfjs.getDocument({ data: await pdf.arrayBuffer() });
        const loadedDocument = await loadingTask.promise;
        if (cancelled) {
          await loadedDocument.destroy();
          return;
        }
        setDocument(loadedDocument);
        setError('');
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Could not read the generated PDF.');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (loadingTask) {
        void loadingTask.destroy().catch((destroyError: unknown) => {
          console.error('Could not stop PDF loading task', destroyError);
        });
      }
    };
  }, [pdf]);

  useEffect(() => {
    let cancelled = false;

    if (!document) return undefined;

    void document.getPage(pageNumber).then((loadedPage) => {
      if (cancelled) return;
      setPageResult({ pageNumber, page: loadedPage });
      setError('');
    }).catch((pageError: unknown) => {
      if (!cancelled) {
        setError(pageError instanceof Error ? pageError.message : 'Could not render this PDF page.');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [document, pageNumber]);

  useEffect(() => {
    let task: RenderTask | null = null;
    const canvas = canvasRef.current;
    const page = pageResult?.pageNumber === pageNumber ? pageResult.page : null;
    if (!page || !canvas) return undefined;

    const viewport = page.getViewport({ scale });
    const outputScale = window.devicePixelRatio || 1;
    const context = canvas.getContext('2d');
    if (!context) {
      console.error('Your browser could not create a PDF preview canvas.');
      setError('Your browser could not create a PDF preview canvas.');
      return undefined;
    }

    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    task = page.render({
      canvas,
      canvasContext: context,
      viewport,
      transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
    });
    void task.promise.catch((renderError: unknown) => {
      if (renderError instanceof Error && renderError.name === 'RenderingCancelledException') return;
      setError(renderError instanceof Error ? renderError.message : 'Could not render this PDF page.');
    });

    return () => task?.cancel();
  }, [pageNumber, pageResult, scale]);

  function fitWidth() {
    const page = pageResult?.pageNumber === pageNumber ? pageResult.page : null;
    if (!page || !viewportRef.current) return;
    const availableWidth = viewportRef.current.clientWidth - 32;
    const pageWidth = page.getViewport({ scale: 1 }).width;
    setScale(Math.min(2, Math.max(0.5, availableWidth / pageWidth)));
  }

  return (
    <div className="manager-pdf-viewer">
      <div className="manager-pdf-viewer__toolbar" role="toolbar" aria-label="PDF preview controls">
        <button
          className="manager-pdf-viewer__button"
          type="button"
          aria-label="Previous page"
          disabled={!document || pageNumber <= 1}
          onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
        >
          ‹
        </button>
        <span className="manager-pdf-viewer__page-count">
          Page {document ? pageNumber : 0} of {document?.numPages ?? 0}
        </span>
        <button
          className="manager-pdf-viewer__button"
          type="button"
          aria-label="Next page"
          disabled={!document || pageNumber >= document.numPages}
          onClick={() => setPageNumber((current) => Math.min(document?.numPages ?? current, current + 1))}
        >
          ›
        </button>
        <span className="manager-pdf-viewer__separator" aria-hidden="true" />
        <button
          className="manager-pdf-viewer__button"
          type="button"
          aria-label="Zoom out"
          disabled={scale <= 0.5}
          onClick={() => setScale((current) => Math.max(0.5, Math.round((current - 0.1) * 100) / 100))}
        >
          −
        </button>
        <span className="manager-pdf-viewer__zoom">{Math.round(scale * 100)}%</span>
        <button
          className="manager-pdf-viewer__button"
          type="button"
          aria-label="Zoom in"
          disabled={scale >= 2}
          onClick={() => setScale((current) => Math.min(2, Math.round((current + 0.1) * 100) / 100))}
        >
          +
        </button>
        <button className="manager-pdf-viewer__fit" type="button"         disabled={!pageResult || pageResult.pageNumber !== pageNumber} onClick={fitWidth}>
          Fit width
        </button>
      </div>
      <div ref={viewportRef} className="manager-pdf-viewer__viewport">
        {error ? (
          <div className="manager-pdf-viewer__message" role="alert">{error}</div>
        ) : isLoading ? (
          <div className="manager-pdf-viewer__message" role="status">Preparing PDF preview…</div>
        ) : pageResult?.pageNumber === pageNumber ? (
          <div className="manager-pdf-viewer__page">
            <canvas ref={canvasRef} aria-label={`PDF page ${pageNumber}`} />
          </div>
        ) : (
          <div className="manager-pdf-viewer__message">A valid resume JSON is required to display the PDF.</div>
        )}
      </div>
    </div>
  );
}
