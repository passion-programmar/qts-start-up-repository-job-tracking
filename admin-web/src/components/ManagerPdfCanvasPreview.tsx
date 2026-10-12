'use client';

import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';

type ManagerPdfCanvasPreviewProps = {
  pdf: Blob | null;
};

type PdfPageCanvasProps = {
  document: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
};

function PdfPageCanvas({ document, pageNumber, scale }: PdfPageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pageResult, setPageResult] = useState<{ document: PDFDocumentProxy; page: PDFPageProxy } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    document.getPage(pageNumber).then((loadedPage) => {
      if (!cancelled) {
        setPageResult({ document, page: loadedPage });
        setError('');
      }
    }).catch((pageError: unknown) => {
      if (!cancelled) {
        setError(pageError instanceof Error ? pageError.message : 'Could not load this PDF page.');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [document, pageNumber]);

  const page = pageResult?.document === document ? pageResult.page : null;

  useEffect(() => {
    let task: RenderTask | null = null;
    const canvas = canvasRef.current;
    if (!page || !canvas) return undefined;

    const viewport = page.getViewport({ scale });
    const outputScale = window.devicePixelRatio || 1;
    const context = canvas.getContext('2d');
    if (!context) {
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
  }, [page, scale]);

  return (
    <article className="manager-pdf-viewer__page">
      <p className="manager-pdf-viewer__page-label">Page {pageNumber}</p>
      {error ? (
        <div className="manager-pdf-viewer__message" role="alert">{error}</div>
      ) : page ? (
        <canvas ref={canvasRef} aria-label={`PDF page ${pageNumber}`} />
      ) : (
        <div className="manager-pdf-viewer__message" role="status">Rendering page {pageNumber}…</div>
      )}
    </article>
  );
}

export function ManagerPdfCanvasPreview({ pdf }: ManagerPdfCanvasPreviewProps) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [scale, setScale] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(pdf));
  const [error, setError] = useState('');
  const [fitWidthScale, setFitWidthScale] = useState(1);
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
        setIsLoading(false);
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
    if (!document || !viewportRef.current) return undefined;
    let cancelled = false;
    let pageWidth = 0;
    const updateFitWidth = () => {
      if (!pageWidth || !viewportRef.current) return;
      const availableWidth = Math.max(200, viewportRef.current.clientWidth - 20);
      setFitWidthScale(Math.min(2, Math.max(0.35, availableWidth / pageWidth)));
    };
    const observer = new ResizeObserver(updateFitWidth);
    observer.observe(viewportRef.current);
    document.getPage(1).then((firstPage) => {
      if (cancelled) return;
      pageWidth = firstPage.getViewport({ scale: 1 }).width;
      updateFitWidth();
    }).catch((pageError: unknown) => {
      if (!cancelled) {
        setError(pageError instanceof Error ? pageError.message : 'Could not read the first PDF page.');
      }
    });
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [document]);

  const currentScale = scale ?? fitWidthScale;

  function fitWidth() {
    setScale(null);
  }

  return (
    <div className="manager-pdf-viewer">
      <div className="manager-pdf-viewer__toolbar" role="toolbar" aria-label="PDF preview controls">
        <span className="manager-pdf-viewer__page-count">
          {document ? `${document.numPages} page${document.numPages === 1 ? '' : 's'}` : 'PDF preview'}
        </span>
        <button
          className="manager-pdf-viewer__button"
          type="button"
          aria-label="Zoom out"
          disabled={currentScale <= 0.35}
          onClick={() => setScale((current) => Math.max(0.35, Math.round(((current ?? fitWidthScale) - 0.1) * 100) / 100))}
        >
          −
        </button>
        <span className="manager-pdf-viewer__zoom">{Math.round(currentScale * 100)}%</span>
        <button
          className="manager-pdf-viewer__button"
          type="button"
          aria-label="Zoom in"
          disabled={currentScale >= 2}
          onClick={() => setScale((current) => Math.min(2, Math.round(((current ?? fitWidthScale) + 0.1) * 100) / 100))}
        >
          +
        </button>
        <button className="manager-pdf-viewer__fit" type="button" disabled={!document} onClick={fitWidth}>
          Fit width
        </button>
      </div>
      <div ref={viewportRef} className="manager-pdf-viewer__viewport">
        {error ? (
          <div className="manager-pdf-viewer__message" role="alert">{error}</div>
        ) : isLoading ? (
          <div className="manager-pdf-viewer__message" role="status">Preparing PDF preview…</div>
        ) : document ? (
          <div className="manager-pdf-viewer__pages">
            {Array.from({ length: document.numPages }, (_, index) => (
              <PdfPageCanvas
                key={index + 1}
                document={document}
                pageNumber={index + 1}
                scale={currentScale}
              />
            ))}
          </div>
        ) : (
          <div className="manager-pdf-viewer__message">A valid resume JSON is required to display the PDF.</div>
        )}
      </div>
    </div>
  );
}
